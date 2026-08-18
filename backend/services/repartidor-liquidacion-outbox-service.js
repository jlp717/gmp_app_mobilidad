'use strict';

/**
 * Drain REPARTIDOR_LIQUIDACION_OUTBOX PENDING rows and send liquidacion emails.
 */

const { queryWithParams } = require('../config/db');
const { resolveRepartoRuntime } = require('../config/reparto-runtime');
const logger = require('../middleware/logger');
const {
  formatGmpLiquidacionDisplay,
  cashToDeposit,
} = require('./liquidacion-pdf-service');

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

async function markOutbox(id, status, error, { query, tables }) {
  await query(
    `UPDATE ${tables.liquidationOutbox} SET STATUS = ? WHERE ID = ?`,
    [status, id],
  );
  if (error) {
    logger.warn(`[liq-outbox] id=${id} marked ${status}: ${error}`);
  }
}

/**
 * Send immediately from closeDay result (preferred path).
 */
async function processLiquidacionOutboxIntent({
  liquidacion,
  repartidorId,
  outboxId = null,
} = {}, {
  query = queryWithParams,
  env = process.env,
  sendEmails = null,
} = {}) {
  if (!liquidacion) return { sent: 0, skipped: true };
  const send = sendEmails || getSendLiquidacionEmails();

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
    const ok = Array.isArray(results) && results.length > 0 && results.every((r) => r.success);
    if (outboxId != null) {
      const tables = financeTables(env);
      await markOutbox(outboxId, ok ? 'SENT' : 'FAILED', ok ? null : 'send failed', { query, tables });
    }
    return { sent: (results || []).filter((r) => r.success).length, results, skipped: false };
  } catch (error) {
    logger.error(`[liq-outbox] send failed: ${error.message}`);
    if (outboxId != null) {
      try {
        const tables = financeTables(env);
        await markOutbox(outboxId, 'FAILED', error.message, { query, tables });
      } catch (_) { /* ignore */ }
    }
    return { sent: 0, error: error.message, skipped: false };
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
        await markOutbox(outboxId, 'FAILED', 'liquidacion ops missing', { query, tables });
        continue;
      }
      const liquidacion = mapLiquidacionFromOps(opsRows[0]);
      const result = await processLiquidacionOutboxIntent({
        liquidacion,
        repartidorId: liquidacion.repartidorId,
        outboxId,
      }, { query, env, sendEmails: send });
      sent += result.sent || 0;
    } catch (error) {
      logger.error(`[liq-outbox] process id=${outboxId} failed: ${error.message}`);
      try {
        await markOutbox(outboxId, 'FAILED', error.message, { query, tables });
      } catch (_) { /* ignore */ }
    }
  }

  return { processed: (rows || []).length, sent };
}

module.exports = {
  processLiquidacionOutboxIntent,
  processPendingLiquidacionOutbox,
  mapLiquidacionFromOps,
};
