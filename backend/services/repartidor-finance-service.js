'use strict';

const PDFDocument = require('pdfkit');
const { queryWithParams, getPool, initDb } = require('../config/db');
const logger = require('../middleware/logger');
const { sendEmailWithPdf } = require('./emailPdfService');

const INTERNAL_LIQUIDATION_RECIPIENTS = [
  'carmen@mari-pepa.com',
  'marisol@mari-pepa.com',
  'diegocorbalan@mari-pepa.com',
];

function erpSchemaName(raw) {
  const schema = String(raw || 'JAVIER').trim().toUpperCase();
  if (!['JAVIER', 'DSEDAC'].includes(schema)) {
    throw new Error(
      `REPARTIDOR_FINANCE_ERP_SCHEMA invalido: ${schema}. Use JAVIER o DSEDAC.`,
    );
  }
  return schema;
}

const ERP_FINANCE_SCHEMA = erpSchemaName(
  process.env.REPARTIDOR_FINANCE_ERP_SCHEMA || process.env.FINANCE_ERP_SCHEMA,
);
const LQD_TABLE = `${ERP_FINANCE_SCHEMA}.LQD`;

function value(row, key, fallback = undefined) {
  if (!row) return fallback;
  if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  const lower = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(row, lower)) return row[lower];
  return fallback;
}

function toNumber(raw) {
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

function toInt(raw) {
  const num = parseInt(raw, 10);
  return Number.isFinite(num) ? num : 0;
}

function roundMoney(raw) {
  return Math.round((toNumber(raw) + Number.EPSILON) * 100) / 100;
}

function firstRow(rows) {
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : {};
}

function pad(raw, size) {
  return String(raw ?? '').trim().padStart(size, '0');
}

function compactDate(dateString) {
  const [year, month, day] = String(dateString).split('-').map((part) => parseInt(part, 10));
  if (!year || !month || !day) throw new Error(`Invalid ISO date: ${dateString}`);
  return year * 10000 + month * 100 + day;
}

function dateParts(dateString) {
  const [year, month, day] = String(dateString).split('-').map((part) => parseInt(part, 10));
  if (!year || !month || !day) throw new Error(`Invalid ISO date: ${dateString}`);
  return { year, month, day };
}

function nextIsoDate(dateString) {
  const { year, month, day } = dateParts(dateString);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return date.toISOString().slice(0, 10);
}

function dayBounds(dateString) {
  return [`${dateString} 00:00:00`, `${nextIsoDate(dateString)} 00:00:00`];
}

function currentHhmmss() {
  const now = new Date();
  return now.getHours() * 10000 + now.getMinutes() * 100 + now.getSeconds();
}

function formatDateFromParts(row, prefix) {
  const year = toInt(value(row, `${prefix}ANO`) || value(row, `ANO${prefix}`) || value(row, `ANO${prefix}DOCUMENTO`));
  const month = toInt(value(row, `${prefix}MES`) || value(row, `MES${prefix}`) || value(row, `MES${prefix}DOCUMENTO`));
  const day = toInt(value(row, `${prefix}DIA`) || value(row, `DIA${prefix}`) || value(row, `DIA${prefix}DOCUMENTO`));
  if (!year || !month || !day) return null;
  return `${year}-${pad(month, 2)}-${pad(day, 2)}`;
}

function formatCvcDueDate(row) {
  const year = toInt(value(row, 'ANOVENCIMIENTO'));
  const month = toInt(value(row, 'MESVENCIMIENTO'));
  const day = toInt(value(row, 'DIAVENCIMIENTO'));
  if (!year || !month || !day) return null;
  return `${year}-${pad(month, 2)}-${pad(day, 2)}`;
}

function addDaysIso(year, month, day, days) {
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day + toInt(days)));
  return date.toISOString().slice(0, 10);
}

function formatCvclDueDate(row) {
  const rawCreditDays = value(row, 'DIASLIMITECREDITO');
  if (rawCreditDays === undefined || rawCreditDays === null || String(rawCreditDays).trim() === '') {
    return null;
  }
  const creditDays = toInt(rawCreditDays);
  const useAlbaranDate =
    String(value(row, 'DIASLIMITECREDITOCONFECHAALB', '') || '')
      .trim()
      .toUpperCase() === 'S';
  const prefix = useAlbaranDate ? 'ALBARAN_BASE' : 'FACTURA_BASE';
  return addDaysIso(
    toInt(value(row, `${prefix}_ANO`)),
    toInt(value(row, `${prefix}_MES`)),
    toInt(value(row, `${prefix}_DIA`)),
    creditDays,
  );
}

function isoDateToCompact(dateString) {
  if (!dateString) return 0;
  return compactDate(dateString);
}

function buildDocument(row) {
  const year = toInt(value(row, 'EJERCICIODOCUMENTO') || value(row, 'EJERCICIO_DOCUMENTO'));
  const origin = String(value(row, 'ORIGENDOCUMENTO', 'B') || 'B').trim() || 'B';
  const serie = String(value(row, 'SERIEDOCUMENTO') || value(row, 'SERIE_DOCUMENTO') || '').trim();
  const terminal = toInt(value(row, 'TERMINALDOCUMENTO') || value(row, 'TERMINAL_DOCUMENTO'));
  const numero = toInt(value(row, 'NUMERODOCUMENTO') || value(row, 'NUMERO_DOCUMENTO'));
  const xde = toInt(value(row, 'XDEDOCUMENTO') || value(row, 'XDE_DOCUMENTO') || 1);

  if (!year || !numero) return String(value(row, 'DOCUMENTO', '') || '').trim();
  return `E ${year}-${origin}-${serie}-${pad(terminal, 3)}-${pad(numero, 6)}-${pad(xde, 2)}`;
}

function mapCobro(row) {
  const importe = roundMoney(value(row, 'IMPORTEVENCIMIENTO'));
  const pendiente = roundMoney(value(row, 'IMPORTEPENDIENTE'));
  return {
    id: value(row, 'ID') == null ? null : String(value(row, 'ID')),
    fecha: formatCvcDueDate(row),
    codigoCliente: String(value(row, 'CODIGOCLIENTEALBARAN', '') || '').trim(),
    nombreCliente: String(value(row, 'NOMBRE_CLIENTE', '') || '').trim(),
    tipoCobro: String(value(row, 'CODIGOFORMAPAGO', '') || '').trim(),
    tipoDocumento: String(value(row, 'TIPODOCUMENTO', '') || '').trim(),
    documento: buildDocument(row),
    importe,
    cobrado: importe,
    pendiente,
  };
}

function mapVencimiento(row) {
  return {
    tipoDocumento: String(value(row, 'TIPODOCUMENTO', '') || '').trim(),
    codigoCliente: String(value(row, 'CODIGOCLIENTEALBARAN', '') || '').trim(),
    nombreCliente: String(value(row, 'NOMBRE_CLIENTE', '') || '').trim(),
    nombreAlternativo: String(value(row, 'NOMBREALTERNATIVO', '') || '').trim(),
    poblacion: String(value(row, 'POBLACION', '') || '').trim(),
    fechaVencimiento: formatCvclDueDate(row) || formatCvcDueDate(row),
    documento: buildDocument(row),
    importe: roundMoney(value(row, 'IMPORTEVENCIMIENTO')),
    importePendiente: roundMoney(value(row, 'IMPORTEPENDIENTE')),
    keys: {
      tipoDocumento: String(value(row, 'TIPODOCUMENTO', '') || '').trim(),
      origenDocumento: String(value(row, 'ORIGENDOCUMENTO', '') || '').trim(),
      subempresaDocumento: String(value(row, 'SUBEMPRESADOCUMENTO', '') || '').trim(),
      ejercicioDocumento: toInt(value(row, 'EJERCICIODOCUMENTO')),
      serieDocumento: String(value(row, 'SERIEDOCUMENTO', '') || '').trim(),
      terminalDocumento: toInt(value(row, 'TERMINALDOCUMENTO')),
      numeroDocumento: toInt(value(row, 'NUMERODOCUMENTO')),
      xdeDocumento: toInt(value(row, 'XDEDOCUMENTO')),
      dexDocumento: toInt(value(row, 'DEXDOCUMENTO')),
    },
  };
}

function mapLiquidacion(row) {
  if (!row || Object.keys(row).length === 0) return null;
  return {
    id: value(row, 'ID') == null ? null : String(value(row, 'ID')),
    idempotencyToken: value(row, 'IDEMPOTENCY_TOKEN'),
    repartidorId: value(row, 'CODIGOVENDEDOR'),
    numero: {
      subempresa: value(row, 'SUBEMPRESALIQUIDACION'),
      ejercicio: toInt(value(row, 'EJERCICIOLIQUIDACION')),
      serie: value(row, 'SERIELIQUIDACION'),
      terminal: toInt(value(row, 'TERMINALLIQUIDACION')),
      numero: toInt(value(row, 'NUMEROLIQUIDACION')),
      display: `${value(row, 'EJERCICIOLIQUIDACION')}-${value(row, 'SERIELIQUIDACION')}-${pad(value(row, 'TERMINALLIQUIDACION'), 3)}-${pad(value(row, 'NUMEROLIQUIDACION'), 6)}`,
    },
    totals: {
      totalEfectivo: roundMoney(value(row, 'IMPORTEEFECTIVO')),
      totalCheques: roundMoney(value(row, 'IMPORTECHEQUES')),
      totalTarjeta: roundMoney(value(row, 'IMPORTETARJETA')),
      totalPostdatados: roundMoney(value(row, 'IMPORTEPOSTDATADOS')),
      saldoAnterior: roundMoney(value(row, 'IMPORTESALDOACTUAL')),
      totalCobrosDia: roundMoney(value(row, 'TOTAL_COBROS_DIA')),
      totalAIngresar: roundMoney(value(row, 'IMPORTETOTALAINGRESAR')),
      ingresoBanco: roundMoney(value(row, 'IMPORTEINGRESOENBANCO')),
      saldoResultante: roundMoney(value(row, 'SALDO_RESULTANTE')),
    },
    status: value(row, 'REVISADOSN'),
  };
}

class AlreadyDeliveredError extends Error {
  constructor(row) {
    super('Esta entrega ya fue confirmada anteriormente');
    this.name = 'AlreadyDeliveredError';
    this.code = 'ALREADY_DELIVERED';
    this.previousRepartidor = value(row, 'REPARTIDOR_ID');
    this.previousDate = value(row, 'UPDATED_AT');
  }
}

class IdempotencyConflictError extends Error {
  constructor(message = 'El token de idempotencia ya existe con datos distintos') {
    super(message);
    this.name = 'IdempotencyConflictError';
    this.code = 'IDEMPOTENCY_CONFLICT';
  }
}

class DuplicateLiquidacionError extends Error {
  constructor(message = 'Ya existe una liquidacion para este repartidor y fecha') {
    super(message);
    this.name = 'DuplicateLiquidacionError';
    this.code = 'DUPLICATE_DAILY_LIQUIDACION';
  }
}

function sameNumeric(a, b) {
  return toInt(a) === toInt(b);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeTipoDocumento(raw) {
  const value = normalizeText(raw).toUpperCase();
  if (['ALBARAN', 'ALBARANES', 'ALB', 'COB. ALB.', 'COB_ALB'].includes(value)) {
    return 'CAC';
  }
  return value;
}

function isDuplicateKeyError(error) {
  const text = `${error?.message || ''} ${JSON.stringify(error?.odbcErrors || [])}`.toLowerCase();
  return text.includes('duplicate') ||
    text.includes('unique') ||
    text.includes('sql0803') ||
    text.includes('-803') ||
    text.includes('23505');
}

function expectedCobroPayload(delivery, cobro) {
  return {
    entregaId: cobro.entregaId || delivery?.itemId || null,
    codigoRepartidor: cobro.codigoRepartidor || delivery?.repartidorId,
    codigoCliente: cobro.codigoCliente,
    tipoDocumento: normalizeTipoDocumento(cobro.tipoDocumento),
    origenDocumento: cobro.origenDocumento || 'B',
    subempresaDocumento: cobro.subempresaDocumento || 'GMP',
    ejercicioDocumento: cobro.ejercicioDocumento,
    serieDocumento: cobro.serieDocumento,
    terminalDocumento: cobro.terminalDocumento,
    numeroDocumento: cobro.numeroDocumento,
    xdeDocumento: cobro.xdeDocumento || 1,
    dexDocumento: cobro.dexDocumento || 1,
    importeCobrado: cobro.importeCobrado,
    importePendiente: cobro.importePendiente || 0,
    formaPago: cobro.formaPago,
    pantallaOrigen: cobro.pantallaOrigen || 'RUTERO',
  };
}

function assertCobroPayloadMatchesInput(row, expected) {
  if (!row || Object.keys(row).length === 0) {
    throw new IdempotencyConflictError('No existe cobro para replay idempotente');
  }
  const mismatches = [];
  const checks = [
    ['ENTREGA_APP_ID', expected.entregaId, normalizeText],
    ['CODIGOVENDEDOR', expected.codigoRepartidor, normalizeText],
    ['CODIGOCLIENTEALBARAN', expected.codigoCliente, normalizeText],
    ['TIPODOCUMENTO', expected.tipoDocumento, normalizeTipoDocumento],
    ['ORIGENDOCUMENTO', expected.origenDocumento, normalizeText],
    ['SUBEMPRESADOCUMENTO', expected.subempresaDocumento, normalizeText],
    ['SERIEDOCUMENTO', expected.serieDocumento, normalizeText],
    ['CODIGOFORMAPAGO', expected.formaPago, normalizeText],
    ['PANTALLA_ORIGEN', expected.pantallaOrigen, normalizeText],
  ];
  for (const [column, expected, normalizer] of checks) {
    if (normalizer(value(row, column)) !== normalizer(expected)) {
      mismatches.push(column);
    }
  }
  const numericChecks = [
    ['EJERCICIODOCUMENTO', expected.ejercicioDocumento],
    ['TERMINALDOCUMENTO', expected.terminalDocumento],
    ['NUMERODOCUMENTO', expected.numeroDocumento],
    ['XDEDOCUMENTO', expected.xdeDocumento || 1],
    ['DEXDOCUMENTO', expected.dexDocumento || 1],
  ];
  for (const [column, expected] of numericChecks) {
    if (!sameNumeric(value(row, column, expected), expected)) {
      mismatches.push(column);
    }
  }
  if (roundMoney(value(row, 'IMPORTEVENCIMIENTO')) !== roundMoney(expected.importeCobrado)) {
    mismatches.push('IMPORTEVENCIMIENTO');
  }
  if (
    roundMoney(value(row, 'IMPORTEPENDIENTE', expected.importePendiente || 0)) !==
    roundMoney(expected.importePendiente || 0)
  ) {
    mismatches.push('IMPORTEPENDIENTE');
  }
  if (mismatches.length > 0) {
    throw new IdempotencyConflictError(`Token existente con payload distinto: ${mismatches.join(', ')}`);
  }
}

function assertCobroMatchesInput(row, delivery, cobro) {
  assertCobroPayloadMatchesInput(row, expectedCobroPayload(delivery, cobro));
}

function assertLiquidacionMatchesInput(row, input) {
  if (!row || Object.keys(row).length === 0) {
    throw new IdempotencyConflictError('No existe liquidacion para replay idempotente');
  }
  const { year, month, day } = dateParts(input.date);
  const mismatches = [];
  const textChecks = [
    ['CODIGOVENDEDOR', input.repartidorId, normalizeText],
    ['SUBEMPRESALIQUIDACION', 'GMP', normalizeText],
    ['SERIELIQUIDACION', 'A', normalizeText],
  ];
  for (const [column, expected, normalizer] of textChecks) {
    if (normalizer(value(row, column)) !== normalizer(expected)) {
      mismatches.push(column);
    }
  }
  const numericChecks = [
    ['EJERCICIOLIQUIDACION', year],
    ['TERMINALLIQUIDACION', toInt(input.repartidorId)],
    ['DIALIQUIDACION', day],
    ['MESLIQUIDACION', month],
    ['ANOLIQUIDACION', year],
  ];
  for (const [column, expected] of numericChecks) {
    const raw = value(row, column);
    if (raw !== undefined && raw !== null && !sameNumeric(raw, expected)) {
      mismatches.push(column);
    }
  }
  const moneyChecks = [
    ['IMPORTEEFECTIVO', input.totals.totalEfectivo],
    ['IMPORTECHEQUES', input.totals.totalCheques],
    ['IMPORTETARJETA', input.totals.totalTarjeta],
    ['IMPORTEPOSTDATADOS', input.totals.totalPostdatados],
    ['IMPORTESALDOACTUAL', input.totals.saldoActual],
    ['TOTAL_COBROS_DIA', input.totals.totalCobrosDia],
    ['IMPORTETOTALAINGRESAR', input.totals.totalAIngresar],
    ['IMPORTEINGRESOENBANCO', input.totals.ingresoBanco],
    ['IMPORTEGASTOS', input.totals.gastos],
    ['IMPORTEEFECTIVO2', input.totals.efectivo2],
    ['IMPORTEENTREGADO2', input.totals.entregado2],
  ];
  for (const [column, expected] of moneyChecks) {
    if (roundMoney(value(row, column, expected)) !== roundMoney(expected)) {
      mismatches.push(column);
    }
  }
  if (mismatches.length > 0) {
    throw new IdempotencyConflictError(
      `Token de liquidacion existente con payload distinto: ${mismatches.join(', ')}`,
    );
  }
}

async function findLiquidacionRowByToken(idempotencyToken) {
  const rows = await queryWithParams(`
    SELECT
      OPS.*,
      LQD.DIALIQUIDACION,
      LQD.MESLIQUIDACION,
      LQD.ANOLIQUIDACION
    FROM JAVIER.REPARTIDOR_LIQUIDACION_OPS OPS
    LEFT JOIN ${LQD_TABLE} LQD
      ON LQD.IDMARCALIQUIDACION = OPS.IDEMPOTENCY_TOKEN
    WHERE OPS.IDEMPOTENCY_TOKEN = ?
    FETCH FIRST 1 ROW ONLY
  `, [idempotencyToken], false, false);
  return firstRow(rows);
}

async function findLiquidacionByToken(idempotencyToken) {
  return mapLiquidacion(await findLiquidacionRowByToken(idempotencyToken));
}

async function getDailySummary({ repartidorId, date }) {
  const dateYmd = compactDate(date);
  const totalsRows = await queryWithParams(`
    SELECT
      COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('EFECTIVO', 'E', 'CONTADO') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_EFECTIVO,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('CHEQUE', 'TALON', 'TALON BANCARIO') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_CHEQUES,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('TARJETA', 'TPV', 'BIZUM') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_TARJETA,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('POSTDATADO', 'POSTDATADOS') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_POSTDATADOS,
      COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL_COBROS_DIA,
      COUNT(*) AS COBROS_COUNT
    FROM JAVIER.REPARTIDOR_COBROS
    WHERE TRIM(CODIGOVENDEDOR) = ?
      AND ANOVENCIMIENTO * 10000 + MESVENCIMIENTO * 100 + DIAVENCIMIENTO = ?
      AND COALESCE(LIQUIDADO_SN, 'N') <> 'S'
  `, [repartidorId, dateYmd], false, false);

  const balanceRows = await queryWithParams(`
    SELECT SALDO_PENDIENTE
    FROM JAVIER.REPARTIDOR_FINANCIAL_BALANCES
    WHERE TRIM(CODIGOVENDEDOR) = ?
    FETCH FIRST 1 ROW ONLY
  `, [repartidorId], false, false);

  const cobroRows = await queryWithParams(`
    SELECT
      ID,
      DIAVENCIMIENTO,
      MESVENCIMIENTO,
      ANOVENCIMIENTO,
      CODIGOCLIENTEALBARAN,
      NOMBRE_CLIENTE,
      CODIGOFORMAPAGO,
      TIPODOCUMENTO,
      ORIGENDOCUMENTO,
      SERIEDOCUMENTO,
      TERMINALDOCUMENTO,
      NUMERODOCUMENTO,
      EJERCICIODOCUMENTO,
      XDEDOCUMENTO,
      IMPORTEVENCIMIENTO,
      IMPORTEPENDIENTE
    FROM JAVIER.REPARTIDOR_COBROS
    WHERE TRIM(CODIGOVENDEDOR) = ?
      AND ANOVENCIMIENTO * 10000 + MESVENCIMIENTO * 100 + DIAVENCIMIENTO = ?
      AND COALESCE(LIQUIDADO_SN, 'N') <> 'S'
    ORDER BY ANOVENCIMIENTO, MESVENCIMIENTO, DIAVENCIMIENTO, ID
  `, [repartidorId, dateYmd], false, false);

  const totals = firstRow(totalsRows);
  const saldoActual = roundMoney(value(firstRow(balanceRows), 'SALDO_PENDIENTE', 0));
  const totalCobrosDia = roundMoney(value(totals, 'TOTAL_COBROS_DIA'));
  const gastos = 0;

  return {
    repartidorId,
    date,
    summary: {
      totalEfectivo: roundMoney(value(totals, 'TOTAL_EFECTIVO')),
      totalCheques: roundMoney(value(totals, 'TOTAL_CHEQUES')),
      totalTarjeta: roundMoney(value(totals, 'TOTAL_TARJETA')),
      totalPostdatados: roundMoney(value(totals, 'TOTAL_POSTDATADOS')),
      saldoActual,
      totalCobrosDia,
      gastos,
      totalAIngresar: roundMoney(saldoActual + totalCobrosDia - gastos),
      ingresoBanco: 0,
      totalEfectivo2: roundMoney(value(totals, 'TOTAL_EFECTIVO')),
      entregado: 0,
      cobrosCount: toInt(value(totals, 'COBROS_COUNT')),
    },
    cobros: cobroRows.map(mapCobro),
  };
}

async function getSummary({ repartidorId, year, month }) {
  const today = new Date();
  const todayYmd = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const rows = await queryWithParams(`
    SELECT
      COALESCE(SUM(CVC.IMPORTEPENDIENTE), 0) AS TOTAL_PENDIENTE,
      COALESCE(SUM(CASE
        WHEN (CVC.ANOVENCIMIENTO * 10000 + CVC.MESVENCIMIENTO * 100 + CVC.DIAVENCIMIENTO) < ?
        THEN CVC.IMPORTEPENDIENTE ELSE 0 END), 0) AS TOTAL_VENCIDO,
      COUNT(*) AS DOCUMENTOS_PENDIENTES,
      COUNT(DISTINCT TRIM(CVC.CODIGOCLIENTEALBARAN)) AS CLIENTES_PENDIENTES
    FROM DSEDAC.CVC CVC
    INNER JOIN DSEDAC.CPC CPC
      ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
      AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
      AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
      AND CVC.TERMINALDOCUMENTO = CPC.TERMINALALBARAN
      AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
    INNER JOIN DSEDAC.OPP OPP
      ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
    WHERE TRIM(OPP.CODIGOREPARTIDOR) = ?
      AND CVC.ANOEMISION = ?
      AND CVC.MESEMISION = ?
      AND COALESCE(CVC.ANULADOSN, '') <> 'S'
      AND CVC.TIPODOCUMENTO IN ('CAC', 'COC', 'DEV')
      AND CVC.IMPORTEPENDIENTE <> 0
  `, [todayYmd, repartidorId, year, month], false, false);

  const row = firstRow(rows);
  return {
    repartidorId,
    period: { year, month },
    summary: {
      totalPendiente: roundMoney(value(row, 'TOTAL_PENDIENTE')),
      totalVencido: roundMoney(value(row, 'TOTAL_VENCIDO')),
      documentosPendientes: toInt(value(row, 'DOCUMENTOS_PENDIENTES')),
      clientesPendientes: toInt(value(row, 'CLIENTES_PENDIENTES')),
    },
  };
}

async function getVencimientos({ repartidorId, from, to, limit, clientCode, estado }) {
  const fromParts = dateParts(from);
  const toParts = dateParts(to);
  const broadFrom = compactDate(addDaysIso(fromParts.year, fromParts.month, fromParts.day, -120));
  const broadTo = compactDate(addDaysIso(toParts.year, toParts.month, toParts.day, 120));
  const params = [repartidorId, broadFrom, broadTo];
  let clientFilter = '';
  if (clientCode) {
    clientFilter = ' AND TRIM(CVC.CODIGOCLIENTEALBARAN) = ?';
    params.push(clientCode.trim());
  }
  const candidateLimit = Math.min(Math.max(limit * 25, 1000), 20000);
  params.push(candidateLimit);

  const rows = await queryWithParams(`
    SELECT *
    FROM (
      SELECT
        CVC.TIPODOCUMENTO,
        CVC.ORIGENDOCUMENTO,
        CVC.SUBEMPRESADOCUMENTO,
        CVC.EJERCICIODOCUMENTO,
        CVC.SERIEDOCUMENTO,
        CVC.TERMINALDOCUMENTO,
        CVC.NUMERODOCUMENTO,
        CVC.XDEDOCUMENTO,
        CVC.DEXDOCUMENTO,
        CVC.CODIGOCLIENTEALBARAN,
        TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBRECLIENTE), ''), CVC.CODIGOCLIENTEALBARAN)) AS NOMBRE_CLIENTE,
        TRIM(COALESCE(CLI.NOMBREALTERNATIVO, '')) AS NOMBREALTERNATIVO,
        TRIM(COALESCE(CLI.POBLACION, '')) AS POBLACION,
        CVC.DIAVENCIMIENTO,
        CVC.MESVENCIMIENTO,
        CVC.ANOVENCIMIENTO,
        CVC.DIAEMISION AS FACTURA_BASE_DIA,
        CVC.MESEMISION AS FACTURA_BASE_MES,
        CVC.ANOEMISION AS FACTURA_BASE_ANO,
        CPC.DIADOCUMENTO AS ALBARAN_BASE_DIA,
        CPC.MESDOCUMENTO AS ALBARAN_BASE_MES,
        CPC.ANODOCUMENTO AS ALBARAN_BASE_ANO,
        CLCL1.DIASLIMITECREDITO,
        CLCL1.DIASLIMITECREDITOCONFECHAALB,
        CVC.IMPORTEVENCIMIENTO,
        CAST(
          CVC.IMPORTEPENDIENTE - COALESCE(APP_COBROS.IMPORTE_COBRADO_APP, 0)
          AS DECIMAL(15,2)
        ) AS IMPORTEPENDIENTE,
        ROW_NUMBER() OVER (
          ORDER BY CVC.ANOVENCIMIENTO, CVC.MESVENCIMIENTO, CVC.DIAVENCIMIENTO, CVC.NUMERODOCUMENTO
        ) AS RN
      FROM DSEDAC.CVC CVC
      INNER JOIN DSEDAC.CPC CPC
        ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
        AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
        AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
        AND CVC.TERMINALDOCUMENTO = CPC.TERMINALALBARAN
        AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
      INNER JOIN DSEDAC.OPP OPP
        ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
      LEFT JOIN DSEDAC.CLI CLI
        ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
      LEFT JOIN DSEDAC.CLCL1 CLCL1
        ON TRIM(CLCL1.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
      LEFT JOIN (
        SELECT
          TRIM(CODIGOVENDEDOR) AS CODIGOVENDEDOR,
          TRIM(CODIGOCLIENTEALBARAN) AS CODIGOCLIENTEALBARAN,
          TRIM(TIPODOCUMENTO) AS TIPODOCUMENTO,
          TRIM(ORIGENDOCUMENTO) AS ORIGENDOCUMENTO,
          TRIM(SUBEMPRESADOCUMENTO) AS SUBEMPRESADOCUMENTO,
          EJERCICIODOCUMENTO,
          TRIM(SERIEDOCUMENTO) AS SERIEDOCUMENTO,
          TERMINALDOCUMENTO,
          NUMERODOCUMENTO,
          XDEDOCUMENTO,
          DEXDOCUMENTO,
          SUM(COALESCE(IMPORTEVENCIMIENTO, 0)) AS IMPORTE_COBRADO_APP
        FROM JAVIER.REPARTIDOR_COBROS
        GROUP BY
          TRIM(CODIGOVENDEDOR),
          TRIM(CODIGOCLIENTEALBARAN),
          TRIM(TIPODOCUMENTO),
          TRIM(ORIGENDOCUMENTO),
          TRIM(SUBEMPRESADOCUMENTO),
          EJERCICIODOCUMENTO,
          TRIM(SERIEDOCUMENTO),
          TERMINALDOCUMENTO,
          NUMERODOCUMENTO,
          XDEDOCUMENTO,
          DEXDOCUMENTO
      ) APP_COBROS
        ON APP_COBROS.CODIGOVENDEDOR = TRIM(OPP.CODIGOREPARTIDOR)
        AND APP_COBROS.CODIGOCLIENTEALBARAN = TRIM(CVC.CODIGOCLIENTEALBARAN)
        AND APP_COBROS.TIPODOCUMENTO = TRIM(CVC.TIPODOCUMENTO)
        AND APP_COBROS.ORIGENDOCUMENTO = TRIM(CVC.ORIGENDOCUMENTO)
        AND APP_COBROS.SUBEMPRESADOCUMENTO = TRIM(CVC.SUBEMPRESADOCUMENTO)
        AND APP_COBROS.EJERCICIODOCUMENTO = CVC.EJERCICIODOCUMENTO
        AND APP_COBROS.SERIEDOCUMENTO = TRIM(CVC.SERIEDOCUMENTO)
        AND APP_COBROS.TERMINALDOCUMENTO = CVC.TERMINALDOCUMENTO
        AND APP_COBROS.NUMERODOCUMENTO = CVC.NUMERODOCUMENTO
        AND COALESCE(APP_COBROS.XDEDOCUMENTO, 1) = COALESCE(CVC.XDEDOCUMENTO, 1)
        AND COALESCE(APP_COBROS.DEXDOCUMENTO, 1) = COALESCE(CVC.DEXDOCUMENTO, 1)
      WHERE TRIM(OPP.CODIGOREPARTIDOR) = ?
        AND (CVC.ANOVENCIMIENTO * 10000 + CVC.MESVENCIMIENTO * 100 + CVC.DIAVENCIMIENTO) BETWEEN ? AND ?
        AND COALESCE(CVC.ANULADOSN, '') <> 'S'
        AND CVC.TIPODOCUMENTO IN ('CAC', 'COC', 'DEV')
        AND CVC.IMPORTEPENDIENTE <> 0
        ${clientFilter}
    ) V
    WHERE V.RN <= ?
    ORDER BY V.ANOVENCIMIENTO, V.MESVENCIMIENTO, V.DIAVENCIMIENTO, V.NUMERODOCUMENTO
  `, params, false, false);

  const fromYmd = compactDate(from);
  const toYmd = compactDate(to);
  const now = new Date();
  const todayYmd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();

  return rows
    .map(mapVencimiento)
    .filter((item) => {
      const dueYmd = isoDateToCompact(item.fechaVencimiento);
      if (dueYmd < fromYmd || dueYmd > toYmd) return false;
      if (item.importePendiente === 0) return false;
      if (estado === 'vencido') return dueYmd < todayYmd;
      return true;
    })
    .slice(0, limit);
}

async function registerCobro(input) {
  const replayExisting = async () => {
    const existingRows = await queryWithParams(`
      SELECT *
      FROM JAVIER.REPARTIDOR_COBROS
      WHERE IDEMPOTENCY_TOKEN = ?
      FETCH FIRST 1 ROW ONLY
    `, [input.idempotencyToken], false, false);
    const existing = firstRow(existingRows);
    assertCobroPayloadMatchesInput(existing, expectedCobroPayload(null, input));
    return { created: false, id: String(value(existing, 'ID')) };
  };

  try {
    return await withTransaction(async (conn) => {
      await validateCobroDocument(input, conn);

      const existingRows = await conn.query(`
        SELECT *
        FROM JAVIER.REPARTIDOR_COBROS
        WHERE IDEMPOTENCY_TOKEN = ?
        FETCH FIRST 1 ROW ONLY
      `, [input.idempotencyToken]);

      if (existingRows.length > 0) {
        const existing = firstRow(existingRows);
        assertCobroPayloadMatchesInput(existing, expectedCobroPayload(null, input));
        return { created: false, id: String(value(existing, 'ID')) };
      }

      await conn.query(`
        INSERT INTO JAVIER.REPARTIDOR_COBROS (
          ENTREGA_APP_ID,
          CODIGOCLIENTEALBARAN,
          CODIGOVENDEDOR,
          TIPODOCUMENTO,
          ORIGENDOCUMENTO,
          SUBEMPRESADOCUMENTO,
          EJERCICIODOCUMENTO,
          SERIEDOCUMENTO,
          TERMINALDOCUMENTO,
          NUMERODOCUMENTO,
          XDEDOCUMENTO,
          DEXDOCUMENTO,
          IMPORTEVENCIMIENTO,
          IMPORTEPENDIENTE,
          CODIGOFORMAPAGO,
          IDEMPOTENCY_TOKEN,
          PANTALLA_ORIGEN,
          OPERADOR,
          OBSERVACIONES
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        input.entregaId || null,
        input.codigoCliente,
        input.codigoRepartidor,
        normalizeTipoDocumento(input.tipoDocumento),
        input.origenDocumento || 'B',
        input.subempresaDocumento || 'GMP',
        input.ejercicioDocumento,
        input.serieDocumento,
        input.terminalDocumento,
        input.numeroDocumento,
        input.xdeDocumento || 1,
        input.dexDocumento || 1,
        roundMoney(input.importeCobrado),
        roundMoney(input.importePendiente),
        input.formaPago,
        input.idempotencyToken,
        input.pantallaOrigen,
        input.operador,
        input.notas || null,
      ]);

      const row = firstRow(await conn.query(`
        SELECT ID FROM JAVIER.REPARTIDOR_COBROS
        WHERE IDEMPOTENCY_TOKEN = ?
        FETCH FIRST 1 ROW ONLY
      `, [input.idempotencyToken]));

      return { created: true, id: String(value(row, 'ID', '')) };
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return replayExisting();
    }
    throw error;
  }
}

async function validateCobroDocument(input, conn = null) {
  const sql = `
    SELECT 1 AS OK
    FROM DSEDAC.CPC CPC
    INNER JOIN DSEDAC.OPP OPP
      ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
    WHERE CPC.EJERCICIOALBARAN = ?
      AND TRIM(CPC.SERIEALBARAN) = ?
      AND CPC.TERMINALALBARAN = ?
      AND CPC.NUMEROALBARAN = ?
      AND TRIM(CPC.CODIGOCLIENTEALBARAN) = ?
      AND TRIM(OPP.CODIGOREPARTIDOR) = ?
    FETCH FIRST 1 ROW ONLY
  `;
  const params = [
    input.ejercicioDocumento,
    input.serieDocumento,
    input.terminalDocumento,
    input.numeroDocumento,
    input.codigoCliente,
    input.codigoRepartidor,
  ];
  const rows = conn
    ? await conn.query(sql, params)
    : await queryWithParams(sql, params, false, false);
  if (!Array.isArray(rows) || rows.length === 0) {
    const error = new Error('El documento no pertenece al repartidor o cliente indicado');
    error.code = 'DOCUMENT_NOT_ASSIGNED';
    throw error;
  }
}

async function confirmRuteroDeliveryWithCobro({ delivery, cobro }) {
  async function replayExisting() {
    const existingRows = await queryWithParams(`
      SELECT *
      FROM JAVIER.REPARTIDOR_COBROS
      WHERE IDEMPOTENCY_TOKEN = ?
      FETCH FIRST 1 ROW ONLY
    `, [cobro.idempotencyToken], false, false);
    const existing = firstRow(existingRows);
    assertCobroMatchesInput(existing, delivery, cobro);
    const deliveryRows = await queryWithParams(`
      SELECT CONFORMADOSN
      FROM JAVIER.DELIVERY_STATUS
      WHERE ID = ?
      FETCH FIRST 1 ROW ONLY
    `, [delivery.itemId], false, false);
    if (normalizeText(value(firstRow(deliveryRows), 'CONFORMADOSN')) !== 'ENTREGADO') {
      const error = new Error(
        'Token de cobro existente sin entrega confirmada; requiere revision manual',
      );
      error.code = 'INCONSISTENT_IDEMPOTENCY';
      throw error;
    }
    return {
      created: false,
      idempotent: true,
      deliveryStatus: 'ENTREGADO',
      cobroId: String(value(existing, 'ID', '')),
    };
  }

  try {
    return await withTransaction(async (conn) => {
    const tokenRows = await conn.query(`
      SELECT *
      FROM JAVIER.REPARTIDOR_COBROS
      WHERE IDEMPOTENCY_TOKEN = ?
      FETCH FIRST 1 ROW ONLY
    `, [cobro.idempotencyToken]);

    const deliveryRows = await conn.query(`
      SELECT CONFORMADOSN, UPDATED_AT, REPARTIDOR_ID
      FROM JAVIER.DELIVERY_STATUS
      WHERE ID = ?
      FETCH FIRST 1 ROW ONLY
    `, [delivery.itemId]);
    const existingDelivery = firstRow(deliveryRows);
    const isDelivered =
      String(value(existingDelivery, 'CONFORMADOSN', '') || '').trim() === 'ENTREGADO';

    if (tokenRows.length > 0) {
      assertCobroMatchesInput(tokenRows[0], delivery, cobro);
      if (isDelivered) {
        return {
          created: false,
          idempotent: true,
          deliveryStatus: 'ENTREGADO',
          cobroId: String(value(tokenRows[0], 'ID', '')),
        };
      }

      const error = new Error(
        'Token de cobro existente sin entrega confirmada; requiere revision manual',
      );
      error.code = 'INCONSISTENT_IDEMPOTENCY';
      throw error;
    }

    if (isDelivered && !delivery.forceUpdate) {
      throw new AlreadyDeliveredError(existingDelivery);
    }

    await validateCobroDocument({
      ...cobro,
      codigoRepartidor: cobro.codigoRepartidor || delivery.repartidorId,
    }, conn);

    const lat = toNumber(delivery.latitud);
    const lon = toNumber(delivery.longitud);
    let repartidorId = String(delivery.repartidorId || '').trim();
    if (repartidorId.length > 20) repartidorId = repartidorId.substring(0, 20);

    await conn.query(`
      DELETE FROM JAVIER.DELIVERY_STATUS
      WHERE ID = ?
    `, [delivery.itemId]);

    await conn.query(`
      INSERT INTO JAVIER.DELIVERY_STATUS (
        ID,
        CONFORMADOSN,
        OBSERVACIONES,
        FIRMA_PATH,
        LATITUD,
        LONGITUD,
        REPARTIDOR_ID,
        UPDATED_AT
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT TIMESTAMP)
    `, [
      delivery.itemId,
      delivery.status || 'ENTREGADO',
      delivery.observaciones || '',
      delivery.firma || '',
      lat,
      lon,
      repartidorId,
    ]);

    await conn.query(`
      INSERT INTO JAVIER.REPARTIDOR_COBROS (
        ENTREGA_APP_ID,
        CODIGOCLIENTEALBARAN,
        CODIGOVENDEDOR,
        TIPODOCUMENTO,
        ORIGENDOCUMENTO,
        SUBEMPRESADOCUMENTO,
        EJERCICIODOCUMENTO,
        SERIEDOCUMENTO,
        TERMINALDOCUMENTO,
        NUMERODOCUMENTO,
        XDEDOCUMENTO,
        DEXDOCUMENTO,
        IMPORTEVENCIMIENTO,
        IMPORTEPENDIENTE,
        CODIGOFORMAPAGO,
        IDEMPOTENCY_TOKEN,
        PANTALLA_ORIGEN,
        OPERADOR,
        OBSERVACIONES
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      cobro.entregaId || delivery.itemId,
      cobro.codigoCliente,
      cobro.codigoRepartidor || repartidorId,
      normalizeTipoDocumento(cobro.tipoDocumento),
      cobro.origenDocumento || 'B',
      cobro.subempresaDocumento || 'GMP',
      cobro.ejercicioDocumento,
      cobro.serieDocumento,
      cobro.terminalDocumento,
      cobro.numeroDocumento,
      cobro.xdeDocumento || 1,
      cobro.dexDocumento || 1,
      roundMoney(cobro.importeCobrado),
      roundMoney(cobro.importePendiente),
      cobro.formaPago,
      cobro.idempotencyToken,
      cobro.pantallaOrigen || 'RUTERO',
      cobro.operador || 'unknown',
      cobro.notas || null,
    ]);

    return {
      created: true,
      idempotent: false,
      deliveryStatus: delivery.status || 'ENTREGADO',
    };
  });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return replayExisting();
    }
    throw error;
  }
}

async function nextLiquidacionNumber({ conn, subempresa, ejercicio, serie, terminal }) {
  const sql = `
    SELECT COALESCE(MAX(NUMEROLIQUIDACION), 0) + 1 AS NEXT_NUMERO
    FROM ${LQD_TABLE}
    WHERE SUBEMPRESALIQUIDACION = ?
      AND EJERCICIOLIQUIDACION = ?
      AND SERIELIQUIDACION = ?
      AND TERMINALLIQUIDACION = ?
  `;
  const params = [subempresa, ejercicio, serie, terminal];
  const rows = conn
    ? await conn.query(sql, params)
    : await queryWithParams(sql, params, false, false);
  const numero = toInt(value(firstRow(rows), 'NEXT_NUMERO', 1));
  return numero > 0 ? numero : 1;
}

async function withTransaction(callback) {
  let pool = getPool();
  if (!pool) {
    await initDb();
    pool = getPool();
  }
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN WORK');
    const result = await callback(conn);
    await conn.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await conn.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error(`[REPARTIDOR_FINANZAS] Rollback failed: ${rollbackError.message}`);
    }
    throw error;
  } finally {
    try {
      await conn.close();
    } catch (_) {
      // ignore close errors
    }
  }
}

async function closeLiquidacion(input) {
  const existingRow = await findLiquidacionRowByToken(input.idempotencyToken);
  if (existingRow && Object.keys(existingRow).length > 0) {
    assertLiquidacionMatchesInput(existingRow, input);
    return { created: false, liquidacion: mapLiquidacion(existingRow) };
  }

  const { year, month, day } = dateParts(input.date);
  const subempresa = 'GMP';
  const serie = 'A';
  const terminal = toInt(input.repartidorId);
  const hora = currentHhmmss();
  let createdLiquidacion = null;
  let replayedInsideTransaction = false;

  await withTransaction(async (conn) => {
    const existingInsideRow = firstRow(await conn.query(`
      SELECT
        OPS.*,
        LQD.DIALIQUIDACION,
        LQD.MESLIQUIDACION,
        LQD.ANOLIQUIDACION
      FROM JAVIER.REPARTIDOR_LIQUIDACION_OPS OPS
      LEFT JOIN ${LQD_TABLE} LQD
        ON LQD.IDMARCALIQUIDACION = OPS.IDEMPOTENCY_TOKEN
      WHERE OPS.IDEMPOTENCY_TOKEN = ?
      FETCH FIRST 1 ROW ONLY
    `, [input.idempotencyToken]));
    if (existingInsideRow && Object.keys(existingInsideRow).length > 0) {
      assertLiquidacionMatchesInput(existingInsideRow, input);
      createdLiquidacion = mapLiquidacion(existingInsideRow);
      replayedInsideTransaction = true;
      return;
    }

    try {
      await conn.query(`LOCK TABLE ${LQD_TABLE} IN EXCLUSIVE MODE`);
    } catch (lockError) {
      logger.error(`[REPARTIDOR_FINANZAS] Could not lock ${LQD_TABLE} before numbering: ${lockError.message}`);
      throw lockError;
    }

    try {
      await conn.query('LOCK TABLE JAVIER.REPARTIDOR_COBROS IN EXCLUSIVE MODE');
      await conn.query('LOCK TABLE JAVIER.REPARTIDOR_FINANCIAL_BALANCES IN EXCLUSIVE MODE');
    } catch (lockError) {
      logger.error(`[REPARTIDOR_FINANZAS] Could not lock finance tables before closing: ${lockError.message}`);
      throw lockError;
    }

    const existingAfterLockRow = firstRow(await conn.query(`
      SELECT
        OPS.*,
        LQD.DIALIQUIDACION,
        LQD.MESLIQUIDACION,
        LQD.ANOLIQUIDACION
      FROM JAVIER.REPARTIDOR_LIQUIDACION_OPS OPS
      LEFT JOIN ${LQD_TABLE} LQD
        ON LQD.IDMARCALIQUIDACION = OPS.IDEMPOTENCY_TOKEN
      WHERE OPS.IDEMPOTENCY_TOKEN = ?
      FETCH FIRST 1 ROW ONLY
    `, [input.idempotencyToken]));
    if (existingAfterLockRow && Object.keys(existingAfterLockRow).length > 0) {
      assertLiquidacionMatchesInput(existingAfterLockRow, input);
      createdLiquidacion = mapLiquidacion(existingAfterLockRow);
      replayedInsideTransaction = true;
      return;
    }

    const orphanLqd = firstRow(await conn.query(`
      SELECT IDMARCALIQUIDACION
      FROM ${LQD_TABLE}
      WHERE IDMARCALIQUIDACION = ?
      FETCH FIRST 1 ROW ONLY
    `, [input.idempotencyToken]));
    if (orphanLqd && Object.keys(orphanLqd).length > 0) {
      throw new IdempotencyConflictError(
        'Existe una liquidacion ERP con este token pero sin ledger local; requiere revision manual',
      );
    }

    const existingSameDay = firstRow(await conn.query(`
      SELECT IDMARCALIQUIDACION
      FROM ${LQD_TABLE}
      WHERE SUBEMPRESALIQUIDACION = ?
        AND EJERCICIOLIQUIDACION = ?
        AND SERIELIQUIDACION = ?
        AND TERMINALLIQUIDACION = ?
        AND DIALIQUIDACION = ?
        AND MESLIQUIDACION = ?
        AND ANOLIQUIDACION = ?
      FETCH FIRST 1 ROW ONLY
    `, [subempresa, year, serie, terminal, day, month, year]));
    const existingDailyToken = normalizeText(value(existingSameDay, 'IDMARCALIQUIDACION'));
    if (existingDailyToken && existingDailyToken !== input.idempotencyToken) {
      throw new DuplicateLiquidacionError(
        `Ya existe una liquidacion para el repartidor ${input.repartidorId} en ${input.date}`,
      );
    }

    const numero = await nextLiquidacionNumber({
      conn,
      subempresa,
      ejercicio: year,
      serie,
      terminal,
    });
    const dateYmd = compactDate(input.date);

    const totalsRow = firstRow(await conn.query(`
      SELECT
        COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('EFECTIVO', 'E', 'CONTADO') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_EFECTIVO,
        COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('CHEQUE', 'TALON', 'TALON BANCARIO') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_CHEQUES,
        COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('TARJETA', 'TPV', 'BIZUM') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_TARJETA,
        COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('POSTDATADO', 'POSTDATADOS') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_POSTDATADOS,
        COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL_COBROS_DIA,
        COUNT(*) AS COBROS_COUNT
      FROM JAVIER.REPARTIDOR_COBROS
      WHERE TRIM(CODIGOVENDEDOR) = ?
        AND ANOVENCIMIENTO * 10000 + MESVENCIMIENTO * 100 + DIAVENCIMIENTO = ?
        AND COALESCE(LIQUIDADO_SN, 'N') <> 'S'
    `, [input.repartidorId, dateYmd]));

    const cobroRows = await conn.query(`
      SELECT ID
      FROM JAVIER.REPARTIDOR_COBROS
      WHERE TRIM(CODIGOVENDEDOR) = ?
        AND ANOVENCIMIENTO * 10000 + MESVENCIMIENTO * 100 + DIAVENCIMIENTO = ?
        AND COALESCE(LIQUIDADO_SN, 'N') <> 'S'
      ORDER BY ANOVENCIMIENTO, MESVENCIMIENTO, DIAVENCIMIENTO, ID
    `, [input.repartidorId, dateYmd]);

    const balanceRow = firstRow(await conn.query(`
      SELECT SALDO_PENDIENTE
      FROM JAVIER.REPARTIDOR_FINANCIAL_BALANCES
      WHERE TRIM(CODIGOVENDEDOR) = ?
      FETCH FIRST 1 ROW ONLY
    `, [input.repartidorId]));

    const gastos = roundMoney(input.totals.gastos);
    const totals = {
      totalEfectivo: roundMoney(value(totalsRow, 'TOTAL_EFECTIVO')),
      totalCheques: roundMoney(value(totalsRow, 'TOTAL_CHEQUES')),
      totalTarjeta: roundMoney(value(totalsRow, 'TOTAL_TARJETA')),
      totalPostdatados: roundMoney(value(totalsRow, 'TOTAL_POSTDATADOS')),
      saldoActual: roundMoney(value(balanceRow, 'SALDO_PENDIENTE')),
      totalCobrosDia: roundMoney(value(totalsRow, 'TOTAL_COBROS_DIA')),
      gastos,
      totalAIngresar: 0,
      ingresoBanco: roundMoney(input.totals.ingresoBanco),
      efectivo2: roundMoney(input.totals.efectivo2),
      entregado2: roundMoney(input.totals.entregado2),
    };
    totals.totalAIngresar = roundMoney(
      totals.saldoActual + totals.totalCobrosDia - totals.gastos
    );
    const saldoResultante = roundMoney(
      totals.totalAIngresar - totals.ingresoBanco
    );

    await conn.query(`
      INSERT INTO ${LQD_TABLE} (
        SUBEMPRESALIQUIDACION,
        EJERCICIOLIQUIDACION,
        SERIELIQUIDACION,
        TERMINALLIQUIDACION,
        NUMEROLIQUIDACION,
        DIALIQUIDACION,
        MESLIQUIDACION,
        ANOLIQUIDACION,
        HORALIQUIDACION,
        CODIGOVENDEDOR,
        CODIGOVENDEDORUSUARIO,
        CODIGOUSUARIO,
        MATRICULA,
        KILOMETROSSALIDA,
        KILOMETROSLLEGADA,
        KILOMETROSRECORRIDOS,
        IMPORTEEFECTIVO,
        IMPORTECHEQUES,
        IMPORTEPOSTDATADOS,
        IMPORTESALDOACTUAL,
        IMPORTETOTALAINGRESAR,
        IMPORTEINGRESOENBANCO,
        IMPORTEGASTOS,
        IMPRESOSN,
        CODIGOVEHICULO,
        REVISADOSN,
        IDMARCALIQUIDACION,
        IMPORTEEFECTIVO2,
        IMPORTEENTREGADO2,
        IMPORTETARJETA
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      subempresa,
      year,
      serie,
      terminal,
      numero,
      day,
      month,
      year,
      hora,
      pad(input.repartidorId, 2).slice(-2),
      pad(input.repartidorId, 2).slice(-2),
      String(input.createdBy || '').substring(0, 10),
      input.matricula || '',
      0,
      0,
      0,
      roundMoney(totals.totalEfectivo),
      roundMoney(totals.totalCheques),
      roundMoney(totals.totalPostdatados),
      roundMoney(totals.saldoActual),
      roundMoney(totals.totalAIngresar),
      roundMoney(totals.ingresoBanco),
      roundMoney(totals.gastos),
      'N',
      input.codigoVehiculo || '',
      'N',
      input.idempotencyToken,
      roundMoney(totals.efectivo2),
      roundMoney(totals.entregado2),
      roundMoney(totals.totalTarjeta),
    ]);

    await conn.query(`
      INSERT INTO JAVIER.REPARTIDOR_LIQUIDACION_OPS (
        IDEMPOTENCY_TOKEN,
        SUBEMPRESALIQUIDACION,
        EJERCICIOLIQUIDACION,
        SERIELIQUIDACION,
        TERMINALLIQUIDACION,
        NUMEROLIQUIDACION,
        CODIGOVENDEDOR,
        IMPORTEEFECTIVO,
        IMPORTECHEQUES,
        IMPORTETARJETA,
        IMPORTEPOSTDATADOS,
        IMPORTESALDOACTUAL,
        TOTAL_COBROS_DIA,
        IMPORTEGASTOS,
        IMPORTETOTALAINGRESAR,
        IMPORTEINGRESOENBANCO,
        IMPORTEEFECTIVO2,
        IMPORTEENTREGADO2,
        SALDO_RESULTANTE,
        CODIGOUSUARIO,
        REVISADOSN
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CLOSED')
    `, [
      input.idempotencyToken,
      subempresa,
      year,
      serie,
      terminal,
      numero,
      input.repartidorId,
      roundMoney(totals.totalEfectivo),
      roundMoney(totals.totalCheques),
      roundMoney(totals.totalTarjeta),
      roundMoney(totals.totalPostdatados),
      roundMoney(totals.saldoActual),
      roundMoney(totals.totalCobrosDia),
      roundMoney(totals.gastos),
      roundMoney(totals.totalAIngresar),
      roundMoney(totals.ingresoBanco),
      roundMoney(totals.efectivo2),
      roundMoney(totals.entregado2),
      saldoResultante,
      input.createdBy || 'unknown',
    ]);

    await conn.query(`
      MERGE INTO JAVIER.REPARTIDOR_FINANCIAL_BALANCES B
      USING (VALUES (?, ?, ?)) AS V(CODIGOVENDEDOR, SALDO_PENDIENTE, UPDATED_BY)
        ON B.CODIGOVENDEDOR = V.CODIGOVENDEDOR
      WHEN MATCHED THEN
        UPDATE SET SALDO_PENDIENTE = V.SALDO_PENDIENTE,
                   UPDATED_BY = V.UPDATED_BY,
                   UPDATED_AT = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT (CODIGOVENDEDOR, SALDO_PENDIENTE, UPDATED_BY)
        VALUES (V.CODIGOVENDEDOR, V.SALDO_PENDIENTE, V.UPDATED_BY)
    `, [input.repartidorId, saldoResultante, input.createdBy || 'unknown']);

    if (cobroRows.length > 0) {
      const placeholders = cobroRows.map(() => '?').join(', ');
      await conn.query(`
        UPDATE JAVIER.REPARTIDOR_COBROS
        SET LIQUIDADO_SN = 'S',
            LIQUIDACION_TOKEN = ?
        WHERE ID IN (${placeholders})
      `, [
        input.idempotencyToken,
        ...cobroRows.map((row) => value(row, 'ID')),
      ]);
    }
  });

  const liquidacion =
    createdLiquidacion || await findLiquidacionByToken(input.idempotencyToken);
  return { created: !replayedInsideTransaction, liquidacion };
}

async function getCommissionTiers() {
  const rows = await queryWithParams(`
    SELECT ID, THRESHOLD_PCT, COMMISSION_PCT, SORT_ORDER, ACTIVE_SN
    FROM JAVIER.REPARTIDOR_COMMISSION_TIERS
    WHERE ACTIVE_SN = 'S'
    ORDER BY SORT_ORDER, THRESHOLD_PCT
  `, [], false, false);
  return rows.map((row) => ({
    id: value(row, 'ID') == null ? null : String(value(row, 'ID')),
    thresholdPct: roundMoney(value(row, 'THRESHOLD_PCT')),
    commissionPct: roundMoney(value(row, 'COMMISSION_PCT')),
    sortOrder: toInt(value(row, 'SORT_ORDER')),
  }));
}

function calculateCommission({ deliveredAmount, collectedAmount, tiers }) {
  const delivered = roundMoney(deliveredAmount);
  const collected = roundMoney(collectedAmount);
  const reached = [];
  let total = 0;

  for (const tier of tiers) {
    const thresholdAmount = roundMoney(delivered * (toNumber(tier.thresholdPct) / 100));
    const excess = Math.max(0, collected - thresholdAmount);
    const amount = roundMoney(excess * (toNumber(tier.commissionPct) / 100));
    if (excess > 0) {
      reached.push({
        thresholdPct: toNumber(tier.thresholdPct),
        commissionPct: toNumber(tier.commissionPct),
        thresholdAmount,
        excess: roundMoney(excess),
        commission: amount,
      });
      total += amount;
    }
  }

  return {
    deliveredAmount: delivered,
    collectedAmount: collected,
    collectedPct: delivered > 0 ? roundMoney((collected / delivered) * 100) : 0,
    commission: roundMoney(total),
    reached,
  };
}

async function getCommissionSummary({ repartidorId, from, to }) {
  const deliveredRows = await queryWithParams(`
    SELECT COALESCE(SUM(CPC.IMPORTETOTAL), 0) AS TOTAL_REPARTIDO
    FROM DSEDAC.OPP OPP
    INNER JOIN DSEDAC.CPC CPC
      ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
    WHERE TRIM(OPP.CODIGOREPARTIDOR) = ?
      AND (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) BETWEEN ? AND ?
  `, [repartidorId, compactDate(from), compactDate(to)], false, false);

  const collectedRows = await queryWithParams(`
    SELECT COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL_COBRADO
    FROM JAVIER.REPARTIDOR_COBROS
    WHERE TRIM(CODIGOVENDEDOR) = ?
      AND ANOVENCIMIENTO * 10000 + MESVENCIMIENTO * 100 + DIAVENCIMIENTO >= ?
      AND ANOVENCIMIENTO * 10000 + MESVENCIMIENTO * 100 + DIAVENCIMIENTO <= ?
  `, [repartidorId, compactDate(from), compactDate(nextIsoDate(to))], false, false);

  const tiers = await getCommissionTiers();
  const result = calculateCommission({
    deliveredAmount: value(firstRow(deliveredRows), 'TOTAL_REPARTIDO'),
    collectedAmount: value(firstRow(collectedRows), 'TOTAL_COBRADO'),
    tiers,
  });

  return {
    repartidorId,
    range: { from, to },
    ...result,
    tiers,
  };
}

async function saveCommissionTiers({ tiers, updatedBy }) {
  await withTransaction(async (conn) => {
    await conn.query(`
      UPDATE JAVIER.REPARTIDOR_COMMISSION_TIERS
      SET ACTIVE_SN = 'N',
          UPDATED_BY = ?,
          UPDATED_AT = CURRENT_TIMESTAMP
      WHERE ACTIVE_SN = 'S'
    `, [updatedBy || 'unknown']);

    for (let index = 0; index < tiers.length; index++) {
      const tier = tiers[index];
      await conn.query(`
        INSERT INTO JAVIER.REPARTIDOR_COMMISSION_TIERS (
          THRESHOLD_PCT,
          COMMISSION_PCT,
          SORT_ORDER,
          ACTIVE_SN,
          CREATED_BY
        ) VALUES (?, ?, ?, 'S', ?)
      `, [
        roundMoney(tier.thresholdPct),
        roundMoney(tier.commissionPct),
        index + 1,
        updatedBy || 'unknown',
      ]);
    }
  });
  return getCommissionTiers();
}

async function deleteTestData(idempotencyToken, options = {}) {
  const opRows = await queryWithParams(`
    SELECT CODIGOVENDEDOR, IMPORTESALDOACTUAL, CREATED_AT
    FROM JAVIER.REPARTIDOR_LIQUIDACION_OPS
    WHERE IDEMPOTENCY_TOKEN = ?
    FETCH FIRST 1 ROW ONLY
  `, [idempotencyToken], false, false);
  const opRow = firstRow(opRows);

  const cobroRows = await queryWithParams(`
    SELECT ENTREGA_APP_ID, LIQUIDACION_TOKEN
    FROM JAVIER.REPARTIDOR_COBROS
    WHERE IDEMPOTENCY_TOKEN = ?
  `, [idempotencyToken], false, false);

  const liquidatedCobro = cobroRows.find((row) =>
    normalizeText(value(row, 'LIQUIDACION_TOKEN')).length > 0
  );
  if (liquidatedCobro && Object.keys(opRow).length === 0) {
    throw new Error(
      'Cleanup bloqueado: el cobro ya pertenece a una liquidacion. Borra primero la liquidacion de prueba.',
    );
  }

  if (Object.keys(opRow).length > 0) {
    const newerRows = await queryWithParams(`
      SELECT ID
      FROM JAVIER.REPARTIDOR_LIQUIDACION_OPS
      WHERE TRIM(CODIGOVENDEDOR) = ?
        AND CREATED_AT > ?
        AND REVISADOSN = 'CLOSED'
      FETCH FIRST 1 ROW ONLY
    `, [
      normalizeText(value(opRow, 'CODIGOVENDEDOR')),
      value(opRow, 'CREATED_AT'),
    ], false, false);
    if (newerRows.length > 0) {
      throw new Error(
        'Cleanup bloqueado: existen liquidaciones posteriores para este repartidor. No se restaura saldo de una prueba antigua.',
      );
    }
  }

  await queryWithParams(`
    DELETE FROM JAVIER.REPARTIDOR_LIQUIDACION_EMAILS
    WHERE LIQUIDACION_OP_ID IN (
      SELECT ID FROM JAVIER.REPARTIDOR_LIQUIDACION_OPS WHERE IDEMPOTENCY_TOKEN = ?
    )
  `, [idempotencyToken], false, false);
  await queryWithParams(`
    DELETE FROM JAVIER.REPARTIDOR_LIQUIDACION_OPS WHERE IDEMPOTENCY_TOKEN = ?
  `, [idempotencyToken], false, false);
  await queryWithParams(`
    DELETE FROM ${LQD_TABLE} WHERE IDMARCALIQUIDACION = ?
  `, [idempotencyToken], false, false);
  await queryWithParams(`
    UPDATE JAVIER.REPARTIDOR_COBROS
    SET LIQUIDADO_SN = 'N',
        LIQUIDACION_TOKEN = NULL
    WHERE LIQUIDACION_TOKEN = ?
  `, [idempotencyToken], false, false);

  if (Object.keys(opRow).length > 0) {
    await queryWithParams(`
      MERGE INTO JAVIER.REPARTIDOR_FINANCIAL_BALANCES B
      USING (VALUES (?, ?, 'cleanup')) AS V(CODIGOVENDEDOR, SALDO_PENDIENTE, UPDATED_BY)
        ON B.CODIGOVENDEDOR = V.CODIGOVENDEDOR
      WHEN MATCHED THEN
        UPDATE SET SALDO_PENDIENTE = V.SALDO_PENDIENTE,
                   UPDATED_BY = V.UPDATED_BY,
                   UPDATED_AT = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT (CODIGOVENDEDOR, SALDO_PENDIENTE, UPDATED_BY)
        VALUES (V.CODIGOVENDEDOR, V.SALDO_PENDIENTE, V.UPDATED_BY)
    `, [
      value(opRow, 'CODIGOVENDEDOR'),
      roundMoney(value(opRow, 'IMPORTESALDOACTUAL')),
    ], false, false);
  }

  await queryWithParams(`
    DELETE FROM JAVIER.REPARTIDOR_COBROS
    WHERE IDEMPOTENCY_TOKEN = ?
  `, [idempotencyToken], false, false);

  if (options.deleteDeliveryStatus === true) {
    const deliveryIds = new Set(
      cobroRows
        .map((row) => String(value(row, 'ENTREGA_APP_ID', '') || '').trim())
        .filter(Boolean),
    );
    if (options.deliveryId) {
      deliveryIds.add(String(options.deliveryId).trim());
    }

    for (const deliveryId of deliveryIds) {
      await queryWithParams(`
        DELETE FROM JAVIER.DELIVERY_STATUS
        WHERE ID = ?
      `, [deliveryId], false, false);
    }
  }
}

function simplePdfBuffer(title, lines) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(18).text(title, { align: 'center' });
    doc.moveDown();
    for (const line of lines) {
      doc.fontSize(10).text(line);
    }
    doc.end();
  });
}

async function sendLiquidacionEmails({ liquidacion, repartidorEmail, repartidorName, cobros }) {
  if (!liquidacion || !repartidorEmail) return [];
  const subject = `Liquidacion Diaria - GMP ${liquidacion.numero.display}`;
  const lines = [
    `Vendedor: ${liquidacion.repartidorId} ${repartidorName || ''}`,
    `Total Efectivo: ${liquidacion.totals.totalEfectivo.toFixed(2)} EUR`,
    `Total a Ingresar: ${liquidacion.totals.totalAIngresar.toFixed(2)} EUR`,
    `Ingreso en Banco: ${liquidacion.totals.ingresoBanco.toFixed(2)} EUR`,
    ...cobros.map((c) => `${c.fecha} ${c.codigoCliente} ${c.nombreCliente} ${c.documento} ${c.importe.toFixed(2)}`),
  ];
  const pdfBuffer = await simplePdfBuffer(subject, lines);
  const recipients = [repartidorEmail, ...INTERNAL_LIQUIDATION_RECIPIENTS];
  const results = [];
  for (const to of recipients) {
    try {
      const result = await sendEmailWithPdf({
        to,
        subject,
        htmlBody: `<p>${subject}</p>`,
        textBody: lines.join('\n'),
        pdfBuffer,
        pdfFilename: `${subject.replace(/\s+/g, '_')}.pdf`,
      });
      results.push({ to, success: true, result });
    } catch (error) {
      logger.error(`[REPARTIDOR_FINANZAS] Email failed to ${to}: ${error.message}`);
      results.push({ to, success: false, error: error.message });
    }
  }
  return results;
}

module.exports = {
  INTERNAL_LIQUIDATION_RECIPIENTS,
  findLiquidacionByToken,
  getDailySummary,
  getSummary,
  getVencimientos,
  registerCobro,
  confirmRuteroDeliveryWithCobro,
  closeLiquidacion,
  getCommissionSummary,
  getCommissionTiers,
  saveCommissionTiers,
  calculateCommission,
  deleteTestData,
  sendLiquidacionEmails,
};
