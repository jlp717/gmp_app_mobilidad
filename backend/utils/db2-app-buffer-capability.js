'use strict';

const { resolveAppProfile } = require('../config/app-profile');
const { db2QualifiedTable } = require('./db2-identifiers');

function column(name, type, length, nullable, precision = null, scale = null) {
  return Object.freeze({ name, type, length, nullable, precision, scale });
}

const STATE_EVENT_CHECKS = Object.freeze([
  "FROM_STATE IS NULL OR FROM_STATE IN ('BORRADOR','CONFIRMANDO','CONFIRMADO','CANCELANDO','CANCELADO')",
  "TO_STATE IN ('BORRADOR','CONFIRMANDO','CONFIRMADO','CANCELANDO','CANCELADO')",
  "FROM_STATE IS NOT NULL OR TO_STATE = 'BORRADOR'",
  "TO_STATE <> 'CANCELADO' OR LENGTH(TRIM(COALESCE(REASON,''))) > 0",
]);

const APP_BUFFER_REQUIREMENTS = Object.freeze({
  PEDIDO_STATE_EVENTS: Object.freeze({
    columns: Object.freeze([
      column('ID', 'BIGINT', 8, 'N', 18, 0),
      column('PEDIDO_ID', 'INTEGER', 4, 'N', 9, 0),
      column('FROM_STATE', 'VARCHAR', 24, 'Y'),
      column('TO_STATE', 'VARCHAR', 24, 'N'),
      column('ACTOR_ID', 'VARCHAR', 80, 'N'),
      column('ACTOR_ROLE', 'VARCHAR', 32, 'Y'),
      column('DEVICE_ID', 'VARCHAR', 128, 'Y'),
      column('REASON', 'VARCHAR', 500, 'Y'),
      column('IDEMPOTENCY_KEY', 'VARCHAR', 128, 'N'),
      column('PAYLOAD_JSON', 'CLOB', 262144, 'N'),
      column('PAYLOAD_HASH', 'CHAR', 64, 'N'),
      column('ORIGINAL_CLIENT_AT', 'TIMESTMP', 10, 'Y'),
      column('SERVER_OCCURRED_AT', 'TIMESTMP', 10, 'N'),
    ]),
    primaryKey: Object.freeze(['ID']),
    uniqueKeys: Object.freeze([Object.freeze(['IDEMPOTENCY_KEY'])]),
    indexes: Object.freeze([Object.freeze(['PEDIDO_ID', 'SERVER_OCCURRED_AT'])]),
    checks: STATE_EVENT_CHECKS,
  }),
  LIQUIDACION_COMERCIAL: Object.freeze({
    columns: Object.freeze([
      column('ID', 'INTEGER', 4, 'N', 9, 0),
      column('CODIGO_VENDEDOR', 'CHAR', 2, 'N'),
      column('FECHA', 'DATE', 4, 'N'),
      column('INGRESO_BANCO', 'DECIMAL', 11, 'N', 11, 2),
      column('ENTREGADO', 'DECIMAL', 11, 'N', 11, 2),
      column('TOTAL_ESPERADO', 'DECIMAL', 11, 'N', 11, 2),
      column('TOTAL_EFECTIVO', 'DECIMAL', 11, 'N', 11, 2),
      column('TOTAL_CHEQUES', 'DECIMAL', 11, 'N', 11, 2),
      column('TOTAL_POSTDATADOS', 'DECIMAL', 11, 'N', 11, 2),
      column('SALDO_ACTUAL', 'DECIMAL', 11, 'N', 11, 2),
      column('DEVOLUCIONES_YA_COBRADAS', 'DECIMAL', 11, 'N', 11, 2),
      column('TOTAL_A_INGRESAR', 'DECIMAL', 11, 'N', 11, 2),
      column('STATUS', 'VARCHAR', 20, 'N'),
      column('IDEMPOTENCY_TOKEN', 'VARCHAR', 128, 'N'),
      column('CREATED_BY', 'VARCHAR', 20, 'Y'),
      column('CREATED_AT', 'TIMESTMP', 10, 'N'),
      column('UPDATED_AT', 'TIMESTMP', 10, 'N'),
    ]),
    primaryKey: Object.freeze(['ID']),
    uniqueKeys: Object.freeze([
      Object.freeze(['CODIGO_VENDEDOR', 'FECHA']),
      Object.freeze(['IDEMPOTENCY_TOKEN']),
    ]),
    indexes: Object.freeze([]),
    checks: Object.freeze([]),
  }),
  DEVOLUCIONES_COMERCIAL: Object.freeze({
    columns: Object.freeze([
      column('ID', 'INTEGER', 4, 'N', 9, 0),
      column('SERIE', 'CHAR', 4, 'N'),
      column('NUMERO', 'INTEGER', 4, 'N', 9, 0),
      column('CLIENTE', 'CHAR', 10, 'N'),
      column('VENDEDOR', 'CHAR', 2, 'N'),
      column('FECHA', 'DATE', 4, 'N'),
      column('IMPORTE', 'DECIMAL', 11, 'N', 11, 2),
      column('UNIDADES', 'DECIMAL', 11, 'N', 11, 3),
      column('DOCUMENTO_ORIGEN', 'VARCHAR', 40, 'Y'),
      column('YA_COBRADA', 'SMALLINT', 2, 'N', 4, 0),
      column('IDEMPOTENCY_TOKEN', 'VARCHAR', 128, 'N'),
      column('CREATED_BY', 'VARCHAR', 20, 'Y'),
      column('CREATED_AT', 'TIMESTMP', 10, 'N'),
      column('FORMA_PAGO', 'CHAR', 2, 'Y'),
      column('ALBARAN_ORIGEN', 'VARCHAR', 40, 'Y'),
      column('VENCIMIENTO', 'DATE', 4, 'Y'),
      column('IMPACTO_LQD', 'VARCHAR', 20, 'Y'),
      column('FORMA_PAGO_DIAS', 'INTEGER', 4, 'Y', 9, 0),
    ]),
    primaryKey: Object.freeze(['ID']),
    uniqueKeys: Object.freeze([
      Object.freeze(['IDEMPOTENCY_TOKEN']),
      Object.freeze(['VENDEDOR', 'FECHA', 'SERIE', 'NUMERO', 'CLIENTE']),
    ]),
    indexes: Object.freeze([]),
    checks: Object.freeze([]),
  }),
});

const APP_BUFFER_FAMILIES = Object.freeze({
  audit: Object.freeze(['PEDIDO_STATE_EVENTS']),
  commercialFinance: Object.freeze(['LIQUIDACION_COMERCIAL', 'DEVOLUCIONES_COMERCIAL']),
  profileBuffers: Object.freeze([
    'PEDIDO_STATE_EVENTS', 'LIQUIDACION_COMERCIAL', 'DEVOLUCIONES_COMERCIAL',
  ]),
});

function capabilityError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  if (details) error.details = details;
  return error;
}

function assertStrictAppBufferProfile(env = process.env) {
  const resolved = resolveAppProfile(env);
  if (!resolved.valid) {
    throw capabilityError(
      'APP_BUFFER_PROFILE_INVALID',
      'El perfil de tablas de aplicacion no es coherente.',
      Object.freeze({ errors: resolved.errors }),
    );
  }
  const profile = resolved.publicProfile;
  const expectedTableSet = profile.profile === 'production' ? 'production' : 'isolated_test';
  if (profile.tableSet !== expectedTableSet || profile.writeSchema !== 'JAVIER') {
    throw capabilityError(
      'APP_BUFFER_PROFILE_INVALID',
      'El perfil no selecciona la familia de tablas esperada.',
    );
  }
  return profile;
}

function resolveAppBufferTable(name, profile) {
  const canonical = String(name || '').trim().toUpperCase();
  if (!Object.hasOwn(APP_BUFFER_REQUIREMENTS, canonical)) {
    throw capabilityError('APP_BUFFER_FAMILY_UNKNOWN', 'Familia de tabla no reconocida.');
  }
  const prefix = profile.tableSet === 'isolated_test' ? 'TEST_' : '';
  return db2QualifiedTable('JAVIER', `${prefix}${canonical}`);
}

function familyNames(family) {
  const names = APP_BUFFER_FAMILIES[family];
  if (!names) throw capabilityError('APP_BUFFER_FAMILY_UNKNOWN', 'Familia de tabla no reconocida.');
  return names;
}

function buildPredicates(tables) {
  return {
    sql: tables.map(() => '(TABLE_SCHEMA = ? AND TABLE_NAME = ?)').join(' OR '),
    params: tables.flatMap((qualified) => qualified.split('.')),
  };
}

function value(row, name) {
  return row?.[name] ?? row?.[name.toLowerCase()];
}

function canonicalKey(columns) {
  return columns.map((column) => String(column).trim().toUpperCase()).join('|');
}

function normalizeNullable(valueToNormalize) {
  const normalized = String(valueToNormalize || '').trim().toUpperCase();
  if (normalized === 'Y' || normalized === 'YES') return 'Y';
  if (normalized === 'N' || normalized === 'NO') return 'N';
  return null;
}

function normalizeCheckClause(clause) {
  return String(clause || '').trim().toUpperCase().replace(/\s+/g, '');
}

function columnContractMatches(actual, expected) {
  if (!actual) return false;
  if (String(value(actual, 'DATA_TYPE') || '').trim().toUpperCase() !== expected.type) return false;
  if (Number(value(actual, 'LENGTH')) !== expected.length) return false;
  if (normalizeNullable(value(actual, 'IS_NULLABLE')) !== expected.nullable) return false;
  if (expected.precision !== null
      && Number(value(actual, 'NUMERIC_PRECISION')) !== expected.precision) return false;
  if (expected.scale !== null
      && Number(value(actual, 'NUMERIC_SCALE')) !== expected.scale) return false;
  return true;
}

function groupedKeys(rows, { uniqueOnly = false } = {}) {
  const grouped = new Map();
  for (const row of rows || []) {
    if (uniqueOnly && String(value(row, 'IS_UNIQUE') || '').trim().toUpperCase() !== 'U') continue;
    const table = String(value(row, 'TABLE_NAME') || '').trim().toUpperCase();
    const name = String(value(row, 'INDEX_NAME') || value(row, 'CONSTRAINT_NAME') || '')
      .trim().toUpperCase();
    if (!table || !name) continue;
    const key = `${table}:${name}`;
    const columns = grouped.get(key) || [];
    columns.push({
      name: String(value(row, 'COLUMN_NAME') || '').trim().toUpperCase(),
      ordinal: Number(value(row, 'ORDINAL_POSITION')) || 0,
    });
    grouped.set(key, columns);
  }
  return [...grouped.entries()].map(([key, columns]) => {
    const table = key.split(':', 1)[0];
    const ordered = canonicalKey(
      columns.sort((a, b) => a.ordinal - b.ordinal).map((column) => column.name),
    );
    return `${table}:${ordered}`;
  });
}

async function inspectAppBufferCapability({
  family,
  env = process.env,
  catalogQuery,
  forceMetadata = false,
} = {}) {
  const profile = assertStrictAppBufferProfile(env);
  const names = familyNames(family);
  const tables = names.map((name) => resolveAppBufferTable(name, profile));
  if (profile.profile !== 'production' && !forceMetadata) {
    return Object.freeze({ available: true, profile: profile.profile, tables: Object.freeze(tables) });
  }
  if (typeof catalogQuery !== 'function') {
    throw capabilityError(
      'APP_BUFFER_CATALOG_UNAVAILABLE',
      'No hay consulta de catalogo DB2 disponible.',
    );
  }

  const predicates = buildPredicates(tables);
  let tableRows;
  let columnRows;
  let indexRows;
  let constraintRows;
  let checkRows;
  try {
    tableRows = await catalogQuery(
      `SELECT TABLE_SCHEMA, TABLE_NAME FROM QSYS2.SYSTABLES WHERE ${predicates.sql}`,
      predicates.params,
    );
    columnRows = await catalogQuery(
      `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, LENGTH,
              NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE
         FROM QSYS2.SYSCOLUMNS
        WHERE ${predicates.sql}`,
      predicates.params,
    );
    indexRows = await catalogQuery(
      `SELECT I.TABLE_SCHEMA, I.TABLE_NAME, I.INDEX_NAME, I.IS_UNIQUE,
              K.COLUMN_NAME, K.ORDINAL_POSITION
         FROM QSYS2.SYSINDEXES I
         JOIN QSYS2.SYSKEYS K
           ON K.INDEX_SCHEMA = I.INDEX_SCHEMA AND K.INDEX_NAME = I.INDEX_NAME
        WHERE ${predicates.sql.replaceAll('TABLE_SCHEMA', 'I.TABLE_SCHEMA').replaceAll('TABLE_NAME', 'I.TABLE_NAME')}`,
      predicates.params,
    );
    constraintRows = await catalogQuery(
      `SELECT C.TABLE_SCHEMA, C.TABLE_NAME, C.CONSTRAINT_NAME, C.CONSTRAINT_TYPE, C.ENABLED,
              K.COLUMN_NAME, K.ORDINAL_POSITION
         FROM QSYS2.SYSCST C
         JOIN QSYS2.SYSKEYCST K
           ON K.CONSTRAINT_SCHEMA = C.CONSTRAINT_SCHEMA
          AND K.CONSTRAINT_NAME = C.CONSTRAINT_NAME
        WHERE ${predicates.sql.replaceAll('TABLE_SCHEMA', 'C.TABLE_SCHEMA').replaceAll('TABLE_NAME', 'C.TABLE_NAME')}`,
      predicates.params,
    );
    checkRows = await catalogQuery(
      `SELECT C.TABLE_SCHEMA, C.TABLE_NAME, C.CONSTRAINT_NAME, H.CHECK_CLAUSE
         FROM QSYS2.SYSCST C
         JOIN QSYS2.SYSCHKCST H
           ON H.CONSTRAINT_SCHEMA = C.CONSTRAINT_SCHEMA
          AND H.CONSTRAINT_NAME = C.CONSTRAINT_NAME
        WHERE C.CONSTRAINT_TYPE = 'CHECK'
          AND (${predicates.sql.replaceAll('TABLE_SCHEMA', 'C.TABLE_SCHEMA').replaceAll('TABLE_NAME', 'C.TABLE_NAME')})`,
      predicates.params,
    );
  } catch {
    throw capabilityError(
      'APP_BUFFER_CATALOG_UNAVAILABLE',
      'No se pudo verificar el catalogo DB2 de las tablas de aplicacion.',
    );
  }

  const foundTables = new Set((tableRows || []).map((row) => (
    `${String(value(row, 'TABLE_SCHEMA') || '').trim().toUpperCase()}.${String(value(row, 'TABLE_NAME') || '').trim().toUpperCase()}`
  )));
  const columnsByTable = new Map();
  for (const row of columnRows || []) {
    const table = String(value(row, 'TABLE_NAME') || '').trim().toUpperCase();
    if (!columnsByTable.has(table)) columnsByTable.set(table, new Map());
    columnsByTable.get(table).set(
      String(value(row, 'COLUMN_NAME') || '').trim().toUpperCase(),
      row,
    );
  }
  const availablePrimaryKeys = new Set(groupedKeys(
    (constraintRows || []).filter((row) => (
      String(value(row, 'CONSTRAINT_TYPE') || '').trim().toUpperCase() === 'PRIMARY KEY'
      && ['Y', 'YES'].includes(String(value(row, 'ENABLED') || '').trim().toUpperCase())
    )),
  ));
  const availableUniqueKeys = new Set([
    ...groupedKeys(indexRows, { uniqueOnly: true }),
    ...groupedKeys((constraintRows || []).filter((row) => {
      const type = String(value(row, 'CONSTRAINT_TYPE') || '').trim().toUpperCase();
      const enabled = String(value(row, 'ENABLED') || '').trim().toUpperCase();
      return type === 'UNIQUE' && ['Y', 'YES'].includes(enabled);
    })),
  ]);
  const availableIndexes = new Set(groupedKeys(indexRows));
  const checksByTable = new Map();
  for (const row of checkRows || []) {
    const table = String(value(row, 'TABLE_NAME') || '').trim().toUpperCase();
    if (!checksByTable.has(table)) checksByTable.set(table, new Set());
    checksByTable.get(table).add(normalizeCheckClause(value(row, 'CHECK_CLAUSE')));
  }
  const missingTables = tables.filter((table) => !foundTables.has(table));
  const missingColumns = [];
  const incompatibleColumns = [];
  const missingKeys = [];
  const missingChecks = [];
  const unexpectedChecks = [];
  for (const name of names) {
    const physicalName = resolveAppBufferTable(name, profile).split('.')[1];
    const availableColumns = columnsByTable.get(physicalName) || new Map();
    for (const expected of APP_BUFFER_REQUIREMENTS[name].columns) {
      const actual = availableColumns.get(expected.name);
      if (!actual) {
        missingColumns.push(`${physicalName}.${expected.name}`);
      } else if (!columnContractMatches(actual, expected)) {
        incompatibleColumns.push(`${physicalName}.${expected.name}`);
      }
    }
    const primaryKey = APP_BUFFER_REQUIREMENTS[name].primaryKey;
    if (!availablePrimaryKeys.has(`${physicalName}:${canonicalKey(primaryKey)}`)) {
      missingKeys.push(`${physicalName}:PRIMARY KEY(${primaryKey.join(',')})`);
    }
    for (const columns of APP_BUFFER_REQUIREMENTS[name].uniqueKeys) {
      if (!availableUniqueKeys.has(`${physicalName}:${canonicalKey(columns)}`)) {
        missingKeys.push(`${physicalName}:UNIQUE(${columns.join(',')})`);
      }
    }
    for (const columns of APP_BUFFER_REQUIREMENTS[name].indexes) {
      if (!availableIndexes.has(`${physicalName}:${canonicalKey(columns)}`)) {
        missingKeys.push(`${physicalName}:INDEX(${columns.join(',')})`);
      }
    }
    const expectedChecks = new Set(
      APP_BUFFER_REQUIREMENTS[name].checks.map(normalizeCheckClause),
    );
    const availableChecks = checksByTable.get(physicalName) || new Set();
    for (const expectedCheck of expectedChecks) {
      if (!availableChecks.has(expectedCheck)) {
        missingChecks.push(`${physicalName}:${expectedCheck}`);
      }
    }
    if (expectedChecks.size > 0) {
      for (const actualCheck of availableChecks) {
        if (!expectedChecks.has(actualCheck)) {
          unexpectedChecks.push(`${physicalName}:${actualCheck}`);
        }
      }
    }
  }
  return Object.freeze({
    available: missingTables.length === 0
      && missingColumns.length === 0
      && incompatibleColumns.length === 0
      && missingKeys.length === 0
      && missingChecks.length === 0
      && unexpectedChecks.length === 0,
    profile: profile.profile,
    tables: Object.freeze(tables),
    missingTables: Object.freeze(missingTables),
    missingColumns: Object.freeze(missingColumns),
    incompatibleColumns: Object.freeze(incompatibleColumns),
    missingKeys: Object.freeze(missingKeys),
    missingChecks: Object.freeze(missingChecks),
    unexpectedChecks: Object.freeze(unexpectedChecks),
  });
}

async function requireAppBufferCapability(options) {
  const result = await inspectAppBufferCapability(options);
  if (!result.available) {
    throw capabilityError(
      'APP_BUFFER_CAPABILITY_UNAVAILABLE',
      'Las tablas de aplicacion requeridas no estan disponibles.',
      result,
    );
  }
  return result;
}

module.exports = {
  APP_BUFFER_FAMILIES,
  APP_BUFFER_REQUIREMENTS,
  assertStrictAppBufferProfile,
  inspectAppBufferCapability,
  requireAppBufferCapability,
  resolveAppBufferTable,
};
