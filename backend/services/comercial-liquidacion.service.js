'use strict';

const { queryWithParams, getPool } = require('../config/db');
const { db2ErpTable, db2WriteTable } = require('../utils/db2-schemas');
const logger = require('../middleware/logger');

const ERP_LQD = db2ErpTable('LQD');
const WRITE_LQD = db2WriteTable('COBROS_LIQ');
const WRITE_COBROS_CAB = db2WriteTable('COBROS_CAB');
const WRITE_COBROS_COUNTER = db2WriteTable('COBROS_NUMERO_COUNTER');

// ponytail: in-memory idempotency for tests + fast replay. upgrade: DB-only when COBROS_LIQ markers are enough.
const closeState = new Map();
const liquidacionNumeroTails = new Map();

function roundMoney(value) {
  const num = Number.parseFloat(String(value ?? 0));
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function toCents(value) {
  return Math.round((Number(value) || 0) * 100);
}

function parseIsoDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null;
  const [year, month, day] = String(date).split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function isValidCalendarDate(value) {
  return parseIsoDate(value) != null;
}

function resolveRowDate(row, dateFallback) {
  if (dateFallback) return dateFallback;
  const year = Number(row?.ANOLIQUIDACION);
  const month = Number(row?.MESLIQUIDACION);
  const day = Number(row?.DIALIQUIDACION);
  if (year && month && day) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${year}-${pad(month)}-${pad(day)}`;
  }
  return '';
}

function mapLqdSummaryRow(row, date) {
  const num = (v) => Number.parseFloat(String(v ?? 0)) || 0;
  const efectivo = num(row.IMPORTEEFECTIVO);
  const tarjeta = num(row.IMPORTETARJETA);
  const cheques = num(row.IMPORTECHEQUES);
  const postdatados = num(row.IMPORTEPOSTDATADOS);
  const totalCobros = roundMoney(efectivo + tarjeta + cheques + postdatados);
  const totalAIngresar = num(row.IMPORTETOTALAINGRESAR);
  const ingresoBanco = num(row.IMPORTEINGRESOENBANCO);
  const deltaBanco = roundMoney(totalAIngresar - ingresoBanco);

  return {
    vendedorId: String(row.CODIGOVENDEDOR || '').trim(),
    vendorCode: String(row.CODIGOVENDEDOR || '').trim(),
    date: resolveRowDate(row, date),
    liquidacionNumero: Number(row.NUMEROLIQUIDACION) || 0,
    efectivo,
    tarjeta,
    cheques,
    postdatados,
    totalCobros,
    saldoActual: num(row.IMPORTESALDOACTUAL),
    totalAIngresar,
    ingresoBanco,
    deltaBanco,
    totalEfectivo: efectivo,
    totalTarjeta: tarjeta,
    totalCheques: cheques,
    totalPostdatados: postdatados,
    totalCobrosDia: totalCobros,
    delta: deltaBanco,
    cardDetailAggregateOnly: true,
  };
}

function normalizeClosePayload(payload) {
  const totals = payload.totals || {};
  return {
    ...payload,
    vendedorId: String(payload.vendedorId || payload.vendorCode || '').trim(),
    idempotencyKey: String(payload.idempotencyKey || payload.idempotencyToken || '').trim(),
    totals: {
      efectivo: totals.efectivo ?? totals.totalEfectivo,
      tarjeta: totals.tarjeta ?? totals.totalTarjeta,
      cheques: totals.cheques ?? totals.totalCheques,
      postdatados: totals.postdatados ?? totals.totalPostdatados,
      totalCobros: totals.totalCobros ?? totals.totalCobrosDia,
      saldoActual: totals.saldoActual,
      totalAIngresar: totals.totalAIngresar ?? payload.totalAIngresar,
    },
  };
}

function validateClosePayload(payload) {
  const body = normalizeClosePayload(payload || {});
  if (!isValidCalendarDate(body.date)) {
    throw new Error('Fecha invalida');
  }
  if (!body.vendedorId) {
    throw new Error('vendedorId requerido');
  }
  if (!body.idempotencyKey) {
    throw new Error('idempotencyKey requerido');
  }
  const ingresoBanco = roundMoney(body.ingresoBanco);
  const entregado = roundMoney(body.entregado ?? 0);
  if (ingresoBanco < 0 || entregado < 0) {
    throw new Error('Importe negativo no permitido');
  }
  const expectedTotal = body.totals?.totalAIngresar;
  if (expectedTotal != null) {
    const registered = roundMoney(ingresoBanco + entregado);
    if (Math.abs(registered - roundMoney(expectedTotal)) > 0.01) {
      throw new Error('Descuadre en liquidacion');
    }
  }
  return body;
}

function buildLiquidacionRecord(payload) {
  const body = normalizeClosePayload(payload);
  const totals = body.totals || {};
  return {
    idempotencyKey: body.idempotencyKey,
    idempotencyToken: body.idempotencyKey,
    vendedorId: body.vendedorId,
    vendorCode: body.vendedorId,
    date: body.date,
    ingresoBanco: roundMoney(body.ingresoBanco),
    entregado: roundMoney(body.entregado ?? 0),
    totals: {
      efectivo: roundMoney(totals.efectivo),
      tarjeta: roundMoney(totals.tarjeta),
      cheques: roundMoney(totals.cheques),
      postdatados: roundMoney(totals.postdatados),
      totalCobros: roundMoney(totals.totalCobros),
      saldoActual: roundMoney(totals.saldoActual),
      totalAIngresar: roundMoney(totals.totalAIngresar),
    },
  };
}

function mapRegisteredCobrosRow(row) {
  if (row?.REGISTERED_CENTS != null) {
    return { registeredCents: Number(row.REGISTERED_CENTS) || 0 };
  }
  if (!row || (row.TOTAL_COBROS == null && row.TOTAL_A_INGRESAR == null)) return null;
  const efectivo = roundMoney(row.TOTAL_EFECTIVO);
  const tarjeta = roundMoney(row.TOTAL_TARJETA);
  const cheques = roundMoney(row.TOTAL_CHEQUES);
  const postdatados = roundMoney(row.TOTAL_POSTDATADOS);
  const totalCobros = roundMoney(row.TOTAL_COBROS ?? (efectivo + tarjeta + cheques + postdatados));
  const totalAIngresar = roundMoney(row.TOTAL_A_INGRESAR ?? (efectivo + cheques + postdatados));
  return {
    efectivo,
    tarjeta,
    cheques,
    postdatados,
    totalCobros,
    totalAIngresar,
    registeredCents: toCents(totalCobros),
  };
}

function buildObligation(row) {
  const minimumPercent = 60;
  const collectableCents = Number(row?.COLLECTABLE_CENTS) || 0;
  const registeredCents = Number(row?.REGISTERED_CENTS) || 0;
  const requiredCents = Math.ceil((collectableCents * minimumPercent) / 100);
  const remainingCents = Math.max(0, requiredCents - registeredCents);
  return { minimumPercent, collectableCents, registeredCents, requiredCents, remainingCents, met: remainingCents === 0 };
}

async function getRegisteredCobrosTotals(vendedorId, date) {
  const safeDate = String(date || '').trim();
  const rows = await queryWithParams(
    `SELECT COALESCE(SUM(CASE WHEN TRIM(FORMAPAGO) IN ('2','T') THEN IMPORTECOBRADO ELSE 0 END), 0) AS TOTAL_TARJETA,
            COALESCE(SUM(CASE WHEN TRIM(FORMAPAGO) NOT IN ('2','T') THEN IMPORTECOBRADO ELSE 0 END), 0) AS TOTAL_EFECTIVO,
            0 AS TOTAL_CHEQUES,
            0 AS TOTAL_POSTDATADOS,
            COALESCE(SUM(IMPORTECOBRADO), 0) AS TOTAL_COBROS,
            COALESCE(SUM(CASE WHEN TRIM(FORMAPAGO) NOT IN ('2','T') THEN IMPORTECOBRADO ELSE 0 END), 0) AS TOTAL_A_INGRESAR
       FROM ${WRITE_COBROS_CAB}
      WHERE TRIM(USUARIO) = ?
        AND (? = '' OR (FECHAEMISIONANO * 10000 + FECHAEMISIONMES * 100 + FECHAEMISIONDIA) = INTEGER(REPLACE(?, '-', '')))`,
    [String(vendedorId || '').trim(), safeDate, safeDate],
  );
  return mapRegisteredCobrosRow(Array.isArray(rows) ? rows[0] : null);
}

async function getObligationSummary(vendedorId, date) {
  const safeDate = String(date || '').trim();
  const safeVendedorId = String(vendedorId || '').trim();
  const rows = await queryWithParams(
    `WITH COLLECTABLE AS (
       SELECT COALESCE(SUM(CVC.IMPORTEPENDIENTE), 0) AS AMOUNT
         FROM DSEDAC.CVC CVC
        WHERE CVC.IMPORTEPENDIENTE > 0.01
          AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
          AND EXISTS (
            SELECT 1
              FROM DSEDAC.CLP CLP
             WHERE TRIM(CLP.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
               AND TRIM(CLP.VENDEDORCOMERCIAL) = ?
          )
     ), REGISTERED AS (
       SELECT COALESCE(SUM(IMPORTECOBRADO), 0) AS AMOUNT
         FROM ${WRITE_COBROS_CAB}
        WHERE TRIM(USUARIO) = ?
          AND (? = '' OR (FECHAEMISIONANO * 10000 + FECHAEMISIONMES * 100 + FECHAEMISIONDIA) = INTEGER(REPLACE(?, '-', '')))
     )
      SELECT INTEGER(ROUND(COLLECTABLE.AMOUNT * 100, 0)) AS COLLECTABLE_CENTS,
             INTEGER(ROUND(REGISTERED.AMOUNT * 100, 0)) AS REGISTERED_CENTS
       FROM COLLECTABLE, REGISTERED`,
    [safeVendedorId, safeVendedorId, safeDate, safeDate],
  );
  return buildObligation(Array.isArray(rows) ? rows[0] : null);
}

function shouldTryServerRecalculation(payload) {
  const body = normalizeClosePayload(payload || {});
  const totalAIngresar = roundMoney(body.totals?.totalAIngresar);
  const totalCobros = roundMoney(body.totals?.totalCobros);
  const delivered = roundMoney(body.ingresoBanco) + roundMoney(body.entregado ?? 0);
  return totalAIngresar > 0
    && totalAIngresar === totalCobros
    && Math.abs(roundMoney(delivered) - totalAIngresar) > 0.01;
}

async function prepareClosePayload(payload) {
  const body = normalizeClosePayload(payload || {});
  const registered = await getRegisteredCobrosTotals(body.vendedorId, body.date);
  if (!registered || registered.registeredCents <= 0) return body;
  return {
    ...body,
    totals: {
      ...body.totals,
      efectivo: registered.efectivo,
      tarjeta: registered.tarjeta,
      cheques: registered.cheques,
      postdatados: registered.postdatados,
      totalCobros: registered.totalCobros,
      totalAIngresar: registered.totalAIngresar,
    },
  };
}

function normalizeRecordDate(value) {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value || '').slice(0, 10);
}

function moneyFieldsMatch(a, b, fields) {
  return fields.every(
    (field) => roundMoney(a?.[field]) === roundMoney(b?.[field]),
  );
}

function payloadsMatch(stored, incoming) {
  const storedRecord = buildLiquidacionRecord(stored);
  const incomingRecord = buildLiquidacionRecord(incoming);

  const totalFields = [
    'efectivo',
    'tarjeta',
    'cheques',
    'postdatados',
    'totalCobros',
    'saldoActual',
    'totalAIngresar',
  ];

  return storedRecord.vendedorId === incomingRecord.vendedorId
    && normalizeRecordDate(storedRecord.date) === normalizeRecordDate(incomingRecord.date)
    && roundMoney(storedRecord.ingresoBanco) === roundMoney(incomingRecord.ingresoBanco)
    && roundMoney(storedRecord.entregado) === roundMoney(incomingRecord.entregado)
    && moneyFieldsMatch(storedRecord.totals, incomingRecord.totals, totalFields);
}

function mapPersistedLiquidacionRow(row) {
  const record = buildLiquidacionRecord({
    vendedorId: row.VENDEDOR,
    date: row.FECHA || `${row.FECHAANO || ''}-${String(row.FECHAMES || '').padStart(2, '0')}-${String(row.FECHADIA || '').padStart(2, '0')}`,
    idempotencyKey: row.MARCASINCRONIZACION,
    ingresoBanco: row.INGRESOENBANCO,
    entregado: row.ESPECIALENTREGADO,
    totals: {
      efectivo: row.EFECTIVOIMPORTE,
      tarjeta: 0,
      cheques: row.CHEQUESIMPORTE,
      postdatados: row.POSTDATADOSIMPORTE,
      saldoActual: row.SALDOACTUAL,
      totalCobros: Number(row.EFECTIVOIMPORTE || 0) + Number(row.CHEQUESIMPORTE || 0) + Number(row.POSTDATADOSIMPORTE || 0),
      totalAIngresar: row.TOTALAINGRESAR,
    },
  });
  return record;
}

async function findPersistedByIdempotencyKeyInTransaction(conn, idempotencyKey) {
  const marker = String(idempotencyKey || '').slice(0, 30);
  const rows = await conn.query(
    `SELECT VENDEDOR,
            FECHAANO, FECHAMES, FECHADIA,
            (CHAR(FECHAANO) || '-' || RIGHT('0' || CHAR(FECHAMES), 2) || '-' || RIGHT('0' || CHAR(FECHADIA), 2)) AS FECHA,
            MARCASINCRONIZACION, EFECTIVOIMPORTE, CHEQUESIMPORTE,
            POSTDATADOSIMPORTE, SALDOACTUAL, TOTALAINGRESAR,
            INGRESOENBANCO, ESPECIALENTREGADO
       FROM ${WRITE_LQD}
      WHERE MARCASINCRONIZACION = ?
      FETCH FIRST 1 ROWS ONLY`,
    [marker],
  );
  return Array.isArray(rows) && rows[0] ? mapPersistedLiquidacionRow(rows[0]) : null;
}

function liquidacionScope(date) {
  const parts = parseIsoDate(date) || parseIsoDate(new Date().toISOString().slice(0, 10));
  return {
    subempresa: String(process.env.PEDIDOS_SYSTEM_SUBEMPRESA || 'GMP').substring(0, 3),
    ejercicio: parts.year,
    serie: String(process.env.LIQUIDACION_SYSTEM_SERIE || 'L').substring(0, 1),
    terminal: parseInt(process.env.LIQUIDACION_SYSTEM_TERMINAL || process.env.PEDIDOS_SYSTEM_TERMINAL || '10', 10),
    parts,
  };
}

function persistLiquidacionCounterError() {
  const err = new Error('Contador de liquidaciones no inicializado');
  err.code = 'PERSIST_FAILED';
  return err;
}

function liquidacionNumeroLockKey(scope) {
  return [scope.subempresa, scope.ejercicio, scope.serie, scope.terminal].join('|');
}

function withLiquidacionNumeroLock(scope, callback) {
  const key = liquidacionNumeroLockKey(scope);
  const tail = liquidacionNumeroTails.get(key) || Promise.resolve();
  const run = tail.then(callback, callback);
  const nextTail = run.catch(() => {});
  liquidacionNumeroTails.set(key, nextTail);
  nextTail.finally(() => {
    if (liquidacionNumeroTails.get(key) === nextTail) liquidacionNumeroTails.delete(key);
  }).catch(() => {});
  return run;
}

async function reserveLiquidacionNumero(conn, scope) {
  return withLiquidacionNumeroLock(scope, async () => {
    const params = [scope.subempresa, scope.ejercicio, scope.serie, scope.terminal];
    const rows = await conn.query(
      `SELECT NEXT_NUMERO
         FROM ${WRITE_COBROS_COUNTER}
        WHERE SUBEMPRESA = ?
          AND EJERCICIO = ?
          AND SERIE = ?
          AND TERMINAL = ?
        FETCH FIRST 1 ROW ONLY`,
      params,
    );
    const numero = parseInt(rows?.[0]?.NEXT_NUMERO, 10);
    if (!Number.isFinite(numero) || numero <= 0) throw persistLiquidacionCounterError();
    await conn.query(
      [
        'UPDATE',
        WRITE_COBROS_COUNTER,
        'SET NEXT_NUMERO = NEXT_NUMERO + 1,',
        'UPDATED_AT = CURRENT TIMESTAMP',
        'WHERE SUBEMPRESA = ?',
        'AND EJERCICIO = ?',
        'AND SERIE = ?',
        'AND TERMINAL = ?',
        'AND NEXT_NUMERO = ?',
      ].join('\n'),
      [...params, numero],
    );
    const verifyRows = await conn.query(
      `SELECT NEXT_NUMERO
         FROM ${WRITE_COBROS_COUNTER}
        WHERE SUBEMPRESA = ?
          AND EJERCICIO = ?
          AND SERIE = ?
          AND TERMINAL = ?
        FETCH FIRST 1 ROW ONLY`,
      params,
    );
    if (parseInt(verifyRows?.[0]?.NEXT_NUMERO, 10) !== numero + 1) {
      throw persistLiquidacionCounterError();
    }
    return numero;
  });
}

async function closeLiquidacionInTransaction(body) {
  const conn = await getPool().connect();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');

    const persisted = await findPersistedByIdempotencyKeyInTransaction(conn, body.idempotencyKey);
    if (persisted) {
      if (!payloadsMatch(persisted, body)) {
        const err = new Error('IDEMPOTENCY_CONFLICT');
        err.code = 'IDEMPOTENCY_CONFLICT';
        throw err;
      }
      await conn.query('COMMIT');
      return { created: false, liquidacion: persisted };
    }

    const liquidacion = buildLiquidacionRecord(body);
    const scope = liquidacionScope(liquidacion.date);
    const numero = await reserveLiquidacionNumero(conn, scope);
    const marca = String(liquidacion.idempotencyKey || '').slice(0, 30);
    const totals = liquidacion.totals || {};
    const sql = `
      INSERT INTO ${WRITE_LQD} (
        SUBEMPRESA, EJERCICIO, SERIE, TERMINAL, NUMERO,
        FECHADIA, FECHAMES, FECHAANO, HORA, VENDEDOR, USUARIO,
        VEHICULO, VEHICULOMATRICULA, KILOMETROSSALIDA, KILOMETROSLLEGADA,
        KILOMETROSRECORRIDOS, EFECTIVOIMPORTE, CHEQUESIMPORTE,
        POSTDATADOSIMPORTE, SALDOACTUAL, TOTALAINGRESAR, INGRESOENBANCO,
        GASTOSIMPORTE, IMPRESOSN, MARCASINCRONIZACION,
        ESPECIALEFECTIVOIMPORTE, ESPECIALENTREGADO
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await conn.query(sql, [
      scope.subempresa,
      scope.ejercicio,
      scope.serie,
      scope.terminal,
      numero,
      scope.parts.day,
      scope.parts.month,
      scope.parts.year,
      Number(new Date().toTimeString().slice(0, 8).replace(/:/g, '')),
      liquidacion.vendedorId.substring(0, 2),
      String(body.createdBy || liquidacion.vendedorId || '').substring(0, 2),
      '',
      '',
      0,
      0,
      0,
      totals.efectivo ?? 0,
      totals.cheques ?? 0,
      totals.postdatados ?? 0,
      totals.saldoActual ?? 0,
      totals.totalAIngresar ?? 0,
      liquidacion.ingresoBanco,
      0,
      'N',
      marca,
      0,
      liquidacion.entregado,
    ]);
    await conn.query('COMMIT');
    return { created: true, liquidacion };
  } catch (error) {
    try {
      await conn.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error(`[comercial-liquidacion] rollback failed: ${rollbackError.message}`);
    }
    if (error.code === 'IDEMPOTENCY_CONFLICT') {
      throw error;
    }
    const persistError = new Error('No se pudo guardar liquidacion');
    persistError.code = 'PERSIST_FAILED';
    throw persistError;
  } finally {
    await conn.close();
  }
}

async function closeLiquidacion(payload) {
  const body = normalizeClosePayload(payload || {});
  validateClosePayload(body);
  const key = body.idempotencyKey;
  if (!key) {
    throw new Error('idempotencyKey requerido');
  }

  const existing = closeState.get(key);
  if (existing) {
    if (!payloadsMatch(existing, body)) {
      const err = new Error('IDEMPOTENCY_CONFLICT');
      err.code = 'IDEMPOTENCY_CONFLICT';
      throw err;
    }
    return { created: false, liquidacion: existing.liquidacion };
  }

  const result = await closeLiquidacionInTransaction(body);
  closeState.set(key, { ...body, liquidacion: result.liquidacion });
  return result;
}

function pickEmail(row) {
  return row?.CORREOELECTRONICO;
}

async function getDailySummary({ vendedorId, vendorCode, date, numeroLiquidacion, includeCommercialCloseability = false }) {
  const parts = parseIsoDate(date);
  if (!parts) {
    throw new Error('Fecha invalida');
  }
  const code = String(vendedorId || vendorCode || '').trim();

  const params = [code, parts.day, parts.month, parts.year];
  let sql = `
    SELECT CODIGOVENDEDOR, NUMEROLIQUIDACION, IMPORTEEFECTIVO, IMPORTETARJETA,
           IMPORTECHEQUES, IMPORTEPOSTDATADOS, IMPORTESALDOACTUAL,
           IMPORTETOTALAINGRESAR, IMPORTEINGRESOENBANCO,
           DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION
    FROM ${ERP_LQD}
    WHERE TRIM(CODIGOVENDEDOR) = ?
      AND DIALIQUIDACION = ?
      AND MESLIQUIDACION = ?
      AND ANOLIQUIDACION = ?
  `;

  if (numeroLiquidacion != null && numeroLiquidacion !== '') {
    sql += ' AND NUMEROLIQUIDACION = ?';
    params.push(Number(numeroLiquidacion));
  }

  sql += ' FETCH FIRST 1 ROWS ONLY';

  const rows = await queryWithParams(sql, params);
  const summary = mapLqdSummaryRow(rows[0] || {}, date);

  let vendorEmail;
  if (rows[0]) {
    const emailRows = await queryWithParams(
      'SELECT CORREOELECTRONICO FROM DSEDAC.VDDX WHERE TRIM(CODIGOVENDEDOR) = ? FETCH FIRST 1 ROWS ONLY',
      [code],
    );
    vendorEmail = pickEmail(Array.isArray(emailRows) ? emailRows[0] : null)
      || (await queryWithParams(
        `SELECT CORREOELECTRONICO FROM JAVIER.V_DIM_VENDEDOR WHERE TRIM(CODIGOVENDEDOR) = ? FETCH FIRST 1 ROWS ONLY`,
        [code],
      ) || []).map(pickEmail).find(Boolean);
  }

  if (includeCommercialCloseability) {
    const [registered, obligation] = await Promise.all([
      getRegisteredCobrosTotals(code, date),
      getObligationSummary(code, date),
    ]);
    summary.registeredCobros = registered || { registeredCents: 0 };
    summary.obligation = obligation;
    summary.closeability = {
      canClose: obligation.met,
      reasons: obligation.met ? [] : ['MINIMUM_OBLIGATION_NOT_MET'],
    };
  }

  return {
    vendedorId: code,
    vendorCode: code,
    date,
    summary,
    vendorEmail: vendorEmail ? String(vendorEmail).trim() : undefined,
  };
}

function resetCloseState() {
  closeState.clear();
}

module.exports = {
  mapLqdSummaryRow,
  validateClosePayload,
  closeLiquidacion,
  getDailySummary,
  prepareClosePayload,
  shouldTryServerRecalculation,
  getRegisteredCobrosTotals,
  getObligationSummary,
  resetCloseState,
  parseIsoDate,
  isValidCalendarDate,
};
