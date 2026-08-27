'use strict';

/**
 * Drain REPARTIDOR_LIQUIDACION_OUTBOX PENDING rows and send liquidacion emails.
 */

const { queryWithParams } = require('../config/db');
const crypto = require('crypto');
const { resolveRepartoRuntime } = require('../config/reparto-runtime');
const logger = require('../middleware/logger');
const {
  formatGmpLiquidacionDisplay,
  cashToDeposit,
} = require('./liquidacion-pdf-service');
const { redactDeliverySummary } = require('./reparto-email-delivery-policy');

function getSendLiquidacionEmails() {
  // Lazy require avoids circular load with finance service.
  return require('./repartidor-finance-service').sendLiquidacionEmails;
}

function financeTables(env = process.env) {
  const runtime = resolveRepartoRuntime(env);
  if (!runtime.valid || !runtime.tables?.finance?.liquidationOutbox) {
    throw new Error('Liquidacion outbox unavailable in reparto runtime');
  }
  return runtime.tables.finance;
}

function rowValue(row, key) {
  if (!row) return undefined;
  if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  const lower = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(row, lower)) return row[lower];
  const upper = key.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(row, upper)) return row[upper];
  return undefined;
}

function safeJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw || '{}');
  } catch (_) {
    return {};
  }
}

// The deployed DB2 contract has no PROCESSING status. A cryptographic claim
// stored in PAYLOAD_JSON makes FAILED serve as a fail-closed in-flight state:
// a crashed worker cannot be retried automatically and therefore cannot cause
// a concurrent/duplicate SMTP send.
const OUTBOX_CLAIM_KEY = '_repartoDeliveryClaim';
const OUTBOX_REQUEUE_KEY = '_repartoRequeue';
const MAX_OUTBOX_PAYLOAD_BYTES = 3500;

function serializeOutboxPayload(payload) {
  const serialized = JSON.stringify(payload);
  return Buffer.byteLength(serialized, 'utf8') <= MAX_OUTBOX_PAYLOAD_BYTES
    ? serialized : null;
}

function parseOutboxPayload(raw) {
  if (raw && typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function buildOutboxClaim(rawPayload, token) {
  const payload = parseOutboxPayload(rawPayload);
  if (!payload) return null;
  return serializeOutboxPayload({
    ...payload,
    [OUTBOX_CLAIM_KEY]: { token, claimedAt: new Date().toISOString() },
  });
}

function buildOutboxRequeue(rawPayload, token) {
  const payload = parseOutboxPayload(rawPayload);
  if (!payload) return null;
  delete payload[OUTBOX_CLAIM_KEY];
  return serializeOutboxPayload({
    ...payload,
    [OUTBOX_REQUEUE_KEY]: { token, requestedAt: new Date().toISOString() },
  });
}

function hasOutboxRequeue(rawPayload, token) {
  const payload = parseOutboxPayload(rawPayload);
  return String(payload?.[OUTBOX_REQUEUE_KEY]?.token || '') === String(token || '');
}

function hasOutboxClaim(rawPayload, token = null) {
  const payload = parseOutboxPayload(rawPayload);
  const actual = payload?.[OUTBOX_CLAIM_KEY]?.token;
  return token === null ? Boolean(actual) : String(actual || '') === String(token || '');
}

function withoutOutboxClaim(rawPayload) {
  const payload = parseOutboxPayload(rawPayload);
  if (!payload) return null;
  delete payload[OUTBOX_CLAIM_KEY];
  return serializeOutboxPayload(payload);
}

async function claimOutboxForDelivery(id, rawPayload, { query, tables }) {
  let payload = rawPayload;
  if (payload == null) {
    const rows = await query(
      `SELECT PAYLOAD_JSON FROM ${tables.liquidationOutbox}
        WHERE ID = ? AND STATUS = 'PENDING'
        FETCH FIRST 1 ROW ONLY`,
      [id],
    );
    if (!rows?.length) return null;
    payload = rowValue(rows[0], 'PAYLOAD_JSON');
  }
  const token = crypto.randomBytes(18).toString('base64url');
  const claimedPayload = buildOutboxClaim(payload, token);
  if (!claimedPayload) return null;
  await query(
    `UPDATE ${tables.liquidationOutbox}
        SET STATUS = 'FAILED', PAYLOAD_JSON = ?
      WHERE ID = ? AND STATUS = 'PENDING'`,
    [claimedPayload, id],
  );
  const rows = await query(
    `SELECT STATUS, PAYLOAD_JSON FROM ${tables.liquidationOutbox}
      WHERE ID = ? AND STATUS = 'FAILED'
      FETCH FIRST 1 ROW ONLY`,
    [id],
  );
  return rows?.length && hasOutboxClaim(rowValue(rows[0], 'PAYLOAD_JSON'), token)
    ? { token, payload: claimedPayload }
    : null;
}

async function completeClaimedOutbox(id, token, status, { payload, results = [], error = null } = {}, { query, tables }) {
  const merged = deliveryPayload(payload, results, error);
  delete merged[OUTBOX_CLAIM_KEY];
  const serialized = serializeOutboxPayload(merged);
  if (!serialized) throw new Error('outbox delivery payload exceeds safe limit');
  await query(
    `UPDATE ${tables.liquidationOutbox}
        SET STATUS = ?, PAYLOAD_JSON = ?
      WHERE ID = ? AND STATUS = 'FAILED'
        AND LOCATE(CAST(? AS VARCHAR(64)), PAYLOAD_JSON) > 0`,
    [status, serialized, id, token],
  );
  const rows = await query(
    `SELECT STATUS, PAYLOAD_JSON FROM ${tables.liquidationOutbox}
      WHERE ID = ? AND STATUS = ?
      FETCH FIRST 1 ROW ONLY`,
    [id, status],
  );
  return Boolean(rows?.length) && !hasOutboxClaim(rowValue(rows[0], 'PAYLOAD_JSON'));
}

function mapLiquidacionFromOps(row) {
  const snapshot = safeJson(rowValue(row, 'SNAPSHOT_JSON'));
  const replay = safeJson(rowValue(row, 'REPLAY_IDENTITY_JSON'));
  const repartidorId = String(
    rowValue(row, 'CODIGOVENDEDOR')
      || replay.repartidorId
      || '',
  ).trim();
  const dia = Number(rowValue(row, 'DIALIQUIDACION'));
  const mes = Number(rowValue(row, 'MESLIQUIDACION'));
  const ano = Number(rowValue(row, 'ANOLIQUIDACION'));
  const date = replay.date
    || (Number.isFinite(ano) && Number.isFinite(mes) && Number.isFinite(dia)
      ? `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
      : '');
  const numeroValue = Number(rowValue(row, 'NUMEROLIQUIDACION')) || Number(rowValue(row, 'ID'));
  const year = Number(rowValue(row, 'ANOLIQUIDACION'))
    || Number(rowValue(row, 'EJERCICIOLIQUIDACION'))
    || (date ? Number(String(date).slice(0, 4)) : new Date().getFullYear());
  const totalEfectivo = Number(rowValue(row, 'IMPORTEEFECTIVO') ?? snapshot?.breakdown?.cash);
  const totalCheques = Number(rowValue(row, 'IMPORTECHEQUES') ?? 0);
  const totalTarjeta = Number(rowValue(row, 'IMPORTETARJETA') ?? 0);
  const totalPostdatados = Number(rowValue(row, 'IMPORTEPOSTDATADOS') ?? 0);
  const saldoActual = Number(rowValue(row, 'IMPORTESALDOACTUAL') ?? snapshot?.openingBalance ?? 0);
  const expenses = Number(
    rowValue(row, 'IMPORTEGASTOS')
      ?? snapshot?.breakdown?.expenses
      ?? snapshot?.expenses
      ?? 0,
  );
  const adjustments = Number(snapshot?.breakdown?.adjustments ?? snapshot?.adjustments ?? 0);
  const bankDeposits = Number(
    rowValue(row, 'IMPORTEINGRESOENBANCO')
      ?? snapshot?.breakdown?.bankDeposits
      ?? snapshot?.bankDeposits
      ?? 0,
  );
  const payments = Number(
    snapshot?.breakdown?.payments
      ?? snapshot?.payments
      ?? (totalEfectivo + totalCheques + totalTarjeta + totalPostdatados),
  );
  const totalAIngresar = Number(rowValue(row, 'IMPORTETOTALAINGRESAR'));
  const resolvedEfectivo = Number.isFinite(totalEfectivo) ? totalEfectivo : Number(payments) || 0;
  const resolvedIngresar = Number.isFinite(totalAIngresar)
    ? totalAIngresar
    : cashToDeposit({
      totalEfectivo: resolvedEfectivo,
      totalCheques: Number.isFinite(totalCheques) ? totalCheques : 0,
      totalPostdatados: Number.isFinite(totalPostdatados) ? totalPostdatados : 0,
      saldoActual: Number.isFinite(saldoActual) ? saldoActual : 0,
      gastos: Number.isFinite(expenses) ? expenses : 0,
      ajustes: Number.isFinite(adjustments) ? adjustments : 0,
    });
  const ingresoBanco = Number.isFinite(bankDeposits) ? bankDeposits : 0;

  return {
    id: String(rowValue(row, 'ID')),
    repartidorId,
    date,
    status: String(rowValue(row, 'STATUS') || 'CLOSED').trim(),
    numero: {
      display: formatGmpLiquidacionDisplay({
        year,
        vendorCode: repartidorId,
        serie: rowValue(row, 'SERIELIQUIDACION') || 'A',
        numero: numeroValue,
      }),
      value: numeroValue,
      ejercicio: year,
      serie: String(rowValue(row, 'SERIELIQUIDACION') || 'A').trim() || 'A',
      numero: numeroValue,
    },
    totals: {
      totalEfectivo: resolvedEfectivo,
      totalCheques: Number.isFinite(totalCheques) ? totalCheques : 0,
      totalTarjeta: Number.isFinite(totalTarjeta) ? totalTarjeta : 0,
      totalPostdatados: Number.isFinite(totalPostdatados) ? totalPostdatados : 0,
      saldoActual: Number.isFinite(saldoActual) ? saldoActual : 0,
      gastos: Number.isFinite(expenses) ? expenses : 0,
      ajustes: Number.isFinite(adjustments) ? adjustments : 0,
      totalAIngresar: resolvedIngresar,
      ingresoBanco,
      diff: Math.round((resolvedIngresar - ingresoBanco + Number.EPSILON) * 100) / 100,
      payments: Number.isFinite(payments) ? payments : resolvedEfectivo,
      expenses: Number.isFinite(expenses) ? expenses : 0,
      adjustments: Number.isFinite(adjustments) ? adjustments : 0,
      bankDeposits: ingresoBanco,
    },
    snapshot,
  };
}

function redactOutboxError(error) {
  const raw = String(error?.code || error?.message || error || 'email delivery failed');
  return raw
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 240);
}

function deliveryPayload(payload, results, error) {
  const previous = safeJson(payload);
  const summary = redactDeliverySummary(results);
  return {
    ...previous,
    delivery: {
      attempted: summary.attempted,
      sent: summary.sent,
      failed: summary.failed,
      allSucceeded: summary.allSucceeded,
      lastError: error ? redactOutboxError(error) : null,
    },
  };
}

async function markOutbox(id, status, { error = null, payload = null, results = [] } = {}, { query, tables }) {
  const serializedPayload = JSON.stringify(deliveryPayload(payload, results, error));
  await query(
    `UPDATE ${tables.liquidationOutbox}
        SET STATUS = ?, PAYLOAD_JSON = ?
      WHERE ID = ? AND STATUS = 'PENDING'`,
    [status, serializedPayload, id],
  );
  if (error) {
    logger.warn(`[liq-outbox] id=${id} marked ${status}: ${redactOutboxError(error)}`);
  }
}

/**
 * Send immediately from closeDay result (preferred path).
 */
async function processLiquidacionOutboxIntent({
  liquidacion,
  repartidorId,
  outboxId = null,
  outboxPayload = null,
} = {}, {
  query = queryWithParams,
  env = process.env,
  sendEmails = null,
} = {}) {
  if (!liquidacion) return { sent: 0, skipped: true };
  const send = sendEmails || getSendLiquidacionEmails();
  let tables = null;
  let claim = null;
  if (outboxId != null) {
    tables = financeTables(env);
    claim = await claimOutboxForDelivery(outboxId, outboxPayload, { query, tables });
    if (!claim) {
      // Another worker owns it or the legacy payload is unsafe to claim.
      // Never fall through to SMTP in either case.
      return { sent: 0, skipped: true, reason: 'outbox_claim_unavailable' };
    }
  }

  const payments = Array.isArray(liquidacion.snapshot?.payments)
    ? liquidacion.snapshot.payments
    : [];
  const cobros = payments.map((p) => ({
    fecha: liquidacion.date || '',
    codigoCliente: p.codigoCliente || '',
    nombreCliente: p.nombreCliente || '',
    tipoCobro: p.paymentMethod || p.tipoCobro || '',
    tipoDocumento: p.tipoDocumento || '',
    documento: p.documento || p.id || '',
    importe: Number(p.amount) || 0,
  }));

  const totals = liquidacion.totals || {
    totalEfectivo: Number(liquidacion.snapshot?.payments) || 0,
    totalAIngresar: Number(liquidacion.snapshot?.balance) || 0,
    ingresoBanco: Number(liquidacion.snapshot?.bankDeposits) || 0,
    diff: 0,
  };

  const shaped = {
    ...liquidacion,
    repartidorId: repartidorId || liquidacion.repartidorId,
    numero: liquidacion.numero?.display
      ? liquidacion.numero
      : {
        display: formatGmpLiquidacionDisplay({
          year: liquidacion.date ? Number(String(liquidacion.date).slice(0, 4)) : 0,
          vendorCode: repartidorId || liquidacion.repartidorId,
          numero: liquidacion.numero?.value || liquidacion.numero?.numero || liquidacion.id,
        }),
        value: liquidacion.numero?.value || liquidacion.id,
      },
    totals: {
      totalEfectivo: Number(totals.totalEfectivo ?? liquidacion.snapshot?.payments ?? 0),
      totalAIngresar: Number(totals.totalAIngresar ?? liquidacion.snapshot?.balance ?? 0),
      ingresoBanco: Number(totals.ingresoBanco ?? liquidacion.snapshot?.bankDeposits ?? 0),
      diff: Number(totals.diff ?? 0),
    },
  };

  try {
    const results = await send({
      liquidacion: shaped,
      repartidorEmail: null, // resolved inside sendLiquidacionEmails via directory
      repartidorName: '',
      cobros,
    });
    const summary = redactDeliverySummary(results);
    const ok = summary.allSucceeded;
    if (outboxId != null) {
      const completed = await completeClaimedOutbox(outboxId, claim.token, ok ? 'SENT' : 'FAILED', {
        payload: claim.payload,
        results,
        error: ok ? null : 'incomplete email delivery',
      }, { query, tables });
      if (!completed) return { sent: 0, skipped: true, reason: 'outbox_claim_lost' };
    }
    return { sent: summary.sent, results, delivery: summary, skipped: false };
  } catch (error) {
    const redactedError = redactOutboxError(error);
    logger.error(`[liq-outbox] send failed: ${redactedError}`);
    if (outboxId != null) {
      try {
        await completeClaimedOutbox(outboxId, claim.token, 'FAILED', {
          payload: claim.payload,
          error: redactedError,
        }, { query, tables });
      } catch (_) { /* ignore */ }
    }
    return { sent: 0, error: redactedError, skipped: false };
  }
}

/**
 * Drain PENDING outbox rows (scheduler / recovery).
 */
async function processPendingLiquidacionOutbox({
  query = queryWithParams,
  env = process.env,
  limit = 25,
  sendEmails = null,
} = {}) {
  const tables = financeTables(env);
  const send = sendEmails || getSendLiquidacionEmails();
  let rows = [];
  try {
    rows = await query(
      `SELECT ID, LIQUIDACION_ID, OUTBOX_TYPE, STATUS, PAYLOAD_JSON, CREATED_AT
         FROM ${tables.liquidationOutbox}
        WHERE STATUS = 'PENDING'
        ORDER BY CREATED_AT
        FETCH FIRST ${Math.max(1, Math.min(100, Number(limit) || 25))} ROWS ONLY`,
      [],
    );
  } catch (error) {
    logger.warn(`[liq-outbox] pending query failed: ${error.message}`);
    return { processed: 0, sent: 0 };
  }

  let sent = 0;
  for (const row of rows || []) {
    const outboxId = rowValue(row, 'ID');
    const liquidacionId = rowValue(row, 'LIQUIDACION_ID');
    try {
      const opsRows = await query(
        `SELECT ID, CODIGOVENDEDOR, DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION,
                NUMEROLIQUIDACION, STATUS, REPLAY_IDENTITY_JSON, SNAPSHOT_JSON
           FROM ${tables.liquidationOps}
          WHERE ID = ?
          FETCH FIRST 1 ROW ONLY`,
        [liquidacionId],
      );
      if (!opsRows?.length) {
        await markOutbox(outboxId, 'FAILED', {
          payload: rowValue(row, 'PAYLOAD_JSON'),
          error: 'liquidacion ops missing',
        }, { query, tables });
        continue;
      }
      const liquidacion = mapLiquidacionFromOps(opsRows[0]);
      const result = await processLiquidacionOutboxIntent({
        liquidacion,
        repartidorId: liquidacion.repartidorId,
        outboxId,
        outboxPayload: rowValue(row, 'PAYLOAD_JSON'),
      }, { query, env, sendEmails: send });
      sent += result.sent || 0;
    } catch (error) {
      logger.error(`[liq-outbox] process id=${outboxId} failed: ${redactOutboxError(error)}`);
      try {
        await markOutbox(outboxId, 'FAILED', {
          payload: rowValue(row, 'PAYLOAD_JSON'),
          error,
        }, { query, tables });
      } catch (_) { /* ignore */ }
    }
  }

  return { processed: (rows || []).length, sent };
}

async function requeueFailedLiquidacionOutbox({ idempotencyToken, canAccessRepartidor }, {
  query = queryWithParams,
  env = process.env,
} = {}) {
  const tables = financeTables(env);
  const rows = await query(
    `SELECT O.ID, O.STATUS, O.PAYLOAD_JSON, L.CODIGOVENDEDOR
       FROM ${tables.liquidationOutbox} O
       JOIN ${tables.liquidationOps} L ON L.ID = O.LIQUIDACION_ID
      WHERE L.IDEMPOTENCY_TOKEN = ?
      ORDER BY O.CREATED_AT DESC
      FETCH FIRST 1 ROW ONLY`,
    [idempotencyToken],
  );
  const row = rows?.[0];
  if (!row) return { requeued: false, reason: 'not_found' };
  const repartidorId = String(rowValue(row, 'CODIGOVENDEDOR') || '').trim();
  if (!repartidorId || typeof canAccessRepartidor !== 'function' || !canAccessRepartidor(repartidorId)) {
    return { requeued: false, reason: 'forbidden' };
  }
  if (String(rowValue(row, 'STATUS') || '').trim() !== 'FAILED') {
    return { requeued: false, reason: 'not_failed' };
  }
  // A FAILED row containing a claim is possibly in-flight. Never requeue it:
  // doing so could race an SMTP call and create a duplicate delivery.
  const currentPayload = rowValue(row, 'PAYLOAD_JSON');
  if (hasOutboxClaim(currentPayload)) return { requeued: false, reason: 'claimed' };
  const requeueToken = crypto.randomBytes(18).toString('base64url');
  const requeuedPayload = buildOutboxRequeue(currentPayload, requeueToken);
  if (!requeuedPayload) return { requeued: false, reason: 'unsafe_payload' };
  const id = rowValue(row, 'ID');
  await query(
    `UPDATE ${tables.liquidationOutbox}
        SET STATUS = 'PENDING', PAYLOAD_JSON = ?
      WHERE ID = ? AND STATUS = 'FAILED' AND PAYLOAD_JSON = ?`,
    [requeuedPayload, id, currentPayload],
  );
  const verified = await query(
    `SELECT STATUS, PAYLOAD_JSON FROM ${tables.liquidationOutbox}
      WHERE ID = ? AND STATUS = 'PENDING'
      FETCH FIRST 1 ROW ONLY`,
    [id],
  );
  const requeued = Boolean(verified?.length) && hasOutboxRequeue(
    rowValue(verified[0], 'PAYLOAD_JSON'), requeueToken,
  );
  return requeued
    ? { requeued: true, outboxId: String(id), repartidorId }
    : { requeued: false, reason: 'requeue_lost' };
}

module.exports = {
  processLiquidacionOutboxIntent,
  processPendingLiquidacionOutbox,
  mapLiquidacionFromOps,
  redactOutboxError,
  requeueFailedLiquidacionOutbox,
};
