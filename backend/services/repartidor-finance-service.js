'use strict';

const PDFDocument = require('pdfkit');
const { queryWithParams, getPool, initDb } = require('../config/db');
const logger = require('../middleware/logger');
const { sendEmailWithPdf } = require('./emailPdfService');
const { isDeliveryStatusAvailable, isDeliveryStatusNewSchema } = require('../utils/delivery-status-check');

let _financeSchemaInfo = null;

const DEFAULT_FINANCE_SCHEMA_COLUMNS = [
  ['REPARTIDOR_COBROS', 'TIPODOCUMENTO'],
  ['REPARTIDOR_COBROS', 'ORIGENDOCUMENTO'],
  ['REPARTIDOR_COBROS', 'SUBEMPRESADOCUMENTO'],
  ['REPARTIDOR_COBROS', 'EJERCICIODOCUMENTO'],
  ['REPARTIDOR_COBROS', 'SERIEDOCUMENTO'],
  ['REPARTIDOR_COBROS', 'TERMINALDOCUMENTO'],
  ['REPARTIDOR_COBROS', 'NUMERODOCUMENTO'],
  ['REPARTIDOR_COBROS', 'XDEDOCUMENTO'],
  ['REPARTIDOR_COBROS', 'DEXDOCUMENTO'],
  ['REPARTIDOR_COBROS', 'CODIGOCLIENTEALBARAN'],
  ['REPARTIDOR_COBROS', 'CODIGOVENDEDOR'],
  ['REPARTIDOR_COBROS', 'CODIGOFORMAPAGO'],
  ['REPARTIDOR_COBROS', 'DIAVENCIMIENTO'],
  ['REPARTIDOR_COBROS', 'MESVENCIMIENTO'],
  ['REPARTIDOR_COBROS', 'ANOVENCIMIENTO'],
  ['REPARTIDOR_COBROS', 'DIACOBRO'],
  ['REPARTIDOR_COBROS', 'MESCOBRO'],
  ['REPARTIDOR_COBROS', 'ANOCOBRO'],
  ['REPARTIDOR_COBROS', 'NUMEROLIQUIDACION'],
  ['REPARTIDOR_COBROS', 'IMPORTEVENCIMIENTO'],
  ['REPARTIDOR_COBROS', 'IMPORTEPENDIENTE'],
  ['REPARTIDOR_COBROS', 'IDEMPOTENCY_TOKEN'],
  ['REPARTIDOR_COBROS', 'PANTALLA_ORIGEN'],
  ['REPARTIDOR_COBROS', 'OPERADOR'],
  ['REPARTIDOR_COBROS', 'CREATED_AT'],
  ['REPARTIDOR_FINANCIAL_BALANCES', 'CODIGO_REPARTIDOR'],
  ['REPARTIDOR_FINANCIAL_BALANCES', 'SALDO_PENDIENTE'],
  ['REPARTIDOR_FINANCIAL_BALANCES', 'UPDATED_BY'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'IDEMPOTENCY_TOKEN'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'SUBEMPRESALIQUIDACION'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'EJERCICIOLIQUIDACION'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'SERIELIQUIDACION'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'TERMINALLIQUIDACION'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'NUMEROLIQUIDACION'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'CODIGOVENDEDOR'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'IMPORTEEFECTIVO'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'IMPORTECHEQUES'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'IMPORTETARJETA'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'IMPORTEPOSTDATADOS'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'IMPORTESALDOACTUAL'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'IMPORTEGASTOS'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'IMPORTETOTALAINGRESAR'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'IMPORTEINGRESOENBANCO'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'IMPORTEEFECTIVO2'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'IMPORTEENTREGADO2'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'CODIGOUSUARIO'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'REVISADOSN'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'STATUS'],
  ['REPARTIDOR_LIQUIDACION_OPS', 'OPERADOR'],
  ['DELIVERY_STATUS', 'IDEMPOTENCY_TOKEN'],
  ['DELIVERY_STATUS', 'STATUS'],
  ['DELIVERY_STATUS', 'OPERADOR'],
];

function normalizeColumnName(raw) {
  return String(raw || '').trim().toUpperCase();
}

function normalizeTableName(raw) {
  return String(raw || '').trim().toUpperCase();
}

async function getFinanceSchemaInfo() {
  if (_financeSchemaInfo && process.env.NODE_ENV !== 'test') {
    return _financeSchemaInfo;
  }

  const APP_SCHEMA = process.env.PEDIDOS_CONFIRMATION_SCHEMA || 'JAVIER';
  const tables = [
    'REPARTIDOR_COBROS',
    'REPARTIDOR_FINANCIAL_BALANCES',
    'REPARTIDOR_LIQUIDACION_OPS',
    'DELIVERY_STATUS',
  ];
  const columnsByTable = new Map(tables.map((table) => [table, new Set()]));
  let rows = [];

  try {
    rows = await queryWithParams(`
      SELECT TABLE_NAME, COLUMN_NAME
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME IN (${tables.map(() => '?').join(', ')})
    `, [APP_SCHEMA, ...tables], false, false);
  } catch (error) {
    logger.warn(`[REPARTIDOR_FINANZAS] Schema detection failed in ${APP_SCHEMA}: ${error.message}`);
  }
  const detectedRows = Array.isArray(rows)
    ? rows.filter((row) =>
        normalizeTableName(value(row, 'TABLE_NAME')) &&
        normalizeColumnName(value(row, 'COLUMN_NAME'))
      )
    : [];
  if (detectedRows.length === 0) {
    rows = DEFAULT_FINANCE_SCHEMA_COLUMNS.map(([TABLE_NAME, COLUMN_NAME]) => ({
      TABLE_NAME,
      COLUMN_NAME,
    }));
  } else {
    rows = detectedRows;
  }

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

  const info = {
    has,
    cobrosAligned,
    cobrosLegacy,
    cobrosHasCollectionDate: has('REPARTIDOR_COBROS', 'ANOCOBRO') &&
      has('REPARTIDOR_COBROS', 'MESCOBRO') &&
      has('REPARTIDOR_COBROS', 'DIACOBRO'),
    cobrosHasLiquidado: has('REPARTIDOR_COBROS', 'LIQUIDADO_SN'),
    cobrosHasLiquidacionToken: has('REPARTIDOR_COBROS', 'LIQUIDACION_TOKEN'),
    cobrosHasEntregaAppId: has('REPARTIDOR_COBROS', 'ENTREGA_APP_ID'),
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

async function getCobrosSchemaInfo() {
  const info = await getFinanceSchemaInfo();
  return info.cobrosHasCollectionDate;
}

function codeList(raw) {
  return String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item && /^[a-zA-Z0-9]+$/.test(item) && item.length <= 2);
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

function storagePaymentCode(raw, info) {
  const value = normalizeText(raw).toUpperCase();
  if (!info.cobrosAligned) return value;
  if (value === 'EFECTIVO' || value === 'CONTADO') return 'EF';
  if (value === 'TARJETA' || value === 'TPV') return 'TJ';
  if (value === 'BIZUM') return 'BI';
  if (value === 'CHEQUE' || value === 'TALON' || value === 'TALON BANCARIO') return 'CH';
  if (value === 'POSTDATADO' || value === 'POSTDATADOS') return 'PD';
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
    add('ENTREGA_APP_ID', input.entregaId || null);
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
    add('ENTREGA_APP_ID', input.entregaId || null);
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
      INSERT INTO JAVIER.REPARTIDOR_COBROS (
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
      INSERT INTO JAVIER.REPARTIDOR_LIQUIDACION_OPS (
        ${columns.join(',\n        ')}
      ) VALUES (${columns.map(() => '?').join(', ')})
    `,
    params,
  };
}

const INTERNAL_LIQUIDATION_RECIPIENTS = [
  'carmen@mari-pepa.com',
  'marisol@mari-pepa.com',
  'diegocorbalan@mari-pepa.com',
];

function getErpDataSchema() {
  const schema = String(process.env.REPARTIDOR_FINANCE_ERP_SCHEMA || process.env.FINANCE_ERP_SCHEMA || process.env.PEDIDOS_CONFIRMATION_SCHEMA || 'DSEDAC').trim().toUpperCase();
  return schema === 'JAVIER' ? 'JAVIER' : 'DSEDAC';
}

function getAppSchema() {
  return String(process.env.PEDIDOS_CONFIRMATION_SCHEMA || 'JAVIER').trim().toUpperCase();
}

const ERP_DATA_SCHEMA = getErpDataSchema();
const ERP_FINANCE_SCHEMA = getAppSchema();
const LQD_TABLE = `${ERP_DATA_SCHEMA}.LQD`;

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

function firstDefinedValue(row, keys, fallback = undefined) {
  for (const key of keys) {
    const current = value(row, key);
    if (current !== undefined && current !== null) return current;
  }
  return fallback;
}

function normalizePaymentForCompare(raw) {
  const current = normalizeText(raw).toUpperCase();
  if (['EF', 'E', 'CT', 'EFECTIVO', 'CONTADO'].includes(current)) return 'EFECTIVO';
  if (['TJ', 'TARJETA', 'TPV'].includes(current)) return 'TARJETA';
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
    [['ENTREGA_APP_ID', 'ENTREGA_ID'], expected.entregaId, normalizeText],
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
    if (actual === undefined && columns[0] === 'ENTREGA_APP_ID') continue;
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
  await conn.query('LOCK TABLE JAVIER.REPARTIDOR_COBROS IN EXCLUSIVE MODE');
}

async function assertDocumentNotAlreadyCollected(conn, info, input) {
  const criteria = cobroDocumentCriteria(info, input);
  const rows = await conn.query(`
    SELECT ID, IDEMPOTENCY_TOKEN
    FROM JAVIER.REPARTIDOR_COBROS
    WHERE ${criteria.sql}
      AND COALESCE(TRIM(IDEMPOTENCY_TOKEN), '') <> ?
    FETCH FIRST 1 ROW ONLY
  `, [...criteria.params, input.idempotencyToken]);

  if (Array.isArray(rows) && rows.length > 0) {
    throw new PaymentAlreadyRegisteredError();
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
      COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('EFECTIVO', 'E', 'CONTADO') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_EFECTIVO,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('CHEQUE', 'TALON', 'TALON BANCARIO') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_CHEQUES,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('TARJETA', 'TPV', 'BIZUM') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_TARJETA,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('POSTDATADO', 'POSTDATADOS') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_POSTDATADOS,
      COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL_COBROS_DIA,
      COUNT(*) AS COBROS_COUNT
    FROM JAVIER.REPARTIDOR_COBROS
    WHERE TRIM(CODIGOVENDEDOR) = ?
      AND ${dateCol} = ?
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
    FROM JAVIER.REPARTIDOR_COBROS RC
    LEFT JOIN .CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(RC.CODIGOCLIENTEALBARAN)
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
      COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('EFECTIVO', 'EF', 'E', 'CONTADO', 'CT') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_EFECTIVO,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('CHEQUE', 'CH', 'TALON', 'TALON BANCARIO') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_CHEQUES,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('TARJETA', 'TJ', 'TPV', 'BIZUM', 'BI') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_TARJETA,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('POSTDATADO', 'PD', 'POSTDATADOS') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_POSTDATADOS,
      COALESCE(SUM(${amountCol}), 0) AS TOTAL_COBROS_DIA,
      COUNT(*) AS COBROS_COUNT
    FROM JAVIER.REPARTIDOR_COBROS
    WHERE ${repFilter.sql}
      AND ${dateCol} = ?
      AND ${notLiquidated}
  `, [...repFilter.params, dateYmd], false, false);

  const balanceRows = await queryWithParams(`
    SELECT COALESCE(SUM(SALDO_PENDIENTE), 0) AS SALDO_PENDIENTE
    FROM JAVIER.REPARTIDOR_FINANCIAL_BALANCES
    WHERE ${balanceFilter.sql}
  `, balanceFilter.params, false, false);

  const cobroRows = await queryWithParams(`
    SELECT
      RC.ID,
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
    FROM JAVIER.REPARTIDOR_COBROS RC
    LEFT JOIN .CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(${info.cobrosAligned ? 'RC.CODIGOCLIENTEALBARAN' : 'RC.CODIGO_CLIENTE'})
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
    FROM .CVC CVC
    INNER JOIN .CPC CPC
      ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
      AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
      AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
      AND CVC.TERMINALDOCUMENTO = CPC.TERMINALALBARAN
      AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
    INNER JOIN .OPP OPP
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
  await getFinanceSchemaInfo();
  const fromParts = dateParts(from);
  const toParts = dateParts(to);
  const broadFrom = compactDate(addDaysIso(fromParts.year, fromParts.month, fromParts.day, -120));
  const broadTo = compactDate(addDaysIso(toParts.year, toParts.month, toParts.day, 120));
  const ids = codeList(repartidorId);
  const repFilter = inClause('TRIM(OPP.CODIGOREPARTIDOR)', ids);
  const params = [...repFilter.params, broadFrom, broadTo];
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
      FROM .CVC CVC
      INNER JOIN .CPC CPC
        ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
        AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
        AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
        AND CVC.TERMINALDOCUMENTO = CPC.TERMINALALBARAN
        AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
      INNER JOIN .OPP OPP
        ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
      LEFT JOIN .CLI CLI
        ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
      LEFT JOIN .CLCL1 CLCL1
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
      WHERE ${repFilter.sql}
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
    const result = await withTransaction(async (conn) => {
      await lockCobrosForPayment(conn);

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

      await validateCobroDocument(input, conn);
      const info = await getFinanceSchemaInfo();
      await assertDocumentNotAlreadyCollected(conn, info, input);
      const insert = cobroInsertStatement(info, input);
      await conn.query(insert.sql, insert.params);

      const row = firstRow(await conn.query(`
        SELECT ID FROM JAVIER.REPARTIDOR_COBROS
        WHERE IDEMPOTENCY_TOKEN = ?
        FETCH FIRST 1 ROW ONLY
      `, [input.idempotencyToken]));

      return { created: true, id: String(value(row, 'ID', '')) };
    });

    if (result.created) {
      logger.info(`[AUDIT] PAYMENT_REGISTERED | Doc:${normalizeTipoDocumento(input.tipoDocumento)}-${input.ejercicioDocumento}-${input.serieDocumento}-${input.terminalDocumento}-${input.numeroDocumento} | Rep:${input.codigoRepartidor} | Amount:${roundMoney(input.importeCobrado)} | Token:${input.idempotencyToken}`);
    }

    return result;
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
    FROM .CVC CVC
    INNER JOIN .CPC CPC
      ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
      AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
      AND TRIM(CVC.SERIEDOCUMENTO) = TRIM(CPC.SERIEALBARAN)
      AND CVC.TERMINALDOCUMENTO = CPC.TERMINALALBARAN
      AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
    INNER JOIN .OPP OPP
      ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
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
    return await withTransaction(async (conn) => {
      await lockCobrosForPayment(conn);
      if (isDeliveryStatusAvailable()) {
        await conn.query('LOCK TABLE JAVIER.DELIVERY_STATUS IN EXCLUSIVE MODE');
      }

      const tokenRows = await conn.query(`
        SELECT *
        FROM JAVIER.REPARTIDOR_COBROS
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
        FROM JAVIER.DELIVERY_STATUS
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

      const info = await getFinanceSchemaInfo();
      await assertDocumentNotAlreadyCollected(conn, info, {
        ...cobro,
        codigoRepartidor: cobro.codigoRepartidor || delivery.repartidorId,
      });

      const lat = toNumber(delivery.latitud);
      const lon = toNumber(delivery.longitud);
      let repartidorId = String(delivery.repartidorId || '').trim();
      if (repartidorId.length > 20) repartidorId = repartidorId.substring(0, 20);

      await conn.query(`
        DELETE FROM JAVIER.DELIVERY_STATUS
        WHERE ${dsLookupCol} = ?
      `, [dsLookupVal]);

      if (dsNew) {
        await conn.query(`
          INSERT INTO JAVIER.DELIVERY_STATUS (
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
  const info = await getFinanceSchemaInfo();
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
    const dateCol = cobrosDateFilterColumn(info);
    const orderBy = cobrosDateOrderBy(info, '');
    const codeColumn = cobrosCodeColumn(info);
    const amountCol = cobrosAmountColumn(info);
    const paymentCol = cobrosPaymentColumn(info);
    const notLiquidated = cobrosNotLiquidatedCondition(info);

    const totalsRow = firstRow(await conn.query(`
      SELECT
        COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('EFECTIVO', 'EF', 'E', 'CONTADO', 'CT') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_EFECTIVO,
        COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('CHEQUE', 'CH', 'TALON', 'TALON BANCARIO') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_CHEQUES,
        COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('TARJETA', 'TJ', 'TPV', 'BIZUM', 'BI') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_TARJETA,
        COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('POSTDATADO', 'PD', 'POSTDATADOS') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_POSTDATADOS,
        COALESCE(SUM(${amountCol}), 0) AS TOTAL_COBROS_DIA,
        COUNT(*) AS COBROS_COUNT
      FROM JAVIER.REPARTIDOR_COBROS
      WHERE TRIM(${codeColumn}) = ?
        AND ${dateCol} = ?
        AND ${notLiquidated}
    `, [input.repartidorId, dateYmd]));

    const cobroRows = await conn.query(`
      SELECT ID
      FROM JAVIER.REPARTIDOR_COBROS
      WHERE TRIM(${codeColumn}) = ?
        AND ${dateCol} = ?
        AND ${notLiquidated}
      ORDER BY ${orderBy}, ID
    `, [input.repartidorId, dateYmd]);

    const balanceRow = firstRow(await conn.query(`
      SELECT SALDO_PENDIENTE
      FROM JAVIER.REPARTIDOR_FINANCIAL_BALANCES
      WHERE TRIM(${info.balanceCodeColumn}) = ?
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

    const opsInsert = liquidacionOpsInsertStatement(info, {
      idempotencyToken: input.idempotencyToken,
      subempresa,
      year,
      serie,
      terminal,
      numero,
      repartidorId: input.repartidorId,
      totals,
      saldoResultante,
      createdBy: input.createdBy,
    });
    await conn.query(opsInsert.sql, opsInsert.params);

    await conn.query(`
      MERGE INTO JAVIER.REPARTIDOR_FINANCIAL_BALANCES B
      USING (VALUES (?, ?, ?)) AS V(${info.balanceCodeColumn}, SALDO_PENDIENTE, UPDATED_BY)
        ON B.${info.balanceCodeColumn} = V.${info.balanceCodeColumn}
      WHEN MATCHED THEN
        UPDATE SET SALDO_PENDIENTE = V.SALDO_PENDIENTE,
                   UPDATED_BY = V.UPDATED_BY,
                   UPDATED_AT = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT (${info.balanceCodeColumn}, SALDO_PENDIENTE, UPDATED_BY)
        VALUES (V.${info.balanceCodeColumn}, V.SALDO_PENDIENTE, V.UPDATED_BY)
    `, [input.repartidorId, saldoResultante, input.createdBy || 'unknown']);

    if (cobroRows.length > 0) {
      const placeholders = cobroRows.map(() => '?').join(', ');
      const setParts = [];
      const updateParams = [];
      if (info.cobrosHasLiquidado) setParts.push("LIQUIDADO_SN = 'S'");
      if (info.cobrosHasLiquidacionToken) {
        setParts.push('LIQUIDACION_TOKEN = ?');
        updateParams.push(input.idempotencyToken);
      }
      if (info.cobrosHasNumeroLiquidacion) {
        setParts.push('NUMEROLIQUIDACION = ?');
        updateParams.push(numero);
      }
      if (setParts.length > 0) {
        await conn.query(`
          UPDATE JAVIER.REPARTIDOR_COBROS
          SET ${setParts.join(',\n              ')}
          WHERE ID IN (${placeholders})
        `, [
          ...updateParams,
          ...cobroRows.map((row) => value(row, 'ID')),
        ]);
      }
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

async function getCommissionSummaryLegacyUnused({ repartidorId, from, to }) {
  await getCobrosSchemaInfo();
  const dateCol = cobrosDateFilterColumn();

  const deliveredRows = await queryWithParams(`
    SELECT COALESCE(SUM(CPC.IMPORTETOTAL), 0) AS TOTAL_REPARTIDO
    FROM .OPP OPP
    INNER JOIN .CPC CPC
      ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
    WHERE TRIM(OPP.CODIGOREPARTIDOR) = ?
      AND (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) BETWEEN ? AND ?
  `, [repartidorId, compactDate(from), compactDate(to)], false, false);

  const collectedRows = await queryWithParams(`
    SELECT COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL_COBRADO
    FROM JAVIER.REPARTIDOR_COBROS
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
    FROM .OPP OPP
    INNER JOIN .CPC CPC
      ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
    WHERE ${repFilter.sql}
      AND (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) BETWEEN ? AND ?
  `, [...repFilter.params, fromYmd, toYmd], false, false);

  const collectedRows = await queryWithParams(`
    SELECT COALESCE(SUM(CASE
      WHEN COALESCE(CVC.IMPORTEPENDIENTE, 0) = 0
      THEN CPC.IMPORTETOTAL
      ELSE CPC.IMPORTETOTAL - COALESCE(CVC.IMPORTEPENDIENTE, 0)
    END), 0) AS TOTAL_COBRADO
    FROM .OPP OPP
    INNER JOIN .CPC CPC
      ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
    LEFT JOIN .CVC CVC
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
    const dsNew = isDeliveryStatusAvailable() && isDeliveryStatusNewSchema();
    const dsDelCol = dsNew ? 'IDEMPOTENCY_TOKEN' : 'ID';
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
        WHERE ${dsDelCol} = ?
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
