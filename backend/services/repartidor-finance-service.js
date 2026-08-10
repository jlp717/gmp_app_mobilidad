'use strict';

const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { queryWithParams, getPool, initDb } = require('../config/db');
const logger = require('../middleware/logger');
const { sendEmailWithPdf } = require('./emailPdfService');
const { isDeliveryStatusAvailable, isDeliveryStatusNewSchema } = require('../utils/delivery-status-check');
const { resolveRepartoRuntime } = require('../config/reparto-runtime');
const { validateFinanceTableMapping } = require('../config/reparto-runtime');
const {
  createRepartoCobrosDb2Port,
  RepartoCobrosCapabilityError,
  RepartoCobrosIdempotencyRaceError,
} = require('../repositories/reparto-cobros-db2-port');
// Req #16: Audit-trail para cobros del repartidor (write best-effort)
const auditLog = require('./audit-log.service');

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
    rows = await queryWithParams(`
      SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME
      FROM QSYS2.SYSCOLUMNS
      WHERE ${catalogTargets.map(() => '(TABLE_SCHEMA = ? AND TABLE_NAME = ?)').join(' OR ')}
    `, catalogTargets.flatMap(({ schema, table }) => [schema, table]), false, false);
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

function cobroReplaySelect(info) {
  const candidates = [
    'ID',
    'CODIGOVENDEDOR',
    'CODIGO_REPARTIDOR',
    'CODIGOCLIENTEALBARAN',
    'CODIGO_CLIENTE',
    'TIPODOCUMENTO',
    'TIPO_DOCUMENTO',
    'ORIGENDOCUMENTO',
    'ORIGEN_DOCUMENTO',
    'SUBEMPRESADOCUMENTO',
    'SUBEMPRESA_DOCUMENTO',
    'EJERCICIODOCUMENTO',
    'EJERCICIO_DOCUMENTO',
    'SERIEDOCUMENTO',
    'SERIE_DOCUMENTO',
    'TERMINALDOCUMENTO',
    'TERMINAL_DOCUMENTO',
    'NUMERODOCUMENTO',
    'NUMERO_DOCUMENTO',
    'XDEDOCUMENTO',
    'XDE_DOCUMENTO',
    'DEXDOCUMENTO',
    'DEX_DOCUMENTO',
    'CODIGOFORMAPAGO',
    'FORMA_PAGO',
    'PANTALLA_ORIGEN',
    'IMPORTEVENCIMIENTO',
    'IMPORTE_COBRADO',
    'IMPORTEPENDIENTE',
    'IMPORTE_PENDIENTE',
    'LIQUIDADO_SN',
    'NUMEROLIQUIDACION',
    'CREATED_AT',
  ];
  const columns = candidates.filter((column) => info.has('REPARTIDOR_COBROS', column));
  return columns.length > 0 ? columns.join(', ') : 'ID, IDEMPOTENCY_TOKEN';
}

async function getCobrosSchemaInfo() {
  const info = await getFinanceSchemaInfo();
  return info.cobrosHasCollectionDate;
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

function inClause(column, values) {
  if (values.length === 1) {
    return { sql: `${column} = ?`, params: values };
  }
  return {
    sql: `${column} IN (${values.map(() => '?').join(', ')})`,
    params: values,
  };
}

function cobrosDateFilterColumn(info, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  if (info.cobrosHasCollectionDate) {
    return `${prefix}ANOCOBRO * 10000 + ${prefix}MESCOBRO * 100 + ${prefix}DIACOBRO`;
  }
  if (info.cobrosHasFechaCobro) {
    return `YEAR(${prefix}FECHA_COBRO) * 10000 + MONTH(${prefix}FECHA_COBRO) * 100 + DAY(${prefix}FECHA_COBRO)`;
  }
  return `${prefix}ANOVENCIMIENTO * 10000 + ${prefix}MESVENCIMIENTO * 100 + ${prefix}DIAVENCIMIENTO`;
}

function cobrosDateSelectColumns(info) {
  if (info.cobrosHasCollectionDate) return 'RC.DIACOBRO, RC.MESCOBRO, RC.ANOCOBRO';
  if (info.cobrosHasFechaCobro) {
    return 'DAY(RC.FECHA_COBRO) AS DIACOBRO, MONTH(RC.FECHA_COBRO) AS MESCOBRO, YEAR(RC.FECHA_COBRO) AS ANOCOBRO';
  }
  return 'RC.DIAVENCIMIENTO, RC.MESVENCIMIENTO, RC.ANOVENCIMIENTO';
}

function cobrosDateOrderBy(info, alias = 'RC') {
  const prefix = alias ? `${alias}.` : '';
  if (info.cobrosHasCollectionDate) return `${prefix}ANOCOBRO, ${prefix}MESCOBRO, ${prefix}DIACOBRO`;
  if (info.cobrosHasFechaCobro) return `${prefix}FECHA_COBRO`;
  return `${prefix}ANOVENCIMIENTO, ${prefix}MESVENCIMIENTO, ${prefix}DIAVENCIMIENTO`;
}

function cobrosNotLiquidatedCondition(info, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  if (info.cobrosHasLiquidado) {
    return `COALESCE(${prefix}LIQUIDADO_SN, 'N') <> 'S'`;
  }
  if (info.cobrosHasNumeroLiquidacion) {
    return `COALESCE(${prefix}NUMEROLIQUIDACION, 0) = 0`;
  }
  return '1 = 1';
}

function cobrosCodeColumn(info, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return info.cobrosAligned ? `${prefix}CODIGOVENDEDOR` : `${prefix}CODIGO_REPARTIDOR`;
}

function cobrosAmountColumn(info, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return info.cobrosAligned ? `${prefix}IMPORTEVENCIMIENTO` : `${prefix}IMPORTE_COBRADO`;
}

function cobrosPendingColumn(info, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return info.cobrosAligned ? `${prefix}IMPORTEPENDIENTE` : `${prefix}IMPORTE_PENDIENTE`;
}

function cobrosPaymentColumn(info, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return info.cobrosAligned ? `${prefix}CODIGOFORMAPAGO` : `${prefix}FORMA_PAGO`;
}

function liquidacionCodeColumn(info, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  if (info.has('REPARTIDOR_LIQUIDACION_OPS', 'CODIGOVENDEDOR')) {
    return `${prefix}CODIGOVENDEDOR`;
  }
  if (info.has('REPARTIDOR_LIQUIDACION_OPS', 'CODIGO_REPARTIDOR')) {
    return `${prefix}CODIGO_REPARTIDOR`;
  }
  throw new FinanceSchemaUnavailableError(
    'El ledger de liquidaciones no contiene un codigo de repartidor compatible',
  );
}

function liquidacionCollectedExpression(info, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  if (info.has('REPARTIDOR_LIQUIDACION_OPS', 'TOTAL_COBROS_DIA')) {
    return `COALESCE(${prefix}TOTAL_COBROS_DIA, 0)`;
  }

  const components = [
    'IMPORTEEFECTIVO',
    'IMPORTECHEQUES',
    'IMPORTETARJETA',
    'IMPORTEPOSTDATADOS',
  ].filter((column) => info.has('REPARTIDOR_LIQUIDACION_OPS', column));
  if (components.length === 0) {
    throw new FinanceSchemaUnavailableError(
      'El ledger de liquidaciones no contiene importes cobrados compatibles',
    );
  }
  return components.map((column) => `COALESCE(${prefix}${column}, 0)`).join(' + ');
}

function storagePaymentCode(raw, info) {
  const value = normalizeText(raw).toUpperCase();
  if (!info.cobrosAligned) return value;
  if (['EFECTIVO', 'CONTADO', 'EF', 'F0'].includes(value)) return 'EF';
  if (['TARJETA', 'TPV', 'TJ'].includes(value)) return 'TJ';
  if (['TRANSFERENCIA', 'TRANSFER', 'TR', 'T0'].includes(value)) return 'TR';
  // BI is an app-ledger code; it is not asserted to be an ERP FPG master code.
  if (['BIZUM', 'BI'].includes(value)) return 'BI';
  if (['CHEQUE', 'TALON', 'TALON BANCARIO', 'CH'].includes(value)) return 'CH';
  if (['POSTDATADO', 'POSTDATADOS', 'PD'].includes(value)) return 'PD';
  return value.slice(0, 2);
}

function cobroInsertStatement(info, input) {
  const now = new Date();
  const columns = [];
  const params = [];
  const add = (column, value) => {
    if (!info.has('REPARTIDOR_COBROS', column)) return;
    columns.push(column);
    params.push(value);
  };

  if (info.cobrosAligned) {
    add('CODIGOCLIENTEALBARAN', input.codigoCliente);
    add('CODIGOCLIENTEFACTURA', input.codigoCliente);
    add('CODIGOVENDEDOR', input.codigoRepartidor);
    add('CODIGOVENDEDORCOBRO', input.codigoRepartidor);
    add('TIPODOCUMENTO', normalizeTipoDocumento(input.tipoDocumento));
    add('ORIGENDOCUMENTO', input.origenDocumento || 'B');
    add('SUBEMPRESADOCUMENTO', input.subempresaDocumento || 'GMP');
    add('EJERCICIODOCUMENTO', input.ejercicioDocumento);
    add('SERIEDOCUMENTO', input.serieDocumento);
    add('TERMINALDOCUMENTO', input.terminalDocumento);
    add('NUMERODOCUMENTO', input.numeroDocumento);
    add('XDEDOCUMENTO', input.xdeDocumento || 1);
    add('DEXDOCUMENTO', input.dexDocumento || 1);
    add('IMPORTEVENCIMIENTO', roundMoney(input.importeCobrado));
    add('IMPORTEPENDIENTE', roundMoney(input.importePendiente));
    add('CODIGOFORMAPAGO', storagePaymentCode(input.formaPago, info));
    add('DIACOBRO', now.getDate());
    add('MESCOBRO', now.getMonth() + 1);
    add('ANOCOBRO', now.getFullYear());
    add('IDEMPOTENCY_TOKEN', input.idempotencyToken);
    add('PANTALLA_ORIGEN', input.pantallaOrigen || 'RUTERO');
    add('OPERADOR', input.operador || 'unknown');
    add('OBSERVACIONES', input.notas || null);
  } else {
    add('CODIGO_CLIENTE', input.codigoCliente);
    add('NOMBRE_CLIENTE', input.nombreCliente || '');
    add('CODIGO_REPARTIDOR', input.codigoRepartidor);
    add('TIPO_DOCUMENTO', normalizeTipoDocumento(input.tipoDocumento));
    add('ORIGEN_DOCUMENTO', input.origenDocumento || 'B');
    add('SUBEMPRESA_DOCUMENTO', input.subempresaDocumento || 'GMP');
    add('EJERCICIO_DOCUMENTO', input.ejercicioDocumento);
    add('SERIE_DOCUMENTO', input.serieDocumento);
    add('TERMINAL_DOCUMENTO', input.terminalDocumento);
    add('NUMERO_DOCUMENTO', input.numeroDocumento);
    add('XDE_DOCUMENTO', input.xdeDocumento || 1);
    add('DEX_DOCUMENTO', input.dexDocumento || 1);
    add('IMPORTE_COBRADO', roundMoney(input.importeCobrado));
    add('IMPORTE_PENDIENTE', roundMoney(input.importePendiente));
    add('FORMA_PAGO', storagePaymentCode(input.formaPago, info));
    add('IDEMPOTENCY_TOKEN', input.idempotencyToken);
    add('PANTALLA_ORIGEN', input.pantallaOrigen || 'RUTERO');
    add('OPERADOR', input.operador || 'unknown');
    add('NOTAS', input.notas || null);
  }

  return {
    sql: `
      INSERT INTO ${FINANCE_TABLES.cobros} (
        ${columns.join(',\n        ')}
      ) VALUES (${columns.map(() => '?').join(', ')})
    `,
    params,
  };
}

function liquidacionOpsInsertStatement(info, input) {
  const columns = [];
  const params = [];
  const add = (column, raw) => {
    if (!info.has('REPARTIDOR_LIQUIDACION_OPS', column)) return;
    columns.push(column);
    params.push(raw);
  };

  add('IDEMPOTENCY_TOKEN', input.idempotencyToken);
  add('SUBEMPRESALIQUIDACION', input.subempresa);
  add('EJERCICIOLIQUIDACION', input.year);
  add('SERIELIQUIDACION', input.serie);
  add('TERMINALLIQUIDACION', input.terminal);
  add('NUMEROLIQUIDACION', input.numero);
  add('CODIGOVENDEDOR', input.repartidorId);
  add('IMPORTEEFECTIVO', roundMoney(input.totals.totalEfectivo));
  add('IMPORTECHEQUES', roundMoney(input.totals.totalCheques));
  add('IMPORTETARJETA', roundMoney(input.totals.totalTarjeta));
  add('IMPORTEPOSTDATADOS', roundMoney(input.totals.totalPostdatados));
  add('IMPORTESALDOACTUAL', roundMoney(input.totals.saldoActual));
  add('TOTAL_COBROS_DIA', roundMoney(input.totals.totalCobrosDia));
  add('IMPORTEGASTOS', roundMoney(input.totals.gastos));
  add('IMPORTETOTALAINGRESAR', roundMoney(input.totals.totalAIngresar));
  add('IMPORTEINGRESOENBANCO', roundMoney(input.totals.ingresoBanco));
  add('IMPORTEEFECTIVO2', roundMoney(input.totals.efectivo2));
  add('IMPORTEENTREGADO2', roundMoney(input.totals.entregado2));
  add('SALDO_RESULTANTE', roundMoney(input.saldoResultante));
  add('CODIGOUSUARIO', input.createdBy || 'unknown');
  add('REVISADOSN', 'S');
  add('STATUS', 'CLOSED');
  add('OPERADOR', input.createdBy || 'unknown');

  return {
    sql: `
      INSERT INTO ${FINANCE_TABLES.liquidationOps} (
        ${columns.join(',\n        ')}
      ) VALUES (${columns.map(() => '?').join(', ')})
    `,
    params,
  };
}

const INTERNAL_LIQUIDATION_RECIPIENTS = Object.freeze([]);

const FINANCE_RUNTIME = resolveRepartoRuntime(process.env);

function assertFinanceRuntime() {
  const mapping = validateFinanceTableMapping(FINANCE_RUNTIME);
  if (!FINANCE_RUNTIME.valid || !mapping.valid) {
    throw new FinanceSchemaUnavailableError(
      'La configuracion de reparto no permite consultar ni liquidar finanzas',
    );
  }
  return FINANCE_RUNTIME;
}

function getErpDataSchema() {
  return assertFinanceRuntime().schemas.read;
}

function getAppSchema() {
  return assertFinanceRuntime().schemas.app;
}

function getCommissionConfigSchema() {
  const runtime = assertFinanceRuntime();
  const schema = String(
    process.env.REPARTIDOR_COMMISSION_CONFIG_SCHEMA || runtime.schemas.app,
  ).trim().toUpperCase();
  if (schema !== runtime.schemas.app) {
    throw new FinanceSchemaUnavailableError(
      'El esquema de comisiones debe coincidir con el esquema de aplicacion de reparto',
    );
  }
  return schema;
}
const ERP_DATA_SCHEMA = getErpDataSchema();
const COMMISSION_CONFIG_SCHEMA = getCommissionConfigSchema();
const FINANCE_TABLES = Object.freeze({ ...assertFinanceRuntime().tables.finance });
const ERP_APP_SCHEMA = getAppSchema();

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

function cobroDocumentCriteria(info, input) {
  const tipoDocumento = normalizeTipoDocumento(input.tipoDocumento);
  const commonParams = [
    input.codigoRepartidor,
    input.codigoCliente,
    tipoDocumento,
    input.origenDocumento || 'B',
    input.subempresaDocumento || 'GMP',
    input.ejercicioDocumento,
    input.serieDocumento,
    input.terminalDocumento,
    input.numeroDocumento,
    input.xdeDocumento || 1,
    input.dexDocumento || 1,
  ];

  if (info.cobrosAligned) {
    return {
      sql: `TRIM(CODIGOVENDEDOR) = ?
        AND TRIM(CODIGOCLIENTEALBARAN) = ?
        AND TRIM(TIPODOCUMENTO) = ?
        AND TRIM(ORIGENDOCUMENTO) = ?
        AND TRIM(SUBEMPRESADOCUMENTO) = ?
        AND EJERCICIODOCUMENTO = ?
        AND TRIM(SERIEDOCUMENTO) = ?
        AND TERMINALDOCUMENTO = ?
        AND NUMERODOCUMENTO = ?
        AND COALESCE(XDEDOCUMENTO, 1) = ?
        AND COALESCE(DEXDOCUMENTO, 1) = ?`,
      params: commonParams,
    };
  }

  return {
    sql: `TRIM(CODIGO_REPARTIDOR) = ?
      AND TRIM(CODIGO_CLIENTE) = ?
      AND TRIM(TIPO_DOCUMENTO) = ?
      AND TRIM(ORIGEN_DOCUMENTO) = ?
      AND TRIM(SUBEMPRESA_DOCUMENTO) = ?
      AND EJERCICIO_DOCUMENTO = ?
      AND TRIM(SERIE_DOCUMENTO) = ?
      AND TERMINAL_DOCUMENTO = ?
      AND NUMERO_DOCUMENTO = ?
      AND COALESCE(XDE_DOCUMENTO, 1) = ?
      AND COALESCE(DEX_DOCUMENTO, 1) = ?`,
    params: commonParams,
  };
}

async function lockCobrosForPayment(conn) {
  await conn.query(`LOCK TABLE ${FINANCE_TABLES.cobros} IN EXCLUSIVE MODE`);
}

async function assertPaymentWithinOutstandingBalance(conn, info, input, documentRow) {
  const erpPending = Number(value(documentRow, 'ERP_IMPORTEPENDIENTE'));
  if (!Number.isFinite(erpPending) || erpPending < 0) {
    throw new FinanceSchemaUnavailableError(
      'El documento no expone un saldo pendiente valido para registrar el abono',
    );
  }

  const criteria = cobroDocumentCriteria(info, input);
  const amountColumn = cobrosAmountColumn(info);
  const totals = firstRow(await conn.query(`
    SELECT COALESCE(SUM(${amountColumn}), 0) AS APP_COLLECTED
    FROM ${FINANCE_TABLES.cobros}
    WHERE ${criteria.sql}
  `, criteria.params));
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
    const comercialRows = await conn.query(`
      SELECT ID
        FROM ${FINANCE_TABLES.commercialCobros}
       WHERE TRIM(CODIGO_CLIENTE) = ?
         AND (TRIM(REFERENCIA) = ? OR REFERENCIA LIKE ?)
       FETCH FIRST 1 ROW ONLY
    `, [String(input.codigoCliente || '').trim(), composedRef, likeRef]);
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
  const rows = await queryWithParams(`
    SELECT OPS.*
    FROM ${FINANCE_TABLES.liquidationOps} OPS
    WHERE OPS.IDEMPOTENCY_TOKEN = ?
    FETCH FIRST 1 ROW ONLY
  `, [idempotencyToken], false, false);
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

  const totalsRows = await queryWithParams(`
    SELECT
      COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('EFECTIVO', 'EF', 'F0', 'E', 'CONTADO') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_EFECTIVO,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('CHEQUE', 'TALON', 'TALON BANCARIO') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_CHEQUES,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('TARJETA', 'TJ', 'TPV', 'TRANSFERENCIA', 'TR', 'T0', 'BIZUM', 'BI') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_TARJETA,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('POSTDATADO', 'POSTDATADOS') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_POSTDATADOS,
      COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL_COBROS_DIA,
      COUNT(*) AS COBROS_COUNT
    FROM ${FINANCE_TABLES.cobros}
    WHERE TRIM(CODIGOVENDEDOR) = ?
      AND ${dateCol} = ?
      AND COALESCE(LIQUIDADO_SN, 'N') <> 'S'
  `, [repartidorId, dateYmd], false, false);

  const balanceRows = await queryWithParams(`
    SELECT SALDO_PENDIENTE
    FROM ${FINANCE_TABLES.balances}
    WHERE TRIM(CODIGOVENDEDOR) = ?
    FETCH FIRST 1 ROW ONLY
  `, [repartidorId], false, false);

  const cobroRows = await queryWithParams(`
    SELECT
      RC.ID,
      ${selectCols},
      RC.CODIGOCLIENTEALBARAN,
      TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), TRIM(CLI.NOMBRECLIENTE))) AS NOMBRE_CLIENTE,
      RC.CODIGOFORMAPAGO,
      RC.TIPODOCUMENTO,
      RC.ORIGENDOCUMENTO,
      RC.SERIEDOCUMENTO,
      RC.TERMINALDOCUMENTO,
      RC.NUMERODOCUMENTO,
      RC.EJERCICIODOCUMENTO,
      RC.XDEDOCUMENTO,
      RC.IMPORTEVENCIMIENTO,
      RC.IMPORTEPENDIENTE
    FROM ${FINANCE_TABLES.cobros} RC
    LEFT JOIN ${ERP_DATA_SCHEMA}.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(RC.CODIGOCLIENTEALBARAN)
    WHERE TRIM(RC.CODIGOVENDEDOR) = ?
      AND ${dateCol} = ?
      AND COALESCE(RC.LIQUIDADO_SN, 'N') <> 'S'
    ORDER BY ${orderBy}, RC.ID
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
        ingresoBanco: 0, totalEfectivo2: 0, entregado: 0, cobrosCount: 0,
      },
      cobros: [],
    };
  }

  const dateYmd = compactDate(date);
  const dateCol = cobrosDateFilterColumn(info);
  const aliasedDateCol = cobrosDateFilterColumn(info, 'RC');
  const selectCols = cobrosDateSelectColumns(info);
  const orderBy = cobrosDateOrderBy(info);
  const repFilter = inClause(`TRIM(${cobrosCodeColumn(info)})`, ids);
  const repFilterRc = inClause(`TRIM(${cobrosCodeColumn(info, 'RC')})`, ids);
  const balanceFilter = inClause(`TRIM(${info.balanceCodeColumn})`, ids);
  const amountCol = cobrosAmountColumn(info);
  const paymentCol = cobrosPaymentColumn(info);
  const notLiquidated = cobrosNotLiquidatedCondition(info);
  const notLiquidatedRc = cobrosNotLiquidatedCondition(info, 'RC');

  const totalsRows = await queryWithParams(`
    SELECT
      COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('EFECTIVO', 'EF', 'F0', 'E', 'CONTADO', 'CT') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_EFECTIVO,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('CHEQUE', 'CH', 'TALON', 'TALON BANCARIO') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_CHEQUES,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('TARJETA', 'TJ', 'TPV', 'TRANSFERENCIA', 'TR', 'T0', 'BIZUM', 'BI') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_TARJETA,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('POSTDATADO', 'PD', 'POSTDATADOS') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_POSTDATADOS,
      COALESCE(SUM(${amountCol}), 0) AS TOTAL_COBROS_DIA,
      COUNT(*) AS COBROS_COUNT
    FROM ${FINANCE_TABLES.cobros}
    WHERE ${repFilter.sql}
      AND ${dateCol} = ?
      AND ${notLiquidated}
  `, [...repFilter.params, dateYmd], false, false);

  const balanceRows = await queryWithParams(`
    SELECT COALESCE(SUM(SALDO_PENDIENTE), 0) AS SALDO_PENDIENTE
    FROM ${FINANCE_TABLES.balances}
    WHERE ${balanceFilter.sql}
  `, balanceFilter.params, false, false);

  const cobroRows = await queryWithParams(`
    SELECT
      RC.ID,
      RC.IDEMPOTENCY_TOKEN,
      ${selectCols},
      ${info.cobrosAligned ? 'RC.CODIGOCLIENTEALBARAN' : 'RC.CODIGO_CLIENTE AS CODIGOCLIENTEALBARAN'},
      TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), TRIM(CLI.NOMBRECLIENTE))) AS NOMBRE_CLIENTE,
      ${info.cobrosAligned ? 'RC.CODIGOFORMAPAGO' : 'RC.FORMA_PAGO AS CODIGOFORMAPAGO'},
      ${info.cobrosAligned ? 'RC.TIPODOCUMENTO' : 'RC.TIPO_DOCUMENTO AS TIPODOCUMENTO'},
      ${info.cobrosAligned ? 'RC.ORIGENDOCUMENTO' : "COALESCE(RC.ORIGEN_DOCUMENTO, 'B') AS ORIGENDOCUMENTO"},
      ${info.cobrosAligned ? 'RC.SERIEDOCUMENTO' : "COALESCE(RC.SERIE_DOCUMENTO, '') AS SERIEDOCUMENTO"},
      ${info.cobrosAligned ? 'RC.TERMINALDOCUMENTO' : 'COALESCE(RC.TERMINAL_DOCUMENTO, 0) AS TERMINALDOCUMENTO'},
      ${info.cobrosAligned ? 'RC.NUMERODOCUMENTO' : 'RC.NUMERO_DOCUMENTO AS NUMERODOCUMENTO'},
      ${info.cobrosAligned ? 'RC.EJERCICIODOCUMENTO' : 'RC.EJERCICIO_DOCUMENTO AS EJERCICIODOCUMENTO'},
      ${info.cobrosAligned ? 'RC.XDEDOCUMENTO' : 'COALESCE(RC.XDE_DOCUMENTO, 1) AS XDEDOCUMENTO'},
      ${cobrosAmountColumn(info, 'RC')} AS IMPORTEVENCIMIENTO,
      ${cobrosPendingColumn(info, 'RC')} AS IMPORTEPENDIENTE
    FROM ${FINANCE_TABLES.cobros} RC
    LEFT JOIN ${ERP_DATA_SCHEMA}.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(${info.cobrosAligned ? 'RC.CODIGOCLIENTEALBARAN' : 'RC.CODIGO_CLIENTE'})
    WHERE ${repFilterRc.sql}
      AND ${aliasedDateCol} = ?
      AND ${notLiquidatedRc}
    ORDER BY ${orderBy}, RC.ID
  `, [...repFilterRc.params, dateYmd], false, false);

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
  const info = await getFinanceSchemaInfo();
  const ids = codeList(repartidorId);
  if (ids.length === 0) {
    throw new FinanceSchemaUnavailableError(
      'No existe un repartidor valido para calcular el resumen mensual',
    );
  }

  const cobrosCodeFilter = inClause(`TRIM(${cobrosCodeColumn(info, 'RC')})`, ids);
  const liquidacionCodeFilter = inClause(
    `TRIM(${liquidacionCodeColumn(info, 'OPS')})`,
    ids,
  );
  const firstDay = year * 10000 + month * 100 + 1;
  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const firstDayNextMonth = nextMonthYear * 10000 + nextMonth * 100 + 1;
  const cobrosDateColumn = cobrosDateFilterColumn(info, 'RC');
  const collectedAmountColumn = cobrosAmountColumn(info, 'RC');
  const liquidatedAmountExpression = liquidacionCollectedExpression(info, 'OPS');

  const cobrosRows = await queryWithParams(`
    SELECT
      COALESCE(SUM(${collectedAmountColumn}), 0) AS TOTAL_COBRADO,
      COUNT(*) AS COBROS_COUNT
    FROM ${FINANCE_TABLES.cobros} RC
    WHERE ${cobrosCodeFilter.sql}
      AND ${cobrosDateColumn} >= ?
      AND ${cobrosDateColumn} < ?
  `, [...cobrosCodeFilter.params, firstDay, firstDayNextMonth], false, false);

  const liquidacionRows = await queryWithParams(`
    SELECT OPS.*, ${liquidatedAmountExpression} AS TOTAL_LIQUIDADO_COBROS
    FROM ${FINANCE_TABLES.liquidationOps} OPS
    WHERE ${liquidacionCodeFilter.sql}
      AND OPS.ANOLIQUIDACION = ?
      AND OPS.MESLIQUIDACION = ?
    ORDER BY OPS.ANOLIQUIDACION, OPS.MESLIQUIDACION,
      OPS.DIALIQUIDACION, OPS.IDEMPOTENCY_TOKEN
  `, [...liquidacionCodeFilter.params, year, month], false, false);

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

function vencimientosCursorFingerprint({ repartidorId, from, to, clientCode, estado, todayYmd }) {
  return [repartidorId, from, to, clientCode || '', estado || 'todos', todayYmd].join('|');
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

function db2DateFromParts(yearExpression, monthExpression, dayExpression) {
  return `DATE(
    RIGHT('0000' || TRIM(CHAR(${yearExpression})), 4) || '-' ||
    RIGHT('00' || TRIM(CHAR(${monthExpression})), 2) || '-' ||
    RIGHT('00' || TRIM(CHAR(${dayExpression})), 2)
  )`;
}

function vencimientosDueYmdExpression() {
  const useAlbaran = "UPPER(TRIM(COALESCE(CLCL1.DIASLIMITECREDITOCONFECHAALB, ''))) = 'S'";
  const baseYear = `CASE WHEN ${useAlbaran} THEN CPC.ANODOCUMENTO ELSE CVC.ANOEMISION END`;
  const baseMonth = `CASE WHEN ${useAlbaran} THEN CPC.MESDOCUMENTO ELSE CVC.MESEMISION END`;
  const baseDay = `CASE WHEN ${useAlbaran} THEN CPC.DIADOCUMENTO ELSE CVC.DIAEMISION END`;
  const baseDate = db2DateFromParts(baseYear, baseMonth, baseDay);
  const calculatedDate = `(${baseDate} + INTEGER(CLCL1.DIASLIMITECREDITO) DAYS)`;
  const rawDueYmd = '(CVC.ANOVENCIMIENTO * 10000 + CVC.MESVENCIMIENTO * 100 + CVC.DIAVENCIMIENTO)';
  return `(CASE
    WHEN CLCL1.DIASLIMITECREDITO IS NOT NULL
      AND (${baseYear}) > 0 AND (${baseMonth}) > 0 AND (${baseDay}) > 0
    THEN YEAR(${calculatedDate}) * 10000 + MONTH(${calculatedDate}) * 100 + DAY(${calculatedDate})
    ELSE ${rawDueYmd}
  END)`;
}

async function getVencimientos({ repartidorId, from, to, limit, cursor, clientCode, estado }) {
  const ids = codeList(repartidorId);
  const pageLimit = Math.min(Math.max(toInt(limit), 1), 100);
  const cursorState = decodeVencimientosCursor(cursor, {
    repartidorId: ids.join(','), from, to, clientCode, estado,
  });
  const { offset, todayYmd, fingerprint } = cursorState;
  await getFinanceSchemaInfo();
  const repFilter = inClause('TRIM(OPP.CODIGOREPARTIDOR)', ids);
  const fromYmd = compactDate(from);
  const toYmd = compactDate(to);
  const dueYmd = vencimientosDueYmdExpression();
  const params = [...repFilter.params, fromYmd, toYmd];
  let clientFilter = '';
  if (clientCode) {
    clientFilter = ' AND TRIM(CVC.CODIGOCLIENTEALBARAN) = ?';
    params.push(clientCode.trim());
  }
  let stateFilter = '';
  if (estado === 'vencido' || estado === 'pendiente') {
    stateFilter = estado === 'vencido'
      ? ' AND BASE.DUE_YMD < ?'
      : ' AND BASE.DUE_YMD >= ?';
    params.push(todayYmd);
  }
  params.push(offset, offset + pageLimit);

  const rows = await queryWithParams(`
    SELECT *
    FROM (
      SELECT
        BASE.*,
        COUNT(*) OVER() AS TOTAL_COUNT,
        ROW_NUMBER() OVER (
          ORDER BY BASE.DUE_YMD,
            BASE.EJERCICIODOCUMENTO, BASE.TIPODOCUMENTO,
            BASE.ORIGENDOCUMENTO, BASE.SUBEMPRESADOCUMENTO,
            BASE.SERIEDOCUMENTO, BASE.TERMINALDOCUMENTO,
            BASE.NUMERODOCUMENTO, BASE.XDEDOCUMENTO,
            BASE.DEXDOCUMENTO, BASE.CODIGOCLIENTEALBARAN
        ) AS RN
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
          CAST(CVC.IMPORTEPENDIENTE - COALESCE(APP_COBROS.IMPORTE_COBRADO_APP, 0) AS DECIMAL(15,2)) AS IMPORTEPENDIENTE,
          ${dueYmd} AS DUE_YMD
        FROM ${ERP_DATA_SCHEMA}.CVC CVC
        INNER JOIN ${ERP_DATA_SCHEMA}.CPC CPC
          ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
          AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
          AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
          AND CVC.TERMINALDOCUMENTO = CPC.TERMINALALBARAN
          AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
        INNER JOIN ${ERP_DATA_SCHEMA}.OPP OPP
          ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
          AND OPP.EJERCICIOORDENPREPARACION = CPC.EJERCICIOORDENPREPARACION
        LEFT JOIN ${ERP_DATA_SCHEMA}.CLI CLI
          ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
        LEFT JOIN ${ERP_DATA_SCHEMA}.CLCL1 CLCL1
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
          FROM ${FINANCE_TABLES.cobros}
          GROUP BY TRIM(CODIGOVENDEDOR), TRIM(CODIGOCLIENTEALBARAN),
            TRIM(TIPODOCUMENTO), TRIM(ORIGENDOCUMENTO),
            TRIM(SUBEMPRESADOCUMENTO), EJERCICIODOCUMENTO,
            TRIM(SERIEDOCUMENTO), TERMINALDOCUMENTO,
            NUMERODOCUMENTO, XDEDOCUMENTO, DEXDOCUMENTO
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
        WHERE ${repFilter.sql}
          AND ${dueYmd} BETWEEN ? AND ?
          AND COALESCE(CVC.ANULADOSN, '') <> 'S'
          AND CVC.TIPODOCUMENTO IN ('CAC', 'COC', 'DEV')
          ${clientFilter}
      ) BASE
      WHERE BASE.IMPORTEPENDIENTE <> 0
        ${stateFilter}
    ) PAGED
    WHERE PAGED.RN > ? AND PAGED.RN <= ?
    ORDER BY PAGED.RN
  `, params, false, false);

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

  const pool = getPool();
  const conn = await pool.connect();
  let begun = false;
  try {
    const port = createRepartoCobrosDb2Port({ runtime, logger });
    // The catalog/index capability gate deliberately runs before BEGIN WORK.
    await port.assertCapabilities(conn);
    await conn.query('BEGIN WORK');
    begun = true;
    const result = await port.forConnection(conn).insertCobro(input);
    await conn.query('COMMIT');
    begun = false;
    logger.info(`[REPARTIDOR_FINANZAS] PAYMENT_REGISTERED rep=${normalizeText(input.codigoRepartidor)} amount=${roundMoney(input.importeCobrado)} created=${result.created}`);
    return { created: result.created, id: String(result.id) };
  } catch (error) {
    if (begun) {
      try { await conn.query('ROLLBACK'); } catch (rollbackError) {
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
  const sql = `
    SELECT CVC.IMPORTEPENDIENTE AS ERP_IMPORTEPENDIENTE
    FROM ${ERP_DATA_SCHEMA}.CVC CVC
    INNER JOIN ${ERP_DATA_SCHEMA}.CPC CPC
      ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
      AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
      AND TRIM(CVC.SERIEDOCUMENTO) = TRIM(CPC.SERIEALBARAN)
      AND CVC.TERMINALDOCUMENTO = CPC.TERMINALALBARAN
      AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
    INNER JOIN ${ERP_DATA_SCHEMA}.OPP OPP
      ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
      AND OPP.EJERCICIOORDENPREPARACION = CPC.EJERCICIOORDENPREPARACION
    WHERE TRIM(CVC.TIPODOCUMENTO) = ?
      AND TRIM(CVC.ORIGENDOCUMENTO) = ?
      AND TRIM(CVC.SUBEMPRESADOCUMENTO) = ?
      AND CVC.EJERCICIODOCUMENTO = ?
      AND TRIM(CVC.SERIEDOCUMENTO) = ?
      AND CVC.TERMINALDOCUMENTO = ?
      AND CVC.NUMERODOCUMENTO = ?
      AND COALESCE(CVC.XDEDOCUMENTO, 1) = ?
      AND COALESCE(CVC.DEXDOCUMENTO, 1) = ?
      AND TRIM(CVC.CODIGOCLIENTEALBARAN) = ?
      AND TRIM(OPP.CODIGOREPARTIDOR) = ?
    FETCH FIRST 1 ROW ONLY
  `;
  const params = [
    normalizeTipoDocumento(input.tipoDocumento),
    input.origenDocumento || 'B',
    input.subempresaDocumento || 'GMP',
    input.ejercicioDocumento,
    input.serieDocumento,
    input.terminalDocumento,
    input.numeroDocumento,
    input.xdeDocumento || 1,
    input.dexDocumento || 1,
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
  return firstRow(rows);
}

async function confirmRuteroDeliveryWithCobro({ delivery, cobro }) {
  async function replayExisting() {
    const info = await getFinanceSchemaInfo();
    const existingRows = await queryWithParams(`
      SELECT ${cobroReplaySelect(info)}
      FROM ${FINANCE_TABLES.cobros}
      WHERE IDEMPOTENCY_TOKEN = ?
      FETCH FIRST 1 ROW ONLY
    `, [cobro.idempotencyToken], false, false);
    const existing = firstRow(existingRows);
    assertCobroMatchesInput(existing, delivery, cobro);
    const deliveryRows = await queryWithParams(`
      SELECT CONFORMADOSN
      FROM ${ERP_APP_SCHEMA}.DELIVERY_STATUS
      WHERE IDEMPOTENCY_TOKEN = ?
      FETCH FIRST 1 ROW ONLY
    `, [delivery.idempotencyToken], false, false);
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
        await conn.query(`LOCK TABLE ${ERP_APP_SCHEMA}.DELIVERY_STATUS IN EXCLUSIVE MODE`);
      }

      const tokenRows = await conn.query(`
        SELECT ${cobroReplaySelect(info)}
        FROM ${FINANCE_TABLES.cobros}
        WHERE IDEMPOTENCY_TOKEN = ?
        FETCH FIRST 1 ROW ONLY
      `, [cobro.idempotencyToken]);

      const dsNew = isDeliveryStatusAvailable() && isDeliveryStatusNewSchema();
      const dsLookupCol = dsNew ? 'IDEMPOTENCY_TOKEN' : 'ID';
      const dsLookupVal = dsNew ? delivery.idempotencyToken : delivery.itemId;
      const dsStatusCol = dsNew ? 'STATUS' : 'CONFORMADOSN';
      const dsRepCol = dsNew ? 'OPERADOR' : 'REPARTIDOR_ID';

      const deliveryRows = await conn.query(`
        SELECT ${dsStatusCol}, UPDATED_AT, ${dsRepCol}
        FROM ${ERP_APP_SCHEMA}.DELIVERY_STATUS
        WHERE ${dsLookupCol} = ?
        FETCH FIRST 1 ROW ONLY
      `, [dsLookupVal]);
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

      await conn.query(`
        DELETE FROM ${ERP_APP_SCHEMA}.DELIVERY_STATUS
        WHERE ${dsLookupCol} = ?
      `, [dsLookupVal]);

      if (dsNew) {
        await conn.query(`
          INSERT INTO ${ERP_APP_SCHEMA}.DELIVERY_STATUS (
            STATUS,
            LATITUD,
            LONGITUD,
            OPERADOR,
            PANTALLA_ORIGEN,
            IDEMPOTENCY_TOKEN,
            UPDATED_AT
          ) VALUES (?, ?, ?, ?, 'COBROS', ?, CURRENT TIMESTAMP)
        `, [
          delivery.status || 'ENTREGADO',
          lat,
          lon,
          repartidorId,
          delivery.idempotencyToken,
        ]);
      } else {
        await conn.query(`
          INSERT INTO ${ERP_APP_SCHEMA}.DELIVERY_STATUS (
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
      }

      const insert = cobroInsertStatement(info, {
        ...cobro,
        entregaId: cobro.entregaId || delivery.itemId,
        codigoRepartidor: cobro.codigoRepartidor || repartidorId,
        pantallaOrigen: cobro.pantallaOrigen || 'RUTERO',
        operador: cobro.operador || 'unknown',
      });
      await conn.query(insert.sql, insert.params);

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

async function closeLiquidacion() {
  // The canonical liquidation service exclusively owns this operation.
  // This compatibility export must stay side-effect free.
  throw new FinanceSchemaUnavailableError(
    'El cierre de liquidacion se realiza mediante el servicio canonico',
  );
}

async function getCommissionTiers() {
  const rows = await queryWithParams(`
    SELECT ID, THRESHOLD_PCT, COMMISSION_PCT, SORT_ORDER, ACTIVE_SN
    FROM ${COMMISSION_CONFIG_SCHEMA}.REPARTIDOR_COMMISSION_TIERS
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
  const orderedTiers = [...(tiers || [])].sort((a, b) => {
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

  const deliveredRows = await queryWithParams(`
    SELECT COALESCE(SUM(CPC.IMPORTETOTAL), 0) AS TOTAL_REPARTIDO
    FROM ${ERP_DATA_SCHEMA}.OPP OPP
    INNER JOIN ${ERP_DATA_SCHEMA}.CPC CPC
      ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
      AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
    WHERE TRIM(OPP.CODIGOREPARTIDOR) = ?
      AND (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) BETWEEN ? AND ?
  `, [repartidorId, compactDate(from), compactDate(to)], false, false);

  const collectedRows = await queryWithParams(`
    SELECT COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL_COBRADO
    FROM ${FINANCE_TABLES.cobros}
    WHERE TRIM(CODIGOVENDEDOR) = ?
      AND ${dateCol} >= ?
      AND ${dateCol} <= ?
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

async function getCommissionSummary({ repartidorId, from, to }) {
  await getFinanceSchemaInfo();
  const ids = codeList(repartidorId);
  const repFilter = inClause('TRIM(OPP.CODIGOREPARTIDOR)', ids);
  const fromYmd = compactDate(from);
  const toYmd = compactDate(to);

  const deliveredRows = await queryWithParams(`
    SELECT COALESCE(SUM(CPC.IMPORTETOTAL), 0) AS TOTAL_REPARTIDO
    FROM ${ERP_DATA_SCHEMA}.OPP OPP
    INNER JOIN ${ERP_DATA_SCHEMA}.CPC CPC
      ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
      AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
    WHERE ${repFilter.sql}
      AND (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) BETWEEN ? AND ?
  `, [...repFilter.params, fromYmd, toYmd], false, false);

  const collectedRows = await queryWithParams(`
    SELECT COALESCE(SUM(CASE
      WHEN COALESCE(CVC.IMPORTEPENDIENTE, 0) = 0
      THEN CPC.IMPORTETOTAL
      ELSE CPC.IMPORTETOTAL - COALESCE(CVC.IMPORTEPENDIENTE, 0)
    END), 0) AS TOTAL_COBRADO
    FROM ${ERP_DATA_SCHEMA}.OPP OPP
    INNER JOIN ${ERP_DATA_SCHEMA}.CPC CPC
      ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
      AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
    LEFT JOIN ${ERP_DATA_SCHEMA}.CVC CVC
      ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
      AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
      AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
      AND CVC.TERMINALDOCUMENTO = CPC.TERMINALALBARAN
      AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
    WHERE ${repFilter.sql}
      AND (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) BETWEEN ? AND ?
  `, [...repFilter.params, fromYmd, toYmd], false, false);

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
      UPDATE ${COMMISSION_CONFIG_SCHEMA}.REPARTIDOR_COMMISSION_TIERS
      SET ACTIVE_SN = 'N',
          UPDATED_BY = ?,
          UPDATED_AT = CURRENT_TIMESTAMP
      WHERE ACTIVE_SN = 'S'
    `, [updatedBy || 'unknown']);

    for (let index = 0; index < tiers.length; index++) {
      const tier = tiers[index];
      await conn.query(`
        INSERT INTO ${COMMISSION_CONFIG_SCHEMA}.REPARTIDOR_COMMISSION_TIERS (
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

async function deleteTestData() {
  // Destructive ledger cleanup is retired in every environment. Test fixtures
  // must be isolated by their owning repository instead of deleting live data.
  throw new FinanceSchemaUnavailableError(
    'La limpieza destructiva de datos financieros esta retirada',
  );
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
  if (!liquidacion) return [];
  if (!normalizeText(repartidorEmail)) throw new LiquidacionEmailRecipientRequiredError();
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
  const rows = await queryWithParams(`
      SELECT
        TRIM(CVC.TIPODOCUMENTO) AS TIPODOCUMENTO,
        TRIM(CVC.ORIGENDOCUMENTO) AS ORIGENDOCUMENTO,
        TRIM(CVC.SUBEMPRESADOCUMENTO) AS SUBEMPRESADOCUMENTO,
        CVC.EJERCICIODOCUMENTO,
        TRIM(CVC.SERIEDOCUMENTO) AS SERIEDOCUMENTO,
        CVC.TERMINALDOCUMENTO,
        CVC.NUMERODOCUMENTO,
        CVC.XDEDOCUMENTO,
        CVC.DEXDOCUMENTO,
        TRIM(CVC.CODIGOCLIENTEALBARAN) AS CODIGOCLIENTE,
        TRIM(COALESCE(CLI.NOMBRECLIENTE, '')) AS NOMBRE_CLIENTE,
        TRIM(COALESCE(CLI.NOMBREALTERNATIVO, '')) AS NOMBRE_ALTERNATIVO,
        TRIM(COALESCE(CLI.POBLACION, '')) AS POBLACION,
        TRIM(COALESCE(CVC.CODIGOFORMAPAGO, '')) AS CODIGOFORMAPAGO,
        CVC.DIAEMISION, CVC.MESEMISION, CVC.ANOEMISION,
        CVC.DIAVENCIMIENTO, CVC.MESVENCIMIENTO, CVC.ANOVENCIMIENTO,
        CAST(CVC.IMPORTEVENCIMIENTO AS DECIMAL(15,2)) AS IMPORTEVENCIMIENTO,
        CAST(CVC.IMPORTECANCELADO AS DECIMAL(15,2)) AS IMPORTECANCELADO,
        CAST(CVC.IMPORTEPENDIENTE AS DECIMAL(15,2)) AS IMPORTEPENDIENTE,
        TRIM(COALESCE(CVC.CODIGOVENDEDOR, '')) AS CODIGOVENDEDOR,
        TRIM(COALESCE(CVC.CODIGOVENDEDORCOBRO, '')) AS CODIGOVENDEDORCOBRO,
        TRIM(COALESCE(CVC.ANULADOSN, '')) AS ANULADOSN
      FROM ${ERP_DATA_SCHEMA}.CVC CVC
      LEFT JOIN ${ERP_DATA_SCHEMA}.CLI CLI
        ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
      WHERE TRIM(CVC.TIPODOCUMENTO) = ?
        AND CVC.EJERCICIODOCUMENTO = ?
        AND TRIM(CVC.SERIEDOCUMENTO) = ?
        AND CVC.TERMINALDOCUMENTO = ?
        AND CVC.NUMERODOCUMENTO = ?
        AND COALESCE(CVC.XDEDOCUMENTO, 1) = ?
        AND (TRIM(CVC.CODIGOVENDEDOR) = ? OR TRIM(CVC.CODIGOVENDEDORCOBRO) = ?)
      FETCH FIRST 1 ROW ONLY
    `, [...params, repartidorId, repartidorId], false, false);
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
  const info = await getFinanceSchemaInfo();
  try {
    const rows = await queryWithParams(
      `SELECT COALESCE(SALDO_PENDIENTE, 0) AS SALDO
       FROM ${FINANCE_TABLES.balances}
        WHERE TRIM(CODIGO_REPARTIDOR) = ?
        FETCH FIRST 1 ROW ONLY`,
      [rep], false, false
    );
    if (rows && rows.length > 0) return roundMoney(value(rows[0], 'SALDO'));
  } catch (_) { /* tabla no existe aún */ }
  // Fallback: agregar cobros no liquidados
  if (!info.cobrosAligned && !info.cobrosLegacy) return 0;
  try {
    const codeColumn = cobrosCodeColumn(info);
    const pendingColumn = info.cobrosAligned
      ? 'IMPORTEPENDIENTE'
      : info.has('REPARTIDOR_COBROS', 'IMPORTE_PENDIENTE')
        ? 'IMPORTE_PENDIENTE'
        : cobrosAmountColumn(info);
    const notLiquidated = cobrosNotLiquidatedCondition(info);
    const rows = await queryWithParams(
      `SELECT COALESCE(SUM(${pendingColumn}), 0) AS SALDO
       FROM ${FINANCE_TABLES.cobros}
       WHERE TRIM(${codeColumn}) = ?
         AND ${notLiquidated}`,
      [rep], false, false
    );
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
  const codeColumn = cobrosCodeColumn(info);
  const amountColumn = cobrosAmountColumn(info);
  const codeFilter = inClause(`TRIM(${codeColumn})`, ids);
  const yearExpr = info.cobrosHasCollectionDate
    ? 'ANOCOBRO'
    : info.cobrosHasFechaCobro
      ? 'YEAR(FECHA_COBRO)'
      : 'ANOVENCIMIENTO';
  const monthExpr = info.cobrosHasCollectionDate
    ? 'MESCOBRO'
    : info.cobrosHasFechaCobro
      ? 'MONTH(FECHA_COBRO)'
      : 'MESVENCIMIENTO';
  const rows = await queryWithParams(
    `SELECT ${yearExpr} AS ANO,
            ${monthExpr} AS MES,
            COALESCE(SUM(${amountColumn}), 0) AS TOTAL,
            COUNT(*) AS NUM_COBROS
     FROM ${FINANCE_TABLES.cobros}
     WHERE ${codeFilter.sql}
       AND ${yearExpr} BETWEEN 2000 AND 2100
       AND ${monthExpr} BETWEEN 1 AND 12
     GROUP BY ${yearExpr}, ${monthExpr}
     ORDER BY ${yearExpr} DESC, ${monthExpr} DESC
     FETCH FIRST 6 ROWS ONLY`,
    codeFilter.params, false, false
  );
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
  const repFilter = inClause('TRIM(OPP.CODIGOREPARTIDOR)', ids);
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
  const rows = await queryWithParams(
    `SELECT TRIM(LAC.CODIGOARTICULO) AS CODIGO,
            TRIM(COALESCE(NULLIF(TRIM(ART.DESCRIPCIONARTICULO), ''), NULLIF(TRIM(LAC.DESCRIPCION), ''), LAC.CODIGOARTICULO)) AS NOMBRE,
            COALESCE(SUM(LAC.CANTIDADENVASES), 0) AS UNIDADES,
            COALESCE(SUM(LAC.IMPORTEVENTA), 0) AS IMPORTE
     FROM ${ERP_DATA_SCHEMA}.CPC CPC
     INNER JOIN ${ERP_DATA_SCHEMA}.LAC LAC
       ON LAC.SUBEMPRESAALBARAN = CPC.SUBEMPRESAALBARAN
      AND LAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
      AND LAC.SERIEALBARAN = CPC.SERIEALBARAN
      AND LAC.TERMINALALBARAN = CPC.TERMINALALBARAN
      AND LAC.NUMEROALBARAN = CPC.NUMEROALBARAN
     LEFT JOIN ${ERP_DATA_SCHEMA}.ART ART
       ON TRIM(ART.CODIGOARTICULO) = TRIM(LAC.CODIGOARTICULO)
     INNER JOIN ${ERP_DATA_SCHEMA}.OPP OPP
       ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
      AND OPP.EJERCICIOORDENPREPARACION = CPC.EJERCICIOORDENPREPARACION
     WHERE ${repFilter.sql}
       AND CPC.ANODOCUMENTO >= YEAR(CURRENT DATE) - 1
       AND TRIM(LAC.CODIGOARTICULO) <> ''
     GROUP BY TRIM(LAC.CODIGOARTICULO),
              TRIM(COALESCE(NULLIF(TRIM(ART.DESCRIPCIONARTICULO), ''), NULLIF(TRIM(LAC.DESCRIPCION), ''), LAC.CODIGOARTICULO))
     ORDER BY IMPORTE DESC, CODIGO
     FETCH FIRST ${safeLimit} ROWS ONLY`,
    repFilter.params, false, false
  );
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
  INTERNAL_LIQUIDATION_RECIPIENTS,
  findLiquidacionByToken,
  getDailySummary,
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
  // Audit helper (re-export para tests)
  _auditLog: auditLog,
};
