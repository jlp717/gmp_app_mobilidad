'use strict';

const crypto = require('crypto');
const { db2AppTable } = require('../../utils/db2-schemas');

const STATE_EVENTS_TABLE = 'JAVIER.TEST_PEDIDO_STATE_EVENTS';
const PEDIDOS_CAB_TABLE = db2AppTable('PEDIDOS_CAB');
const SENSITIVE_KEY = /(authorization|cookie|password|passwd|secret|token|jwt|credential)/i;
const ALLOWED_STATES = new Set([
  'BORRADOR',
  'CONFIRMANDO',
  'CONFIRMADO',
  'CANCELANDO',
  'CANCELADO',
]);

function stateEventError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function assertAuditTarget() {
  const unitTest = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'test';
  if (!unitTest && !/^JAVIER\.TEST_PEDIDOS_CAB$/i.test(PEDIDOS_CAB_TABLE)) {
    throw stateEventError(
      'ORDER_STATE_AUDIT_TARGET_UNAVAILABLE',
      'La auditoria de estados solo esta habilitada en el esquema TEST aislado.',
      503,
    );
  }
}

function normalizeState(value, { nullable = false } = {}) {
  if (value == null || String(value).trim() === '') {
    if (nullable) return null;
    throw stateEventError('INVALID_ORDER_STATE', 'Estado de pedido requerido.', 400);
  }
  const state = String(value).trim().toUpperCase();
  if (!ALLOWED_STATES.has(state)) {
    throw stateEventError('INVALID_ORDER_STATE', `Estado de pedido no reconocido: ${state}`, 409);
  }
  return state;
}

function normalizeOriginalClientAt(value) {
  if (value == null || String(value).trim() === '') return null;
  const raw = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/.exec(raw);
  if (!match) {
    throw stateEventError(
      'INVALID_ORIGINAL_CLIENT_AT',
      'originalCreatedAt debe ser una fecha UTC ISO-8601 terminada en Z.',
      400,
    );
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText = ''] = match;
  const [year, month, day, hour, minute, second] = [
    yearText, monthText, dayText, hourText, minuteText, secondText,
  ].map(Number);
  const millis = Number((fractionText + '000').slice(0, 3));
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millis));
  const exactCalendar = year >= 1000
    && parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    && parsed.getUTCHours() === hour
    && parsed.getUTCMinutes() === minute
    && parsed.getUTCSeconds() === second;
  if (!exactCalendar) {
    throw stateEventError('INVALID_ORIGINAL_CLIENT_AT', 'originalCreatedAt no es una fecha valida.', 400);
  }
  const fraction = (fractionText || '0').padEnd(6, '0');
  return `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}.${fraction}Z`;
}

function normalizeDeviceId(value) {
  if (value == null) return null;
  const normalized = String(value).trim().slice(0, 128);
  if (!normalized || /^(?:unknown|unavailable|n\/a|null)$/i.test(normalized)) return null;
  return normalized;
}

function sanitizeAuditValue(value, seen = new WeakSet()) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => sanitizeAuditValue(item, seen));
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (SENSITIVE_KEY.test(key)) continue;
    result[key] = /^(?:deviceId|device_id)$/i.test(key)
      ? normalizeDeviceId(value[key])
      : sanitizeAuditValue(value[key], seen);
  }
  seen.delete(value);
  return result;
}

function canonicalPayload(payload) {
  return JSON.stringify(sanitizeAuditValue(payload || {}));
}

function payloadHash(payloadJson) {
  return crypto.createHash('sha256').update(payloadJson).digest('hex');
}

function toDb2Timestamp(iso) {
  if (!iso) return null;
  return String(iso).replace('T', ' ').replace(/Z$/, '');
}

async function appendOrderStateEvent(queryFn, {
  pedidoId,
  fromState,
  toState,
  actorId,
  actorRole,
  deviceId,
  reason,
  idempotencyKey,
  originalClientAt,
  payload,
}) {
  if (typeof queryFn !== 'function') throw new TypeError('queryFn transaccional requerido');
  assertAuditTarget();
  const id = Number.parseInt(pedidoId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw stateEventError('INVALID_ORDER_ID', 'Pedido invalido para auditoria.', 400);
  }
  const from = normalizeState(fromState, { nullable: true });
  const to = normalizeState(toState);
  const eventReason = reason == null ? null : String(reason).trim().slice(0, 500);
  if (to === 'CANCELADO' && !eventReason) {
    throw stateEventError('CANCELLATION_REASON_REQUIRED', 'El motivo de cancelacion es obligatorio.', 400);
  }
  const key = String(idempotencyKey || '').trim().slice(0, 128);
  if (!key) throw stateEventError('STATE_EVENT_IDEMPOTENCY_REQUIRED', 'Clave de auditoria requerida.', 400);
  const json = canonicalPayload(payload);
  const hash = payloadHash(json);
  const existing = await queryFn(
    `SELECT PAYLOAD_HASH, FROM_STATE, TO_STATE
       FROM ${STATE_EVENTS_TABLE}
      WHERE IDEMPOTENCY_KEY = ?`,
    [key],
  );
  if (Array.isArray(existing) && existing.length > 0) {
    const row = existing[0];
    const same = String(row.PAYLOAD_HASH || '').trim() === hash
      && (row.FROM_STATE == null ? null : String(row.FROM_STATE).trim()) === from
      && String(row.TO_STATE || '').trim() === to;
    if (!same) {
      throw stateEventError(
        'STATE_EVENT_IDEMPOTENCY_CONFLICT',
        'La clave de auditoria ya existe con otro contenido.',
        409,
      );
    }
    return { created: false, payloadHash: hash };
  }
  const originalIso = normalizeOriginalClientAt(originalClientAt);
  await queryFn(
    `INSERT INTO ${STATE_EVENTS_TABLE}
        (PEDIDO_ID, FROM_STATE, TO_STATE, ACTOR_ID, ACTOR_ROLE, DEVICE_ID,
         REASON, IDEMPOTENCY_KEY, PAYLOAD_JSON, PAYLOAD_HASH, ORIGINAL_CLIENT_AT)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      from,
      to,
      String(actorId || 'SYSTEM').trim().slice(0, 80) || 'SYSTEM',
      actorRole == null ? null : String(actorRole).trim().slice(0, 32),
      normalizeDeviceId(deviceId),
      eventReason,
      key,
      json,
      hash,
      toDb2Timestamp(originalIso),
    ],
  );
  return { created: true, payloadHash: hash };
}

function getOrderStateEvents(queryFn, pedidoId) {
  if (typeof queryFn !== 'function') throw new TypeError('queryFn requerido');
  return queryFn(
    `SELECT ID, PEDIDO_ID, FROM_STATE, TO_STATE, ACTOR_ID, ACTOR_ROLE,
            DEVICE_ID, REASON, IDEMPOTENCY_KEY, PAYLOAD_JSON, PAYLOAD_HASH,
            ORIGINAL_CLIENT_AT, SERVER_OCCURRED_AT
       FROM ${STATE_EVENTS_TABLE}
      WHERE PEDIDO_ID = ?
      ORDER BY SERVER_OCCURRED_AT ASC, ID ASC`,
    [Number.parseInt(pedidoId, 10)],
  );
}

module.exports = {
  ALLOWED_STATES,
  STATE_EVENTS_TABLE,
  appendOrderStateEvent,
  canonicalPayload,
  getOrderStateEvents,
  normalizeDeviceId,
  normalizeOriginalClientAt,
  normalizeState,
  payloadHash,
  sanitizeAuditValue,
};
