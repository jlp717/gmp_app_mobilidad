'use strict';

const crypto = require('crypto');
const { db2AppTable } = require('../../utils/db2-schemas');
const {
  assertStrictAppBufferProfile,
  requireAppBufferCapability,
  resolveAppBufferTable,
} = require('../../utils/db2-app-buffer-capability');

const STATE_EVENTS_TABLE = db2AppTable('PEDIDO_STATE_EVENTS');
const PEDIDOS_CAB_TABLE = db2AppTable('PEDIDOS_CAB');
const TIMELINE_DEFAULT_LIMIT = 25;
const TIMELINE_MAX_LIMIT = 100;
const DB2_BIGINT_MAX = 9223372036854775807n;
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
  const profile = assertStrictAppBufferProfile(process.env);
  const expectedEvents = resolveAppBufferTable('PEDIDO_STATE_EVENTS', profile);
  const isolated = profile.tableSet === 'isolated_test';
  const expectedHeader = isolated ? 'JAVIER.TEST_PEDIDOS_CAB' : 'JAVIER.PEDIDOS_CAB';
  if (!isolated
    || STATE_EVENTS_TABLE !== expectedEvents
    || PEDIDOS_CAB_TABLE !== expectedHeader) {
    throw stateEventError(
      'ORDER_STATE_AUDIT_TARGET_UNAVAILABLE',
      'La escritura de auditoria solo esta habilitada en el esquema TEST aislado.',
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

function normalizeTimelineBigInt(value, field, { nullable = true } = {}) {
  if (value == null || String(value).trim() === '') {
    if (nullable) return null;
    throw stateEventError(`INVALID_${field}`, `${field} requerido.`, 400);
  }
  const text = String(value).trim();
  if (!/^[1-9]\d*$/.test(text)) {
    throw stateEventError(`INVALID_${field}`, `${field} no valido.`, 400);
  }
  try {
    const parsed = BigInt(text);
    if (parsed > DB2_BIGINT_MAX) throw new RangeError('BIGINT overflow');
  } catch {
    throw stateEventError(`INVALID_${field}`, `${field} no valido.`, 400);
  }
  return text;
}

function normalizeTimelineLimit(value) {
  if (value == null || String(value).trim() === '') return TIMELINE_DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw stateEventError('INVALID_TIMELINE_LIMIT', 'timelineLimit no valido.', 400);
  }
  return Math.min(parsed, TIMELINE_MAX_LIMIT);
}

function normalizeTimelineReadOptions({ limit, cursor, eventId } = {}) {
  return {
    limit: normalizeTimelineLimit(limit),
    cursor: normalizeTimelineBigInt(cursor, 'TIMELINE_CURSOR'),
    eventId: normalizeTimelineBigInt(eventId, 'TIMELINE_EVENT_ID'),
  };
}

function getOrderStateEvents(queryFn, pedidoId, { limit, cursor } = {}) {
  if (typeof queryFn !== 'function') throw new TypeError('queryFn requerido');
  const pageLimit = normalizeTimelineLimit(limit);
  const normalizedCursor = normalizeTimelineBigInt(cursor, 'TIMELINE_CURSOR');
  const cursorClause = normalizedCursor ? 'AND ID < CAST(? AS BIGINT)' : '';
  return queryFn(
    `SELECT ID, PEDIDO_ID, FROM_STATE, TO_STATE, ACTOR_ID, ACTOR_ROLE,
            DEVICE_ID, REASON,
            VARCHAR_FORMAT(ORIGINAL_CLIENT_AT, 'YYYY-MM-DD"T"HH24:MI:SS.FF6')
              AS ORIGINAL_CLIENT_AT_TEXT,
            VARCHAR_FORMAT(SERVER_OCCURRED_AT, 'YYYY-MM-DD"T"HH24:MI:SS.FF6')
              AS SERVER_OCCURRED_AT_TEXT
       FROM ${STATE_EVENTS_TABLE}
      WHERE PEDIDO_ID = ?
        ${cursorClause}
      ORDER BY ID DESC
      FETCH FIRST ? ROWS ONLY`,
    [
      Number.parseInt(pedidoId, 10),
      ...(normalizedCursor ? [normalizedCursor] : []),
      pageLimit + 1,
    ],
  );
}

function getOrderStateEventSnapshot(queryFn, pedidoId, eventId) {
  if (typeof queryFn !== 'function') throw new TypeError('queryFn requerido');
  const normalizedEventId = normalizeTimelineBigInt(
    eventId,
    'TIMELINE_EVENT_ID',
    { nullable: false },
  );
  return queryFn(
    `SELECT ID, PEDIDO_ID, FROM_STATE, TO_STATE, ACTOR_ID, ACTOR_ROLE,
            DEVICE_ID, REASON, PAYLOAD_JSON,
            VARCHAR_FORMAT(ORIGINAL_CLIENT_AT, 'YYYY-MM-DD"T"HH24:MI:SS.FF6')
              AS ORIGINAL_CLIENT_AT_TEXT,
            VARCHAR_FORMAT(SERVER_OCCURRED_AT, 'YYYY-MM-DD"T"HH24:MI:SS.FF6')
              AS SERVER_OCCURRED_AT_TEXT
       FROM ${STATE_EVENTS_TABLE}
      WHERE PEDIDO_ID = ?
        AND ID = CAST(? AS BIGINT)
      FETCH FIRST 1 ROW ONLY`,
    [Number.parseInt(pedidoId, 10), normalizedEventId],
  );
}

function safeIdString(value) {
  if (value == null || String(value).trim() === '') return null;
  return String(value).trim();
}

function db2TimestampText(value, { utc = false } = {}) {
  if (value == null || String(value).trim() === '') return null;
  if (value instanceof Date) {
    const iso = value.toISOString();
    return utc ? iso : iso.replace(/Z$/, '');
  }
  const normalized = String(value).trim().replace(' ', 'T').replace(/Z$/i, '');
  return utc ? `${normalized}Z` : normalized;
}

function valueFor(object, ...keys) {
  if (!object || typeof object !== 'object') return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key)) return object[key];
  }
  return undefined;
}

function finiteNumberOrNull(value) {
  if (value == null || String(value).trim() === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timelineText(value, maxLength = 256) {
  if (value == null) return undefined;
  if (!['string', 'number', 'bigint', 'boolean'].includes(typeof value)) return null;
  return String(value).trim().slice(0, maxLength);
}

function compactObject(entries) {
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

function sanitizeTimelineHeader(header) {
  if (!header || typeof header !== 'object') return undefined;
  return compactObject([
    ['estado', timelineText(valueFor(header, 'estado', 'ESTADO'), 32)],
    ['total', finiteNumberOrNull(valueFor(header, 'total', 'IMPORTETOTAL'))],
    ['base', finiteNumberOrNull(valueFor(header, 'base', 'IMPORTEBASE'))],
    ['iva', finiteNumberOrNull(valueFor(header, 'iva', 'IMPORTEIVA'))],
    ['descuentoGlobal', finiteNumberOrNull(valueFor(
      header,
      'descuentoGlobal',
      'DESCUENTO_GLOBAL',
      'PORCENTAJEDESCUENTO1',
    ))],
    ['tipoVenta', timelineText(valueFor(header, 'tipoVenta', 'tipoventa', 'TIPOVENTA'), 16)],
  ]);
}

function sanitizeTimelineLine(line) {
  if (!line || typeof line !== 'object') return undefined;
  return compactObject([
    ['id', safeIdString(valueFor(line, 'id', 'ID'))],
    ['secuencia', finiteNumberOrNull(valueFor(line, 'sequence', 'secuencia', 'SECUENCIA'))],
    ['codigoArticulo', timelineText(valueFor(line, 'codigoArticulo', 'CODIGOARTICULO'), 10)],
    ['descripcion', timelineText(valueFor(line, 'descripcion', 'DESCRIPCION'), 256)],
    ['cantidadEnvases', finiteNumberOrNull(valueFor(line, 'cantidadEnvases', 'CANTIDADENVASES'))],
    ['cantidadUnidades', finiteNumberOrNull(valueFor(line, 'cantidadUnidades', 'CANTIDADUNIDADES'))],
    ['unidadMedida', timelineText(valueFor(line, 'unidadMedida', 'UNIDADMEDIDA'), 32)],
    ['precioVenta', finiteNumberOrNull(valueFor(line, 'precioVenta', 'PRECIOVENTA'))],
    ['precioTarifa', finiteNumberOrNull(valueFor(line, 'precioTarifa', 'PRECIOTARIFA'))],
    ['precioTarifaCliente', finiteNumberOrNull(valueFor(
      line,
      'precioTarifaCliente',
      'PRECIOTARIFACLIENTE',
    ))],
    ['descuentoLinea', finiteNumberOrNull(valueFor(
      line,
      'descuentoLinea',
      'DESCUENTO_LINEA',
      'PORCENTAJEDESCUENTO',
    ))],
    ['importeVenta', finiteNumberOrNull(valueFor(line, 'importeVenta', 'IMPORTEVENTA'))],
    ['tipoLinea', timelineText(valueFor(line, 'tipoLinea', 'TIPOLINEA'), 16)],
  ]);
}

function sanitizeTimelineSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return undefined;
  const lines = Array.isArray(snapshot.lines)
    ? snapshot.lines.map(sanitizeTimelineLine).filter(Boolean)
    : undefined;
  return compactObject([
    ['header', sanitizeTimelineHeader(snapshot.header)],
    ['lines', lines],
  ]);
}

function sanitizeTimelinePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const lines = Array.isArray(payload.lines)
    ? payload.lines.map(sanitizeTimelineLine).filter(Boolean)
    : undefined;
  const bolsa = payload.bolsa && typeof payload.bolsa === 'object'
    ? compactObject([
      ['consumo', finiteNumberOrNull(payload.bolsa.consumo)],
      ['acumulacion', finiteNumberOrNull(payload.bolsa.acumulacion)],
    ])
    : undefined;
  return compactObject([
    ['event', timelineText(valueFor(payload, 'event'), 64)],
    ['header', sanitizeTimelineHeader(payload.header)],
    ['lines', lines],
    ['before', sanitizeTimelineSnapshot(payload.before)],
    ['after', sanitizeTimelineSnapshot(payload.after)],
    ['bolsa', bolsa],
    ['originalClientAt', db2TimestampText(timelineText(payload.originalClientAt, 64), { utc: true })],
  ]);
}

function parseTimelinePayload(raw) {
  if (raw == null || String(raw).trim() === '') {
    return { payload: null, payloadStatus: 'missing' };
  }
  try {
    const parsed = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
    const payload = sanitizeTimelinePayload(parsed);
    return payload
      ? { payload, payloadStatus: 'available' }
      : { payload: null, payloadStatus: 'corrupt' };
  } catch {
    return { payload: null, payloadStatus: 'corrupt' };
  }
}

function mapOrderStateEventRow(row = {}) {
  const parsed = parseTimelinePayload(row.PAYLOAD_JSON ?? row.payloadJson);
  return {
    id: safeIdString(row.ID ?? row.id),
    orderId: safeIdString(row.PEDIDO_ID ?? row.pedidoId),
    fromState: row.FROM_STATE == null ? null : String(row.FROM_STATE).trim(),
    toState: row.TO_STATE == null ? null : String(row.TO_STATE).trim(),
    actorId: row.ACTOR_ID == null ? null : String(row.ACTOR_ID).trim(),
    actorRole: row.ACTOR_ROLE == null ? null : String(row.ACTOR_ROLE).trim(),
    deviceId: normalizeDeviceId(row.DEVICE_ID ?? row.deviceId),
    reason: row.REASON == null ? null : String(row.REASON).trim(),
    originalClientAtUtc: db2TimestampText(
      row.ORIGINAL_CLIENT_AT_TEXT ?? row.ORIGINAL_CLIENT_AT,
      { utc: true },
    ),
    serverOccurredAtLocal: db2TimestampText(
      row.SERVER_OCCURRED_AT_TEXT ?? row.SERVER_OCCURRED_AT,
    ),
    serverTimeZone: 'Europe/Madrid',
    ...parsed,
  };
}

function mapOrderStateEventSummaryRow(row = {}) {
  const event = mapOrderStateEventRow(row);
  delete event.payload;
  delete event.payloadStatus;
  return event;
}

function isOrderStateTimelineSupported(env = process.env) {
  try {
    const profile = assertStrictAppBufferProfile(env);
    const expectedEvents = resolveAppBufferTable('PEDIDO_STATE_EVENTS', profile);
    const expectedHeader = profile.tableSet === 'isolated_test'
      ? 'JAVIER.TEST_PEDIDOS_CAB'
      : 'JAVIER.PEDIDOS_CAB';
    return STATE_EVENTS_TABLE === expectedEvents && PEDIDOS_CAB_TABLE === expectedHeader;
  } catch {
    return false;
  }
}

async function readOrderStateTimeline(
  queryFn,
  pedidoId,
  {
    env = process.env,
    limit,
    cursor,
    eventId,
  } = {},
) {
  if (!isOrderStateTimelineSupported(env)) {
    return {
      status: 'unavailable',
      code: 'ORDER_TIMELINE_UNSUPPORTED_PROFILE',
      events: [],
    };
  }
  const normalizedOptions = normalizeTimelineReadOptions({ limit, cursor, eventId });
  const pageLimit = normalizedOptions.limit;
  const normalizedCursor = normalizedOptions.cursor;
  const normalizedEventId = normalizedOptions.eventId;
  try {
    await requireAppBufferCapability({
      family: 'audit',
      env,
      catalogQuery: queryFn,
    });
    const rows = await getOrderStateEvents(queryFn, pedidoId, {
      limit: pageLimit,
      cursor: normalizedCursor,
    });
    const hasMore = (rows || []).length > pageLimit;
    const events = (rows || []).slice(0, pageLimit).map(mapOrderStateEventSummaryRow);
    const result = {
      status: 'available',
      events,
      hasMore,
      nextCursor: hasMore && events.length > 0 ? events[events.length - 1].id : null,
    };
    if (normalizedEventId) {
      try {
        const snapshotRows = await getOrderStateEventSnapshot(
          queryFn,
          pedidoId,
          normalizedEventId,
        );
        result.snapshot = snapshotRows?.[0]
          ? mapOrderStateEventRow(snapshotRows[0])
          : null;
        result.snapshotStatus = result.snapshot ? 'available' : 'not_found';
      } catch {
        result.snapshot = null;
        result.snapshotStatus = 'unavailable';
        result.snapshotCode = 'ORDER_TIMELINE_SNAPSHOT_UNAVAILABLE';
      }
    }
    return result;
  } catch (error) {
    return {
      status: 'unavailable',
      code: error?.code === 'APP_BUFFER_CAPABILITY_UNAVAILABLE'
        ? 'ORDER_TIMELINE_CAPABILITY_UNAVAILABLE'
        : 'ORDER_TIMELINE_READ_UNAVAILABLE',
      events: [],
    };
  }
}

module.exports = {
  ALLOWED_STATES,
  STATE_EVENTS_TABLE,
  appendOrderStateEvent,
  canonicalPayload,
  getOrderStateEvents,
  getOrderStateEventSnapshot,
  isOrderStateTimelineSupported,
  mapOrderStateEventRow,
  mapOrderStateEventSummaryRow,
  normalizeTimelineBigInt,
  normalizeTimelineLimit,
  normalizeTimelineReadOptions,
  normalizeDeviceId,
  normalizeOriginalClientAt,
  normalizeState,
  payloadHash,
  readOrderStateTimeline,
  sanitizeAuditValue,
  sanitizeTimelinePayload,
};
