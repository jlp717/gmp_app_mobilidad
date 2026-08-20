'use strict';

const {
  validateConfirmationTableMapping,
  validateFinanceTableMapping,
} = require('../config/reparto-runtime');
const {
  cashToDeposit,
  computeClosingBalance,
  sumCashPayments,
  CASH_METHOD_RE,
  CHEQUE_METHOD_RE,
  CARD_METHOD_RE,
  POSTDATED_METHOD_RE,
} = require('../services/liquidacion-pdf-service');

const MARKER_MAX_LENGTH = 30;
const BASE_TABLE_KEYS = Object.freeze([
  'liquidationOps', 'cobros', 'balances', 'audit', 'expenses', 'adjustments',
  'bankDeposits',
]);
const TABLE_KEYS = Object.freeze([...BASE_TABLE_KEYS, 'liquidationOutbox']);

function column(dataType, length, numericPrecision, numericScale, isNullable, defaultValue = null,
  isIdentity = false) {
  return Object.freeze({
    dataType, length, numericPrecision, numericScale,
    isNullable: isNullable ? 'Y' : 'N',
    hasDefault: isIdentity ? 'I' : (isNullable || defaultValue !== null ? 'Y' : 'N'),
    defaultValue,
    isIdentity: isIdentity ? 'YES' : 'NO',
    identityGeneration: isIdentity ? 'ALWAYS' : null,
    identityStart: isIdentity ? 1 : null,
    identityIncrement: isIdentity ? 1 : null,
  });
}
const char = (length, nullable = false, defaultValue = null) =>
  column('CHAR', length, null, null, nullable, defaultValue);
const varchar = (length, nullable = false, defaultValue = null) =>
  column('VARCHAR', length, null, null, nullable, defaultValue);
const numeric = (precision, scale = 0, nullable = false, defaultValue = null) =>
  column('NUMERIC', precision, precision, scale, nullable, defaultValue);
const decimal = (precision, scale = 0, nullable = false, defaultValue = null) =>
  column('DECIMAL', precision, precision, scale, nullable, defaultValue);
const integer = (nullable = false, defaultValue = null, identity = false) =>
  column('INTEGER', 4, 9, 0, nullable, defaultValue, identity);
const bigint = (nullable = false, defaultValue = null, identity = false) =>
  column('BIGINT', 8, 18, 0, nullable, defaultValue, identity);
const timestampColumn = (nullable = false, defaultValue = null) =>
  column('TIMESTMP', 10, null, null, nullable, defaultValue);
const clob = (length, nullable = true) => column('CLOB', length, null, null, nullable);

const lqdColumns = Object.freeze({
  SUBEMPRESALIQUIDACION: char(3, false, "' '"),
  EJERCICIOLIQUIDACION: numeric(4, 0, false, '0'),
  SERIELIQUIDACION: char(1, false, "' '"),
  TERMINALLIQUIDACION: numeric(3, 0, false, '0'),
  NUMEROLIQUIDACION: numeric(6, 0, false, '0'),
  DIALIQUIDACION: numeric(2, 0, false, '0'),
  MESLIQUIDACION: numeric(2, 0, false, '0'),
  ANOLIQUIDACION: numeric(4, 0, false, '0'),
  HORALIQUIDACION: numeric(6, 0, false, '0'),
  CODIGOVENDEDOR: char(2, false, "' '"),
  CODIGOVENDEDORUSUARIO: char(2, false, "' '"),
  CODIGOUSUARIO: char(10, false, "' '"),
  MATRICULA: char(20, false, "' '"),
  KILOMETROSSALIDA: numeric(11, 3, false, '0'),
  KILOMETROSLLEGADA: numeric(11, 3, false, '0'),
  KILOMETROSRECORRIDOS: numeric(11, 3, false, '0'),
  IMPORTEEFECTIVO: numeric(10, 2, false, '0'),
  IMPORTECHEQUES: numeric(10, 2, false, '0'),
  IMPORTEPOSTDATADOS: numeric(10, 2, false, '0'),
  IMPORTESALDOACTUAL: numeric(10, 2, false, '0'),
  IMPORTETOTALAINGRESAR: numeric(10, 2, false, '0'),
  IMPORTEINGRESOENBANCO: numeric(10, 2, false, '0'),
  IMPORTEGASTOS: numeric(10, 2, false, '0'),
  IMPRESOSN: char(1, false, "' '"),
  CODIGOVEHICULO: char(10, false, "' '"),
  REVISADOSN: char(1, false, "' '"),
  IDMARCALIQUIDACION: char(30, false, "' '"),
  IMPORTEEFECTIVO2: numeric(10, 2, false, '0'),
  IMPORTEENTREGADO2: numeric(10, 2, false, '0'),
  IMPORTETARJETA: numeric(10, 2, false, '0'),
  ID: integer(false, null, true),
  MARCAACTUALIZACION: varchar(50, false, "' '"),
});

const structuredColumns = (detailName, detailLength) => Object.freeze({
  ID: bigint(false, null, true),
  IDEMPOTENCY_TOKEN: varchar(128), CODIGO_REPARTIDOR: char(2),
  DIA: numeric(2), MES: numeric(2), ANO: numeric(4), IMPORTE: decimal(10, 2),
  [detailName]: varchar(detailLength), OBSERVACION: varchar(250, true),
  STATUS: varchar(12, false, "'PENDING'"), LIQUIDACION_ID: bigint(true),
  LIQUIDACION_MARKER: char(30, true), ACTOR_ID: varchar(40), ACTOR_ROLE: varchar(30),
  CREATED_AT: timestampColumn(false, 'CURRENT TIMESTAMP'),
});

const REQUIRED_COLUMN_MANIFEST = Object.freeze({
  liquidationOps: Object.freeze({
    ...lqdColumns,
    IDEMPOTENCY_TOKEN: varchar(128, true),
    REPLAY_IDENTITY_JSON: clob(8192), SNAPSHOT_JSON: clob(65536),
    STATUS: varchar(20, true, "'CLOSED'"), OPERADOR: varchar(50, true, "'system'"),
    PANTALLA_ORIGEN: varchar(20, true, "'LIQUIDACION_DIARIA'"),
    CREATED_AT: timestampColumn(true, 'CURRENT TIMESTAMP'), UPDATED_AT: timestampColumn(true),
  }),
  cobros: Object.freeze({
    ID: integer(false, null, true), CODIGOVENDEDOR: char(2, false, "' '"),
    DIACOBRO: numeric(2, 0, false, '0'), MESCOBRO: numeric(2, 0, false, '0'),
    ANOCOBRO: numeric(4, 0, false, '0'), IMPORTEVENCIMIENTO: numeric(10, 2, false, '0'),
    CODIGOFORMAPAGO: char(2, false, "' '"), CREATED_AT: timestampColumn(true, 'CURRENT TIMESTAMP'),
    LIQUIDADO_SN: char(1, true, "'N'"), LIQUIDACION_TOKEN: varchar(128, true),
    NUMEROLIQUIDACION: numeric(6, 0, false, '0'),
  }),
  balances: Object.freeze({
    CODIGO_REPARTIDOR: varchar(20), SALDO_PENDIENTE: decimal(15, 2, false, '0'),
  }),
  audit: Object.freeze({
    ID: integer(false, null, true), EVENT_TYPE: varchar(40), OPERADOR: varchar(40, true),
    CODIGO_REPARTIDOR: varchar(10, true), PAYLOAD_PREVIEW: varchar(500, true),
    CREATED_AT: timestampColumn(true, 'CURRENT TIMESTAMP'),
  }),
  expenses: structuredColumns('CATEGORIA', 40),
  adjustments: structuredColumns('MOTIVO', 120),
  bankDeposits: structuredColumns('REFERENCIA', 80),
  liquidationOutbox: Object.freeze({
    ID: bigint(false, null, true), LIQUIDACION_ID: bigint(), OUTBOX_TYPE: varchar(50),
    STATUS: varchar(20, false, "'PENDING'"), PAYLOAD_JSON: clob(16384, false),
    CREATED_AT: timestampColumn(false, 'CURRENT TIMESTAMP'),
  }),
  confirmations: Object.freeze({
    ID: bigint(false, null, true), REPARTIDOR_ID: varchar(20), STATUS: varchar(20),
    CONFIRMED_AT: timestampColumn(false, 'CURRENT TIMESTAMP'),
  }),
  lines: Object.freeze({
    CONFIRMACION_ID: bigint(), LINEA_ID: varchar(80),
    CANTIDAD_ENTREGADA: decimal(15, 3), CANTIDAD_PENDIENTE: decimal(15, 3, false, '0'),
    CANTIDAD_RECHAZADA: decimal(15, 3, false, '0'), PRECIO_UNITARIO: decimal(15, 4, true),
    MOTIVO_DIFERENCIA: varchar(80, true),
  }),
});
const REQUIRED_COLUMNS = Object.freeze(Object.fromEntries(
  Object.entries(REQUIRED_COLUMN_MANIFEST).map(([key, manifest]) =>
    [key, Object.freeze(Object.keys(manifest))]),
));

const REQUIRED_CONSTRAINT_SIGNATURES = Object.freeze({
  liquidationOps: Object.freeze(['PRIMARY KEY:ID']),
  cobros: Object.freeze(['PRIMARY KEY:ID']),
  balances: Object.freeze(['PRIMARY KEY:CODIGO_REPARTIDOR']),
  audit: Object.freeze(['PRIMARY KEY:ID']),
  expenses: Object.freeze([
    'PRIMARY KEY:ID', 'UNIQUE:IDEMPOTENCY_TOKEN', 'CHECK:IMPORTE>0',
    "CHECK:STATUSIN('PENDING','LIQUIDATED')",
  ]),
  adjustments: Object.freeze([
    'PRIMARY KEY:ID', 'UNIQUE:IDEMPOTENCY_TOKEN', 'CHECK:IMPORTE<>0',
    "CHECK:STATUSIN('PENDING','LIQUIDATED')",
  ]),
  bankDeposits: Object.freeze([
    'PRIMARY KEY:ID', 'UNIQUE:IDEMPOTENCY_TOKEN', 'CHECK:IMPORTE>0',
    "CHECK:STATUSIN('PENDING','LIQUIDATED')",
  ]),
  liquidationOutbox: Object.freeze([
    'PRIMARY KEY:ID', "CHECK:STATUSIN('PENDING','SENT','FAILED')",
  ]),
  confirmations: Object.freeze([
    'PRIMARY KEY:ID', "CHECK:STATUSIN('ENTREGADO','PARCIAL','NO_ENTREGADO','RECHAZADO')",
  ]),
  lines: Object.freeze(['PRIMARY KEY:CONFIRMACION_ID,LINEA_ID']),
});

const REQUIRED_SEQUENCE_METADATA = Object.freeze({
  DATA_TYPE: 'BIGINT', NUMERIC_PRECISION: '19',
  START: '1', INCREMENT: '1', MINIMUM_VALUE: '1', MAXIMUM_VALUE: '9223372036854775807',
  CYCLE_OPTION: 'NO', CACHE: '20', ORDER_OPTION: 'NO',
});

const REQUIRED_UNIQUE_SIGNATURES = Object.freeze({
  liquidationOps: Object.freeze([
    'IDEMPOTENCY_TOKEN:A', 'IDMARCALIQUIDACION:A',
    'CODIGOVENDEDOR:A,DIALIQUIDACION:A,MESLIQUIDACION:A,ANOLIQUIDACION:A',
  ]),
  expenses: Object.freeze(['IDEMPOTENCY_TOKEN:A']),
  adjustments: Object.freeze(['IDEMPOTENCY_TOKEN:A']),
  bankDeposits: Object.freeze(['IDEMPOTENCY_TOKEN:A']),
});
// DB2-generated index names for PK/UNIQUE constraints are not stable. The
// physical contract is therefore exact by table, uniqueness, ordered columns
// and direction; every expected signature must occur once and no extra index
// signature is accepted.
const REQUIRED_INDEX_SIGNATURES = Object.freeze({
  // Explicit CREATE INDEX only. PK/UNIQUE constraint backing indexes are not
  // reliably present in QSYS2.SYSINDEXES on this IBM i host; those are covered
  // by REQUIRED_CONSTRAINT_SIGNATURES.
  liquidationOps: Object.freeze([
    'U:IDEMPOTENCY_TOKEN:A', 'U:IDMARCALIQUIDACION:A',
    'U:CODIGOVENDEDOR:A,DIALIQUIDACION:A,MESLIQUIDACION:A,ANOLIQUIDACION:A',
  ]),
  cobros: Object.freeze([]),
  balances: Object.freeze([]),
  audit: Object.freeze([]),
  expenses: Object.freeze([
    'D:CODIGO_REPARTIDOR:A,DIA:A,MES:A,ANO:A,STATUS:A',
  ]),
  adjustments: Object.freeze([
    'D:CODIGO_REPARTIDOR:A,DIA:A,MES:A,ANO:A,STATUS:A',
  ]),
  bankDeposits: Object.freeze([
    'D:CODIGO_REPARTIDOR:A,DIA:A,MES:A,ANO:A,STATUS:A',
  ]),
  liquidationOutbox: Object.freeze(['D:STATUS:A,CREATED_AT:A']),
  confirmations: Object.freeze(['U:ID:A']),

  lines: Object.freeze(['U:CONFIRMACION_ID:A,LINEA_ID:A']),
});
const STRUCTURED_ENTRY_TYPES = Object.freeze({
  EXPENSE: Object.freeze({ tableKey: 'expenses', detailColumn: 'CATEGORIA', detailKey: 'category' }),
  ADJUSTMENT: Object.freeze({ tableKey: 'adjustments', detailColumn: 'MOTIVO', detailKey: 'reason' }),
  BANK_DEPOSIT: Object.freeze({ tableKey: 'bankDeposits', detailColumn: 'REFERENCIA', detailKey: 'reference' }),
});

class LiquidacionRepositoryUnavailableError extends Error {
  constructor(message, details, statusCode = 503, code = 'LIQUIDACION_CAPABILITY_UNAVAILABLE') {
    super(message);
    this.name = 'LiquidacionRepositoryUnavailableError';
    this.code = code;
    this.statusCode = statusCode;
    if (details) this.details = details;
  }
}

function rowValue(row, name) {
  return row?.[name] ?? row?.[name.toLowerCase()] ?? row?.[name.toUpperCase()];
}
function first(result) { return Array.isArray(result) && result.length ? result[0] : null; }
function qualifiedParts(identifier) {
  const [schema, object] = String(identifier || '').split('.');
  return { schema, object };
}
function assertConnection(connection) {
  if (!connection || (typeof connection.query !== 'function' && typeof connection.execute !== 'function')) {
    throw new TypeError('DB2 connection must expose query(sql, params) or execute(sql, params)');
  }
  const missing = ['beginTransaction', 'commit', 'rollback']
    .filter((method) => typeof connection[method] !== 'function');
  if (missing.length) {
    throw new LiquidacionRepositoryUnavailableError(
      'La conexion DB2 no permite transacciones explicitas', { missing },
    );
  }
}
async function rows(connection, sql, params = []) {
  const result = typeof connection.query === 'function'
    ? await connection.query(sql, params) : await connection.execute(sql, params);
  return Array.isArray(result) ? result : (result?.rows || []);
}
async function execute(connection, sql, params = []) {
  return typeof connection.query === 'function'
    ? connection.query(sql, params) : connection.execute(sql, params);
}
function affectedRows(result) {
  const value = Number(result?.count ?? result?.rowCount ?? result?.affectedRows);
  return Number.isFinite(value) ? value : null;
}
function json(value) { return JSON.stringify(value); }
function assertMarker(marker) {
  if (typeof marker !== 'string' || marker.length < 1 || marker.length > MARKER_MAX_LENGTH) {
    throw new LiquidacionRepositoryUnavailableError(
      'El marcador de liquidacion no cumple el limite DB2 de 30 caracteres',
    );
  }
}
function assertRuntime(runtime) {
  const mapping = validateFinanceTableMapping(runtime);
  const confirmationMapping = validateConfirmationTableMapping(runtime);
  if (!runtime?.valid || !runtime.writesEnabled || !runtime.financeCapabilityApproved
      || !mapping.valid || !confirmationMapping.valid) {
    throw new LiquidacionRepositoryUnavailableError(
      'El runtime financiero DB2 no esta autorizado', {
        mappingErrors: [...mapping.errors, ...confirmationMapping.errors],
      },
    );
  }
  return Object.freeze({ finance: { ...runtime.tables.finance }, confirmation: { ...runtime.tables.confirmation } });
}
function parsePersistedJson(value, field) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    return parsed;
  } catch (_) {
    throw new LiquidacionRepositoryUnavailableError(`El replay persistido tiene ${field} corrupto`);
  }
}
function normalizeReplay(row) {
  if (!row) return null;
  return Object.freeze({
    id: rowValue(row, 'ID'),
    idempotencyToken: String(rowValue(row, 'IDEMPOTENCY_TOKEN') || '').trim(),
    marker: String(rowValue(row, 'IDMARCALIQUIDACION') || '').trim(),
    status: String(rowValue(row, 'STATUS') || '').trim(),
    replayIdentity: parsePersistedJson(rowValue(row, 'REPLAY_IDENTITY_JSON'), 'REPLAY_IDENTITY_JSON'),
    snapshot: parsePersistedJson(rowValue(row, 'SNAPSHOT_JSON'), 'SNAPSHOT_JSON'),
  });
}
function dateParts(date) {
  const [year, month, day] = String(date).split('-').map(Number);
  return { year, month, day };
}
function timestamp(value) {
  if (value == null || value === '') {
    return new Date().toISOString();
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}
function scalarId(value) {
  if (value == null) return '';
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    if (typeof value.toString === 'function') {
      const text = value.toString();
      if (text && text !== '[object Object]') return text.trim();
    }
    if (value.low != null) return String(value.low);
    return '';
  }
  return String(value).trim();
}
function money(value, field = 'importe') {
  if (value == null || typeof value === 'boolean'
      || (typeof value === 'string' && !value.trim())) {
    throw new LiquidacionRepositoryUnavailableError(`El valor autoritativo ${field} no es valido`);
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    throw new LiquidacionRepositoryUnavailableError(`El valor autoritativo ${field} no es valido`);
  }
  return amount;
}
function uniqueConstraintError(error) {
  const candidates = [error, error?.cause, ...(Array.isArray(error?.odbcErrors) ? error.odbcErrors : [])];
  return candidates.some((item) => {
    const state = String(item?.state || item?.sqlState || '').toUpperCase();
    const code = String(item?.code ?? item?.nativeError ?? '').toUpperCase();
    return state === '23505' || ['SQL0803', '-803', '803'].includes(code);
  });
}
function placeholders(count) { return Array.from({ length: count }, () => '?').join(', '); }
function normalizedDefault(value) {
  if (value === undefined || value === null) return null;
  const compact = String(value).trim().toUpperCase()
    .replace(/CURRENT_TIMESTAMP/g, 'CURRENT TIMESTAMP')
    .replace(/\s+/g, ' ');
  if (/^[+-]?0+(?:\.0+)?$/.test(compact)) return '0';
  return compact;
}
function normalizedConstraintType(value) {
  const type = String(value || '').trim().toUpperCase();
  if (type === 'P' || type === 'PRIMARY KEY') return 'PRIMARY KEY';
  if (type === 'C' || type === 'CHECK') return 'CHECK';
  if (type === 'U' || type === 'UNIQUE') return 'UNIQUE';
  return type;
}
function normalizedCheck(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '')
    .replace(/^CHECK/, '').replace(/^\((.*)\)$/s, '$1');
}
function multisetDifference(source, allowed) {
  const remaining = new Map();
  for (const signature of allowed) remaining.set(signature, (remaining.get(signature) || 0) + 1);
  return source.filter((signature) => {
    const count = remaining.get(signature) || 0;
    if (count < 1) return true;
    remaining.set(signature, count - 1);
    return false;
  });
}
function columnMetadataMismatch(row, expected) {
  const actual = {
    dataType: String(rowValue(row, 'DATA_TYPE') || '').trim().toUpperCase(),
    length: Number(rowValue(row, 'LENGTH')),
    numericPrecision: rowValue(row, 'NUMERIC_PRECISION') == null
      ? null : Number(rowValue(row, 'NUMERIC_PRECISION')),
    numericScale: rowValue(row, 'NUMERIC_SCALE') == null
      ? null : Number(rowValue(row, 'NUMERIC_SCALE')),
    isNullable: String(rowValue(row, 'IS_NULLABLE') || '').trim().toUpperCase()
      .replace(/^YES$/, 'Y').replace(/^NO$/, 'N'),
    hasDefault: String(rowValue(row, 'HAS_DEFAULT') || '').trim().toUpperCase()
      .replace(/^YES$/, 'Y').replace(/^NO$/, 'N'),
    defaultValue: normalizedDefault(rowValue(row, 'COLUMN_DEFAULT')),
    isIdentity: String(rowValue(row, 'IS_IDENTITY') || '').trim().toUpperCase(),
    identityGeneration: rowValue(row, 'IDENTITY_GENERATION') == null
      ? null : String(rowValue(row, 'IDENTITY_GENERATION')).trim().toUpperCase(),
    identityStart: rowValue(row, 'IDENTITY_START') == null
      ? null : Number(rowValue(row, 'IDENTITY_START')),
    identityIncrement: rowValue(row, 'IDENTITY_INCREMENT') == null
      ? null : Number(rowValue(row, 'IDENTITY_INCREMENT')),
  };
  return Object.entries(expected).some(([key, value]) => {
    const normalizedExpected = key === 'defaultValue' ? normalizedDefault(value) : value;
    return actual[key] !== normalizedExpected;
  });
}
function sequenceMetadataMismatches(row) {
  if (!row) return ['missing'];
  return Object.entries(REQUIRED_SEQUENCE_METADATA).filter(([field, expected]) => {
    const raw = rowValue(row, field);
    return String(raw ?? '').trim().toUpperCase() !== String(expected).toUpperCase();
  }).map(([field]) => field);
}

function createRepartidorLiquidacionDb2Repository({ runtime, connectionFactory, logger = console } = {}) {
  const mappings = assertRuntime(runtime);
  if (typeof connectionFactory !== 'function') throw new TypeError('connectionFactory is required');
  const sequence = qualifiedParts(mappings.finance.liquidationSequence);
  // isolated_test keeps a byte-exact catalog contract. Production tables are
  // additive (CVC-shaped cobros, REPARTO_* confirmations with extra columns);
  // require presence + compatible metadata, allow extras/order drift.
  // Byte-exact catalog only in automated NODE_ENV=test. Staging/demo isolated_test
  // keeps required columns but allows additive confirmation/finance columns (033/CVC).
  const catalogMode = runtime?.tableSet === 'isolated_test' && process.env.NODE_ENV === 'test'
    ? 'exact'
    : 'compatible';
  let catalogVerified = false;
  let catalogVerifiedWithOutbox = false;

  function catalogObjects(requiresOutbox) {
    const financeKeys = requiresOutbox ? TABLE_KEYS : BASE_TABLE_KEYS;
    return [
      ...financeKeys.map((key) => ({ key, ...qualifiedParts(mappings.finance[key]) })),
      ...['confirmations', 'lines'].map((key) => ({ key, ...qualifiedParts(mappings.confirmation[key]) })),
    ];
  }

  async function assertCapabilities({ requiredTransactionMethods = [], requiresOutbox = false } = {}) {
    assertRuntime(runtime);
    const known = new Set([
      'getByIdempotencyToken', 'lockDay', 'deriveDaySnapshot', 'insertOperation',
      'markCobrosLiquidated', 'markExpensesLiquidated', 'markAdjustmentsLiquidated',
      'markBankDepositsLiquidated', 'updateBalance', 'appendAudit', 'enqueueEmailOutbox',
      'lockBalance', 'getStructuredEntryByToken', 'isDayClosed',
      'insertStructuredEntry', 'listStructuredEntries',
    ]);
    const missing = requiredTransactionMethods.filter((method) => !known.has(method));
    if (requiresOutbox && !mappings.finance.liquidationOutbox) missing.push('enqueueEmailOutbox');
    if (missing.length) {
      throw new LiquidacionRepositoryUnavailableError('Faltan capacidades del repositorio', { missing });
    }
  }

  async function assertCatalog(connection, requiresOutbox) {
    if (catalogVerified && (!requiresOutbox || catalogVerifiedWithOutbox)) return;
    const requested = catalogObjects(requiresOutbox);
    const predicates = requested.map(() => '(TABLE_SCHEMA = ? AND TABLE_NAME = ?)').join(' OR ');
    const params = requested.flatMap(({ schema, object }) => [schema, object]);
    const tableRows = await rows(connection,
      `SELECT TABLE_SCHEMA, TABLE_NAME FROM QSYS2.SYSTABLES WHERE ${predicates}`, params);
    const foundTables = new Set(tableRows.map((row) =>
      `${rowValue(row, 'TABLE_SCHEMA')}.${rowValue(row, 'TABLE_NAME')}`.toUpperCase()));
    const missingTables = requested
      .filter(({ schema, object }) => !foundTables.has(`${schema}.${object}`))
      .map(({ schema, object }) => `${schema}.${object}`);
    if (missingTables.length) {
      throw new LiquidacionRepositoryUnavailableError(
        'Faltan tablas del manifiesto de liquidacion', { missingTables },
      );
    }

    const columnRows = await rows(connection,
      'SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, LENGTH, NUMERIC_PRECISION, '
        + 'NUMERIC_SCALE, IS_NULLABLE, HAS_DEFAULT, COLUMN_DEFAULT, IS_IDENTITY, IDENTITY_GENERATION, '
        + 'IDENTITY_START, IDENTITY_INCREMENT '
        + `FROM QSYS2.SYSCOLUMNS2 WHERE ${predicates}`,
      params);
    const available = new Map();
    for (const row of columnRows) {
      const object = `${rowValue(row, 'TABLE_SCHEMA')}.${rowValue(row, 'TABLE_NAME')}`.toUpperCase();
      if (!available.has(object)) available.set(object, new Map());
      available.get(object).set(String(rowValue(row, 'COLUMN_NAME')).toUpperCase(), row);
    }
    const missingColumns = requested.flatMap(({ key, schema, object }) =>
      REQUIRED_COLUMNS[key].filter((column) => !available.get(`${schema}.${object}`)?.has(column))
        .map((column) => `${schema}.${object}.${column}`));
    if (missingColumns.length) {
      throw new LiquidacionRepositoryUnavailableError(
        'Faltan columnas del manifiesto de liquidacion', { missingColumns },
      );
    }
    const unexpectedColumns = requested.flatMap(({ key, schema, object }) => {
      const expected = new Set(REQUIRED_COLUMNS[key]);
      return [...(available.get(`${schema}.${object}`)?.keys() || [])]
        .filter((name) => !expected.has(name))
        .map((name) => `${schema}.${object}.${name}`);
    });
    if (catalogMode === 'exact' && unexpectedColumns.length) {
      throw new LiquidacionRepositoryUnavailableError(
        'El catalogo contiene columnas fuera del manifiesto de liquidacion', { unexpectedColumns },
      );
    }
    const mismatchedColumns = requested.flatMap(({ key, schema, object }) => {
      const objectColumns = available.get(`${schema}.${object}`);
      return Object.entries(REQUIRED_COLUMN_MANIFEST[key])
        .filter(([name, expected], index) => {
          const row = objectColumns.get(name);
          if (!row) return true;
          if (catalogMode === 'exact'
            && Number(rowValue(row, 'ORDINAL_POSITION')) !== index + 1) {
            return true;
          }
          return columnMetadataMismatch(row, expected);
        })
        .map(([name]) => `${schema}.${object}.${name}`);
    });
    if (mismatchedColumns.length) {
      throw new LiquidacionRepositoryUnavailableError(
        'La metadata fisica no coincide con el manifiesto de liquidacion', { mismatchedColumns },
      );
    }

    const constraintPredicates = requested
      .map(() => '(X.TABLE_SCHEMA = ? AND X.TABLE_NAME = ?)').join(' OR ');
    const constraintRows = await rows(connection,
      'SELECT X.TABLE_SCHEMA, X.TABLE_NAME, X.CONSTRAINT_NAME, X.CONSTRAINT_TYPE, '
        + 'COALESCE(MIN(CAST(C.CHECK_CLAUSE AS VARCHAR(4096))), \'\') AS CHECK_CONDITION, '
        + "COALESCE(LISTAGG(K.COLUMN_NAME, ',') WITHIN GROUP (ORDER BY K.ORDINAL_POSITION), '') AS KEY_COLUMNS "
        + 'FROM QSYS2.SYSCST X '
        + 'LEFT JOIN QSYS2.SYSKEYCST K '
        + 'ON K.CONSTRAINT_SCHEMA = X.CONSTRAINT_SCHEMA AND K.CONSTRAINT_NAME = X.CONSTRAINT_NAME '
        + 'LEFT JOIN QSYS2.SYSCHKCST C '
        + 'ON C.CONSTRAINT_SCHEMA = X.CONSTRAINT_SCHEMA AND C.CONSTRAINT_NAME = X.CONSTRAINT_NAME '
        + `WHERE ${constraintPredicates} `
        + 'GROUP BY X.TABLE_SCHEMA, X.TABLE_NAME, X.CONSTRAINT_NAME, X.CONSTRAINT_TYPE', params);
    const actualConstraints = new Map();
    for (const row of constraintRows) {
      const object = `${rowValue(row, 'TABLE_SCHEMA')}.${rowValue(row, 'TABLE_NAME')}`.toUpperCase();
      if (!actualConstraints.has(object)) actualConstraints.set(object, []);
      const type = normalizedConstraintType(rowValue(row, 'CONSTRAINT_TYPE'));
      const value = type === 'CHECK'
        ? normalizedCheck(rowValue(row, 'CHECK_CONDITION'))
        : String(rowValue(row, 'KEY_COLUMNS') || '').trim().toUpperCase();
      actualConstraints.get(object).push(`${type}:${value}`);
    }
    const missingConstraints = requested.flatMap(({ key, schema, object }) => {
      const actual = actualConstraints.get(`${schema}.${object}`) || [];
      return (REQUIRED_CONSTRAINT_SIGNATURES[key] || [])
        .filter((signature) => !actual.includes(signature))
        .map((signature) => `${schema}.${object}:${signature}`);
    });
    if (missingConstraints.length) {
      throw new LiquidacionRepositoryUnavailableError(
        'Faltan constraints exactos de liquidacion', { missingConstraints },
      );
    }
    const unexpectedConstraints = requested.flatMap(({ key, schema, object }) => {
      const actual = actualConstraints.get(`${schema}.${object}`) || [];
      return multisetDifference(actual, REQUIRED_CONSTRAINT_SIGNATURES[key] || [])
        .map((signature) => `${schema}.${object}:${signature}`);
    });
    if (unexpectedConstraints.length && catalogMode === 'exact') {
      throw new LiquidacionRepositoryUnavailableError(
        'El catalogo contiene constraints fuera del manifiesto de liquidacion',
        { unexpectedConstraints },
      );
    }

    const indexedObjects = requested;
    const indexPredicates = indexedObjects
      .map(() => '(I.TABLE_SCHEMA = ? AND I.TABLE_NAME = ?)').join(' OR ');
    const indexRows = await rows(connection,
      'SELECT I.TABLE_SCHEMA, I.TABLE_NAME, I.INDEX_NAME, I.IS_UNIQUE, K.COLUMN_NAME, '
        + 'K.ORDINAL_POSITION, K.ORDERING '
        + 'FROM QSYS2.SYSINDEXES I INNER JOIN QSYS2.SYSKEYS K '
        + 'ON K.INDEX_SCHEMA = I.INDEX_SCHEMA AND K.INDEX_NAME = I.INDEX_NAME '
        + `WHERE ${indexPredicates} ORDER BY I.TABLE_SCHEMA, I.TABLE_NAME, I.INDEX_NAME, K.ORDINAL_POSITION`,
      indexedObjects.flatMap(({ schema, object }) => [schema, object]));
    const signatures = new Map();
    for (const row of indexRows) {
      const rawUniqueFlag = String(rowValue(row, 'IS_UNIQUE')).trim().toUpperCase();
      const uniqueFlag = ['YES', 'U'].includes(rawUniqueFlag) ? 'U'
        : ['NO', 'D'].includes(rawUniqueFlag) ? 'D' : rawUniqueFlag;
      const name = `${rowValue(row, 'TABLE_SCHEMA')}.${rowValue(row, 'TABLE_NAME')}.${rowValue(row, 'INDEX_NAME')}`;
      if (!signatures.has(name)) signatures.set(name, { uniqueFlag, columns: [] });
      const signature = signatures.get(name);
      if (signature.uniqueFlag !== uniqueFlag) signature.uniqueFlag = 'MIXED';
      const ordering = String(rowValue(row, 'ORDERING') || '').trim().toUpperCase() || 'A';
      signature.columns.push(`${String(rowValue(row, 'COLUMN_NAME')).toUpperCase()}:${ordering}`);
    }
    const actualIndexes = new Map();
    for (const [name, signature] of signatures.entries()) {
      const object = name.slice(0, name.lastIndexOf('.'));
      if (!actualIndexes.has(object)) actualIndexes.set(object, []);
      actualIndexes.get(object).push(`${signature.uniqueFlag}:${signature.columns.join(',')}`);
    }
    const missingIndexes = indexedObjects.flatMap(({ key, schema, object }) => {
      const actual = actualIndexes.get(`${schema}.${object}`) || [];
      let required = REQUIRED_INDEX_SIGNATURES[key] || [];
      // On IBM i, PRIMARY KEY uniqueness often does not appear in SYSINDEXES.
      // Compatible production catalogs treat those U: signatures as covered by PK.
      if (catalogMode === 'compatible') {
        const pkCols = new Set(
          (REQUIRED_CONSTRAINT_SIGNATURES[key] || [])
            .filter((signature) => signature.startsWith('PRIMARY KEY:'))
            .map((signature) => signature.slice('PRIMARY KEY:'.length)),
        );
        required = required.filter((signature) => {
          if (!signature.startsWith('U:')) return true;
          const cols = signature.slice(2).split(',').map((part) => part.split(':')[0]).join(',');
          return !pkCols.has(cols);
        });
      }
      return multisetDifference(required, actual)
        .map((signature) => `${schema}.${object}:${signature}`);
    });
    const missingUniqueIndexes = missingIndexes
      .filter((signature) => signature.includes(':U:'))
      .map((signature) => signature.replace(':U:', ':'));
    if (missingIndexes.length) {
      throw new LiquidacionRepositoryUnavailableError(
        'Faltan indices exactos de liquidacion', { missingIndexes, missingUniqueIndexes },
      );
    }
    const unexpectedIndexes = indexedObjects.flatMap(({ key, schema, object }) => {
      const actual = actualIndexes.get(`${schema}.${object}`) || [];
      return multisetDifference(actual, REQUIRED_INDEX_SIGNATURES[key] || [])
        .map((signature) => `${schema}.${object}:${signature}`);
    });
    if (unexpectedIndexes.length && catalogMode === 'exact') {
      throw new LiquidacionRepositoryUnavailableError(
        'El catalogo contiene indices fuera del manifiesto de liquidacion', { unexpectedIndexes },
      );
    }

    const sequenceRows = await rows(connection,
      'SELECT SEQUENCE_SCHEMA, SEQUENCE_NAME, DATA_TYPE, '
        + 'CAST(NUMERIC_PRECISION AS VARCHAR(32)) AS NUMERIC_PRECISION, '
        + 'CAST(START AS VARCHAR(64)) AS START, '
        + 'CAST(INCREMENT AS VARCHAR(64)) AS INCREMENT, '
        + 'CAST(MINIMUM_VALUE AS VARCHAR(64)) AS MINIMUM_VALUE, '
        + 'CAST(MAXIMUM_VALUE AS VARCHAR(64)) AS MAXIMUM_VALUE, '
        + 'CYCLE_OPTION, CAST(CACHE AS VARCHAR(32)) AS CACHE, '
        + '"ORDER" AS ORDER_OPTION '
        + 'FROM QSYS2.SYSSEQUENCES '
        + 'WHERE SEQUENCE_SCHEMA = ? AND SEQUENCE_NAME = ?', [sequence.schema, sequence.object]);
    const sequenceMismatches = sequenceMetadataMismatches(first(sequenceRows));
    if (sequenceMismatches.length) {
      throw new LiquidacionRepositoryUnavailableError(
        'La secuencia canonica no coincide con el manifiesto', {
          sequence: mappings.finance.liquidationSequence, sequenceMismatches,
        },
      );
    }
    catalogVerified = true;
    if (requiresOutbox) catalogVerifiedWithOutbox = true;
  }

  function transaction(connection) {
    const finance = mappings.finance;
    const confirmation = mappings.confirmation;

    async function markExact({ table, repartidorId, date, ids, marker, operationId }) {
      assertMarker(marker);
      if (!Array.isArray(ids) || new Set(ids.map(String)).size !== ids.length) {
        throw new LiquidacionRepositoryUnavailableError('Los identificadores a liquidar deben ser exactos y unicos');
      }
      if (!ids.length) return;
      const { year, month, day } = dateParts(date);
      const result = await execute(connection,
        `UPDATE ${table} SET STATUS = ?, LIQUIDACION_ID = ?, LIQUIDACION_MARKER = ? `
          + `WHERE CODIGO_REPARTIDOR = ? AND DIA = ? AND MES = ? AND ANO = ? `
          + `AND STATUS = ? AND ID IN (${placeholders(ids.length)})`,
        ['LIQUIDATED', operationId, marker, repartidorId, day, month, year, 'PENDING', ...ids]);
      const affected = affectedRows(result);
      if (affected !== ids.length) {
        throw new LiquidacionRepositoryUnavailableError(
          'No se pudieron marcar exactamente las filas derivadas', { expected: ids.length, affected },
        );
      }
    }

    function entryType(type) {
      const config = STRUCTURED_ENTRY_TYPES[type];
      if (!config) throw new LiquidacionRepositoryUnavailableError('Tipo de entrada de liquidacion no permitido');
      return Object.freeze({ ...config, table: finance[config.tableKey] });
    }

    function structuredEntry(row, type) {
      if (!row) return null;
      const config = entryType(type);
      const year = Number(rowValue(row, 'ANO'));
      const month = Number(rowValue(row, 'MES'));
      const day = Number(rowValue(row, 'DIA'));
      const date = Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)
        ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        : '';
      return Object.freeze({
        id: scalarId(rowValue(row, 'ID')), type,
        repartidorId: String(rowValue(row, 'CODIGO_REPARTIDOR') || '').trim(),
        date, amount: money(rowValue(row, 'IMPORTE')),
        [config.detailKey]: String(rowValue(row, config.detailColumn) || '').trim(),
        observation: String(rowValue(row, 'OBSERVACION') || '').trim() || undefined,
        status: String(rowValue(row, 'STATUS') || '').trim(),
        createdAt: timestamp(rowValue(row, 'CREATED_AT')),
      });
    }

    function structuredSelect(config) {
      return `SELECT CAST(ID AS VARCHAR(20)) AS ID, CODIGO_REPARTIDOR, DIA, MES, ANO, IMPORTE, ${config.detailColumn}, `
        + `OBSERVACION, STATUS, CREATED_AT FROM ${config.table}`;
    }

    async function dayClosed({ repartidorId, date }) {
      const { year, month, day } = dateParts(date);
      return Boolean(first(await rows(connection,
        `SELECT ID FROM ${finance.liquidationOps} WHERE CODIGOVENDEDOR = ? `
          + 'AND DIALIQUIDACION = ? AND MESLIQUIDACION = ? AND ANOLIQUIDACION = ? '
          + "AND STATUS = 'CLOSED' FETCH FIRST 1 ROW ONLY WITH RS",
        [repartidorId, day, month, year])));
    }

    return Object.freeze({
      async getByIdempotencyToken(token) {
        return normalizeReplay(first(await rows(connection,
          `SELECT ID, IDEMPOTENCY_TOKEN, IDMARCALIQUIDACION, STATUS, `
            + `REPLAY_IDENTITY_JSON, SNAPSHOT_JSON FROM ${finance.liquidationOps} `
            + 'WHERE IDEMPOTENCY_TOKEN = ? FETCH FIRST 1 ROW ONLY WITH RS', [token])));
      },
      async lockBalance({ repartidorId }) {
        const balance = first(await rows(connection,
          `SELECT SALDO_PENDIENTE FROM ${finance.balances} `
            + 'WHERE CODIGO_REPARTIDOR = ? FOR UPDATE WITH RS', [repartidorId]));
        if (!balance) {
          throw new LiquidacionRepositoryUnavailableError(
            'No existe el saldo autoritativo del repartidor', { repartidorId },
          );
        }
        return Object.freeze({ saldo: money(rowValue(balance, 'SALDO_PENDIENTE')) });
      },
      async getStructuredEntryByToken({ type, idempotencyToken }) {
        const config = entryType(type);
        return structuredEntry(first(await rows(connection,
          `${structuredSelect(config)} WHERE IDEMPOTENCY_TOKEN = ? FETCH FIRST 1 ROW ONLY WITH RS`,
          [idempotencyToken])), type);
      },
      async isDayClosed({ repartidorId, date }) {
        return dayClosed({ repartidorId, date });
      },
      async insertStructuredEntry(input) {
        const config = entryType(input.type);
        const { year, month, day } = dateParts(input.date);
        await execute(connection,
          `INSERT INTO ${config.table} (IDEMPOTENCY_TOKEN, CODIGO_REPARTIDOR, DIA, MES, ANO, `
            + `IMPORTE, ${config.detailColumn}, OBSERVACION, STATUS, ACTOR_ID, ACTOR_ROLE) `
            + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [input.idempotencyToken, input.repartidorId, day, month, year, input.amount,
            input[config.detailKey], input.observation || null, 'PENDING', input.actorId, input.actorRole]);
        const identity = first(await rows(connection,
          'SELECT IDENTITY_VAL_LOCAL() AS ID FROM SYSIBM.SYSDUMMY1'));
        const id = rowValue(identity, 'ID');
        if (id == null) {
          throw new LiquidacionRepositoryUnavailableError('DB2 no devolvio el identificador de entrada');
        }
        return structuredEntry(first(await rows(connection,
          `${structuredSelect(config)} WHERE ID = ? FETCH FIRST 1 ROW ONLY WITH RS`, [id])), input.type);
      },
      async listStructuredEntries({ repartidorId, repartidorIds, date }) {
        const owners = [...new Set((Array.isArray(repartidorIds)
          ? repartidorIds : String(repartidorId || '').split(','))
          .map((item) => String(item || '').trim()).filter(Boolean))];
        if (!owners.length || owners.length > 100 || owners.some((item) => !/^\d{1,20}$/.test(item))) {
          throw new LiquidacionRepositoryUnavailableError('Selector de repartidores invalido');
        }
        const { year, month, day } = dateParts(date);
        const ownerPlaceholders = placeholders(owners.length);
        const params = [...owners, day, month, year];
        const list = async (type) => {
          const config = entryType(type);
          return (await rows(connection,
            `${structuredSelect(config)} WHERE TRIM(CODIGO_REPARTIDOR) IN (${ownerPlaceholders}) `
              + 'AND DIA = ? AND MES = ? AND ANO = ? ORDER BY CODIGO_REPARTIDOR, ID WITH RS',
            params)).map((row) => structuredEntry(row, type));
        };
        const expenses = await list('EXPENSE');
        const adjustments = await list('ADJUSTMENT');
        const bankDeposits = await list('BANK_DEPOSIT');
        const closedRows = await rows(connection,
          `SELECT COUNT(DISTINCT TRIM(CODIGOVENDEDOR)) AS CLOSED_COUNT FROM ${finance.liquidationOps} `
            + `WHERE TRIM(CODIGOVENDEDOR) IN (${ownerPlaceholders}) AND DIALIQUIDACION = ? `
            + "AND MESLIQUIDACION = ? AND ANOLIQUIDACION = ? AND STATUS = 'CLOSED' WITH RS",
          params);
        const closed = Number(rowValue(first(closedRows), 'CLOSED_COUNT')) === owners.length;
        return Object.freeze({ closed, expenses, adjustments, bankDeposits });
      },
      async lockDay({ repartidorId, date }) {
        const { year, month, day } = dateParts(date);
        return first(await rows(connection,
          `SELECT ID FROM ${finance.liquidationOps} WHERE CODIGOVENDEDOR = ? `
            + 'AND DIALIQUIDACION = ? AND MESLIQUIDACION = ? AND ANOLIQUIDACION = ? '
            + 'AND STATUS = ? FETCH FIRST 1 ROW ONLY FOR UPDATE WITH RS',
          [repartidorId, day, month, year, 'CLOSED'])) || null;
      },
      async deriveDaySnapshot({ repartidorId, date }) {
        const { year, month, day } = dateParts(date);
        const balanceRow = first(await rows(connection,
          `SELECT SALDO_PENDIENTE FROM ${finance.balances} WHERE CODIGO_REPARTIDOR = ? FOR UPDATE WITH RS`,
          [repartidorId]));
        if (!balanceRow) {
          throw new LiquidacionRepositoryUnavailableError('No existe el saldo inicial autoritativo del repartidor');
        }
        const deliveryRows = await rows(connection,
          `SELECT C.ID, C.STATUS, `
            + 'SUM(L.CANTIDAD_ENTREGADA * L.PRECIO_UNITARIO) AS IMPORTE_ENTREGADO, '
            + 'SUM((L.CANTIDAD_PENDIENTE + L.CANTIDAD_RECHAZADA) * L.PRECIO_UNITARIO) AS IMPORTE_PENDIENTE, '
            + 'SUM(CASE WHEN L.LINEA_ID IS NOT NULL AND L.PRECIO_UNITARIO IS NULL THEN 1 ELSE 0 END) AS PRECIOS_NULOS, '
            + 'COUNT(L.LINEA_ID) AS LINEAS '
            + `FROM ${confirmation.confirmations} C LEFT JOIN ${confirmation.lines} L ON L.CONFIRMACION_ID = C.ID `
            + 'WHERE C.REPARTIDOR_ID = ? AND DATE(C.CONFIRMED_AT) = ? '
            + 'GROUP BY C.ID, C.STATUS ORDER BY C.ID WITH RS', [repartidorId, date]);
        const paymentRows = await rows(connection,
          `SELECT ID, IMPORTEVENCIMIENTO, CODIGOFORMAPAGO, CREATED_AT, `
            + 'CODIGOCLIENTEALBARAN, TIPODOCUMENTO, SERIEDOCUMENTO, TERMINALDOCUMENTO, NUMERODOCUMENTO '
            + `FROM ${finance.cobros} `
            + 'WHERE CODIGOVENDEDOR = ? AND DIACOBRO = ? AND MESCOBRO = ? AND ANOCOBRO = ? '
            + "AND COALESCE(LIQUIDADO_SN, 'N') <> 'S' ORDER BY ID FOR UPDATE WITH RS",
          [repartidorId, day, month, year]);
        const expenseRows = await rows(connection,
          `SELECT ID, IMPORTE, CATEGORIA FROM ${finance.expenses} WHERE CODIGO_REPARTIDOR = ? `
            + "AND DIA = ? AND MES = ? AND ANO = ? AND STATUS = 'PENDING' ORDER BY ID FOR UPDATE WITH RS",
          [repartidorId, day, month, year]);
        const adjustmentRows = await rows(connection,
          `SELECT ID, IMPORTE, MOTIVO FROM ${finance.adjustments} WHERE CODIGO_REPARTIDOR = ? `
            + "AND DIA = ? AND MES = ? AND ANO = ? AND STATUS = 'PENDING' ORDER BY ID FOR UPDATE WITH RS",
          [repartidorId, day, month, year]);
        const depositRows = await rows(connection,
          `SELECT ID, IMPORTE FROM ${finance.bankDeposits} WHERE CODIGO_REPARTIDOR = ? `
            + "AND DIA = ? AND MES = ? AND ANO = ? AND STATUS = 'PENDING' ORDER BY ID FOR UPDATE WITH RS",
          [repartidorId, day, month, year]);
        const statusMap = Object.freeze({
          ENTREGADO: 'ENTREGADA', PARCIAL: 'PARCIAL', NO_ENTREGADO: 'NO_REALIZADA', RECHAZADO: 'RECHAZADA',
        });
        const deliveries = deliveryRows.map((row) => {
          if (!Number.isInteger(Number(rowValue(row, 'LINEAS'))) || Number(rowValue(row, 'LINEAS')) < 1) {
            throw new LiquidacionRepositoryUnavailableError('Hay confirmaciones autoritativas sin lineas');
          }
          if (Number(rowValue(row, 'PRECIOS_NULOS')) > 0) {
            throw new LiquidacionRepositoryUnavailableError('Hay lineas confirmadas sin precio autoritativo');
          }
          return {
            id: rowValue(row, 'ID'), status: statusMap[String(rowValue(row, 'STATUS')).trim()],
            amount: money(rowValue(row, 'IMPORTE_ENTREGADO')),
            pendingAmount: money(rowValue(row, 'IMPORTE_PENDIENTE')),
          };
        });
        const payments = paymentRows.map((row) => ({
          id: rowValue(row, 'ID'), amount: money(rowValue(row, 'IMPORTEVENCIMIENTO')),
          paymentMethod: String(rowValue(row, 'CODIGOFORMAPAGO') || '').trim(),
          collectedAt: timestamp(rowValue(row, 'CREATED_AT')),
          codigoCliente: String(rowValue(row, 'CODIGOCLIENTEALBARAN') || '').trim(),
          tipoDocumento: String(rowValue(row, 'TIPODOCUMENTO') || '').trim(),
          documento: [
            String(rowValue(row, 'TIPODOCUMENTO') || '').trim(),
            String(rowValue(row, 'SERIEDOCUMENTO') || '').trim(),
            String(rowValue(row, 'TERMINALDOCUMENTO') || '').trim(),
            String(rowValue(row, 'NUMERODOCUMENTO') || '').trim(),
          ].filter(Boolean).join(' '),
        }));
        const expenses = expenseRows.map((row) => ({
          id: rowValue(row, 'ID'), amount: money(rowValue(row, 'IMPORTE')),
          category: String(rowValue(row, 'CATEGORIA') || '').trim(),
        }));
        const adjustments = adjustmentRows.map((row) => {
          const signedAmount = money(rowValue(row, 'IMPORTE'));
          return { id: rowValue(row, 'ID'), amount: Math.abs(signedAmount), signedAmount,
            reason: String(rowValue(row, 'MOTIVO') || '').trim() };
        });
        const bankDeposits = depositRows.map((row) => ({
          id: rowValue(row, 'ID'), amount: money(rowValue(row, 'IMPORTE')),
        }));
        const pending = deliveries.filter((delivery) => delivery.pendingAmount > 0)
          .map((delivery) => ({ id: delivery.id, amount: delivery.pendingAmount, reason: delivery.status }));
        const sum = (items, field = 'amount') => items.reduce((total, item) => total + item[field], 0);
        const openingBalance = money(rowValue(balanceRow, 'SALDO_PENDIENTE'));
        const breakdown = {
          deliveries: sum(deliveries), payments: sum(payments), expenses: sum(expenses),
          adjustments: sum(adjustments, 'signedAmount'), bankDeposits: sum(bankDeposits),
          pending: sum(pending),
        };
        const balance = computeClosingBalance({
          openingBalance,
          cashPayments: sumCashPayments(payments),
          expenses: breakdown.expenses,
          adjustments: breakdown.adjustments,
          bankDeposits: breakdown.bankDeposits,
        });
        return { repartidorId, date, deliveries, payments, expenses, adjustments,
          bankDeposits, pending, openingBalance, breakdown, balance };
      },
      async insertOperation(input) {
        assertMarker(input.marker);
        const { year, month, day } = dateParts(input.date);
        const byMethod = (pattern) => input.snapshot.payments
          .filter((payment) => pattern.test(payment.paymentMethod)).reduce((sum, payment) => sum + payment.amount, 0);
        const cash = byMethod(CASH_METHOD_RE);
        const cheques = byMethod(CHEQUE_METHOD_RE);
        const cards = byMethod(CARD_METHOD_RE);
        const postdated = byMethod(POSTDATED_METHOD_RE);
        const classifiedPayments = cash + cheques + cards + postdated;
        if (Math.abs(classifiedPayments - input.snapshot.breakdown.payments) > 0.00001) {
          throw new LiquidacionRepositoryUnavailableError(
            'Hay formas de pago autoritativas sin clasificacion LQD',
          );
        }
        // Solo efectivo entra en ingreso banco / arrastre de deuda.
        const totalToDeposit = cashToDeposit({
          totalEfectivo: cash,
          saldoActual: input.snapshot.openingBalance,
          gastos: input.snapshot.breakdown.expenses,
          ajustes: input.snapshot.breakdown.adjustments,
        });
        await execute(connection,
          `INSERT INTO ${finance.liquidationOps} (`
            + 'IDEMPOTENCY_TOKEN, IDMARCALIQUIDACION, CODIGOVENDEDOR, DIALIQUIDACION, MESLIQUIDACION, '
            + 'ANOLIQUIDACION, NUMEROLIQUIDACION, MATRICULA, CODIGOVEHICULO, IMPORTEEFECTIVO, '
            + 'IMPORTECHEQUES, IMPORTEPOSTDATADOS, IMPORTETARJETA, IMPORTESALDOACTUAL, '
            + 'IMPORTETOTALAINGRESAR, IMPORTEINGRESOENBANCO, IMPORTEGASTOS, IMPORTEEFECTIVO2, '
            + 'IMPORTEENTREGADO2, REPLAY_IDENTITY_JSON, SNAPSHOT_JSON, STATUS, OPERADOR, PANTALLA_ORIGEN, UPDATED_AT) '
            + `VALUES (?, ?, ?, ?, ?, ?, NEXT VALUE FOR ${mappings.finance.liquidationSequence}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT TIMESTAMP)`,
          [input.idempotencyToken, input.marker, input.repartidorId, day, month, year,
            input.matricula || '', input.codigoVehiculo || '', cash, cheques, postdated, cards,
            input.snapshot.openingBalance, totalToDeposit, input.snapshot.breakdown.bankDeposits,
            input.snapshot.breakdown.expenses, cash, input.snapshot.breakdown.deliveries,
            json(input.replayIdentity), json(input.snapshot), 'CLOSED',
            `${input.actorId}:${input.actorRole}`, 'RUTERO']);
        const identity = first(await rows(connection,
          'SELECT IDENTITY_VAL_LOCAL() AS ID FROM SYSIBM.SYSDUMMY1'));
        const id = rowValue(identity, 'ID');
        if (id == null) throw new LiquidacionRepositoryUnavailableError('DB2 no devolvio el identificador de OPS');
        const operation = first(await rows(connection,
          `SELECT NUMEROLIQUIDACION FROM ${finance.liquidationOps} WHERE ID = ?`, [id]));
        const numeroLiquidacion = rowValue(operation, 'NUMEROLIQUIDACION');
        if (numeroLiquidacion == null) {
          throw new LiquidacionRepositoryUnavailableError('DB2 no devolvio el numero de liquidacion');
        }
        return Object.freeze({ id, numeroLiquidacion });
      },
      async markCobrosLiquidated({ repartidorId, date, cobroIds, marker, numeroLiquidacion }) {
        assertMarker(marker);
        if (!Array.isArray(cobroIds) || new Set(cobroIds.map(String)).size !== cobroIds.length) {
          throw new LiquidacionRepositoryUnavailableError('Los identificadores de cobro deben ser exactos y unicos');
        }
        if (!cobroIds.length) return;
        const { year, month, day } = dateParts(date);
        const result = await execute(connection,
          `UPDATE ${finance.cobros} SET LIQUIDADO_SN = ?, LIQUIDACION_TOKEN = ?, NUMEROLIQUIDACION = ? `
            + 'WHERE CODIGOVENDEDOR = ? AND DIACOBRO = ? AND MESCOBRO = ? AND ANOCOBRO = ? '
            + `AND COALESCE(LIQUIDADO_SN, ?) <> ? AND ID IN (${placeholders(cobroIds.length)})`,
          ['S', marker, numeroLiquidacion, repartidorId, day, month, year, 'N', 'S', ...cobroIds]);
        const affected = affectedRows(result);
        if (affected === cobroIds.length) return;
        throw new LiquidacionRepositoryUnavailableError(
          'No se pudieron marcar exactamente los cobros derivados', { expected: cobroIds.length, affected },
        );
      },
      markExpensesLiquidated(input) { return markExact({ ...input, table: finance.expenses }); },
      markAdjustmentsLiquidated(input) { return markExact({ ...input, table: finance.adjustments }); },
      markBankDepositsLiquidated(input) { return markExact({ ...input, table: finance.bankDeposits }); },
      async updateBalance({ repartidorId, snapshot }) {
        const result = await execute(connection,
          `UPDATE ${finance.balances} SET SALDO_PENDIENTE = ? WHERE CODIGO_REPARTIDOR = ?`,
          [snapshot.balance, repartidorId]);
        if (affectedRows(result) !== 1) {
          throw new LiquidacionRepositoryUnavailableError('No se pudo actualizar exactamente el saldo autoritativo');
        }
      },
      async appendAudit(input) {
        await execute(connection,
          `INSERT INTO ${finance.audit} (EVENT_TYPE, OPERADOR, CODIGO_REPARTIDOR, PAYLOAD_PREVIEW) `
            + 'VALUES (?, ?, ?, ?)',
          [input.event, `${input.actorId}:${input.actorRole}`, input.repartidorId,
            json({ date: input.date, operationId: input.operationId, marker: input.marker })]);
      },
      async enqueueEmailOutbox(intent) {
        await execute(connection,
          `INSERT INTO ${finance.liquidationOutbox} `
            + '(LIQUIDACION_ID, OUTBOX_TYPE, STATUS, PAYLOAD_JSON) VALUES (?, ?, ?, ?)',
          [intent.liquidacionId, intent.type, 'PENDING', json(intent)]);
        const idRows = await execute(connection,
          'SELECT IDENTITY_VAL_LOCAL() AS OUTBOX_ID FROM SYSIBM.SYSDUMMY1');
        const outboxId = idRows?.[0]?.OUTBOX_ID ?? idRows?.[0]?.outbox_id ?? null;
        return outboxId == null ? null : Number(outboxId);
      },
    });
  }

  async function withTransaction(work, { requiresOutbox = false } = {}) {
    const connection = await connectionFactory();
    let committed = false;
    let primaryError = null;
    try {
      assertConnection(connection);
      await assertCatalog(connection, requiresOutbox);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let active = false;
        try {
          await connection.beginTransaction();
          active = true;
          const result = await work(transaction(connection));
          await connection.commit();
          active = false;
          committed = true;
          return result;
        } catch (error) {
          if (active) {
            try { await connection.rollback(); } catch (rollbackError) {
              logger.error?.('liquidacion rollback failed', { code: rollbackError?.code || null });
            }
          }
          if (attempt === 0 && uniqueConstraintError(error)) continue;
          if (uniqueConstraintError(error)) {
            throw new LiquidacionRepositoryUnavailableError(
              'Conflicto concurrente al cerrar la liquidacion', null, 409,
              'LIQUIDACION_DAY_ALREADY_CLOSED',
            );
          }
          throw error;
        }
      }
      throw new LiquidacionRepositoryUnavailableError('No se pudo completar la liquidacion');
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      try { await connection.close?.(); } catch (closeError) {
        logger.warn?.('liquidacion connection close failed', { code: closeError?.code || null });
        if (!committed && !primaryError) throw closeError;
      }
    }
  }

  async function verifyCatalogReadOnly({ requiresOutbox = true } = {}) {
    const connection = await connectionFactory();
    let primaryError = null;
    try {
      assertConnection(connection);
      await assertCatalog(connection, requiresOutbox);
      return Object.freeze({ catalogVerified: true, requiresOutbox });
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      try {
        await connection?.close?.();
      } catch (closeError) {
        logger.warn?.('liquidacion catalog connection close failed', {
          code: closeError?.code || null,
        });
        if (!primaryError) {
          throw new LiquidacionRepositoryUnavailableError(
            'No se pudo cerrar la conexion de verificacion del catalogo',
            { code: closeError?.code || null },
          );
        }
      }
    }
  }

  return Object.freeze({
    assertCapabilities, verifyCatalogReadOnly, withTransaction,
    get catalogVerified() { return catalogVerified; },
  });
}

module.exports = {
  MARKER_MAX_LENGTH, REQUIRED_COLUMNS, REQUIRED_COLUMN_MANIFEST,
  REQUIRED_CONSTRAINT_SIGNATURES, REQUIRED_UNIQUE_SIGNATURES, REQUIRED_INDEX_SIGNATURES,
  REQUIRED_SEQUENCE_METADATA, TABLE_KEYS,
  LiquidacionRepositoryUnavailableError, createRepartidorLiquidacionDb2Repository,
};
