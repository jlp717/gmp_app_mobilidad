'use strict';

const { queryWithParams } = require('../config/db');
const { db2AppTable } = require('../utils/db2-schemas');
const { db2InsertSql } = require('../utils/db2-identifiers');
const { resolveRepartoRuntime } = require('../config/reparto-runtime');
const logger = require('../middleware/logger');

const TEST_LIQUIDACION_TABLE = 'JAVIER.TEST_LIQUIDACION_COMERCIAL';
const TEST_DEVOLUCIONES_TABLE = 'JAVIER.TEST_DEVOLUCIONES_COMERCIAL';

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
    source: String(row.SOURCE || 'DSED.LACLAE').trim() || 'DSED.LACLAE',
    documentoOrigen: String(row.DOCUMENTO_ORIGEN || '').trim() || null,
  };
}

function returnDocKey(item) {
  return [
    String(item.vendedor || '').trim(),
    String(item.date || '').trim(),
    String(item.serie || '').trim(),
    String(item.numero || '').trim(),
    String(item.cliente || '').trim(),
  ].join('|');
}

function isTableMissingError(error) {
  const msg = String(error?.message || error || '');
  return /SQL0204|SQL5005|not (found|exist)|undefined name/i.test(msg);
}

function typedError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function assertIsolatedTestWrites() {
  const runtime = resolveRepartoRuntime(process.env);
  const tableSet = String(runtime?.tableSet || process.env.REPARTO_TABLE_SET || '').trim();
  if (tableSet !== 'isolated_test') {
    throw typedError(
      'La liquidacion comercial solo se persiste en isolated_test (JAVIER.TEST_*)',
      'WRITES_TEST_ONLY',
      409,
    );
  }
  if (!runtime?.valid) {
    throw typedError('Runtime comercial no disponible', 'RUNTIME_UNAVAILABLE', 503);
  }
  if (!TEST_LIQUIDACION_TABLE.startsWith('JAVIER.TEST_')
    || !TEST_DEVOLUCIONES_TABLE.startsWith('JAVIER.TEST_')) {
    throw typedError('Tabla TEST comercial mal configurada', 'WRITES_TEST_ONLY', 409);
  }
}

function normalizeIdempotencyToken(value, fallbackPrefix) {
  const token = String(value || '').trim().substring(0, 128);
  if (token) return token;
  return `${fallbackPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
  const erpReturns = (rows || []).map((row) => mapReturnRow({ ...row, SOURCE: 'DSED.LACLAE' }));
  const overlay = await listTestReturns({
    vendorCodes,
    date: parsedDate.iso,
    clientCode: client,
    limit: fetchLimit,
  }, deps);
  const seen = new Set(erpReturns.map(returnDocKey));
  const merged = [...erpReturns];
  for (const item of overlay) {
    if (seen.has(returnDocKey(item))) continue;
    seen.add(returnDocKey(item));
    merged.push(item);
  }
  return merged;
}

async function listTestReturns({
  vendorCodes,
  date,
  clientCode,
  limit = 100,
} = {}, deps = {}) {
  const run = deps.queryWithParams || queryWithParams;
  const parsedDate = parseIsoDate(date);
  if (!parsedDate) return [];
  const vendorFilter = buildVendorInClause('VENDEDOR', vendorCodes);
  const client = String(clientCode || '').trim().substring(0, 10);
  const clientClause = client ? 'AND TRIM(CLIENTE) = CAST(? AS VARCHAR(10))' : '';
  const fetchLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const sql = `
    SELECT YEAR(FECHA) AS YEAR,
           MONTH(FECHA) AS MONTH,
           DAY(FECHA) AS DAY,
           TRIM(SERIE) AS SERIE,
           NUMERO AS NUMERO,
           TRIM(CLIENTE) AS CLIENTE,
           TRIM(VENDEDOR) AS VENDEDOR,
           IMPORTE AS AMOUNT,
           UNIDADES AS UNITS,
           YA_COBRADA AS YA_COBRADA,
           TRIM(COALESCE(DOCUMENTO_ORIGEN, '')) AS DOCUMENTO_ORIGEN
      FROM ${TEST_DEVOLUCIONES_TABLE}
     WHERE FECHA = ?
       ${vendorFilter.clause}
       ${clientClause}
     ORDER BY IMPORTE ASC
     FETCH FIRST ${fetchLimit} ROWS ONLY
  `;
  const params = [parsedDate.iso, ...vendorFilter.params];
  if (client) params.push(client);
  try {
    const rows = await run(sql, params);
    return (rows || []).map((row) => mapReturnRow({
      ...row,
      SOURCE: TEST_DEVOLUCIONES_TABLE,
    }));
  } catch (error) {
    if (isTableMissingError(error)) {
      logger.warn('[COMERCIAL_LIQUIDACION] TEST devoluciones overlay table missing');
      return [];
    }
    throw error;
  }
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

  const [cobros, returns, lqd, savedDraft] = await Promise.all([
    getDailyCobrosByFormaPago({ vendorCodes, date: parsedDate.iso }, deps),
    listReturns({ vendorCodes, date: parsedDate.iso }, deps),
    getLqdForVendorDay({ vendorCodes, date: parsedDate.iso }, deps),
    getSavedDraft({ vendorCodes, date: parsedDate.iso }, deps),
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
    saved: Boolean(savedDraft),
  });

  return {
    date: parsedDate.iso,
    cobros,
    returns,
    lqd,
    savedDraft,
    summary,
  };
}

async function getSavedDraft({
  vendorCodes,
  date,
} = {}, deps = {}) {
  const run = deps.queryWithParams || queryWithParams;
  const parsedDate = parseIsoDate(date);
  if (!parsedDate) return null;
  const codes = sanitizeVendorCodes(vendorCodes);
  if (codes.length !== 1) return null;
  const sql = `
    SELECT TRIM(CODIGO_VENDEDOR) AS VENDEDOR,
           FECHA,
           INGRESO_BANCO,
           ENTREGADO,
           TOTAL_ESPERADO,
           TOTAL_A_INGRESAR,
           STATUS,
           UPDATED_AT
      FROM ${TEST_LIQUIDACION_TABLE}
     WHERE TRIM(CODIGO_VENDEDOR) = CAST(? AS VARCHAR(2))
       AND FECHA = ?
     FETCH FIRST 1 ROW ONLY
  `;
  try {
    const rows = await run(sql, [codes[0], parsedDate.iso]);
    const row = rows?.[0];
    if (!row) return null;
    return {
      vendedor: String(row.VENDEDOR || codes[0]).trim(),
      date: parsedDate.iso,
      ingresoBanco: money(row.INGRESO_BANCO),
      entregado: money(row.ENTREGADO),
      totalEsperado: money(row.TOTAL_ESPERADO),
      totalAIngresar: money(row.TOTAL_A_INGRESAR),
      status: String(row.STATUS || 'SAVED').trim(),
      savedAt: row.UPDATED_AT || null,
      source: TEST_LIQUIDACION_TABLE,
    };
  } catch (error) {
    if (isTableMissingError(error)) return null;
    throw error;
  }
}

async function saveLiquidacion({
  vendorCodes,
  date,
  ingresoBanco,
  entregado,
  expectedTotal,
  totals = {},
  createdBy,
  idempotencyToken,
} = {}, deps = {}) {
  assertIsolatedTestWrites();
  const run = deps.queryWithParams || queryWithParams;
  const parsedDate = parseIsoDate(date);
  if (!parsedDate) {
    throw typedError('fecha invalida; usa YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  }
  const codes = sanitizeVendorCodes(vendorCodes);
  if (codes.length !== 1) {
    throw typedError('COMERCIAL debe guardar la liquidacion de un solo vendedor', 'VALIDATION_ERROR', 400);
  }
  const banco = money(ingresoBanco);
  const hand = money(entregado);
  if (banco < 0 || hand < 0) {
    throw typedError('importes de liquidacion invalidos', 'VALIDATION_ERROR', 400);
  }
  const token = normalizeIdempotencyToken(
    idempotencyToken,
    `liq-${codes[0]}-${parsedDate.iso}`,
  );
  const expected = money(expectedTotal);
  const payload = {
    vendedor: codes[0],
    date: parsedDate.iso,
    ingresoBanco: banco,
    entregado: hand,
    totalEsperado: expected,
    totalEfectivo: money(totals.totalEfectivo),
    totalCheques: money(totals.totalCheques),
    totalPostdatados: money(totals.totalPostdatados),
    saldoActual: money(totals.saldoActual),
    devolucionesYaCobradas: Math.abs(money(totals.devolucionesYaCobradas)),
    totalAIngresar: money(totals.totalAIngresar == null ? expected : totals.totalAIngresar),
    createdBy: String(createdBy || codes[0]).trim().substring(0, 20),
    token,
  };

  const existingByToken = await run(
    `SELECT TRIM(CODIGO_VENDEDOR) AS VENDEDOR, FECHA, INGRESO_BANCO, ENTREGADO
       FROM ${TEST_LIQUIDACION_TABLE}
      WHERE IDEMPOTENCY_TOKEN = ?
      FETCH FIRST 1 ROW ONLY`,
    [token],
  ).catch((error) => {
    if (isTableMissingError(error)) {
      throw typedError(
        'Tabla TEST de liquidacion comercial no disponible',
        'TEST_TABLE_UNAVAILABLE',
        503,
      );
    }
    throw error;
  });
  if (existingByToken?.[0]) {
    const row = existingByToken[0];
    const same = String(row.VENDEDOR || '').trim() === payload.vendedor
      && money(row.INGRESO_BANCO) === payload.ingresoBanco
      && money(row.ENTREGADO) === payload.entregado;
    if (!same) {
      throw typedError('Token de idempotencia reutilizado con otro payload', 'IDEMPOTENCY_CONFLICT', 409);
    }
    return { ...payload, idempotent: true, source: TEST_LIQUIDACION_TABLE };
  }

  const existingDay = await run(
    `SELECT ID FROM ${TEST_LIQUIDACION_TABLE}
      WHERE TRIM(CODIGO_VENDEDOR) = CAST(? AS VARCHAR(2))
        AND FECHA = ?
      FETCH FIRST 1 ROW ONLY`,
    [payload.vendedor, payload.date],
  );
  if (existingDay?.[0]) {
    await run(
      `UPDATE ${TEST_LIQUIDACION_TABLE}
          SET INGRESO_BANCO = ?,
              ENTREGADO = ?,
              TOTAL_ESPERADO = ?,
              TOTAL_EFECTIVO = ?,
              TOTAL_CHEQUES = ?,
              TOTAL_POSTDATADOS = ?,
              SALDO_ACTUAL = ?,
              DEVOLUCIONES_YA_COBRADAS = ?,
              TOTAL_A_INGRESAR = ?,
              STATUS = 'SAVED',
              IDEMPOTENCY_TOKEN = ?,
              CREATED_BY = ?,
              UPDATED_AT = CURRENT TIMESTAMP
        WHERE TRIM(CODIGO_VENDEDOR) = CAST(? AS VARCHAR(2))
          AND FECHA = ?`,
      [
        payload.ingresoBanco,
        payload.entregado,
        payload.totalEsperado,
        payload.totalEfectivo,
        payload.totalCheques,
        payload.totalPostdatados,
        payload.saldoActual,
        payload.devolucionesYaCobradas,
        payload.totalAIngresar,
        payload.token,
        payload.createdBy,
        payload.vendedor,
        payload.date,
      ],
    );
    return { ...payload, idempotent: false, source: TEST_LIQUIDACION_TABLE };
  }

  const insert = db2InsertSql(TEST_LIQUIDACION_TABLE, [
    'CODIGO_VENDEDOR', 'FECHA', 'INGRESO_BANCO', 'ENTREGADO', 'TOTAL_ESPERADO',
    'TOTAL_EFECTIVO', 'TOTAL_CHEQUES', 'TOTAL_POSTDATADOS', 'SALDO_ACTUAL',
    'DEVOLUCIONES_YA_COBRADAS', 'TOTAL_A_INGRESAR', 'STATUS',
    'IDEMPOTENCY_TOKEN', 'CREATED_BY',
  ]);
  try {
    await run(insert, [
      payload.vendedor,
      payload.date,
      payload.ingresoBanco,
      payload.entregado,
      payload.totalEsperado,
      payload.totalEfectivo,
      payload.totalCheques,
      payload.totalPostdatados,
      payload.saldoActual,
      payload.devolucionesYaCobradas,
      payload.totalAIngresar,
      'SAVED',
      payload.token,
      payload.createdBy,
    ]);
  } catch (error) {
    if (isTableMissingError(error)) {
      throw typedError(
        'Tabla TEST de liquidacion comercial no disponible',
        'TEST_TABLE_UNAVAILABLE',
        503,
      );
    }
    throw error;
  }
  return { ...payload, idempotent: false, source: TEST_LIQUIDACION_TABLE };
}

async function nextTestReturnNumero({ vendor, date } = {}, deps = {}) {
  const run = deps.queryWithParams || queryWithParams;
  const rows = await run(
    `SELECT COALESCE(MAX(NUMERO), 0) AS LAST_NUM
       FROM ${TEST_DEVOLUCIONES_TABLE}
      WHERE TRIM(VENDEDOR) = CAST(? AS VARCHAR(2))
        AND FECHA = ?`,
    [vendor, date],
  );
  return (Number(rows?.[0]?.LAST_NUM) || 0) + 1;
}

async function registerReturn({
  vendorCodes,
  date,
  clientCode,
  amount,
  units = 0,
  serie,
  numero,
  documentoOrigen,
  yaCobrada = true,
  createdBy,
  idempotencyToken,
} = {}, deps = {}) {
  assertIsolatedTestWrites();
  const run = deps.queryWithParams || queryWithParams;
  const parsedDate = parseIsoDate(date);
  if (!parsedDate) {
    throw typedError('fecha invalida; usa YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  }
  const codes = sanitizeVendorCodes(vendorCodes);
  if (codes.length !== 1) {
    throw typedError('COMERCIAL debe registrar la devolucion de un solo vendedor', 'VALIDATION_ERROR', 400);
  }
  const client = String(clientCode || '').trim().substring(0, 10);
  if (!client) {
    throw typedError('cliente obligatorio', 'VALIDATION_ERROR', 400);
  }
  const signedAmount = money(amount);
  if (!Number.isFinite(signedAmount) || signedAmount === 0) {
    throw typedError('importe de devolucion obligatorio', 'VALIDATION_ERROR', 400);
  }
  const storeAmount = signedAmount > 0 ? money(-signedAmount) : signedAmount;
  const token = normalizeIdempotencyToken(
    idempotencyToken,
    `dev-${codes[0]}-${parsedDate.iso}-${client}`,
  );
  const serieCode = String(serie || RETURN_SERIE).trim().substring(0, 4) || RETURN_SERIE;

  const existing = await run(
    `SELECT SERIE, NUMERO, TRIM(CLIENTE) AS CLIENTE, IMPORTE, YA_COBRADA
       FROM ${TEST_DEVOLUCIONES_TABLE}
      WHERE IDEMPOTENCY_TOKEN = ?
      FETCH FIRST 1 ROW ONLY`,
    [token],
  ).catch((error) => {
    if (isTableMissingError(error)) {
      throw typedError(
        'Tabla TEST de devoluciones comerciales no disponible',
        'TEST_TABLE_UNAVAILABLE',
        503,
      );
    }
    throw error;
  });
  if (existing?.[0]) {
    const row = existing[0];
    return {
      ...mapReturnRow({
        YEAR: parsedDate.year,
        MONTH: parsedDate.month,
        DAY: parsedDate.day,
        SERIE: row.SERIE,
        NUMERO: row.NUMERO,
        CLIENTE: row.CLIENTE,
        VENDEDOR: codes[0],
        AMOUNT: row.IMPORTE,
        UNITS: units,
        YA_COBRADA: row.YA_COBRADA,
        DOCUMENTO_ORIGEN: documentoOrigen,
        SOURCE: TEST_DEVOLUCIONES_TABLE,
      }),
      idempotent: true,
    };
  }

  const resolvedNumero = Number.parseInt(numero, 10);
  const docNumero = Number.isFinite(resolvedNumero) && resolvedNumero > 0
    ? resolvedNumero
    : await nextTestReturnNumero({ vendor: codes[0], date: parsedDate.iso }, deps);

  const insert = db2InsertSql(TEST_DEVOLUCIONES_TABLE, [
    'SERIE', 'NUMERO', 'CLIENTE', 'VENDEDOR', 'FECHA',
    'IMPORTE', 'UNIDADES', 'DOCUMENTO_ORIGEN', 'YA_COBRADA',
    'IDEMPOTENCY_TOKEN', 'CREATED_BY',
  ]);
  try {
    await run(insert, [
      serieCode,
      docNumero,
      client,
      codes[0],
      parsedDate.iso,
      storeAmount,
      money(units),
      String(documentoOrigen || '').trim().substring(0, 40) || null,
      yaCobrada ? 1 : 0,
      token,
      String(createdBy || codes[0]).trim().substring(0, 20),
    ]);
  } catch (error) {
    if (isTableMissingError(error)) {
      throw typedError(
        'Tabla TEST de devoluciones comerciales no disponible',
        'TEST_TABLE_UNAVAILABLE',
        503,
      );
    }
    throw error;
  }
  return {
    ...mapReturnRow({
      YEAR: parsedDate.year,
      MONTH: parsedDate.month,
      DAY: parsedDate.day,
      SERIE: serieCode,
      NUMERO: docNumero,
      CLIENTE: client,
      VENDEDOR: codes[0],
      AMOUNT: storeAmount,
      UNITS: units,
      YA_COBRADA: yaCobrada ? 1 : 0,
      DOCUMENTO_ORIGEN: documentoOrigen,
      SOURCE: TEST_DEVOLUCIONES_TABLE,
    }),
    idempotent: false,
  };
}

module.exports = {
  RETURN_SERIE,
  RETURN_TIPO_VENTA,
  FORMAS_PAGO_REPARTIDOR,
  TEST_LIQUIDACION_TABLE,
  TEST_DEVOLUCIONES_TABLE,
  sanitizeVendorCodes,
  parseIsoDate,
  todayIsoDate,
  classifyFormaPago,
  buildComercialLiquidacionSummary,
  listReturns,
  listTestReturns,
  getDailyCobrosByFormaPago,
  getLqdForVendorDay,
  getDailySummary,
  getSavedDraft,
  saveLiquidacion,
  registerReturn,
  assertIsolatedTestWrites,
};
