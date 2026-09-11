'use strict';

const { queryWithParams } = require('../config/db');
const { db2AppTable } = require('../utils/db2-schemas');
const logger = require('../middleware/logger');

const RETURN_SERIE = 'D';
const RETURN_TIPO_VENTA = 'DV';
const FORMAS_PAGO_REPARTIDOR = new Set(['01', 'CO', 'CTR', 'EF']);
const FORMAS_PAGO_CHEQUE = new Set(['CHEQUE', 'TALON', 'TALON BANCARIO', 'CH']);
const FORMAS_PAGO_POSTDATADO = new Set(['POSTDATADO', 'POSTDATADOS', 'PD']);

function sanitizeVendorCodes(vendorCodes) {
  if (!Array.isArray(vendorCodes)) return [];
  return [...new Set(
    vendorCodes
      .map((code) => String(code || '').trim())
      .filter((code) => /^[a-zA-Z0-9]+$/.test(code))
      .filter((code) => code.toUpperCase() !== 'ALL')
      .map((code) => code.substring(0, 2))
      .filter(Boolean),
  )];
}

function parseIsoDate(value) {
  const raw = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2035 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return { year, month, day, iso: raw };
}

function todayIsoDate(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function money(value) {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function classifyFormaPago(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return 'EFECTIVO';
  if (FORMAS_PAGO_REPARTIDOR.has(normalized)) return 'REPARTIDOR';
  if (FORMAS_PAGO_CHEQUE.has(normalized)) return 'CHEQUES';
  if (FORMAS_PAGO_POSTDATADO.has(normalized)) return 'POSTDATADOS';
  return 'EFECTIVO';
}

function buildVendorInClause(columnSql, vendorCodes) {
  const codes = sanitizeVendorCodes(vendorCodes);
  if (codes.length === 0) {
    return { clause: '', params: [] };
  }
  return {
    clause: `AND TRIM(${columnSql}) IN (${codes.map(() => 'CAST(? AS VARCHAR(2))').join(',')})`,
    params: codes,
  };
}

function buildComercialLiquidacionSummary({
  totalEfectivo = 0,
  totalCheques = 0,
  totalPostdatados = 0,
  saldoActual = 0,
  devolucionesYaCobradas = 0,
  totalAIngresar,
  source = 'COBROS',
} = {}) {
  const efectivo = money(totalEfectivo);
  const cheques = money(totalCheques);
  const postdatados = money(totalPostdatados);
  const saldo = money(saldoActual);
  const devoluciones = Math.abs(money(devolucionesYaCobradas));
  const computed = money(efectivo + cheques + postdatados + saldo);
  return {
    totalEfectivo: efectivo,
    totalCheques: cheques,
    totalPostdatados: postdatados,
    saldoActual: saldo,
    devolucionesYaCobradas: devoluciones,
    totalAIngresar: totalAIngresar == null ? computed : money(totalAIngresar),
    source,
    cashImpactHypothesis: 'lqd_importetotalaingresar_no_subtract_returns',
  };
}

function mapReturnRow(row) {
  const year = Number(row.YEAR) || 0;
  const month = Number(row.MONTH) || 0;
  const day = Number(row.DAY) || 0;
  const serie = String(row.SERIE || '').trim();
  const numero = String(row.NUMERO == null ? '' : row.NUMERO).trim();
  return {
    year,
    month,
    day,
    date: year && month && day
      ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : null,
    serie,
    numero,
    documento: serie && numero ? `${serie}-${numero}` : serie || numero,
    cliente: String(row.CLIENTE || '').trim(),
    vendedor: String(row.VENDEDOR || '').trim(),
    amount: money(row.AMOUNT),
    units: money(row.UNITS),
    yaCobrada: Number(row.YA_COBRADA) === 1,
    formaPago: String(row.FORMA_PAGO || '').trim() || null,
    source: 'DSED.LACLAE',
  };
}

async function listReturns({
  vendorCodes,
  date,
  clientCode,
  limit = 100,
} = {}, deps = {}) {
  const run = deps.queryWithParams || queryWithParams;
  const parsedDate = parseIsoDate(date);
  if (!parsedDate) {
    const error = new Error('fecha invalida; usa YYYY-MM-DD');
    error.code = 'VALIDATION_ERROR';
    error.status = 400;
    throw error;
  }

  const vendorFilter = buildVendorInClause('L.LCCDVD', vendorCodes);
  const client = String(clientCode || '').trim().substring(0, 10);
  const clientClause = client ? 'AND TRIM(L.LCCDCL) = CAST(? AS VARCHAR(10))' : '';
  const fetchLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);

  const sql = `
    SELECT L.LCAADC AS YEAR,
           L.LCMMDC AS MONTH,
           L.LCDDDC AS DAY,
           TRIM(L.LCSRAB) AS SERIE,
           L.LCNRAB AS NUMERO,
           TRIM(L.LCCDCL) AS CLIENTE,
           TRIM(L.LCCDVD) AS VENDEDOR,
           SUM(L.LCIMVT) AS AMOUNT,
           SUM(L.LCCTUD) AS UNITS,
           MAX(CASE
             WHEN CVC.IMPORTEPENDIENTE = 0
               OR UPPER(TRIM(COALESCE(CVC.CODIGOFORMAPAGO, ''))) = 'PG'
               OR UPPER(TRIM(COALESCE(FPG.CODIGOFORMAPAGO, ''))) = 'PG'
             THEN 1 ELSE 0
           END) AS YA_COBRADA,
           MAX(TRIM(COALESCE(FPG.DESCRIPCIONFORMAPAGO, CVC.CODIGOFORMAPAGO, ''))) AS FORMA_PAGO
    FROM DSED.LACLAE L
    LEFT JOIN DSEDAC.CVC CVC
      ON TRIM(CVC.CODIGOCLIENTEALBARAN) = TRIM(L.LCCDCL)
     AND TRIM(CVC.SERIEDOCUMENTO) = TRIM(L.LCSRAB)
     AND CVC.NUMERODOCUMENTO = L.LCNRAB
     AND TRIM(CVC.TIPODOCUMENTO) = 'DEV'
     AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
    LEFT JOIN DSEDAC.FPG FPG
      ON TRIM(FPG.CODIGOFORMAPAGO) = TRIM(CVC.CODIGOFORMAPAGO)
    WHERE (L.LCSRAB = ? OR L.LCTPVT = ?)
      AND L.LCAADC = ?
      AND L.LCMMDC = ?
      AND L.LCDDDC = ?
      ${vendorFilter.clause}
      ${clientClause}
    GROUP BY L.LCAADC, L.LCMMDC, L.LCDDDC,
             TRIM(L.LCSRAB), L.LCNRAB,
             TRIM(L.LCCDCL), TRIM(L.LCCDVD)
    ORDER BY AMOUNT ASC
    FETCH FIRST ${fetchLimit} ROWS ONLY
  `;

  const params = [
    RETURN_SERIE,
    RETURN_TIPO_VENTA,
    parsedDate.year,
    parsedDate.month,
    parsedDate.day,
    ...vendorFilter.params,
  ];
  if (client) params.push(client);

  const rows = await run(sql, params);
  return (rows || []).map(mapReturnRow);
}

async function getDailyCobrosByFormaPago({
  vendorCodes,
  date,
} = {}, deps = {}) {
  const run = deps.queryWithParams || queryWithParams;
  const parsedDate = parseIsoDate(date);
  if (!parsedDate) {
    const error = new Error('fecha invalida; usa YYYY-MM-DD');
    error.code = 'VALIDATION_ERROR';
    error.status = 400;
    throw error;
  }

  const cobrosTable = db2AppTable('COBROS');
  const vendorFilter = buildVendorInClause('CODIGO_USUARIO', vendorCodes);
  const sql = `
    SELECT TRIM(FORMA_PAGO) AS FORMA_PAGO,
           SUM(IMPORTE) AS TOTAL
    FROM ${cobrosTable}
    WHERE YEAR(FECHA) = ?
      AND MONTH(FECHA) = ?
      AND DAY(FECHA) = ?
      ${vendorFilter.clause}
    GROUP BY TRIM(FORMA_PAGO)
  `;
  const rows = await run(sql, [
    parsedDate.year,
    parsedDate.month,
    parsedDate.day,
    ...vendorFilter.params,
  ]);

  const totals = {
    totalEfectivo: 0,
    totalCheques: 0,
    totalPostdatados: 0,
    totalRepartidorExcluded: 0,
  };
  for (const row of rows || []) {
    const amount = money(row.TOTAL);
    const kind = classifyFormaPago(row.FORMA_PAGO);
    if (kind === 'REPARTIDOR') totals.totalRepartidorExcluded += amount;
    else if (kind === 'CHEQUES') totals.totalCheques += amount;
    else if (kind === 'POSTDATADOS') totals.totalPostdatados += amount;
    else totals.totalEfectivo += amount;
  }
  return {
    totalEfectivo: money(totals.totalEfectivo),
    totalCheques: money(totals.totalCheques),
    totalPostdatados: money(totals.totalPostdatados),
    totalRepartidorExcluded: money(totals.totalRepartidorExcluded),
  };
}

async function getLqdForVendorDay({
  vendorCodes,
  date,
} = {}, deps = {}) {
  const run = deps.queryWithParams || queryWithParams;
  const parsedDate = parseIsoDate(date);
  if (!parsedDate) {
    const error = new Error('fecha invalida; usa YYYY-MM-DD');
    error.code = 'VALIDATION_ERROR';
    error.status = 400;
    throw error;
  }

  const codes = sanitizeVendorCodes(vendorCodes);
  if (codes.length === 0) {
    return null;
  }

  const sql = `
    SELECT COALESCE(SUM(LQD.IMPORTEEFECTIVO), 0) AS TOTAL_EFECTIVO,
           COALESCE(SUM(LQD.IMPORTECHEQUES), 0) AS TOTAL_CHEQUES,
           COALESCE(SUM(LQD.IMPORTEPOSTDATADOS), 0) AS TOTAL_POSTDATADOS,
           COALESCE(SUM(LQD.IMPORTESALDOACTUAL), 0) AS SALDO_ACTUAL,
           COALESCE(SUM(LQD.IMPORTETOTALAINGRESAR), 0) AS TOTAL_A_INGRESAR,
           COUNT(*) AS FILAS
      FROM DSEDAC.LQD LQD
     WHERE TRIM(LQD.CODIGOVENDEDOR) IN (${codes.map(() => 'CAST(? AS VARCHAR(2))').join(',')})
       AND LQD.ANOLIQUIDACION = ?
       AND LQD.MESLIQUIDACION = ?
       AND LQD.DIALIQUIDACION = ?
  `;
  const rows = await run(sql, [...codes, parsedDate.year, parsedDate.month, parsedDate.day]);
  const row = rows?.[0];
  const filas = Number(row?.FILAS) || 0;
  if (!row || filas <= 0) return null;
  return {
    totalEfectivo: money(row.TOTAL_EFECTIVO),
    totalCheques: money(row.TOTAL_CHEQUES),
    totalPostdatados: money(row.TOTAL_POSTDATADOS),
    saldoActual: money(row.SALDO_ACTUAL),
    totalAIngresar: money(row.TOTAL_A_INGRESAR),
    filas,
    source: 'DSEDAC.LQD',
  };
}

async function getDailySummary({
  vendorCodes,
  date,
  saldoActual = 0,
} = {}, deps = {}) {
  const parsedDate = parseIsoDate(date);
  if (!parsedDate) {
    const error = new Error('fecha invalida; usa YYYY-MM-DD');
    error.code = 'VALIDATION_ERROR';
    error.status = 400;
    throw error;
  }

  const [cobros, returns, lqd] = await Promise.all([
    getDailyCobrosByFormaPago({ vendorCodes, date: parsedDate.iso }, deps),
    listReturns({ vendorCodes, date: parsedDate.iso }, deps),
    getLqdForVendorDay({ vendorCodes, date: parsedDate.iso }, deps),
  ]);

  const devolucionesYaCobradas = returns.reduce(
    (sum, item) => sum + Math.abs(item.amount || 0),
    0,
  );
  const summary = buildComercialLiquidacionSummary({
    totalEfectivo: lqd ? lqd.totalEfectivo : cobros.totalEfectivo,
    totalCheques: lqd ? lqd.totalCheques : cobros.totalCheques,
    totalPostdatados: lqd ? lqd.totalPostdatados : cobros.totalPostdatados,
    saldoActual: lqd ? lqd.saldoActual : saldoActual,
    devolucionesYaCobradas,
    totalAIngresar: lqd ? lqd.totalAIngresar : undefined,
    source: lqd ? 'DSEDAC.LQD' : 'COBROS',
  });

  logger.info('[COMERCIAL_LIQUIDACION] daily summary built', {
    date: parsedDate.iso,
    vendors: sanitizeVendorCodes(vendorCodes).length,
    returns: returns.length,
    lqd: Boolean(lqd),
  });

  return {
    date: parsedDate.iso,
    cobros,
    returns,
    lqd,
    summary,
  };
}

module.exports = {
  RETURN_SERIE,
  RETURN_TIPO_VENTA,
  FORMAS_PAGO_REPARTIDOR,
  sanitizeVendorCodes,
  parseIsoDate,
  todayIsoDate,
  classifyFormaPago,
  buildComercialLiquidacionSummary,
  listReturns,
  getDailyCobrosByFormaPago,
  getLqdForVendorDay,
  getDailySummary,
};
