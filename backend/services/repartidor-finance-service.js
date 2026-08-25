'use strict';

const crypto = require('crypto');
const {
  getRepartoFinanceDb2Repository,
} = require('../repositories/reparto-finance-db2-repository');
const logger = require('../middleware/logger');
const { sendEmailWithPdf } = require('./emailPdfService');
const {
  resolveRepartoEmailDelivery,
  buildRepartoMessageId,
} = require('./reparto-email-delivery-policy');
const {
  buildLiquidacionPdfBuffer,
  formatGmpLiquidacionDisplay,
  cashToDeposit,
} = require('./liquidacion-pdf-service');
const {
  resolveLiquidacionRecipients,
} = require('./staff-email-directory-service');
const { isDeliveryStatusAvailable, isDeliveryStatusNewSchema } = require('../utils/delivery-status-check');
const { validateFinanceTableMapping } = require('../config/reparto-runtime');
const {
  createRepartoCobrosDb2Port,
  RepartoCobrosCapabilityError,
  RepartoCobrosIdempotencyRaceError,
} = require('../repositories/reparto-cobros-db2-port');
// Req #16: Audit-trail para cobros del repartidor (write best-effort)
const auditLog = require('./audit-log.service');
const financeRepo = getRepartoFinanceDb2Repository();
const FINANCE_TABLES = financeRepo.tables;

let _financeSchemaInfo = null;

class FinanceSchemaUnavailableError extends Error {
  constructor(message = 'El catálogo DB2 de reparto no está disponible') {
    super(message);
    this.name = 'FinanceSchemaUnavailableError';
    this.code = 'REPARTO_SCHEMA_UNAVAILABLE';
    this.statusCode = 503;
  }
}

class LiquidacionEmailRecipientRequiredError extends Error {
  constructor() {
    super('La liquidacion no tiene un destinatario de correo valido');
    this.name = 'LiquidacionEmailRecipientRequiredError';
    this.code = 'LIQUIDACION_EMAIL_RECIPIENT_REQUIRED';
    this.statusCode = 422;
  }
}

function normalizeColumnName(raw) {
  return String(raw || '').trim().toUpperCase();
}

function normalizeTableName(raw) {
  return String(raw || '').trim().toUpperCase();
}

function sanitizeErrorMessage(error) {
  const raw = String(error?.message || error || 'unknown error');
  return raw.replace(/[\r\n\t]/g, ' ').replace(/[^\w .,:;()/-]/g, '?').slice(0, 240);
}

async function getFinanceSchemaInfo() {
  if (_financeSchemaInfo && process.env.NODE_ENV !== 'test') {
    return _financeSchemaInfo;
  }

  const tables = {
    REPARTIDOR_COBROS: FINANCE_TABLES.cobros,
    REPARTIDOR_FINANCIAL_BALANCES: FINANCE_TABLES.balances,
    REPARTIDOR_LIQUIDACION_OPS: FINANCE_TABLES.liquidationOps,
  };
  const catalogTargets = Object.entries(tables).map(([logical, identifier]) => {
    const [schema, table] = identifier.split('.');
    return { logical, schema, table };
  });
  const columnsByTable = new Map(Object.keys(tables).map((table) => [table, new Set()]));
  let rows = [];

  try {
    rows = await financeRepo.selectSysColumns(catalogTargets);
  } catch (error) {
    logger.warn(`[REPARTIDOR_FINANZAS] Schema detection failed: ${sanitizeErrorMessage(error)}`);
    throw new FinanceSchemaUnavailableError(
      `No se pudo consultar el catálogo DB2 de reparto en reparto`,
    );
  }
  const detectedRows = Array.isArray(rows)
    ? rows.map((row) => {
        const physicalName = normalizeTableName(value(row, 'TABLE_NAME'));
        const target = catalogTargets.find(({ schema, table }) =>
          schema === normalizeTableName(value(row, 'TABLE_SCHEMA')) && table === physicalName)
          // Unit doubles historically return logical names without a schema;
          // production catalog rows never use this compatibility branch.
          || (process.env.NODE_ENV === 'test' && Object.hasOwn(tables, physicalName)
            ? { logical: physicalName } : null);
        return target ? { ...row, TABLE_NAME: target.logical } : null;
      }).filter((row) => row && normalizeColumnName(value(row, 'COLUMN_NAME')))
    : [];
  if (detectedRows.length === 0) {
    logger.warn('[REPARTIDOR_FINANZAS] Empty or malformed schema catalog');
    throw new FinanceSchemaUnavailableError(
      `El catálogo DB2 de reparto está vacío o es inválido`,
    );
  }
  rows = detectedRows;

  for (const row of rows || []) {
    const tableName = normalizeTableName(value(row, 'TABLE_NAME'));
    const columnName = normalizeColumnName(value(row, 'COLUMN_NAME'));
    if (columnsByTable.has(tableName) && columnName) {
      columnsByTable.get(tableName).add(columnName);
    }
  }

  const has = (table, column) =>
    columnsByTable.get(table)?.has(normalizeColumnName(column)) === true;
  const cobrosAligned = has('REPARTIDOR_COBROS', 'CODIGOVENDEDOR') &&
    has('REPARTIDOR_COBROS', 'IMPORTEVENCIMIENTO');
  const cobrosLegacy = has('REPARTIDOR_COBROS', 'CODIGO_REPARTIDOR') &&
    has('REPARTIDOR_COBROS', 'IMPORTE_COBRADO');
  if (!cobrosAligned && !cobrosLegacy) {
    logger.warn('[REPARTIDOR_FINANZAS] Unsupported reparto cobros schema');
    throw new FinanceSchemaUnavailableError(
      `El catálogo DB2 de reparto no contiene un esquema de cobros compatible`,
    );
  }

  const info = {
    has,
    cobrosAligned,
    cobrosLegacy,
    cobrosHasCollectionDate: has('REPARTIDOR_COBROS', 'ANOCOBRO') &&
      has('REPARTIDOR_COBROS', 'MESCOBRO') &&
      has('REPARTIDOR_COBROS', 'DIACOBRO'),
    cobrosHasLiquidado: has('REPARTIDOR_COBROS', 'LIQUIDADO_SN'),
    cobrosHasLiquidacionToken: has('REPARTIDOR_COBROS', 'LIQUIDACION_TOKEN'),
    cobrosHasCreatedAt: has('REPARTIDOR_COBROS', 'CREATED_AT'),
    cobrosHasFechaCobro: has('REPARTIDOR_COBROS', 'FECHA_COBRO'),
    cobrosHasNumeroLiquidacion: has('REPARTIDOR_COBROS', 'NUMEROLIQUIDACION'),
    // Slim isolated_test cobros (034) lack CVC document columns; production has them.
    cobrosHasDocumentColumns: (
      (has('REPARTIDOR_COBROS', 'CODIGOCLIENTEALBARAN') || has('REPARTIDOR_COBROS', 'CODIGO_CLIENTE'))
      && (has('REPARTIDOR_COBROS', 'TIPODOCUMENTO') || has('REPARTIDOR_COBROS', 'TIPO_DOCUMENTO'))
      && (has('REPARTIDOR_COBROS', 'NUMERODOCUMENTO') || has('REPARTIDOR_COBROS', 'NUMERO_DOCUMENTO'))
    ),
    cobrosHasIdempotencyToken: has('REPARTIDOR_COBROS', 'IDEMPOTENCY_TOKEN'),
    balanceCodeColumn: has('REPARTIDOR_FINANCIAL_BALANCES', 'CODIGOVENDEDOR')
      ? 'CODIGOVENDEDOR'
      : 'CODIGO_REPARTIDOR',
    opsHasSaldoResultante: has('REPARTIDOR_LIQUIDACION_OPS', 'SALDO_RESULTANTE'),
  };

  logger.info(
    `[REPARTIDOR_FINANZAS] Schema detected: cobros=${cobrosAligned ? 'aligned' : cobrosLegacy ? 'legacy' : 'unknown'}, ` +
    `liqFlag=${info.cobrosHasLiquidado}, balanceCode=${info.balanceCodeColumn}`,
  );
  if (process.env.NODE_ENV !== 'test') {
    _financeSchemaInfo = info;
  }
  return info;
}

async function getCobrosSchemaInfo() {
  const info = await getFinanceSchemaInfo();
  return info.cobrosHasCollectionDate;
}

async function ensureIsolatedTestFinanceSeed() {
  return Object.freeze({ skipped: true, reason: 'explicit_copy_script_required' });
}

function codeList(raw) {
  // FIX 2026-05-15: antes filtraba con length<=2, lo que descartaba IDs
  // alfanumericos validos como "A4" si len fuera distinto, o codigos de 3+
  // caracteres (futuros vendedores). Resultado: ids=[] silencioso y endpoints
  // devolvian datos vacios sin error. Ahora acepta 1..10 chars alfanum y
  // logea si la lista queda vacia con datos en raw.
  const items = String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item && /^[A-Za-z0-9_-]{1,10}$/.test(item));
  if (items.length === 0 && raw && String(raw).trim().length > 0) {
    logger.warn(`[REPARTIDOR_FINANZAS] codeList: input "${raw}" no produjo IDs validos`);
  }
  return items;
}

const {
  cobrosDateFilterColumn,
  cobrosDateSelectColumns,
  cobrosDateOrderBy,
} = financeRepo.helpers;


const FINANCE_RUNTIME = financeRepo.bindings.runtime;

function assertFinanceRuntime() {
  const mapping = validateFinanceTableMapping(FINANCE_RUNTIME);
  if (!FINANCE_RUNTIME.valid || !mapping.valid) {
    throw new FinanceSchemaUnavailableError(
      'La configuracion de reparto no permite consultar ni liquidar finanzas',
    );
  }
  return FINANCE_RUNTIME;
}

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
  const year = toInt(value(row, 'ANOCOBRO') || value(row, 'ANOVENCIMIENTO'));
  const month = toInt(value(row, 'MESCOBRO') || value(row, 'MESVENCIMIENTO'));
  const day = toInt(value(row, 'DIACOBRO') || value(row, 'DIAVENCIMIENTO'));
  const fecha = (year && month && day) ? `${year}-${pad(month, 2)}-${pad(day, 2)}` : null;
  return {
    id: value(row, 'ID') == null ? null : String(value(row, 'ID')),
    // Req #16: exponer idempotency token para poder anular el cobro desde la UI.
    idempotencyToken: String(value(row, 'IDEMPOTENCY_TOKEN', '') || '').trim() || null,
    fecha,
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

function isValidIsoCalendarDate(raw) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw || ''))) return false;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw;
}

function mapVencimiento(row) {
  const calculatedDueDate = formatCvclDueDate(row) || formatCvcDueDate(row);
  const fechaVencimiento = isValidIsoCalendarDate(calculatedDueDate)
    ? calculatedDueDate
    : null;
  return {
    tipoDocumento: String(value(row, 'TIPODOCUMENTO', '') || '').trim(),
    codigoCliente: String(value(row, 'CODIGOCLIENTEALBARAN', '') || '').trim(),
    nombreCliente: String(value(row, 'NOMBRE_CLIENTE', '') || '').trim(),
    nombreAlternativo: String(value(row, 'NOMBREALTERNATIVO', '') || '').trim(),
    poblacion: String(value(row, 'POBLACION', '') || '').trim(),
    fechaVencimiento,
    fechaValida: fechaVencimiento !== null,
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
      display: formatGmpLiquidacionDisplay({
        year: toInt(value(row, 'EJERCICIOLIQUIDACION'))
          || toInt(value(row, 'ANOLIQUIDACION')),
        vendorCode: value(row, 'CODIGOVENDEDOR'),
        serie: value(row, 'SERIELIQUIDACION') || 'A',
        numero: toInt(value(row, 'NUMEROLIQUIDACION')),
      }),
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

class LiquidacionPdfReadError extends Error {
  constructor(message, { code = 'LIQUIDACION_PDF_UNAVAILABLE', statusCode = 503 } = {}) {
    super(message);
    this.name = 'LiquidacionPdfReadError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function parseLiquidacionSnapshot(value, field) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid shape');
    return parsed;
  } catch (_) {
    throw new LiquidacionPdfReadError(`El cierre persistido no contiene ${field} valido`);
  }
}

function normalizedPersistedLiquidacionTimestamp(value, fallbackDate) {
  if (value == null || String(value).trim() === '') return `${fallbackDate} 00:00:00`;
  const text = value instanceof Date ? value.toISOString() : String(value).trim();
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/.exec(text);
  if (!match) {
    throw new LiquidacionPdfReadError('El cierre persistido contiene una fecha de creación no válida');
  }
  const [year, month, day] = match[1].split('-').map(Number);
  const [hour, minute, second] = match.slice(2, 5).map(Number);
  const civil = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (civil.getUTCFullYear() !== year || civil.getUTCMonth() !== month - 1
      || civil.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) {
    throw new LiquidacionPdfReadError('El cierre persistido contiene una fecha de creación no válida');
  }
  return text;
}

function normalizedSnapshotPaymentMetadata(value, field, maxLength) {
  if (value == null) return '';
  if (typeof value !== 'string') {
    throw new LiquidacionPdfReadError(`El cierre persistido contiene ${field} no válido`);
  }
  const text = value.trim();
  if (!text) return '';
  if (text.length > maxLength || /[\u0000-\u001F\u007F]/.test(text)) {
    throw new LiquidacionPdfReadError(`El cierre persistido contiene ${field} no válido`);
  }
  return text;
}

function liquidacionPdfPaymentTotals(payments) {
  const totals = { totalEfectivo: 0, totalCheques: 0, totalTarjeta: 0, totalPostdatados: 0 };
  for (const payment of payments) {
    const amount = roundMoney(payment.amount);
    const method = String(payment.paymentMethod || '').trim().toUpperCase();
    if (/^(EFECTIVO|EF|F0|E|CONTADO|CT)$/.test(method)) totals.totalEfectivo += amount;
    else if (/^(CHEQUE|CH|TALON|TALON BANCARIO)$/.test(method)) totals.totalCheques += amount;
    else if (/^(TARJETA|TJ|TPV|TRANSFERENCIA|TR|T0|BIZUM|BI)$/.test(method)) totals.totalTarjeta += amount;
    else if (/^(POSTDATADO|PD|POSTDATADOS)$/.test(method)) totals.totalPostdatados += amount;
    else throw new LiquidacionPdfReadError('El snapshot contiene una forma de cobro no clasificable');
  }
  return Object.fromEntries(Object.entries(totals).map(([key, amount]) => [key, roundMoney(amount)]));
}

function shadowLiquidacionPayments(row, date) {
  const entries = [
    ['IMPORTEEFECTIVO', 'EFECTIVO'],
    ['IMPORTECHEQUES', 'CHEQUE'],
    ['IMPORTETARJETA', 'TARJETA'],
    ['IMPORTEPOSTDATADOS', 'POSTDATADO'],
  ];
  return entries
    .map(([field, paymentMethod]) => ({
      id: `LQD-${paymentMethod}`,
      amount: roundMoney(value(row, field, 0)),
      paymentMethod,
      collectedAt: `${date}T00:00:00.000Z`,
    }))
    .filter((payment) => payment.amount > 0);
}

async function buildClosedLiquidacionPdf({ idempotencyToken, repartidorId }) {
  const token = normalizeText(idempotencyToken);
  const owner = normalizeText(repartidorId);
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(token) || !/^[0-9]{1,20}$/.test(owner)) {
    throw new LiquidacionPdfReadError('El selector de liquidacion no es valido', {
      code: 'INVALID_LIQUIDACION_PDF_SELECTOR', statusCode: 422,
    });
  }
  const row = await findLiquidacionRowByToken(token);
  if (!row) {
    throw new LiquidacionPdfReadError('No existe la liquidacion solicitada', {
      code: 'LIQUIDACION_NOT_FOUND', statusCode: 404,
    });
  }
  const persistedOwner = normalizeText(value(row, 'CODIGOVENDEDOR'));
  const shadowLqd = !normalizeText(value(row, 'SNAPSHOT_JSON'))
    && value(row, 'IDMARCALIQUIDACION') != null;
  const status = shadowLqd ? 'CLOSED' : normalizeText(value(row, 'STATUS')).toUpperCase();
  if (persistedOwner !== owner) {
    throw new LiquidacionPdfReadError('No existe la liquidacion solicitada', {
      code: 'LIQUIDACION_NOT_FOUND', statusCode: 404,
    });
  }
  if (status !== 'CLOSED') {
    throw new LiquidacionPdfReadError('La liquidacion no esta cerrada', {
      code: 'LIQUIDACION_NOT_CLOSED', statusCode: 409,
    });
  }
  let replayIdentity;
  let snapshot;
  if (shadowLqd) {
    const year = toInt(value(row, 'ANOLIQUIDACION'));
    const month = toInt(value(row, 'MESLIQUIDACION'));
    const day = toInt(value(row, 'DIALIQUIDACION'));
    const date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const opening = roundMoney(value(row, 'IMPORTESALDOACTUAL', 0));
    const paymentsTotal = roundMoney(
      toNumber(value(row, 'IMPORTEEFECTIVO', 0))
      + toNumber(value(row, 'IMPORTECHEQUES', 0))
      + toNumber(value(row, 'IMPORTETARJETA', 0))
      + toNumber(value(row, 'IMPORTEPOSTDATADOS', 0)),
    );
    replayIdentity = { repartidorId: persistedOwner, date };
    snapshot = {
      repartidorId: persistedOwner,
      date,
      openingBalance: opening,
      breakdown: {
        payments: paymentsTotal,
        expenses: roundMoney(value(row, 'IMPORTEGASTOS', 0)),
        adjustments: 0,
        bankDeposits: roundMoney(value(row, 'IMPORTEINGRESOENBANCO', 0)),
      },
      payments: shadowLiquidacionPayments(row, date),
    };
  } else {
    replayIdentity = parseLiquidacionSnapshot(value(row, 'REPLAY_IDENTITY_JSON'), 'REPLAY_IDENTITY_JSON');
    snapshot = parseLiquidacionSnapshot(value(row, 'SNAPSHOT_JSON'), 'SNAPSHOT_JSON');
  }
  const date = normalizeText(replayIdentity.date);
  if (normalizeText(replayIdentity.repartidorId) !== owner || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)
      || normalizeText(snapshot.repartidorId) !== owner || normalizeText(snapshot.date) !== date
      || !Array.isArray(snapshot.payments) || !snapshot.breakdown || typeof snapshot.breakdown !== 'object') {
    throw new LiquidacionPdfReadError('El cierre persistido no es coherente');
  }
  const paymentTotals = liquidacionPdfPaymentTotals(snapshot.payments);
  const totalCobrosDia = roundMoney(snapshot.breakdown.payments);
  const totalAIngresar = cashToDeposit({
    totalEfectivo: paymentTotals.totalEfectivo,
    saldoActual: Number(snapshot.openingBalance),
    gastos: Number(snapshot.breakdown.expenses),
    ajustes: Number(snapshot.breakdown.adjustments),
  });
  const ingresoBanco = roundMoney(snapshot.breakdown.bankDeposits);
  const totals = {
    ...paymentTotals, totalCobrosDia, saldoActual: roundMoney(snapshot.openingBalance),
    gastos: roundMoney(snapshot.breakdown.expenses), ajustes: roundMoney(snapshot.breakdown.adjustments),
    totalAIngresar, ingresoBanco, diff: roundMoney(totalAIngresar - ingresoBanco),
  };
  const displayNumber = formatGmpLiquidacionDisplay({
    year: toInt(value(row, 'ANOLIQUIDACION')) || Number(date.slice(0, 4)),
    vendorCode: owner, serie: value(row, 'SERIELIQUIDACION') || 'A',
    numero: toInt(value(row, 'NUMEROLIQUIDACION')),
  });
  const cobros = snapshot.payments.map((payment) => ({
    fecha: String(payment.collectedAt || '').slice(0, 10) || date,
    codigoCliente: normalizedSnapshotPaymentMetadata(payment.codigoCliente, 'codigoCliente', 30),
    nombreCliente: normalizedSnapshotPaymentMetadata(payment.nombreCliente, 'nombreCliente', 160),
    tipoCobro: payment.paymentMethod,
    tipoDocumento: normalizedSnapshotPaymentMetadata(payment.tipoDocumento, 'tipoDocumento', 20),
    documento: normalizedSnapshotPaymentMetadata(payment.documento, 'documento', 120) || payment.id,
    importe: roundMoney(payment.amount),
  }));
  const generatedAt = normalizedPersistedLiquidacionTimestamp(
    value(row, 'CREATED_AT', value(row, 'CREATEDAT')), date,
  );
  const pdfBuffer = await buildLiquidacionPdfBuffer({
    title: `Liquidación Diaria - ${displayNumber}`, displayNumber, repartidorId: owner, dateLabel: date,
    generatedAt, totals, cobros,
  });
  return Object.freeze({
    pdfBuffer, fileName: `Liquidacion_${displayNumber.replace(/[^A-Za-z0-9_-]+/g, '_')}.pdf`,
    liquidacionId: String(value(row, 'ID')), idempotencyToken: token,
    repartidorId: owner, date, status: 'CLOSED',
  });
}

class AlreadyDeliveredError extends Error {
  constructor(row) {
    super('Esta entrega ya fue confirmada anteriormente');
    this.name = 'AlreadyDeliveredError';
    this.code = 'ALREADY_DELIVERED';
    this.previousRepartidor = value(row, 'OPERADOR') ?? value(row, 'REPARTIDOR_ID');
    this.previousDate = value(row, 'UPDATED_AT') ?? value(row, 'FECHAACTUALIZACION');
  }
}

class IdempotencyConflictError extends Error {
  constructor(message = 'El token de idempotencia ya existe con datos distintos') {
    super(message);
    this.name = 'IdempotencyConflictError';
    this.code = 'IDEMPOTENCY_CONFLICT';
  }
}

class PaymentAlreadyRegisteredError extends Error {
  constructor(message = 'El documento ya tiene un cobro registrado') {
    super(message);
    this.name = 'PaymentAlreadyRegisteredError';
    this.code = 'PAYMENT_ALREADY_REGISTERED';
  }
}

class PaymentExceedsOutstandingError extends Error {
  constructor(message = 'El importe supera el saldo pendiente del documento') {
    super(message);
    this.name = 'PaymentExceedsOutstandingError';
    this.code = 'PAYMENT_EXCEEDS_OUTSTANDING';
    this.statusCode = 409;
  }
}

class DuplicateLiquidacionError extends Error {
  constructor(message = 'Ya existe una liquidacion para este repartidor y fecha') {
    super(message);
    this.name = 'DuplicateLiquidacionError';
    this.code = 'DUPLICATE_DAILY_LIQUIDACION';
  }
}

// Req #16: Alias semántico para PaymentAlreadyRegisteredError (algunos consumidores
// esperan DuplicatePaymentError). Mantiene compatibilidad con código existente.
class DuplicatePaymentError extends PaymentAlreadyRegisteredError {
  constructor(message = 'El documento ya tiene un cobro registrado') {
    super(message);
    this.name = 'DuplicatePaymentError';
    this.code = 'DUPLICATE_PAYMENT';
  }
}

// Req #16: Repartidor no autorizado para liquidar/cobrar este documento
// (e.g. CODIGOVENDEDORCOBRO en CVC distinto del repartidor logueado).
class PaymentAuthzDeniedError extends Error {
  constructor(message = 'No tienes autorización para cobrar este documento', context = {}) {
    super(message);
    this.name = 'PaymentAuthzDeniedError';
    this.code = 'PAYMENT_AUTHZ_DENIED';
    this.context = context;
  }
}

// Req #16 (devoluciones): el cobro ya fue incluido en una liquidación cerrada;
// para anularlo hay que abrir un proceso de regularización manual.
class CobroAlreadyLiquidadoError extends Error {
  constructor(message = 'No se puede anular: el cobro está incluido en una liquidación cerrada') {
    super(message);
    this.name = 'CobroAlreadyLiquidadoError';
    this.code = 'COBRO_ALREADY_LIQUIDADO';
  }
}

class CobroNotFoundError extends Error {
  constructor(message = 'No existe ningún cobro con ese token de idempotencia') {
    super(message);
    this.name = 'CobroNotFoundError';
    this.code = 'COBRO_NOT_FOUND';
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

function firstDefinedValue(row, keys, fallback = undefined) {
  for (const key of keys) {
    const current = value(row, key);
    if (current !== undefined && current !== null) return current;
  }
  return fallback;
}

function normalizePaymentForCompare(raw) {
  const current = normalizeText(raw).toUpperCase();
  if (['EF', 'F0', 'E', 'CT', 'EFECTIVO', 'CONTADO'].includes(current)) return 'EFECTIVO';
  if (['TJ', 'TARJETA', 'TPV'].includes(current)) return 'TARJETA';
  if (['TR', 'T0', 'TRANSFER', 'TRANSFERENCIA'].includes(current)) return 'TRANSFERENCIA';
  if (['BI', 'BIZUM'].includes(current)) return 'BIZUM';
  if (['CH', 'CHEQUE', 'TALON', 'TALON BANCARIO'].includes(current)) return 'CHEQUE';
  if (['PD', 'POSTDATADO', 'POSTDATADOS'].includes(current)) return 'POSTDATADO';
  return current;
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
    [['CODIGOVENDEDOR', 'CODIGO_REPARTIDOR'], expected.codigoRepartidor, normalizeText],
    [['CODIGOCLIENTEALBARAN', 'CODIGO_CLIENTE'], expected.codigoCliente, normalizeText],
    [['TIPODOCUMENTO', 'TIPO_DOCUMENTO'], expected.tipoDocumento, normalizeTipoDocumento],
    [['ORIGENDOCUMENTO', 'ORIGEN_DOCUMENTO'], expected.origenDocumento, normalizeText],
    [['SUBEMPRESADOCUMENTO', 'SUBEMPRESA_DOCUMENTO'], expected.subempresaDocumento, normalizeText],
    [['SERIEDOCUMENTO', 'SERIE_DOCUMENTO'], expected.serieDocumento, normalizeText],
    [['CODIGOFORMAPAGO', 'FORMA_PAGO'], expected.formaPago, normalizePaymentForCompare],
    [['PANTALLA_ORIGEN'], expected.pantallaOrigen, normalizeText],
  ];
  for (const [columns, expectedValue, normalizer] of checks) {
    const actual = firstDefinedValue(row, columns);
    if (actual === undefined && expectedValue == null) continue;
    if (normalizer(actual) !== normalizer(expectedValue)) {
      mismatches.push(columns[0]);
    }
  }
  const numericChecks = [
    [['EJERCICIODOCUMENTO', 'EJERCICIO_DOCUMENTO'], expected.ejercicioDocumento],
    [['TERMINALDOCUMENTO', 'TERMINAL_DOCUMENTO'], expected.terminalDocumento],
    [['NUMERODOCUMENTO', 'NUMERO_DOCUMENTO'], expected.numeroDocumento],
    [['XDEDOCUMENTO', 'XDE_DOCUMENTO'], expected.xdeDocumento || 1],
    [['DEXDOCUMENTO', 'DEX_DOCUMENTO'], expected.dexDocumento || 1],
  ];
  for (const [columns, expectedValue] of numericChecks) {
    if (!sameNumeric(firstDefinedValue(row, columns, expectedValue), expectedValue)) {
      mismatches.push(columns[0]);
    }
  }
  if (
    roundMoney(firstDefinedValue(row, ['IMPORTEVENCIMIENTO', 'IMPORTE_COBRADO'])) !==
    roundMoney(expected.importeCobrado)
  ) {
    mismatches.push('IMPORTEVENCIMIENTO');
  }
  if (
    roundMoney(firstDefinedValue(row, ['IMPORTEPENDIENTE', 'IMPORTE_PENDIENTE'], expected.importePendiente || 0)) !==
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

async function lockCobrosForPayment(conn) {
  await financeRepo.lockCobrosTable(conn);
}

async function assertPaymentWithinOutstandingBalance(conn, info, input, documentRow) {
  const erpPending = Number(value(documentRow, 'ERP_IMPORTEPENDIENTE'));
  if (!Number.isFinite(erpPending) || erpPending < 0) {
    throw new FinanceSchemaUnavailableError(
      'El documento no expone un saldo pendiente valido para registrar el abono',
    );
  }

  const totals = firstRow(await financeRepo.sumAppCollectedForDocument(conn, info, input));
  const appCollected = roundMoney(value(totals, 'APP_COLLECTED'));
  const available = roundMoney(Math.max(erpPending - appCollected, 0));
  const requested = roundMoney(input.importeCobrado);
  const expectedRemaining = roundMoney(Math.max(available - requested, 0));
  const submittedRemaining = roundMoney(input.importePendiente);

  if (requested <= 0 || requested > available || submittedRemaining !== expectedRemaining) {
    throw new PaymentExceedsOutstandingError(
      `El abono solicitado no coincide con el saldo pendiente disponible (${available})`,
    );
  }
}

async function assertDocumentNotCollectedByCommercial(conn, input) {
  // Preserve the existing cross-table business guard without changing the
  // commercial collection subsystem.
  try {
    const composedRef = `${String(input.serieDocumento || '').trim()}-${input.numeroDocumento}`;
    const likeRef = `%${composedRef}`;
    const comercialRows = await financeRepo.selectCommercialCobroMatch(conn, {
      codigoCliente: input.codigoCliente,
      composedRef,
      likeRef,
    });
    if (Array.isArray(comercialRows) && comercialRows.length > 0) {
      const err = new PaymentAlreadyRegisteredError();
      err.message = `Documento ${composedRef} ya cobrado por el COMERCIAL (cliente=${input.codigoCliente}).`;
      err.code = 'COBRO_ALREADY_COLLECTED_BY_COMERCIAL';
      throw err;
    }
  } catch (xtableErr) {
    if (xtableErr instanceof PaymentAlreadyRegisteredError) throw xtableErr;
    if (xtableErr && xtableErr.code === 'COBRO_ALREADY_COLLECTED_BY_COMERCIAL') throw xtableErr;
    logger.warn(`[REPARTIDOR_FINANZAS] Cross-table check failed: ${sanitizeErrorMessage(xtableErr)}`);
  }
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
  const rows = await financeRepo.selectLiquidacionByToken(idempotencyToken);
  return firstRow(rows);
}

async function findLiquidacionByToken(idempotencyToken) {
  return mapLiquidacion(await findLiquidacionRowByToken(idempotencyToken));
}

async function getDailySummaryLegacyUnused({ repartidorId, date }) {
  await getCobrosSchemaInfo();

  // Migration 024 hasn't been run yet — REPARTIDOR_COBROS uses old column names
  const legacySchemaUnavailable = normalizeText('yes') === 'yes';
  if (legacySchemaUnavailable) {
    logger.warn(`[REPARTIDOR_COBROS] getDailySummary: schema not aligned (migration 024 not run), returning empty`);
    return {
      repartidorId,
      date,
      summary: {
        totalEfectivo: 0, totalCheques: 0, totalTarjeta: 0, totalPostdatados: 0,
        saldoActual: 0, totalCobrosDia: 0, gastos: 0, totalAIngresar: 0,
        ingresoBanco: 0, totalEfectivo2: 0, entregado: 0, cobrosCount: 0,
      },
      cobros: [],
    };
  }

  const dateYmd = compactDate(date);
  const dateCol = cobrosDateFilterColumn();
  const selectCols = cobrosDateSelectColumns();
  const orderBy = cobrosDateOrderBy();

  const totalsRows = await financeRepo.selectDailyTotalsLegacy({
    repartidorId, dateYmd, dateCol,
  });

  const balanceRows = await financeRepo.selectBalanceByVendedor(repartidorId);

  const cobroRows = await financeRepo.selectDailyCobrosLegacy({
    repartidorId, dateYmd, dateCol, selectCols, orderBy,
  });

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
      totalAIngresar: roundMoney(
        cashToDeposit({
          totalEfectivo: roundMoney(value(totals, 'TOTAL_EFECTIVO')),
          saldoActual,
          gastos,
          ajustes: 0,
        }),
      ),
      ingresoBanco: 0,
      totalEfectivo2: roundMoney(value(totals, 'TOTAL_EFECTIVO')),
      entregado: 0,
      cobrosCount: toInt(value(totals, 'COBROS_COUNT')),
    },
    cobros: cobroRows.map(mapCobro),
  };
}

async function getDailySummary({ repartidorId, date }) {
  // Try schema-detected query first; on 42S22 (column not found), invalidate
  // the schema cache and retry with fresh detection.
  for (let retry = 0; retry < 2; retry++) {
    try {
      return await _getDailySummaryInternal({ repartidorId, date });
    } catch (error) {
      const isColumnMissing = String(error?.message || '')
        .includes('42S22') || String(error?.odbcErrors?.[0]?.state || '') === '42S22';
      if (isColumnMissing && retry === 0) {
        logger.warn(`[REPARTIDOR_COBROS] getDailySummary: 42S22 detected, refreshing schema cache`);
        _financeSchemaInfo = null; // Invalidate cache
        continue; // Retry with fresh schema
      }
      if (isColumnMissing) {
        throw new FinanceSchemaUnavailableError(
          'El catálogo DB2 de reparto no coincide con las columnas necesarias',
        );
      }
      throw error; // Non-column error, propagate
    }
  }
}

async function _getDailySummaryInternal({ repartidorId, date }) {
  const info = await getFinanceSchemaInfo();
  const ids = codeList(repartidorId);

  if (ids.length === 0 || (!info.cobrosAligned && !info.cobrosLegacy)) {
    if (ids.length > 0) {
      logger.warn('[REPARTIDOR_COBROS] getDailySummary: unknown schema, returning empty');
    }
    return {
      repartidorId,
      date,
      summary: {
        totalEfectivo: 0, totalCheques: 0, totalTarjeta: 0, totalPostdatados: 0,
        saldoActual: 0, totalCobrosDia: 0, gastos: 0, totalAIngresar: 0,
        ingresoBanco: 0, totalEfectivo2: 0, entregado: 0, deudaPendiente: 0,
        cobrosCount: 0,
      },
      cobros: [],
    };
  }

  const dateYmd = compactDate(date);
  const isolatedTestBalances = String(process.env.REPARTO_TABLE_SET || '').trim().toLowerCase() === 'isolated_test';

  const [totalsRows, balanceRows, cobroRows, structured, deliveredRows, debtRows, closedRows] =
    await Promise.all([
      financeRepo.selectDailyTotals({ info, ids, dateYmd }),
      financeRepo.selectBalanceSum({ info, ids }),
      financeRepo.selectDailyCobros({ info, ids, dateYmd }),
      financeRepo.selectDailyStructuredSums({ ids, dateYmd }),
      financeRepo.selectDeliveredAmount({ ids, fromYmd: dateYmd, toYmd: dateYmd }),
      financeRepo.selectDailyErpDebt({ ids, dateYmd }),
      isolatedTestBalances && ids.length === 1 && typeof financeRepo.selectClosedLiquidacion === 'function'
        ? financeRepo.selectClosedLiquidacion({ info, ids, dateYmd })
        : Promise.resolve([]),
    ]);

  const totals = firstRow(totalsRows);
  const closedRow = firstRow(closedRows);
  const isClosed = Boolean(closedRow && Object.keys(closedRow).length > 0);
  let saldoActual = 0;
  if (isolatedTestBalances) {
    // TEST liquidations serialize the day against TEST_REPARTIDOR_FINANCIAL_BALANCES.
    // DSEDAC.LQD is an ERP read model and may contain a different production
    // snapshot, so mixing it here would make Daily Summary disagree with the
    // exact balance used by closeDay().
    saldoActual = roundMoney(value(firstRow(balanceRows), 'SALDO_PENDIENTE', 0));
  } else {
    try {
      const lqdRows = await Promise.all(ids.map((id) => financeRepo.selectLastLqdSaldo(id)));
      const hasLqdSnapshot = lqdRows.some((rows) => Array.isArray(rows) && rows.length > 0);
      if (hasLqdSnapshot) {
        saldoActual = roundMoney(lqdRows.reduce((sum, rows) => {
          if (!rows || !rows.length) return sum;
          return sum + Number(value(rows[0], 'SALDO', 0) || 0);
        }, 0));
      } else {
        saldoActual = roundMoney(value(firstRow(balanceRows), 'SALDO_PENDIENTE', 0));
      }
    } catch (error) {
      logger.warn(`[REPARTIDOR_FINANZAS] daily-summary DSEDAC.LQD saldo: ${error.message}`);
      saldoActual = roundMoney(value(firstRow(balanceRows), 'SALDO_PENDIENTE', 0));
    }
  }
  let totalCobrosDia = roundMoney(value(totals, 'TOTAL_COBROS_DIA'));
  let gastos = roundMoney(structured.gastos);
  let ingresoBanco = roundMoney(structured.ingresoBanco);
  let entregado = roundMoney(value(firstRow(deliveredRows), 'TOTAL_REPARTIDO', 0));
  const deudaPendiente = roundMoney(value(firstRow(debtRows), 'DEUDA_PENDIENTE', 0));

  let totalEfectivo = roundMoney(value(totals, 'TOTAL_EFECTIVO'));
  let totalCheques = roundMoney(value(totals, 'TOTAL_CHEQUES'));
  let totalTarjeta = roundMoney(value(totals, 'TOTAL_TARJETA'));
  let totalPostdatados = roundMoney(value(totals, 'TOTAL_POSTDATADOS'));
  let ajustes = roundMoney(structured.ajustes);
  let totalAIngresar = cashToDeposit({
    totalEfectivo,
    saldoActual,
    gastos,
    ajustes,
  });
  const cobrosCount = toInt(value(totals, 'COBROS_COUNT'));
  if (isClosed) {
    let closedAdjustments = 0;
    try {
      const rawSnapshot = value(closedRow, 'SNAPSHOT_JSON');
      const snapshot = typeof rawSnapshot === 'string'
        ? JSON.parse(rawSnapshot)
        : rawSnapshot;
      closedAdjustments = roundMoney(snapshot?.breakdown?.adjustments);
    } catch (_) {
      // The persisted numeric columns remain authoritative if the snapshot
      // cannot be decoded for a legacy closed row.
    }
    saldoActual = roundMoney(value(closedRow, 'IMPORTESALDOACTUAL', saldoActual));
    totalEfectivo = roundMoney(value(closedRow, 'IMPORTEEFECTIVO', totalEfectivo));
    totalCheques = roundMoney(value(closedRow, 'IMPORTECHEQUES', totalCheques));
    totalTarjeta = roundMoney(value(closedRow, 'IMPORTETARJETA', totalTarjeta));
    totalPostdatados = roundMoney(value(closedRow, 'IMPORTEPOSTDATADOS', totalPostdatados));
    totalCobrosDia = roundMoney(value(
      closedRow,
      'TOTAL_COBROS_DIA',
      totalEfectivo + totalCheques + totalTarjeta + totalPostdatados,
    ));
    gastos = roundMoney(value(closedRow, 'IMPORTEGASTOS', gastos));
    ingresoBanco = roundMoney(value(closedRow, 'IMPORTEINGRESOENBANCO', ingresoBanco));
    entregado = roundMoney(value(closedRow, 'IMPORTEENTREGADO2', entregado));
    ajustes = closedAdjustments;
    totalAIngresar = roundMoney(value(
      closedRow,
      'IMPORTETOTALAINGRESAR',
      cashToDeposit({ totalEfectivo, saldoActual, gastos, ajustes }),
    ));
  }

  // camelCase = contrato Flutter actual; UPPER = alias legacy APK/parsers.
  const summary = {
    totalEfectivo,
    totalCheques,
    totalTarjeta,
    totalPostdatados,
    saldoActual,
    totalCobrosDia,
    gastos,
    totalAIngresar,
    ingresoBanco,
    totalEfectivo2: totalEfectivo,
    entregado,
    deudaPendiente,
    cobrosCount,
    ajustes,
    TOTAL_AJUSTES: ajustes,
    TOTAL_EFECTIVO: totalEfectivo,
    TOTAL_CHEQUES: totalCheques,
    TOTAL_TARJETA: totalTarjeta,
    TOTAL_POSTDATADOS: totalPostdatados,
    SALDO_PENDIENTE: saldoActual,
    TOTAL_COBROS_DIA: totalCobrosDia,
    TOTAL_GASTOS: gastos,
    TOTAL_A_INGRESAR: totalAIngresar,
    TOTAL_REPARTIDO: entregado,
    DEUDA_PENDIENTE: deudaPendiente,
    COBROS_COUNT: cobrosCount,
    status: isClosed ? 'CLOSED' : 'OPEN',
  };

  return {
    repartidorId,
    date,
    summary,
    // Compatibility alias for older Flutter parsers that read `totals`.
    totals: summary,
    cobros: cobroRows.map(mapCobro),
  };
}

async function getSummary({ repartidorId, year, month }) {
  const info = await getFinanceSchemaInfo();
  const ids = codeList(repartidorId);
  if (ids.length === 0) {
    throw new FinanceSchemaUnavailableError(
      'No existe un repartidor valido para calcular el resumen mensual',
    );
  }

  const firstDay = year * 10000 + month * 100 + 1;
  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const firstDayNextMonth = nextMonthYear * 10000 + nextMonth * 100 + 1;

  const cobrosRows = await financeRepo.selectMonthlyCobrosTotals({
    info, ids, firstDay, firstDayNextMonth,
  });
  const liquidacionRows = await financeRepo.selectMonthlyLiquidaciones({
    info, ids, year, month,
  });

  const cobrosRow = firstRow(cobrosRows);
  const totalCobrado = roundMoney(value(cobrosRow, 'TOTAL_COBRADO'));
  const totalLiquidado = roundMoney((liquidacionRows || []).reduce(
    (total, row) => total + roundMoney(value(row, 'TOTAL_LIQUIDADO_COBROS')),
    0,
  ));
  const saldoPendiente = roundMoney(Math.max(totalCobrado - totalLiquidado, 0));
  const liquidaciones = (liquidacionRows || []).map((row) => ({
    ...mapLiquidacion(row),
    date: `${value(row, 'ANOLIQUIDACION')}-${pad(value(row, 'MESLIQUIDACION'), 2)}-${pad(value(row, 'DIALIQUIDACION'), 2)}`,
    totalLiquidado: roundMoney(value(row, 'TOTAL_LIQUIDADO_COBROS')),
  }));

  return {
    repartidorId,
    year,
    month,
    period: { year, month },
    summary: {
      totalCobrado,
      totalLiquidado,
      saldoPendiente,
      cobrosCount: toInt(value(cobrosRow, 'COBROS_COUNT')),
      liquidacionesCount: liquidaciones.length,
    },
    liquidaciones,
  };
}

class InvalidFinanceCursorError extends Error {
  constructor() {
    super('El cursor de vencimientos no es valido para estos filtros');
    this.name = 'InvalidFinanceCursorError';
    this.code = 'INVALID_FINANCE_CURSOR';
    this.statusCode = 400;
  }
}

const MAX_VENCIMIENTOS_CURSOR_OFFSET = 100000;

class FinanceCursorUnavailableError extends Error {
  constructor() {
    super('La firma del cursor financiero no esta configurada');
    this.name = 'FinanceCursorUnavailableError';
    this.code = 'FINANCE_CURSOR_UNAVAILABLE';
    this.statusCode = 503;
  }
}

function currentLocalYmd() {
  const now = new Date();
  return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
}

function validCompactCalendarDate(raw) {
  if (!Number.isInteger(raw) || raw < 20000101 || raw > 21001231) return false;
  const text = String(raw);
  return isValidIsoCalendarDate(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`);
}

function financeCursorSecret() {
  const secret = String(process.env.JWT_ACCESS_SECRET || '');
  if (secret.length < 32) throw new FinanceCursorUnavailableError();
  return secret;
}

function vencimientosCursorFingerprint({ repartidorId, from, to, clientCode, search, estado, todayYmd }) {
  return [repartidorId, from, to, clientCode || '', search || '', estado || 'todos', todayYmd].join('|');
}

function cursorSignature(encodedPayload) {
  return crypto
    .createHmac('sha256', financeCursorSecret())
    .update(encodedPayload)
    .digest('hex');
}

function decodeVencimientosCursor(cursor, filters) {
  if (!cursor) {
    const todayYmd = currentLocalYmd();
    return {
      offset: 0,
      todayYmd,
      fingerprint: vencimientosCursorFingerprint({ ...filters, todayYmd }),
    };
  }
  try {
    const parts = String(cursor).split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new InvalidFinanceCursorError();
    }
    const [encodedPayload, signature] = parts;
    const expectedSignature = cursorSignature(encodedPayload);
    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    if (
      signature.length !== expectedSignature.length ||
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      throw new InvalidFinanceCursorError();
    }
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (
      payload.version !== 1 ||
      !Number.isInteger(payload.offset) ||
      payload.offset < 0 ||
      payload.offset > MAX_VENCIMIENTOS_CURSOR_OFFSET ||
      !validCompactCalendarDate(payload.todayYmd)
    ) {
      throw new InvalidFinanceCursorError();
    }
    const fingerprint = vencimientosCursorFingerprint({
      ...filters,
      todayYmd: payload.todayYmd,
    });
    if (payload.fingerprint !== fingerprint) {
      throw new InvalidFinanceCursorError();
    }
    return { offset: payload.offset, todayYmd: payload.todayYmd, fingerprint };
  } catch (error) {
    if (error instanceof FinanceCursorUnavailableError) throw error;
    if (error instanceof InvalidFinanceCursorError) throw error;
    throw new InvalidFinanceCursorError();
  }
}

function encodeVencimientosCursor(offset, fingerprint, todayYmd) {
  const encodedPayload = Buffer.from(JSON.stringify({
    version: 1,
    offset,
    fingerprint,
    todayYmd,
  }), 'utf8').toString('base64url');
  return `${encodedPayload}.${cursorSignature(encodedPayload)}`;
}

async function getVencimientos({ repartidorId, from, to, limit, cursor, clientCode, search, estado }) {
  const ids = codeList(repartidorId);
  const pageLimit = Math.min(Math.max(toInt(limit), 1), 100);
  const cursorState = decodeVencimientosCursor(cursor, {
    repartidorId: ids.join(','), from, to, clientCode, search, estado,
  });
  const { offset, todayYmd, fingerprint } = cursorState;
  const info = await getFinanceSchemaInfo();
  const fromYmd = compactDate(from);
  const toYmd = compactDate(to);

  const rows = await financeRepo.selectVencimientosPage({
    info,
    ids,
    fromYmd,
    toYmd,
    clientCode,
    search,
    estado,
    todayYmd,
    offset,
    pageLimit,
  });
  

  const items = (rows || []).map(mapVencimiento);
  const reportedTotal = rows.length > 0 ? toInt(value(rows[0], 'TOTAL_COUNT')) : 0;
  const total = reportedTotal > 0 ? reportedTotal : offset + items.length;
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < total;
  return {
    items,
    total,
    hasMore,
    nextCursor: hasMore ? encodeVencimientosCursor(nextOffset, fingerprint, todayYmd) : null,
  };
}
async function registerCobro(input) {
  const runtime = assertFinanceRuntime();
  if (!runtime.financeCapabilityApproved || !runtime.writesEnabled) {
    throw new FinanceSchemaUnavailableError('La capacidad canonica de cobros no esta autorizada');
  }

  const conn = await financeRepo.connect();
  let begun = false;
  try {
    const port = createRepartoCobrosDb2Port({ runtime, logger });
    // The catalog/index capability gate deliberately runs before BEGIN WORK.
    await port.assertCapabilities(conn);
    await financeRepo.beginWork(conn);
    begun = true;
    const result = await port.forConnection(conn).insertCobro(input);
    await financeRepo.commit(conn);
    begun = false;
    logger.info(`[REPARTIDOR_FINANZAS] PAYMENT_REGISTERED rep=${normalizeText(input.codigoRepartidor)} amount=${roundMoney(input.importeCobrado)} created=${result.created}`);
    return { created: result.created, id: String(result.id) };
  } catch (error) {
    if (begun) {
      try { await financeRepo.rollback(conn); } catch (rollbackError) {
        logger.error(`[REPARTIDOR_FINANZAS] Cobro rollback failed: ${sanitizeErrorMessage(rollbackError)}`);
      }
    }
    if (error instanceof RepartoCobrosCapabilityError || error instanceof RepartoCobrosIdempotencyRaceError) {
      throw error;
    }
    throw error;
  } finally {
    try { await conn.close(); } catch (closeError) {
      logger.warn(`[REPARTIDOR_FINANZAS] Cobro connection close failed: ${sanitizeErrorMessage(closeError)}`);
    }
  }
}
async function validateCobroDocument(input, conn = null) {
  const rows = await financeRepo.validateCobroDocument(input, conn);
  if (!Array.isArray(rows) || rows.length === 0) {
    const error = new Error('El documento no pertenece al repartidor o cliente indicado');
    error.code = 'DOCUMENT_NOT_ASSIGNED';
    throw error;
  }
  return firstRow(rows);
}

async function confirmRuteroDeliveryWithCobro({ delivery, cobro }) {
  async function replayExisting() {
    const info = await getFinanceSchemaInfo();
    const existingRows = await financeRepo.selectCobroByToken(info, cobro.idempotencyToken);
    const existing = firstRow(existingRows);
    assertCobroMatchesInput(existing, delivery, cobro);
    const deliveryRows = await financeRepo.selectDeliveryStatusByToken(delivery.idempotencyToken);
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
    // Fail before opening a transaction or taking locks when catalog is unavailable.
    const schemaInfo = await getFinanceSchemaInfo();
    return await withTransaction(async (conn) => {
      await lockCobrosForPayment(conn);
      const info = schemaInfo;
      if (isDeliveryStatusAvailable()) {
        await financeRepo.lockDeliveryStatusTable(conn);
      }

      const tokenRows = await financeRepo.selectCobroByToken(info, cobro.idempotencyToken, conn);

      const dsNew = isDeliveryStatusAvailable() && isDeliveryStatusNewSchema();
      const dsLookupCol = dsNew ? 'IDEMPOTENCY_TOKEN' : 'ID';
      const dsLookupVal = dsNew ? delivery.idempotencyToken : delivery.itemId;
      const dsStatusCol = dsNew ? 'STATUS' : 'CONFORMADOSN';
      const dsRepCol = dsNew ? 'OPERADOR' : 'REPARTIDOR_ID';

      const deliveryRows = await financeRepo.selectDeliveryStatus(conn, {
        statusCol: dsStatusCol,
        repCol: dsRepCol,
        lookupCol: dsLookupCol,
        lookupVal: dsLookupVal,
      });
      const existingDelivery = firstRow(deliveryRows);
      const isDelivered =
        String(value(existingDelivery, dsStatusCol, '') || '').trim() === 'ENTREGADO';

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

      await assertDocumentNotAlreadyCollected(conn, info, {
        ...cobro,
        codigoRepartidor: cobro.codigoRepartidor || delivery.repartidorId,
      });

      const lat = toNumber(delivery.latitud);
      const lon = toNumber(delivery.longitud);
      let repartidorId = String(delivery.repartidorId || '').trim();
      if (repartidorId.length > 20) repartidorId = repartidorId.substring(0, 20);

      await financeRepo.deleteDeliveryStatus(conn, {
        lookupCol: dsLookupCol,
        lookupVal: dsLookupVal,
      });

      if (dsNew) {
        await financeRepo.insertDeliveryStatusNew(conn, {
          status: delivery.status || 'ENTREGADO',
          lat,
          lon,
          repartidorId,
          idempotencyToken: delivery.idempotencyToken,
        });
      } else {
        await financeRepo.insertDeliveryStatusLegacy(conn, {
          itemId: delivery.itemId,
          status: delivery.status || 'ENTREGADO',
          observaciones: delivery.observaciones || '',
          firma: delivery.firma || '',
          lat,
          lon,
          repartidorId,
        });
      }

      await financeRepo.insertCobroRow(conn, info, {
        ...cobro,
        entregaId: cobro.entregaId || delivery.itemId,
        codigoRepartidor: cobro.codigoRepartidor || repartidorId,
        pantallaOrigen: cobro.pantallaOrigen || 'RUTERO',
        operador: cobro.operador || 'unknown',
      });

      logger.info(`[AUDIT] RUTERO_DELIVERY_PAYMENT_REGISTERED | Delivery:${delivery.itemId} | Rep:${cobro.codigoRepartidor || repartidorId} | Amount:${roundMoney(cobro.importeCobrado)} | Token:${cobro.idempotencyToken}`);

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

async function withTransaction(callback) {
  const conn = await financeRepo.connect();
  try {
    await financeRepo.beginWork(conn);
    const result = await callback(conn);
    await financeRepo.commit(conn);
    return result;
  } catch (error) {
    try {
      await financeRepo.rollback(conn);
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

async function closeLiquidacion() {
  // The canonical liquidation service exclusively owns this operation.
  // This compatibility export must stay side-effect free.
  throw new FinanceSchemaUnavailableError(
    'El cierre de liquidacion se realiza mediante el servicio canonico',
  );
}

async function getCommissionTiers() {
  const rows = await financeRepo.selectCommissionTiers();
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
  const orderedTiers = [...(tiers || [])]
    .filter((tier) => toNumber(tier.thresholdPct) >= 30)
    .sort((a, b) => {
      const byThreshold = toNumber(a.thresholdPct) - toNumber(b.thresholdPct);
      if (byThreshold !== 0) return byThreshold;
      return toNumber(a.sortOrder) - toNumber(b.sortOrder);
    });
  let appliedTier = null;

  // Business rule: apply only the highest reached threshold, and calculate
  // commission over the excess above that threshold.
  for (const tier of orderedTiers) {
    const thresholdAmount = roundMoney(delivered * (toNumber(tier.thresholdPct) / 100));
    const excess = Math.max(0, collected - thresholdAmount);
    const amount = roundMoney(excess * (toNumber(tier.commissionPct) / 100));
    if (excess > 0) {
      appliedTier = {
        thresholdPct: toNumber(tier.thresholdPct),
        commissionPct: toNumber(tier.commissionPct),
        thresholdAmount,
        excess: roundMoney(excess),
        commission: amount,
      };
    }
  }

  return {
    deliveredAmount: delivered,
    collectedAmount: collected,
    collectedPct: delivered > 0 ? roundMoney((collected / delivered) * 100) : 0,
    commission: appliedTier ? appliedTier.commission : 0,
    reached: appliedTier ? [appliedTier] : [],
  };
}

async function getCommissionSummaryLegacyUnused({ repartidorId, from, to }) {
  await getCobrosSchemaInfo();
  const dateCol = cobrosDateFilterColumn();

  const deliveredRows = await financeRepo.selectDeliveredAmountLegacy({
    repartidorId,
    fromYmd: compactDate(from),
    toYmd: compactDate(to),
  });

  const collectedRows = await financeRepo.selectCollectedAmountLegacy({
    repartidorId,
    fromYmd: compactDate(from),
    toYmdInclusive: compactDate(nextIsoDate(to)),
    dateCol,
  });

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

async function getCommissionSummary({ repartidorId, from, to }) {
  await getFinanceSchemaInfo();
  const ids = codeList(repartidorId);
  const fromYmd = compactDate(from);
  const toYmd = compactDate(to);

  const deliveredRows = await financeRepo.selectDeliveredAmount({ ids, fromYmd, toYmd });
  const collectedRows = await financeRepo.selectCollectedFromErp({ ids, fromYmd, toYmd });

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
  if (!Array.isArray(tiers) || tiers.some((tier) => toNumber(tier.thresholdPct) < 30)) {
    const error = new Error('El primer tramo de comision debe ser como minimo del 30%');
    error.code = 'COMMISSION_THRESHOLD_MINIMUM_REQUIRED';
    error.statusCode = 422;
    throw error;
  }

  await withTransaction(async (conn) => {
    await financeRepo.deactivateCommissionTiers(conn, updatedBy);
    await financeRepo.insertCommissionTier(conn, { tiers, updatedBy });
  });
  return getCommissionTiers();
}

async function deleteTestData() {
  // Destructive ledger cleanup is retired in every environment. Test fixtures
  // must be isolated by their owning repository instead of deleting live data.
  throw new FinanceSchemaUnavailableError(
    'La limpieza destructiva de datos financieros esta retirada',
  );
}

function simplePdfBuffer(title, lines) {
  return buildLiquidacionPdfBuffer({
    title,
    displayNumber: title,
    repartidorLabel: lines[0] || '',
    cobros: [],
    totals: null,
  });
}

async function sendLiquidacionEmails({
  liquidacion, repartidorName, cobros, env = process.env,
}) {
  if (!liquidacion) return [];

  const repartidorId = normalizeText(liquidacion.repartidorId);

  const directory = await resolveLiquidacionRecipients({
    repartidorId,
  });
  if (directory.missingRequired?.length) {
    throw new LiquidacionEmailRecipientRequiredError();
  }
  const recipients = new Set(
    [...(directory.emails || [])].map((email) => String(email).trim().toLowerCase()).filter(Boolean),
  );
  const delivery = resolveRepartoEmailDelivery({
    recipients: [...recipients],
    // Passing the runtime explicitly makes the isolated-test sink policy
    // deterministic for callers/tests while preserving process.env in normal use.
    env,
    mode: 'automatic',
  });
  const effectiveRecipients = delivery.effectiveRecipients;

  if (effectiveRecipients.length === 0) {
    throw new LiquidacionEmailRecipientRequiredError();
  }

  const numero = liquidacion.numero && typeof liquidacion.numero === 'object'
    ? liquidacion.numero
    : {};
  const gmpNumber = formatGmpLiquidacionDisplay({
    year: numero.ejercicio || (liquidacion.date ? Number(String(liquidacion.date).slice(0, 4)) : 0),
    vendorCode: repartidorId,
    serie: numero.serie || 'A',
    numero: numero.numero || numero.value || liquidacion.id,
  });
  const displayNumber = numero.display && String(numero.display).startsWith('GMP ')
    ? numero.display
    : gmpNumber;
  const subject = `Liquidación Diaria - ${displayNumber}`;
  const totals = {
    totalEfectivo: roundMoney(liquidacion.totals?.totalEfectivo),
    totalCheques: roundMoney(liquidacion.totals?.totalCheques),
    totalTarjeta: roundMoney(liquidacion.totals?.totalTarjeta),
    totalPostdatados: roundMoney(liquidacion.totals?.totalPostdatados),
    totalCobrosDia: roundMoney(liquidacion.totals?.totalCobrosDia
      ?? liquidacion.totals?.payments),
    saldoActual: roundMoney(liquidacion.totals?.saldoActual
      ?? liquidacion.totals?.saldoAnterior
      ?? liquidacion.snapshot?.openingBalance),
    gastos: roundMoney(liquidacion.totals?.gastos ?? liquidacion.totals?.expenses),
    ajustes: roundMoney(liquidacion.totals?.ajustes ?? liquidacion.totals?.adjustments),
    totalAIngresar: roundMoney(liquidacion.totals?.totalAIngresar),
    ingresoBanco: roundMoney(liquidacion.totals?.ingresoBanco),
    diff: roundMoney(
      liquidacion.totals?.diff
        ?? (roundMoney(liquidacion.totals?.totalAIngresar) - roundMoney(liquidacion.totals?.ingresoBanco)),
    ),
  };
  const cobroRows = (cobros || []).map((c) => ({
    fecha: c.fecha || liquidacion.date || '',
    codigoCliente: c.codigoCliente || '',
    nombreCliente: c.nombreCliente || '',
    tipoCobro: c.tipoCobro || c.paymentMethod || '',
    tipoDocumento: c.tipoDocumento || '',
    documento: c.documento || c.id || '',
    importe: Number(c.importe || c.amount || 0),
  }));
  const textLines = [
    `Vendedor: ${repartidorId} ${repartidorName || ''}`.trim(),
    `Usuario: ${repartidorId} ${repartidorName || ''}`.trim(),
    `Fecha: ${liquidacion.date || ''}`,
    `Número: ${displayNumber}`,
    `Total Efectivo: ${totals.totalEfectivo.toFixed(2)} EUR`,
    `Total Tarjeta: ${totals.totalTarjeta.toFixed(2)} EUR`,
    `Total a Ingresar: ${totals.totalAIngresar.toFixed(2)} EUR`,
    `Ingreso en Banco: ${totals.ingresoBanco.toFixed(2)} EUR`,
    `Diferencia: ${totals.diff.toFixed(2)} EUR`,
    ...cobroRows.map((c) => (
      `${c.fecha || ''} ${c.codigoCliente || ''} ${c.nombreCliente || ''} ${c.tipoCobro || ''} ${c.documento || ''} ${Number(c.importe || 0).toFixed(2)}`
    )),
  ];

  const pdfBuffer = await buildLiquidacionPdfBuffer({
    title: subject,
    displayNumber,
    repartidorId,
    repartidorName,
    dateLabel: liquidacion.date || '',
    totals,
    cobros: cobroRows,
  });

  const results = [];
  for (const to of effectiveRecipients) {
    try {
      const result = await sendEmailWithPdf({
        to,
        messageId: buildRepartoMessageId({
          kind: 'liquidacion',
          identity: `${liquidacion.id || ''}|${displayNumber}|${liquidacion.date || ''}`,
          recipient: to,
        }),
        subject,
        htmlBody: `
          <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;">
            <div style="background:linear-gradient(135deg,#003d7a 0%,#1a5490 100%);padding:20px;border-radius:12px 12px 0 0;">
              <h1 style="margin:0;color:#fff;font-size:20px;">${subject}</h1>
            </div>
            <div style="background:#f8f9fa;padding:20px;border-radius:0 0 12px 12px;">
              <p style="color:#333;font-size:14px;">Adjunto PDF de liquidación diaria (${displayNumber}).</p>
              <ul style="color:#555;font-size:13px;">
                <li>Efectivo: ${totals.totalEfectivo.toFixed(2)} EUR</li>
                <li>Tarjeta: ${totals.totalTarjeta.toFixed(2)} EUR</li>
                <li>A ingresar: ${totals.totalAIngresar.toFixed(2)} EUR</li>
                <li>Banco: ${totals.ingresoBanco.toFixed(2)} EUR</li>
                <li>Diff: ${totals.diff.toFixed(2)} EUR</li>
              </ul>
            </div>
          </div>`,
        textBody: textLines.join('\n'),
        pdfBuffer,
        pdfFilename: `${String(subject).replace(/\s+/g, '_')}.pdf`,
      });
      results.push({ to, success: true, result });
    } catch (error) {
      logger.error(`[REPARTIDOR_FINANZAS] Email failed to ${to}: ${error.message}`);
      results.push({ to, success: false, error: error.message });
    }
  }
  return results;
}

// ─── Req #16: Lookups adicionales usados por routes/repartidor-finanzas.js ──

/**
 * Devuelve el detalle de un vencimiento CVC dado su clave compuesta.
 * Usado por `GET /vencimientos/:repartidorId/:docId/detalle` para abrir el
 * formulario de cobro del repartidor con todos los datos del documento.
 */
async function getDetalleVencimiento(docKey) {
  if (!docKey || !docKey.tipo) return null;
  const repartidorId = normalizeText(docKey.repartidorId);
  if (!repartidorId) {
    throw new PaymentAuthzDeniedError('Se requiere el repartidor para consultar un vencimiento');
  }
  const params = [
    String(docKey.tipo).trim(),
    Number(docKey.ejercicio) || 0,
    String(docKey.serie || '').trim(),
    Number(docKey.terminal) || 0,
    Number(docKey.numero) || 0,
    Number(docKey.xde) || 1,
  ];
  const rows = await financeRepo.selectDetalleVencimiento({ params, repartidorId });
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  return {
    docKey: {
      tipo: value(row, 'TIPODOCUMENTO'),
      origen: value(row, 'ORIGENDOCUMENTO'),
      subempresa: value(row, 'SUBEMPRESADOCUMENTO'),
      ejercicio: toInt(value(row, 'EJERCICIODOCUMENTO')),
      serie: value(row, 'SERIEDOCUMENTO'),
      terminal: toInt(value(row, 'TERMINALDOCUMENTO')),
      numero: toInt(value(row, 'NUMERODOCUMENTO')),
      xde: toInt(value(row, 'XDEDOCUMENTO')),
      dex: toInt(value(row, 'DEXDOCUMENTO')),
    },
    cliente: {
      codigo: value(row, 'CODIGOCLIENTE'),
      nombre: value(row, 'NOMBRE_CLIENTE') || value(row, 'NOMBRE_ALTERNATIVO') || value(row, 'CODIGOCLIENTE'),
      poblacion: value(row, 'POBLACION') || '',
    },
    formaPago: value(row, 'CODIGOFORMAPAGO') || '',
    emision: {
      dia: toInt(value(row, 'DIAEMISION')),
      mes: toInt(value(row, 'MESEMISION')),
      ano: toInt(value(row, 'ANOEMISION')),
    },
    vencimiento: {
      dia: toInt(value(row, 'DIAVENCIMIENTO')),
      mes: toInt(value(row, 'MESVENCIMIENTO')),
      ano: toInt(value(row, 'ANOVENCIMIENTO')),
    },
    importes: {
      total: roundMoney(value(row, 'IMPORTEVENCIMIENTO')),
      cancelado: roundMoney(value(row, 'IMPORTECANCELADO')),
      pendiente: roundMoney(value(row, 'IMPORTEPENDIENTE')),
    },
    autorizacion: {
      vendedor: value(row, 'CODIGOVENDEDOR') || '',
      vendedorCobro: value(row, 'CODIGOVENDEDORCOBRO') || '',
    },
    anulado: (value(row, 'ANULADOSN') || '').toUpperCase() === 'S',
  };
}

/**
 * Saldo actual del repartidor: lee CUENTAS_LIQUIDACION si existe; fallback a
 * sumar IMPORTEPENDIENTE de REPARTIDOR_COBROS no liquidados.
 */
async function getSaldoActual(repartidorId) {
  const rep = normalizeText(repartidorId);
  if (!rep) return 0;
  try {
    const lqd = await financeRepo.selectLastLqdSaldo(rep);
    if (lqd && lqd.length > 0) return roundMoney(value(lqd[0], 'SALDO'));
  } catch (_) { /* DSEDAC.LQD no disponible */ }
  const info = await getFinanceSchemaInfo();
  try {
    const rows = await financeRepo.selectSaldoFromBalances(rep);
    if (rows && rows.length > 0) return roundMoney(value(rows[0], 'SALDO'));
  } catch (_) { /* tabla no existe aún */ }
  // Fallback: agregar cobros no liquidados
  if (!info.cobrosAligned && !info.cobrosLegacy) return 0;
  try {
    const rows = await financeRepo.selectSaldoFromPendingCobros({ info, repartidorId: rep });
    return roundMoney(value(rows[0], 'SALDO'));
  } catch (err) {
    logger.warn(`[REPARTIDOR_FINANZAS] getSaldoActual fallback error: ${err.message}`);
    return 0;
  }
}

/**
 * Evolución mensual (últimos 6 meses) de cobros del repartidor.
 */
async function getEvolution(repartidorId) {
  const ids = codeList(repartidorId);
  const info = await getFinanceSchemaInfo();
  const rows = await financeRepo.selectEvolution({ info, ids });
  return (rows || []).map((row) => {
    const ano = toInt(value(row, 'ANO'));
    const mes = toInt(value(row, 'MES'));
    const total = roundMoney(value(row, 'TOTAL'));
    const numCobros = toInt(value(row, 'NUM_COBROS'));
    return {
      period: `${ano}-${pad(mes, 2)}`,
      ano,
      mes,
      total,
      totalSales: total,
      numCobros,
    };
  }).reverse();
}
/**
 * Top productos entregados por el repartidor (basado en CPC.CODIGOREPARTIDOR
 * vía OPP, agregado por familia/artículo).
 */
async function getTopProducts(repartidorId, { limit = 10 } = {}) {
  const ids = codeList(repartidorId);
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
  const rows = await financeRepo.selectTopProducts({ ids, safeLimit });
  return (rows || []).map((row) => {
    const codigo = String(value(row, 'CODIGO', '') || '').trim();
    const nombre = String(value(row, 'NOMBRE', codigo) || codigo).trim();
    const unidades = toNumber(value(row, 'UNIDADES'));
    const importe = roundMoney(value(row, 'IMPORTE'));
    return {
      codigo,
      nombre,
      unidades,
      importe,
      code: codigo,
      name: nombre,
      totalUnits: unidades,
      totalSales: importe,
    };
  });
}
/**
 * Req #16 (devoluciones): anula un cobro registrado por el repartidor.
 *
 * Solo permite anular si:
 *   - El cobro existe (por IDEMPOTENCY_TOKEN).
 *   - El cobro pertenece al repartidor que lo solicita (o ADMIN/JEFE).
 *   - El cobro NO está incluido en una liquidación cerrada (LIQUIDADO_SN <> 'S').
 *
 * Estrategia: borrado físico para mantener la BD limpia + traza en
 * REPARTIDOR_COBROS_AUDIT (event_type=PAYMENT_REVERSED) con el motivo.
 *
 * Devuelve el cobro anulado (snapshot previo al borrado) para que el frontend
 * pueda mostrar al usuario lo que se ha revertido.
 */
async function reverseCobro() {
  // The approved production ledger does not yet expose a verified soft-reversal
  // column set plus transactional audit contract. Refuse before any DB action.
  throw new FinanceSchemaUnavailableError(
    'La reversi?n de cobros no est? disponible hasta validar el contrato de anulaci?n y auditor?a',
  );
}

module.exports = {
  findLiquidacionByToken,
  getDailySummary,
  ensureIsolatedTestFinanceSeed,
  getSummary,
  getVencimientos,
  getDetalleVencimiento,
  getSaldoActual,
  getEvolution,
  getTopProducts,
  registerCobro,
  reverseCobro,
  confirmRuteroDeliveryWithCobro,
  closeLiquidacion,
  getCommissionSummary,
  getCommissionTiers,
  saveCommissionTiers,
  calculateCommission,
  deleteTestData,
  sendLiquidacionEmails,
  buildClosedLiquidacionPdf,
  formatGmpLiquidacionDisplay,
  cashToDeposit,
  shadowLiquidacionPayments,
  // Error classes (Req #16: facilita catch tipado en routes)
  AlreadyDeliveredError,
  IdempotencyConflictError,
  PaymentAlreadyRegisteredError,
  DuplicatePaymentError,
  PaymentAuthzDeniedError,
  DuplicateLiquidacionError,
  CobroAlreadyLiquidadoError,
  CobroNotFoundError,
  FinanceSchemaUnavailableError,
  LiquidacionEmailRecipientRequiredError,
  LiquidacionPdfReadError,
  // Audit helper (re-export para tests)
  _auditLog: auditLog,
};
