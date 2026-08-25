'use strict';

const crypto = require('crypto');

/**
 * SAFE seed: JAVIER prod + read-only ERP → JAVIER.TEST_* only.
 * NEVER writes to DSEDAC / DSED / production ERP.
 *
 * Usage:
 *   node backend/scripts/copy-javier-prod-to-test.js            # dry-run
 *   node backend/scripts/copy-javier-prod-to-test.js --apply     # execute
 *   node backend/scripts/copy-javier-prod-to-test.js --apply --days=30
 *   node backend/scripts/copy-javier-prod-to-test.js --apply --repartidor=08
 *   node backend/scripts/copy-javier-prod-to-test.js --apply --skip-cvc
 *
 * Sources of truth:
 * - Isomorphic: TABLE_MAPPINGS production → isolated_test (when both exist)
 * - ERP liquidacion: DSEDAC.LQD → TEST_REPARTIDOR_LIQUIDACION_OPS (intersection)
 * - ERP cobros: DSEDAC.LQD efectivo/cheques/tarjeta/postdatados → TEST_REPARTIDOR_COBROS
 *   (DSEDAC.CVC.DIACOBRO is always 0 — cannot seed cobros from CVC dates)
 * - ERP ingresos/saldos: LQD.IMPORTEINGRESOENBANCO / IMPORTESALDOACTUAL
 * - ERP firmas: DSEDAC.CACFIRMAS → JAVIER.TEST_REPARTIDOR_FIRMAS (nombre/DNI; skip CLOB)
 * - Optional recovery only: --legacy-bkp-delivery-overlay seeds historical BKP delivery rows
 * - Notifications: NOTIFICATION_ROLE_TARGETS → TEST_NOTIFICATION_ROLE_TARGETS
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const {
  initDb, closePool, query, queryWithParams, getPool,
} = require('../config/db');
const { TABLE_MAPPINGS } = require('../config/reparto-runtime');

function shouldSeedLegacyDeliveryOverlay(args = process.argv.slice(2)) {
  return args.includes('--legacy-bkp-delivery-overlay');
}

const APPLY = process.argv.includes('--apply');
const RECONCILE_TEST_SCHEMA = process.argv.includes('--reconcile-test-schema');
const SCHEMA_ONLY = process.argv.includes('--schema-only');
const SKIP_CVC = process.argv.includes('--skip-cvc');
const ALLOW_TEST_ROW_CLEAR = process.argv.includes('--allow-test-row-clear');
const ALLOW_TEST_TABLE_REBUILD = process.argv.includes('--allow-test-table-rebuild');
const RESUME_FIRMAS = process.argv.includes('--resume-firmas');
const LEGACY_BKP_DELIVERY_OVERLAY = shouldSeedLegacyDeliveryOverlay();
const daysArg = process.argv.find((a) => a.startsWith('--days='));
const DAYS = daysArg ? Math.max(1, Number(daysArg.split('=')[1]) || 30) : 30;
const repArg = process.argv.find((a) => a.startsWith('--repartidor='));
const REPARTIDOR = repArg ? String(repArg.split('=')[1] || '').trim() : '';
const copyRunArg = process.argv.find((a) => a.startsWith('--copy-run-id='));
const COPY_RUN_ID = copyRunArg ? String(copyRunArg.split('=')[1] || '').trim().toUpperCase() : '';

/** Keys filled from ERP read-only seeds instead of empty JAVIER isomorphic tables. */
const ERP_SEEDED_KEYS = new Set(['liquidationOps', 'cobros']);

const BKP_DELIVERY = 'JAVIER.BKP_DELIVERY_STATUS_20260427';
const TEST_DELIVERY = 'JAVIER.TEST_DELIVERY_STATUS';
const ERP_LQD = 'DSEDAC.LQD';
const ERP_CVC = 'DSEDAC.CVC';
const ERP_CACFIRMAS = 'DSEDAC.CACFIRMAS';
const TEST_FIRMAS = 'JAVIER.TEST_REPARTIDOR_FIRMAS';
const PROD_FIRMAS = 'JAVIER.REPARTIDOR_FIRMAS';
const BACKUP_MANIFEST_TABLE = 'JAVIER.TEST_COPY_BACKUP_MANIFEST';

const summaryRows = [];

function assertJavierTest(table) {
  const t = String(table || '').toUpperCase();
  if (!t.startsWith('JAVIER.TEST_')) {
    throw new Error(`Refusing non-TEST write target: ${table}`);
  }
  if (t.includes('DSEDAC') || t.includes('DSED.')) {
    throw new Error(`Refusing DSEDAC/DSED write target: ${table}`);
  }
}

function assertReadOnlyErp(table) {
  const t = String(table || '').toUpperCase();
  if (!t.startsWith('DSEDAC.') && !t.startsWith('JAVIER.')) {
    throw new Error(`Refusing unexpected source: ${table}`);
  }
}

function assertJavierSource(table) {
  const t = String(table || '').toUpperCase();
  if (!t.startsWith('JAVIER.') || t.includes('.TEST_') || t.includes('DSEDAC') || t.includes('DSED.')) {
    throw new Error(`Refusing non-JAVIER prod source: ${table}`);
  }
}

function refuseDsedacWriteSql(sql) {
  // Allow SELECT FROM DSEDAC.*; refuse only when DSEDAC/DSED is the write target.
  const s = String(sql || '').toUpperCase().replace(/\s+/g, ' ');
  const hits = [
    /\bINSERT\s+INTO\s+DSEDAC\./,
    /\bINSERT\s+INTO\s+DSED\./,
    /\bUPDATE\s+DSEDAC\./,
    /\bUPDATE\s+DSED\./,
    /\bDELETE\s+FROM\s+DSEDAC\./,
    /\bDELETE\s+FROM\s+DSED\./,
    /\bMERGE\s+INTO\s+DSEDAC\./,
    /\bMERGE\s+INTO\s+DSED\./,
    /\bCREATE\s+TABLE\s+DSEDAC\./,
    /\bCREATE\s+TABLE\s+DSED\./,
    /\bDROP\s+TABLE\s+DSEDAC\./,
    /\bDROP\s+TABLE\s+DSED\./,
    /\bALTER\s+TABLE\s+DSEDAC\./,
    /\bALTER\s+TABLE\s+DSED\./,
    /\bTRUNCATE\s+TABLE\s+DSEDAC\./,
    /\bTRUNCATE\s+TABLE\s+DSED\./,
  ];
  if (hits.some((re) => re.test(s))) {
    throw new Error(`Refusing SQL that writes DSEDAC/DSED: ${s.slice(0, 160)}`);
  }
}

function normalizeCatalogYesNo(value, label) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (['Y', 'YES', '1', 'TRUE'].includes(normalized)) return 'YES';
  if (['N', 'NO', '0', 'FALSE'].includes(normalized)) return 'NO';
  throw new Error(`Unsupported DB2 catalog ${label}: ${normalized || '<empty>'}`);
}

function normalizeCatalogBoolean(value, label) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (label === 'HAS_DEFAULT' && normalized === 'I') {
    return true;
  }
  return normalizeCatalogYesNo(value, label) === 'YES';
}

function normalizeColumnDefault(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  let result = '';
  let inLiteral = false;
  let pendingSpace = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "'") {
      if (pendingSpace && result) result += ' ';
      pendingSpace = false;
      result += char;
      if (inLiteral && raw[index + 1] === "'") {
        result += "'";
        index += 1;
      } else {
        inLiteral = !inLiteral;
      }
    } else if (inLiteral) {
      result += char;
    } else if (/\s/.test(char)) {
      pendingSpace = result.length > 0;
    } else {
      if (pendingSpace && result) result += ' ';
      pendingSpace = false;
      result += char.toUpperCase();
    }
  }
  if (inLiteral) throw new Error('Unsupported DB2 catalog COLUMN_DEFAULT: unterminated literal');
  return result.trim();
}

function safeDefaultExpression(value) {
  const expression = normalizeColumnDefault(value);
  if (!expression || expression.length > 1024 || expression.includes('\0')) {
    throw new Error('Unsupported DB2 catalog COLUMN_DEFAULT expression');
  }
  let outside = '';
  let inLiteral = false;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (char === "'") {
      if (inLiteral && expression[index + 1] === "'") index += 1;
      else inLiteral = !inLiteral;
    } else if (!inLiteral) {
      outside += char;
    }
  }
  if (inLiteral || /;|--|\/\*|\*\//.test(outside)) {
    throw new Error('Unsupported DB2 catalog COLUMN_DEFAULT expression');
  }
  return expression;
}

function defaultSignature(column) {
  return `${column.hasDefault ? 'YES' : 'NO'}|${normalizeColumnDefault(column.columnDefault)}`;
}

async function columnsOf(schemaTable) {
  const [schema, table] = schemaTable.split('.');
  const rows = await queryWithParams(
    `SELECT TRIM(COLUMN_NAME) AS COLUMN_NAME,
            TRIM(DATA_TYPE) AS DATA_TYPE,
            LENGTH,
            NUMERIC_PRECISION,
            NUMERIC_SCALE,
            IS_NULLABLE,
            HAS_DEFAULT,
            COLUMN_DEFAULT,
            IDENTITY,
            IDENTITY_GENERATION,
            IDENTITY_START,
            IDENTITY_INCREMENT
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
  return (rows || []).map((r) => ({
    name: String(r.COLUMN_NAME || r.column_name).trim().toUpperCase(),
    dataType: String(r.DATA_TYPE || r.data_type || '').toUpperCase(),
    length: String(r.LENGTH ?? r.length ?? ''),
    numericPrecision: String(r.NUMERIC_PRECISION ?? r.numeric_precision ?? ''),
    numericScale: String(r.NUMERIC_SCALE ?? r.numeric_scale ?? ''),
    isNullable: normalizeCatalogYesNo(r.IS_NULLABLE ?? r.is_nullable, 'IS_NULLABLE'),
    hasDefault: normalizeCatalogBoolean(r.HAS_DEFAULT ?? r.has_default, 'HAS_DEFAULT'),
    columnDefault: normalizeColumnDefault(r.COLUMN_DEFAULT ?? r.column_default),
    identity: normalizeCatalogBoolean(r.IDENTITY ?? r.identity, 'IDENTITY'),
    identityGeneration: String(r.IDENTITY_GENERATION ?? r.identity_generation ?? '').trim().toUpperCase(),
    identityStart: String(r.IDENTITY_START ?? r.identity_start ?? ''),
    identityIncrement: String(r.IDENTITY_INCREMENT ?? r.identity_increment ?? ''),
  }));
}

function metadataSignature(column) {
  return [
    column.dataType,
    column.length,
    column.numericPrecision,
    column.numericScale,
    column.isNullable,
  ].join('|');
}

/**
 * Compare a mapped application-table pair exactly before any TEST mutation.
 */
function compareTableMetadata(srcCols, dstCols) {
  const srcByName = new Map(srcCols.map((column) => [column.name, column]));
  const dstByName = new Map(dstCols.map((column) => [column.name, column]));
  const missing = [...srcByName.keys()].filter((name) => !dstByName.has(name));
  const extra = [...dstByName.keys()].filter((name) => !srcByName.has(name));
  const deltas = [];
  const identityDeltas = [];
  const defaultDeltas = [];
  for (const [name, src] of srcByName) {
    const dst = dstByName.get(name);
    const sourceIdentity = src.identity ? `${src.identityGeneration}|${src.identityStart}|${src.identityIncrement}` : 'NO';
    const destinationIdentity = dst?.identity
      ? `${dst.identityGeneration}|${dst.identityStart}|${dst.identityIncrement}` : 'NO';
    if (dst && sourceIdentity !== destinationIdentity) identityDeltas.push(name);
    if (dst && defaultSignature(src) !== defaultSignature(dst)) {
      defaultDeltas.push({
        name,
        source: defaultSignature(src),
        destination: defaultSignature(dst),
      });
    }
  }

  for (const [name, src] of srcByName) {
    const dst = dstByName.get(name);
    if (dst && metadataSignature(src) !== metadataSignature(dst)) {
      deltas.push({
        name,
        source: metadataSignature(src),
        destination: metadataSignature(dst),
      });
    }
  }

  return {
    ok: missing.length === 0 && extra.length === 0 && deltas.length === 0
      && identityDeltas.length === 0 && defaultDeltas.length === 0,
    missing,
    extra,
    deltas,
    identityDeltas,
    defaultDeltas,
  };
}

function createLikeSql(pair) {
  return `CREATE TABLE ${pair.dst} LIKE ${pair.src} INCLUDING IDENTITY INCLUDING DEFAULTS`;
}

function normalizeOperationalContracts(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const kind = String(row.KIND ?? row.kind ?? '').trim().toUpperCase();
    const objectName = String(row.OBJECT_NAME ?? row.object_name ?? '').trim().toUpperCase();
    const column = String(row.COLUMN_NAME ?? row.column_name ?? '').trim().toUpperCase();
    const ordering = String(row.ORDERING ?? row.ordering ?? 'A').trim().toUpperCase();
    const clause = String(row.CHECK_CLAUSE ?? row.check_clause ?? '').trim().replace(/\s+/g, ' ');
    if (!['PRIMARY_KEY', 'CHECK', 'INDEX', 'UNIQUE_INDEX'].includes(kind)
      || !/^[A-Z][A-Z0-9_]*$/.test(objectName)
      || (kind !== 'CHECK' && (!/^[A-Z][A-Z0-9_]*$/.test(column) || !['A', 'D'].includes(ordering)))
      || (kind === 'CHECK' && (!clause || /;|--|\/\*/.test(clause)))) {
      throw new Error('Unsupported DB2 operational contract metadata');
    }
    const key = `${kind}:${objectName}`;
    if (!grouped.has(key)) grouped.set(key, { kind, objectName, columns: [], clause });
    if (kind !== 'CHECK') {
      grouped.get(key).columns.push({
        name: column,
        ordering,
        ordinal: Number(row.ORDINAL_POSITION ?? row.ordinal_position),
      });
    }
  }
  return [...grouped.values()].map((contract) => ({
    kind: contract.kind,
    clause: contract.clause,
    columns: contract.columns
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(({ name, ordering }) => ({ name, ordering })),
  }));
}

async function operationalContractsOf(schemaTable) {
  const [schema, table] = schemaTable.split('.');
  const keyRows = await queryWithParams(
    `SELECT 'PRIMARY_KEY' AS KIND, TRIM(C.CONSTRAINT_NAME) AS OBJECT_NAME,
            TRIM(K.COLUMN_NAME) AS COLUMN_NAME, K.ORDINAL_POSITION, 'A' AS ORDERING, '' AS CHECK_CLAUSE
       FROM QSYS2.SYSCST C
       JOIN QSYS2.SYSKEYCST K ON K.CONSTRAINT_SCHEMA = C.CONSTRAINT_SCHEMA
        AND K.CONSTRAINT_NAME = C.CONSTRAINT_NAME
      WHERE C.TABLE_SCHEMA = ? AND C.TABLE_NAME = ? AND C.CONSTRAINT_TYPE = 'PRIMARY KEY'`,
    [schema, table],
  );
  const checkRows = await queryWithParams(
    `SELECT 'CHECK' AS KIND, TRIM(C.CONSTRAINT_NAME) AS OBJECT_NAME, '' AS COLUMN_NAME,
            0 AS ORDINAL_POSITION, 'A' AS ORDERING, K.CHECK_CLAUSE
       FROM QSYS2.SYSCST C
       JOIN QSYS2.CHECK_CONSTRAINTS K ON K.CONSTRAINT_SCHEMA = C.CONSTRAINT_SCHEMA
        AND K.CONSTRAINT_NAME = C.CONSTRAINT_NAME
      WHERE C.TABLE_SCHEMA = ? AND C.TABLE_NAME = ? AND C.CONSTRAINT_TYPE = 'CHECK'`,
    [schema, table],
  );
  const indexRows = await queryWithParams(
    `SELECT CASE WHEN I.IS_UNIQUE = 'U' THEN 'UNIQUE_INDEX' ELSE 'INDEX' END AS KIND,
            TRIM(I.INDEX_NAME) AS OBJECT_NAME, TRIM(K.COLUMN_NAME) AS COLUMN_NAME,
            K.ORDINAL_POSITION, K.ORDERING, '' AS CHECK_CLAUSE
       FROM QSYS2.SYSINDEXES I
       JOIN QSYS2.SYSKEYS K ON K.INDEX_SCHEMA = I.INDEX_SCHEMA AND K.INDEX_NAME = I.INDEX_NAME
      WHERE I.TABLE_SCHEMA = ? AND I.TABLE_NAME = ?
      ORDER BY I.INDEX_NAME, K.ORDINAL_POSITION`,
    [schema, table],
  );
  return normalizeOperationalContracts([...(keyRows || []), ...(checkRows || []), ...(indexRows || [])]);
}

function operationalContractSignature(contract) {
  if (contract.kind === 'CHECK') return `CHECK:${contract.clause.toUpperCase().replace(/\s+/g, ' ')}`;
  return `${contract.kind}:${contract.columns.map(({ name, ordering }) => `${name}:${ordering}`).join(',')}`;
}

function testObjectName(destination, kind, signature) {
  const table = destination.split('.')[1];
  const hash = crypto.createHash('sha256').update(signature).digest('hex').slice(0, 10).toUpperCase();
  const prefix = { PRIMARY_KEY: 'PKT', CHECK: 'CKT', INDEX: 'IXT', UNIQUE_INDEX: 'UXT' }[kind];
  return `${prefix}_${table.slice(0, 100)}_${hash}`;
}

function buildOperationalContractPlan(pair, sourceContracts, destinationContracts) {
  const existing = new Set(destinationContracts.map(operationalContractSignature));
  return sourceContracts
    .filter((contract) => !existing.has(operationalContractSignature(contract)))
    .map((contract) => {
      const signature = operationalContractSignature(contract);
      const objectName = testObjectName(pair.dst, contract.kind, signature);
      if (contract.kind === 'CHECK') {
        return { kind: 'ADD_CHECK', signature, sql: `ALTER TABLE ${pair.dst} ADD CONSTRAINT JAVIER.${objectName} CHECK (${contract.clause})` };
      }
      const columns = contract.columns
        .map(({ name, ordering }) => `${name}${ordering === 'D' ? ' DESC' : ''}`).join(', ');
      if (contract.kind === 'PRIMARY_KEY') {
        return { kind: 'ADD_PRIMARY_KEY', signature, sql: `ALTER TABLE ${pair.dst} ADD CONSTRAINT JAVIER.${objectName} PRIMARY KEY (${columns})` };
      }
      const unique = contract.kind === 'UNIQUE_INDEX' ? 'UNIQUE ' : '';
      return { kind: 'ADD_INDEX', signature, sql: `CREATE ${unique}INDEX JAVIER.${objectName} ON ${pair.dst} (${columns})` };
    });
}

const RUNTIME_INSERT_COLUMNS = Object.freeze({
  'finance.cobros': Object.freeze([Object.freeze([
    'CODIGOCLIENTEALBARAN', 'CODIGOCLIENTEFACTURA', 'CODIGOVENDEDOR',
    'CODIGOVENDEDORCOBRO', 'TIPODOCUMENTO', 'ORIGENDOCUMENTO',
    'SUBEMPRESADOCUMENTO', 'EJERCICIODOCUMENTO', 'SERIEDOCUMENTO',
    'TERMINALDOCUMENTO', 'NUMERODOCUMENTO', 'XDEDOCUMENTO', 'DEXDOCUMENTO',
    'IMPORTEVENCIMIENTO', 'IMPORTEPENDIENTE', 'CODIGOFORMAPAGO', 'DIACOBRO',
    'MESCOBRO', 'ANOCOBRO', 'IDEMPOTENCY_TOKEN', 'PANTALLA_ORIGEN', 'OPERADOR',
    'OBSERVACIONES', 'LIQUIDADO_SN', 'LIQUIDACION_TOKEN', 'NUMEROLIQUIDACION',
  ])]),
  'finance.audit': Object.freeze([Object.freeze([
    'EVENT_TYPE', 'OPERADOR', 'CODIGO_REPARTIDOR', 'PAYLOAD_PREVIEW',
  ])]),
  'finance.balances': Object.freeze([Object.freeze([
    'CODIGO_REPARTIDOR', 'SALDO_PENDIENTE',
  ])]),
  'notifications.deliveryStatus': Object.freeze([
    Object.freeze(['STATUS', 'LATITUD', 'LONGITUD', 'OPERADOR', 'PANTALLA_ORIGEN', 'IDEMPOTENCY_TOKEN', 'UPDATED_AT']),
    Object.freeze(['ID', 'CONFORMADOSN', 'OBSERVACIONES', 'FIRMA_PATH', 'LATITUD', 'LONGITUD', 'REPARTIDOR_ID', 'UPDATED_AT']),
  ]),
});

const CURRENT_RUNTIME_READ_ONLY_KEYS = new Set([
  'finance.liquidationEmails',
  'finance.commercialCobros',
  'notifications.roleTargets',
]);

/**
 * TEST must retain every operational contract present on its production peer.
 * Extra TEST-only contracts are deliberately permitted: they can make the
 * isolated environment stricter without weakening production parity.
 */
function shouldAuditOperationalContracts(pair) {
  return pair?.objectType === 'TABLE';
}

function runtimeWriteCoverageGaps(pair, sourceColumns, operations) {
  if (!operations.length || pair.objectType === 'SEQUENCE') return [];
  const mappingKey = `${pair.group}.${pair.key}`;
  if (CURRENT_RUNTIME_READ_ONLY_KEYS.has(mappingKey)) return [];
  const signatures = RUNTIME_INSERT_COLUMNS[mappingKey];
  const required = sourceColumns
    .filter((column) => column.isNullable === 'NO' && !column.hasDefault && !column.identity)
    .map((column) => column.name);
  if (!required.length) return [];
  if (!signatures) {
    throw new Error(
      `RUNTIME WRITE COVERAGE BLOCK ${pair.dst}: reconciliation changes a writable table `
      + 'without an audited INSERT column manifest',
    );
  }
  const gaps = [];
  for (let index = 0; index < signatures.length; index++) {
    const covered = new Set(signatures[index]);
    const missing = required.filter((name) => !covered.has(name));
    if (missing.length) gaps.push({ signature: index + 1, missing });
  }
  return gaps;
}

function assertRuntimeWriteCoverage(pair, sourceColumns, operations) {
  const gaps = runtimeWriteCoverageGaps(pair, sourceColumns, operations);
  if (gaps.length) {
    throw new Error(
      `RUNTIME WRITE COVERAGE BLOCK ${pair.dst}: `
      + gaps.map((gap) => `insert#${gap.signature} missing=[${gap.missing.join(',')}]`).join('; '),
    );
  }
}

function sqlTypeFor(column) {
  const type = String(column.dataType || '').toUpperCase();
  const length = Number(column.length || 0);
  const precision = Number(column.numericPrecision || 0);
  const scale = Number(column.numericScale || 0);
  if (['DECIMAL', 'NUMERIC', 'PACKED', 'ZONED'].includes(type)) {
    return `${type}(${precision || length || 10}, ${scale || 0})`;
  }
  if (['CHAR', 'CHARACTER', 'VARCHAR', 'BINARY', 'VARBINARY', 'GRAPHIC', 'VARGRAPHIC'].includes(type)) {
    return `${type}(${length || 1})`;
  }
  if (['CLOB', 'DBCLOB', 'BLOB'].includes(type)) return `${type}(${length || 1})`;
  if (type === 'TIMESTMP') return 'TIMESTAMP';
  if (['BIGINT', 'INTEGER', 'SMALLINT', 'DATE', 'TIME', 'TIMESTAMP', 'BOOLEAN'].includes(type)) return type;
  throw new Error(`Unsupported DB2 type in reconciliation: ${type || '<empty>'}`);
}

function safeTypeWidening(source, destination) {
  const numericFamily = new Set(['DECIMAL', 'NUMERIC', 'PACKED', 'ZONED']);
  if (numericFamily.has(source.dataType) && numericFamily.has(destination.dataType)) {
    return Number(source.numericScale) === Number(destination.numericScale)
      && Number(source.numericPrecision) >= Number(destination.numericPrecision);
  }
  if (source.dataType !== destination.dataType) return false;
  const type = source.dataType;
  if (['CHAR', 'CHARACTER', 'VARCHAR', 'BINARY', 'VARBINARY', 'GRAPHIC', 'VARGRAPHIC', 'CLOB', 'DBCLOB', 'BLOB'].includes(type)) {
    return Number(source.length) > Number(destination.length);
  }
  return false;
}

function buildReconciliationPlan(pair, sourceColumns, destinationColumns, {
  sourceExists = true,
  destinationExists = true,
  destinationRowCount = 0,
  destinationNullCounts = {},
  allowTestRowClear = false,
  allowTestTableRebuild = false,
} = {}) {
  assertJavierSource(pair.src);
  assertJavierTest(pair.dst);
  if (!sourceExists) {
    throw new Error(`SCHEMA RECONCILE BLOCK ${pair.src} -> ${pair.dst}: source table missing`);
  }
  if (!destinationExists) {
    return [{
      kind: 'CREATE_LIKE',
      sql: createLikeSql(pair),
    }];
  }

  const comparison = compareTableMetadata(sourceColumns, destinationColumns);
  if (comparison.ok) return [];
  const sourceByName = new Map(sourceColumns.map((column) => [column.name, column]));
  const destinationByName = new Map(destinationColumns.map((column) => [column.name, column]));
  const rebuildReasons = [];
  if (comparison.identityDeltas.length) rebuildReasons.push(`identity=[${comparison.identityDeltas.join(',')}]`);
  for (const delta of comparison.defaultDeltas) {
    const source = sourceByName.get(delta.name);
    if (source.hasDefault && !normalizeColumnDefault(source.columnDefault)) {
      rebuildReasons.push(`default=${delta.name}:implicit`);
    }
  }
  if (comparison.extra.length) rebuildReasons.push(`extra=[${comparison.extra.join(',')}]`);
  for (const name of comparison.missing) {
    const source = sourceByName.get(name);
    if (allowTestTableRebuild && source.isNullable === 'NO' && !source.hasDefault && destinationRowCount > 0) {
      rebuildReasons.push(`required-add=${name}`);
    }
  }
  for (const delta of comparison.deltas) {
    const source = sourceByName.get(delta.name);
    const destination = destinationByName.get(delta.name);
    const sameTypeShape = source.dataType === destination.dataType
      && source.length === destination.length
      && source.numericPrecision === destination.numericPrecision
      && source.numericScale === destination.numericScale;
    if (!sameTypeShape && (source.dataType !== destination.dataType || !safeTypeWidening(source, destination))) {
      rebuildReasons.push(`type=${delta.name}`);
    }
    if (source.isNullable === 'NO' && destination.isNullable === 'YES') {
      const nullCount = Number(destinationNullCounts[delta.name]);
      if (!Number.isInteger(nullCount) || nullCount < 0) {
        throw new Error(`SCHEMA RECONCILE BLOCK ${pair.dst}.${delta.name}: NULL count unavailable`);
      }
      if (allowTestTableRebuild && nullCount > 0) rebuildReasons.push(`null-data=${delta.name}:${nullCount}`);
    }
  }
  if (rebuildReasons.length) {
    if (!allowTestTableRebuild) {
      throw new Error(
        `SCHEMA RECONCILE BLOCK ${pair.src} -> ${pair.dst}: `
        + `TEST-only exact schema requires backed rebuild (${rebuildReasons.join('; ')}); `
        + 'rerun apply with --allow-test-table-rebuild',
      );
    }
    return [
      { kind: 'DROP_TEST_TABLE', sql: `DROP TABLE ${pair.dst}` },
      {
        kind: 'CREATE_LIKE',
        sql: createLikeSql(pair),
      },
    ];
  }

  const plan = [];
  let testRowsCleared = false;
  for (const name of comparison.missing) {
    const source = sourceByName.get(name);
    if (source.isNullable === 'NO' && !source.hasDefault && destinationRowCount > 0) {
      throw new Error(`SCHEMA RECONCILE BLOCK ${pair.dst}.${name}: NOT NULL add on non-empty TEST table`);
    }
    plan.push({
      kind: 'ADD_COLUMN',
      column: name,
      sql: `ALTER TABLE ${pair.dst} ADD COLUMN ${name} ${sqlTypeFor(source)}`
        + `${source.isNullable === 'NO' ? ' NOT NULL' : ''}`
        + `${source.hasDefault ? (normalizeColumnDefault(source.columnDefault)
          ? ` DEFAULT ${safeDefaultExpression(source.columnDefault)}` : ' WITH DEFAULT') : ''}`,
    });
  }

  for (const delta of comparison.deltas) {
    const source = sourceByName.get(delta.name);
    const destination = destinationByName.get(delta.name);
    const sameTypeShape = source.dataType === destination.dataType
      && source.length === destination.length
      && source.numericPrecision === destination.numericPrecision
      && source.numericScale === destination.numericScale;
    if (!sameTypeShape) {
      if (!safeTypeWidening(source, destination)) {
        throw new Error(
          `SCHEMA RECONCILE BLOCK ${pair.dst}.${delta.name}: destructive/unknown type delta source=${metadataSignature(source)} destination=${metadataSignature(destination)}`,
        );
      }
      plan.push({
        kind: 'WIDEN_COLUMN',
        column: delta.name,
        sql: `ALTER TABLE ${pair.dst} ALTER COLUMN ${delta.name} SET DATA TYPE ${sqlTypeFor(source)}`,
      });
    }
    if (source.isNullable === 'NO' && destination.isNullable === 'YES') {
      const nullCount = Number(destinationNullCounts[delta.name]);
      if (!Number.isInteger(nullCount) || nullCount < 0) {
        throw new Error(`SCHEMA RECONCILE BLOCK ${pair.dst}.${delta.name}: NULL count unavailable`);
      }
      if (nullCount > 0 && !allowTestRowClear) {
        throw new Error(`SCHEMA RECONCILE BLOCK ${pair.dst}.${delta.name}: ${nullCount} NULL rows require --allow-test-row-clear`);
      }
      if (nullCount > 0 && !testRowsCleared) {
        plan.push({
          kind: 'CLEAR_TEST_ROWS',
          rowCount: destinationRowCount,
          sql: `DELETE FROM ${pair.dst}`,
        });
        testRowsCleared = true;
      }
      plan.push({
        kind: 'SET_NOT_NULL',
        column: delta.name,
        nullCount,
        sql: `ALTER TABLE ${pair.dst} ALTER COLUMN ${delta.name} SET NOT NULL`,
      });
    } else if (source.isNullable === 'YES' && destination.isNullable === 'NO') {
      plan.push({
        kind: 'DROP_NOT_NULL',
        column: delta.name,
        sql: `ALTER TABLE ${pair.dst} ALTER COLUMN ${delta.name} DROP NOT NULL`,
      });
    } else if (source.isNullable !== destination.isNullable) {
      throw new Error(`SCHEMA RECONCILE BLOCK ${pair.dst}.${delta.name}: unknown nullability delta`);
    }
  }
  for (const delta of comparison.defaultDeltas) {
    const source = sourceByName.get(delta.name);
    if (source.hasDefault) {
      plan.push({
        kind: 'SET_DEFAULT',
        column: delta.name,
        sql: `ALTER TABLE ${pair.dst} ALTER COLUMN ${delta.name} SET DEFAULT ${safeDefaultExpression(source.columnDefault)}`,
      });
    } else {
      plan.push({
        kind: 'DROP_DEFAULT',
        column: delta.name,
        sql: `ALTER TABLE ${pair.dst} ALTER COLUMN ${delta.name} DROP DEFAULT`,
      });
    }
  }
  return plan;
}

async function reconcileMappingPairs(pairs, {
  tableExistsFn = tableExists,
  columnsOfFn = columnsOf,
  countOfFn = countOf,
  operationalContractsOfFn = operationalContractsOf,
  countNullsFn = countNulls,
  executeFn = run,
  apply = APPLY,
  allowTestRowClear = !apply || ALLOW_TEST_ROW_CLEAR,
  allowTestTableRebuild = !apply || ALLOW_TEST_TABLE_REBUILD,
} = {}) {
  const report = [];
  for (const pair of pairs) {
    const sourceExists = await tableExistsFn(pair.src);
    const destinationExists = await tableExistsFn(pair.dst);
    const sourceColumns = sourceExists ? await columnsOfFn(pair.src) : [];
    const destinationColumns = destinationExists ? await columnsOfFn(pair.dst) : [];
    const destinationRowCount = destinationExists ? await countOfFn(pair.dst) : 0;
    const destinationNullCounts = {};
    if (destinationExists) {
      const destinationByName = new Map(destinationColumns.map((column) => [column.name, column]));
      for (const source of sourceColumns) {
        const destination = destinationByName.get(source.name);
        if (destination && source.isNullable === 'NO' && destination.isNullable === 'YES') {
          destinationNullCounts[source.name] = await countNullsFn(pair.dst, source.name);
        }
      }
    }
    const plan = buildReconciliationPlan(pair, sourceColumns, destinationColumns, {
      sourceExists,
      destinationExists,
      destinationRowCount,
      destinationNullCounts,
      allowTestRowClear,
      allowTestTableRebuild,
    });
    const destinationWillBeRebuilt = plan.some((operation) => operation.kind === 'DROP_TEST_TABLE');
    const auditOperationalContracts = shouldAuditOperationalContracts(pair);
    const sourceContracts = sourceExists && auditOperationalContracts ? await operationalContractsOfFn(pair.src) : [];
    const destinationContracts = destinationExists && !destinationWillBeRebuilt && auditOperationalContracts
      ? await operationalContractsOfFn(pair.dst) : [];
    const fullPlan = [...plan, ...buildOperationalContractPlan(pair, sourceContracts, destinationContracts)];
    // Index/constraint parity does not alter the INSERT column contract. Only
    // structural column changes require an audited runtime INSERT manifest.
    assertRuntimeWriteCoverage(pair, sourceColumns, plan);
    for (const operation of fullPlan) {
      console.log(apply ? 'SCHEMA APPLY' : '[DRY] SCHEMA', operation.sql);
      if (apply) await executeFn(operation.sql);
    }
    report.push({ pair, operations: fullPlan });
  }
  return report;
}

function validateCopyRunId(value) {
  if (!/^[A-Z0-9_]{4,24}$/.test(String(value || ''))) {
    throw new Error('--copy-run-id is required for --apply and must match [A-Z0-9_]{4,24}');
  }
  return value;
}

function backupTableName(destination, runId) {
  assertJavierTest(destination);
  validateCopyRunId(runId);
  const base = destination.split('.')[1].replace(/^TEST_/, '');
  return `JAVIER.TEST_COPY_BKP_${runId}_${base}`;
}

function backupShapeHash(columns) {
  const shape = columns.map((column) => [
    column.name, column.dataType, column.length, column.numericPrecision, column.numericScale,
  ]);
  return crypto.createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}

function canonicalBackupValue(value) {
  if (value === null || value === undefined) return '<NULL>';
  if (Buffer.isBuffer(value)) return `B:${value.toString('base64')}`;
  if (value instanceof Date) return `D:${value.toISOString()}`;
  if (typeof value === 'object') {
    const ordered = Object.keys(value).sort().reduce((result, key) => {
      result[key] = value[key];
      return result;
    }, {});
    return `J:${JSON.stringify(ordered)}`;
  }
  return `${typeof value}:${String(value)}`;
}

const LOB_DATA_TYPES = new Set(['BLOB', 'CLOB', 'DBCLOB', 'NCLOB']);
const LOB_HASH_CHUNK_CHARS = 8192;
const MAX_CLOB_HASH_CHUNKS = 128;
const MAX_BLOB_HASH_CHUNKS = 1024;

function canonicalNumericBackupValue(value) {
  const source = String(value).trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(source)) return `N:${source}`;
  const negative = source.startsWith('-');
  const [rawInteger, rawFraction = ''] = source.replace(/^[+-]/, '').split('.');
  const integer = rawInteger.replace(/^0+(?=\d)/, '') || '0';
  const fraction = rawFraction.replace(/0+$/, '');
  if (integer === '0' && !fraction) return 'N:0';
  return `N:${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

function canonicalTemporalBackupValue(value, dataType) {
  if (value instanceof Date) {
    const iso = value.toISOString();
    return dataType === 'DATE' ? `T:${iso.slice(0, 10)}` : `T:${iso.replace(/\.\d{3}Z$/, (match) => `${match.slice(0, -1)}000`)}`;
  }
  const source = String(value).trim();
  if (dataType === 'DATE') return `T:${source.slice(0, 10)}`;
  const match = source.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/);
  if (!match) return `T:${source}`;
  return `T:${match[1]}T${match[2]}.${(match[3] || '').padEnd(6, '0')}`;
}

function canonicalBackupValueForColumn(value, column) {
  if (value === null || value === undefined) return '<NULL>';
  const dataType = String(column.dataType || '').toUpperCase();
  if (['SMALLINT', 'INTEGER', 'BIGINT', 'DECIMAL', 'NUMERIC', 'DECFLOAT', 'REAL', 'DOUBLE'].includes(dataType)) {
    return canonicalNumericBackupValue(value);
  }
  if (['DATE', 'TIME', 'TIMESTAMP'].includes(dataType)) return canonicalTemporalBackupValue(value, dataType);
  return canonicalBackupValue(value);
}

function projectedHashValue(row, alias, fallbackName) {
  if (Object.prototype.hasOwnProperty.call(row, alias)) return row[alias];
  if (Object.prototype.hasOwnProperty.call(row, alias.toLowerCase())) return row[alias.toLowerCase()];
  if (Object.prototype.hasOwnProperty.call(row, fallbackName)) return row[fallbackName];
  return row[fallbackName.toLowerCase()];
}

function isLobColumn(column) {
  return LOB_DATA_TYPES.has(String(column.dataType || '').toUpperCase());
}

function lobChunkPlan(column, actualLength = column.length) {
  const declaredLength = Number(column.length);
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 1) {
    throw new Error(`BACKUP HASH BLOCK ${column.name}: invalid LOB length metadata`);
  }
  const dataType = String(column.dataType || '').toUpperCase();
  const unitLength = dataType === 'BLOB' ? Math.floor(LOB_HASH_CHUNK_CHARS / 2) : LOB_HASH_CHUNK_CHARS;
  const effectiveLength = Number(actualLength);
  if (!Number.isSafeInteger(effectiveLength) || effectiveLength < 0 || effectiveLength > declaredLength) {
    throw new Error(`BACKUP HASH BLOCK ${column.name}: invalid actual LOB length`);
  }
  const count = Math.ceil(effectiveLength / unitLength);
  const maxChunks = dataType === 'BLOB' ? MAX_BLOB_HASH_CHUNKS : MAX_CLOB_HASH_CHUNKS;
  if (count > maxChunks) {
    throw new Error(`BACKUP HASH BLOCK ${column.name}: LOB exceeds ${maxChunks} safe chunks`);
  }
  return Array.from({ length: count }, (_, index) => ({
    index,
    offset: (index * unitLength) + 1,
    length: Math.min(unitLength, effectiveLength - (index * unitLength)),
  }));
}

function projectedLobMaxLength(row, index, column) {
  const value = projectedHashValue(row, `H${index}_MAX_LENGTH`, column.name);
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error(`BACKUP HASH BLOCK ${column.name}: invalid maximum LOB length`);
  }
  // Validates catalog metadata and enforces the fixed 1 MiB CLOB / 4 MiB
  // BLOB ceiling before a data projection is constructed.
  lobChunkPlan(column, length);
  return length;
}

async function actualLobLengthsOf(schemaTable, columns, { queryFn = query } = {}) {
  const lobColumns = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => isLobColumn(column));
  if (!lobColumns.length) return new Map();
  const projection = lobColumns.map(({ column, index }) => (
    `COALESCE(MAX(COALESCE(LENGTH(${column.name}), 0)), 0) AS H${index}_MAX_LENGTH`
  ));
  const rows = await queryFn(`SELECT ${projection.join(', ')} FROM ${schemaTable}`);
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`BACKUP HASH BLOCK ${schemaTable}: invalid LOB maximum-length result`);
  }
  return new Map(lobColumns.map(({ column, index }) => [
    index,
    projectedLobMaxLength(rows[0], index, column),
  ]));
}

function contentHashProjection(columns, { lobLengths = null } = {}) {
  return columns.flatMap((column, index) => {
    const valueAlias = `H${index}_VALUE`;
    if (!isLobColumn(column)) return [`${column.name} AS ${valueAlias}`];
    const nullAlias = `H${index}_NULL`;
    const lengthAlias = `H${index}_LENGTH`;
    const maximumLength = lobLengths?.has(index) ? lobLengths.get(index) : column.length;
    const chunks = lobChunkPlan(column, maximumLength).flatMap(({ index: chunkIndex, offset, length }) => {
      const chunk = `SUBSTR(${column.name}, ${offset}, ${length})`;
      const effectiveLength = `CASE WHEN LENGTH(${column.name}) <= ${offset - 1} THEN 0 `
        + `WHEN LENGTH(${column.name}) - ${offset - 1} > ${length} THEN ${length} `
        + `ELSE LENGTH(${column.name}) - ${offset - 1} END`;
      const value = String(column.dataType || '').toUpperCase() === 'BLOB'
        ? `HEX(${chunk})`
        : `RTRIM(CAST(${chunk} AS VARCHAR(${LOB_HASH_CHUNK_CHARS})))`;
      return [
        `CASE WHEN ${column.name} IS NULL THEN NULL ELSE ${effectiveLength} END AS H${index}_C${chunkIndex}_LENGTH`,
        `CASE WHEN ${column.name} IS NULL THEN NULL ELSE ${value} END AS H${index}_C${chunkIndex}_VALUE`,
      ];
    });
    // Do not project a LOB directly. IBM i/node-odbc has returned malformed
    // result sets for direct CLOB values; all LOB data crosses the boundary as
    // bounded 8 KiB chunks. Per-chunk and total lengths preserve trailing
    // blanks and SUBSTR padding removed by RTRIM, and fail closed on loss.
    return [
      `CASE WHEN ${column.name} IS NULL THEN 1 ELSE 0 END AS ${nullAlias}`,
      `COALESCE(LENGTH(${column.name}), 0) AS ${lengthAlias}`,
      ...chunks,
    ];
  });
}

function contentHashChunkProjection(column, index, chunk) {
  const nullAlias = `H${index}_NULL`;
  const lengthAlias = `H${index}_LENGTH`;
  const chunkLengthAlias = `H${index}_C${chunk.index}_LENGTH`;
  const chunkValueAlias = `H${index}_C${chunk.index}_VALUE`;
  const columnName = column.name;
  const effectiveLength = `CASE WHEN LENGTH(${columnName}) <= ${chunk.offset - 1} THEN 0 `
    + `WHEN LENGTH(${columnName}) - ${chunk.offset - 1} > ${chunk.length} THEN ${chunk.length} `
    + `ELSE LENGTH(${columnName}) - ${chunk.offset - 1} END`;
  const value = String(column.dataType || '').toUpperCase() === 'BLOB'
    ? `HEX(SUBSTR(${columnName}, ${chunk.offset}, ${chunk.length}))`
    : `RTRIM(CAST(SUBSTR(${columnName}, ${chunk.offset}, ${chunk.length}) AS VARCHAR(${LOB_HASH_CHUNK_CHARS})))`;
  return [
    `CASE WHEN ${columnName} IS NULL THEN 1 ELSE 0 END AS ${nullAlias}`,
    `COALESCE(LENGTH(${columnName}), 0) AS ${lengthAlias}`,
    `CASE WHEN ${columnName} IS NULL THEN NULL ELSE ${effectiveLength} END AS ${chunkLengthAlias}`,
    `CASE WHEN ${columnName} IS NULL THEN NULL ELSE ${value} END AS ${chunkValueAlias}`,
  ];
}

async function contentHashOfLargeBlobSafely(schemaTable, columns, lobLengths, queryFn) {
  const nonLobColumns = columns.filter((column) => !isLobColumn(column));
  const baseRows = nonLobColumns.length
    ? await queryFn(`SELECT ${contentHashProjection(nonLobColumns).join(', ')} FROM ${schemaTable}`)
    : [];
  const baseHashes = (baseRows || []).map((row) => crypto.createHash('sha256').update(
    nonLobColumns.map((column, index) => canonicalBackupValueForColumn(
      projectedHashValue(row, `H${index}_VALUE`, column.name),
      column,
    )).join('\u001f'),
  ).digest('hex')).sort();
  const lobHashes = [];
  for (const [index, column] of columns.entries()) {
    if (!isLobColumn(column)) continue;
    const maximumLength = lobLengths.get(index);
    for (const chunk of lobChunkPlan(column, maximumLength)) {
      const projection = contentHashChunkProjection(column, index, chunk);
      const rows = await queryFn(`SELECT ${projection.join(', ')} FROM ${schemaTable}`);
      const chunkValues = (rows || []).map((row) => {
        const nullMarker = projectedHashValue(row, `H${index}_NULL`, column.name);
        if (String(nullMarker) === '1') return '<NULL>';
        if (String(nullMarker) !== '0') {
          throw new Error(`BACKUP HASH BLOCK ${schemaTable}.${column.name}: invalid LOB null marker`);
        }
        const totalLength = Number(projectedHashValue(row, `H${index}_LENGTH`, column.name));
        const length = Number(projectedHashValue(row, `H${index}_C${chunk.index}_LENGTH`, column.name));
        const value = projectedHashValue(row, `H${index}_C${chunk.index}_VALUE`, column.name);
        if (!Number.isSafeInteger(totalLength) || totalLength < 0 || totalLength > maximumLength
          || !Number.isSafeInteger(length) || length < 0 || length > chunk.length
          || value === null || value === undefined) {
          throw new Error(`BACKUP HASH BLOCK ${schemaTable}.${column.name}: invalid LOB chunk ${chunk.index}`);
        }
        const text = String(value);
        if (String(column.dataType || '').toUpperCase() === 'BLOB' && !/^[A-Fa-f0-9]*$/.test(text)) {
          throw new Error(`BACKUP HASH BLOCK ${schemaTable}.${column.name}: invalid BLOB chunk ${chunk.index}`);
        }
        return `${totalLength}:${length}:${canonicalBackupValue(text)}`;
      }).sort();
      lobHashes.push(crypto.createHash('sha256').update(chunkValues.join('\n')).digest('hex'));
    }
  }
  return crypto.createHash('sha256').update(JSON.stringify({ baseHashes, lobHashes })).digest('hex');
}

function canonicalLobProjection(row, column, index, schemaTable, maximumLength = column.length) {
  const nullMarker = projectedHashValue(row, `H${index}_NULL`, column.name);
  if (String(nullMarker) === '1') return '<NULL>';
  if (String(nullMarker) !== '0') {
    throw new Error(`BACKUP HASH BLOCK ${schemaTable}.${column.name}: invalid LOB null marker`);
  }
  const declaredChunks = lobChunkPlan(column, maximumLength);
  const totalLength = Number(projectedHashValue(row, `H${index}_LENGTH`, column.name));
  if (!Number.isSafeInteger(totalLength) || totalLength < 0 || totalLength > Number(maximumLength)) {
    throw new Error(`BACKUP HASH BLOCK ${schemaTable}.${column.name}: invalid LOB length`);
  }
  let summedLength = 0;
  const chunks = declaredChunks.map(({ index: chunkIndex, length: maxLength }) => {
    const length = Number(projectedHashValue(row, `H${index}_C${chunkIndex}_LENGTH`, column.name));
    const value = projectedHashValue(row, `H${index}_C${chunkIndex}_VALUE`, column.name);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxLength || value === null || value === undefined) {
      throw new Error(`BACKUP HASH BLOCK ${schemaTable}.${column.name}: invalid LOB chunk ${chunkIndex}`);
    }
    const text = String(value);
    if (String(column.dataType || '').toUpperCase() === 'BLOB' && !/^[A-Fa-f0-9]*$/.test(text)) {
      throw new Error(`BACKUP HASH BLOCK ${schemaTable}.${column.name}: invalid BLOB chunk ${chunkIndex}`);
    }
    summedLength += length;
    return `${length}:${canonicalBackupValue(text)}`;
  });
  if (summedLength !== totalLength) {
    throw new Error(`BACKUP HASH BLOCK ${schemaTable}.${column.name}: incomplete LOB chunks`);
  }
  return `L:${totalLength}:${chunks.join('|')}`;
}

async function contentHashOf(schemaTable, columns, { queryFn = query } = {}) {
  assertJavierTest(schemaTable);
  const names = columns.map((column) => column.name);
  if (!names.length) throw new Error(`BACKUP HASH BLOCK ${schemaTable}: no columns`);
  const lobLengths = await actualLobLengthsOf(schemaTable, columns, { queryFn });
  // IBM i/node-odbc rejects one result row containing all chunks of a large
  // BLOB (DB2 -101), although each bounded chunk is valid. Split only the
  // live driver path; unit-test query doubles keep the compact projection.
  const hasLargeBlob = [...lobLengths.entries()].some(([index, length]) => (
    String(columns[index]?.dataType || '').toUpperCase() === 'BLOB' && Number(length) > 65536
  ));
  if (hasLargeBlob && queryFn === query) {
    return contentHashOfLargeBlobSafely(schemaTable, columns, lobLengths, queryFn);
  }
  const rows = await queryFn(`SELECT ${contentHashProjection(columns, { lobLengths }).join(', ')} FROM ${schemaTable}`);
  // DB2 does not guarantee scan order (and CTAS may choose a different access
  // path). Hash the row multiset, never the result-set order, so the durable
  // manifest still detects changed values while accepting a faithful backup.
  const rowHashes = (rows || []).map((row) => {
    const serialized = columns.map((column, index) => (isLobColumn(column)
      ? canonicalLobProjection(row, column, index, schemaTable, lobLengths.get(index))
      : canonicalBackupValueForColumn(
        projectedHashValue(row, `H${index}_VALUE`, column.name),
        column,
      ))).join('\u001f');
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return crypto.createHash('sha256').update(rowHashes.join('\n')).digest('hex');
}

function affectedSchemaPairs(schemaReport) {
  return schemaReport.filter((row) => row.operations.length > 0).map((row) => row.pair);
}

const BACKUP_MANIFEST_COLUMNS = [
  'RUN_ID', 'SOURCE_TABLE', 'DESTINATION_TABLE', 'BACKUP_TABLE', 'ROW_COUNT',
  'SHAPE_HASH', 'CONTENT_HASH', 'STATUS', 'CREATED_AT', 'UPDATED_AT',
];

const BACKUP_MANIFEST_CREATE_SQL = `CREATE TABLE ${BACKUP_MANIFEST_TABLE} (
  RUN_ID VARCHAR(24) NOT NULL,
  SOURCE_TABLE VARCHAR(128) NOT NULL,
  DESTINATION_TABLE VARCHAR(128) NOT NULL,
  BACKUP_TABLE VARCHAR(128) NOT NULL,
  ROW_COUNT BIGINT NOT NULL,
  SHAPE_HASH CHAR(64) NOT NULL,
  CONTENT_HASH CHAR(64) NOT NULL,
  STATUS VARCHAR(16) NOT NULL,
  CREATED_AT TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UPDATED_AT TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (RUN_ID, DESTINATION_TABLE)
)`;

function validateBackupManifestColumns(columns) {
  const byName = new Map(columns.map((column) => [column.name, column]));
  const missing = BACKUP_MANIFEST_COLUMNS.filter((name) => !byName.has(name));
  if (missing.length) {
    throw new Error(`BACKUP MANIFEST BLOCK ${BACKUP_MANIFEST_TABLE}: missing columns [${missing.join(',')}]`);
  }
  for (const name of BACKUP_MANIFEST_COLUMNS.slice(0, 8)) {
    if (byName.get(name).isNullable !== 'NO') {
      throw new Error(`BACKUP MANIFEST BLOCK ${BACKUP_MANIFEST_TABLE}.${name}: must be NOT NULL`);
    }
  }
  return true;
}

async function ensureBackupManifestTable({
  tableExistsFn = tableExists,
  columnsOfFn = columnsOf,
  executeFn = run,
  apply = APPLY,
} = {}) {
  assertJavierTest(BACKUP_MANIFEST_TABLE);
  if (await tableExistsFn(BACKUP_MANIFEST_TABLE)) {
    validateBackupManifestColumns(await columnsOfFn(BACKUP_MANIFEST_TABLE));
    return { table: BACKUP_MANIFEST_TABLE, operations: [], created: false };
  }
  console.log(apply ? 'BACKUP MANIFEST APPLY' : '[DRY] BACKUP MANIFEST', BACKUP_MANIFEST_CREATE_SQL);
  if (!apply) {
    return { table: BACKUP_MANIFEST_TABLE, operations: [BACKUP_MANIFEST_CREATE_SQL], created: false };
  }
  await executeFn(BACKUP_MANIFEST_CREATE_SQL);
  if (!(await tableExistsFn(BACKUP_MANIFEST_TABLE))) {
    throw new Error(`BACKUP MANIFEST BLOCK ${BACKUP_MANIFEST_TABLE}: create not visible`);
  }
  validateBackupManifestColumns(await columnsOfFn(BACKUP_MANIFEST_TABLE));
  return { table: BACKUP_MANIFEST_TABLE, operations: [BACKUP_MANIFEST_CREATE_SQL], created: true };
}

function normalizeBackupManifestRow(row) {
  if (!row) return null;
  const value = (name) => row[name] ?? row[name.toLowerCase()];
  return {
    runId: String(value('RUN_ID') || '').trim(),
    source: String(value('SOURCE_TABLE') || '').trim().toUpperCase(),
    destination: String(value('DESTINATION_TABLE') || '').trim().toUpperCase(),
    backup: String(value('BACKUP_TABLE') || '').trim().toUpperCase(),
    rowCount: Number(value('ROW_COUNT')),
    shapeHash: String(value('SHAPE_HASH') || '').trim().toLowerCase(),
    contentHash: String(value('CONTENT_HASH') || '').trim().toLowerCase(),
    status: String(value('STATUS') || '').trim().toUpperCase(),
  };
}

function validateBackupManifestRecord(record, expected) {
  if (!record) throw new Error(`BACKUP MANIFEST BLOCK ${expected.destination}: missing durable manifest`);
  const exact = ['runId', 'source', 'destination', 'backup'];
  for (const key of exact) {
    if (record[key] !== expected[key]) {
      throw new Error(`BACKUP MANIFEST BLOCK ${expected.destination}: ${key} mismatch`);
    }
  }
  if (!Number.isInteger(record.rowCount) || record.rowCount < 0) {
    throw new Error(`BACKUP MANIFEST BLOCK ${expected.destination}: invalid row count`);
  }
  if (!/^[a-f0-9]{64}$/.test(record.shapeHash) || !/^[a-f0-9]{64}$/.test(record.contentHash)) {
    throw new Error(`BACKUP MANIFEST BLOCK ${expected.destination}: invalid SHA-256`);
  }
  if (!['PLANNED', 'READY'].includes(record.status)) {
    throw new Error(`BACKUP MANIFEST BLOCK ${expected.destination}: invalid status ${record.status}`);
  }
  return record;
}

function assertBackupManifestWriteSql(sql) {
  const normalized = String(sql || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const target = BACKUP_MANIFEST_TABLE.replace('.', '\\.');
  if (!(new RegExp(`^(INSERT INTO|UPDATE) ${target}(?:\\s|$)`)).test(normalized)) {
    throw new Error('BACKUP MANIFEST BLOCK: refusing non-manifest mutation');
  }
  refuseDsedacWriteSql(sql);
}

async function commitBackupManifestWrite(sql, params, { getPoolFn = getPool } = {}) {
  assertBackupManifestWriteSql(sql);
  const pool = getPoolFn();
  if (!pool || typeof pool.connect !== 'function') {
    throw new Error('BACKUP MANIFEST BLOCK: dedicated DB2 connection unavailable');
  }
  const connection = await pool.connect();
  try {
    await connection.beginTransaction();
    await connection.query(sql, params);
    await connection.commit();
  } catch (error) {
    try { await connection.rollback(); } catch (_) { /* best effort */ }
    throw error;
  } finally {
    await connection.close();
  }
}

function createDbBackupManifestStore({
  tableExistsFn = tableExists,
  columnsOfFn = columnsOf,
  executeFn = run,
  queryWithParamsFn = queryWithParams,
  committedWriteFn = commitBackupManifestWrite,
  getPoolFn = getPool,
  apply = APPLY,
} = {}) {
  return {
    ensure: () => ensureBackupManifestTable({ tableExistsFn, columnsOfFn, executeFn, apply }),
    async read(runId, destination) {
      const rows = await queryWithParamsFn(
        `SELECT RUN_ID, SOURCE_TABLE, DESTINATION_TABLE, BACKUP_TABLE, ROW_COUNT,
                SHAPE_HASH, CONTENT_HASH, STATUS
           FROM ${BACKUP_MANIFEST_TABLE}
          WHERE RUN_ID = ? AND DESTINATION_TABLE = ?`,
        [runId, destination],
      );
      return normalizeBackupManifestRow(rows?.[0]);
    },
    async create(record) {
      await committedWriteFn(
        `INSERT INTO ${BACKUP_MANIFEST_TABLE}
          (RUN_ID, SOURCE_TABLE, DESTINATION_TABLE, BACKUP_TABLE, ROW_COUNT,
           SHAPE_HASH, CONTENT_HASH, STATUS)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PLANNED')`,
        [record.runId, record.source, record.destination, record.backup, record.rowCount,
          record.shapeHash, record.contentHash],
        { getPoolFn },
      );
      return this.read(record.runId, record.destination);
    },
    async markReady(record) {
      if (record.status === 'READY') return record;
      await committedWriteFn(
        `UPDATE ${BACKUP_MANIFEST_TABLE}
            SET STATUS = 'READY', UPDATED_AT = CURRENT_TIMESTAMP
          WHERE RUN_ID = ? AND DESTINATION_TABLE = ? AND SOURCE_TABLE = ?
            AND BACKUP_TABLE = ? AND ROW_COUNT = ? AND SHAPE_HASH = ? AND CONTENT_HASH = ?`,
        [record.runId, record.destination, record.source, record.backup, record.rowCount,
          record.shapeHash, record.contentHash],
        { getPoolFn },
      );
      return this.read(record.runId, record.destination);
    },
  };
}

async function validateTableAgainstManifest(schemaTable, manifest, {
  countOfFn,
  columnsOfFn,
  contentHashOfFn,
}) {
  const rowCount = await countOfFn(schemaTable);
  if (rowCount < 0) throw new Error(`BACKUP BLOCK ${schemaTable}: row count unavailable`);
  const columns = await columnsOfFn(schemaTable);
  const shapeHash = backupShapeHash(columns);
  const contentHash = await contentHashOfFn(schemaTable, columns);
  if (rowCount !== manifest.rowCount
    || shapeHash !== manifest.shapeHash
    || contentHash !== manifest.contentHash) {
    throw new Error(`BACKUP MANIFEST BLOCK ${schemaTable}: count/schema/content mismatch`);
  }
  return { rowCount, columns, shapeHash, contentHash };
}

async function backupTestTable(destination, runId, {
  source = destination.replace(/^JAVIER\.TEST_/, 'JAVIER.'),
  tableExistsFn = tableExists,
  columnsOfFn = columnsOf,
  countOfFn = countOf,
  contentHashOfFn = contentHashOf,
  executeFn = run,
  queryWithParamsFn = queryWithParams,
  committedWriteFn = commitBackupManifestWrite,
  getPoolFn = getPool,
  manifestStore = null,
  apply = APPLY,
} = {}) {
  assertJavierTest(destination);
  assertJavierSource(source);
  validateCopyRunId(runId);
  const normalizedSource = source.toUpperCase();
  const normalizedDestination = destination.toUpperCase();
  const backup = backupTableName(normalizedDestination, runId);
  const store = manifestStore || createDbBackupManifestStore({
    tableExistsFn, columnsOfFn, executeFn, queryWithParamsFn,
    committedWriteFn, getPoolFn, apply,
  });
  const expected = {
    runId, source: normalizedSource, destination: normalizedDestination, backup,
  };
  const [destinationExists, backupExists] = await Promise.all([
    tableExistsFn(normalizedDestination),
    tableExistsFn(backup),
  ]);
  const emptyContentHash = crypto.createHash('sha256').update('').digest('hex');

  const persistSnapshot = async (planned) => {
    await store.ensure();
    let manifest = await store.read(runId, normalizedDestination);
    if (manifest) {
      manifest = validateBackupManifestRecord(manifest, expected);
    } else {
      manifest = validateBackupManifestRecord(await store.create(planned), expected);
    }
    if (manifest.rowCount !== planned.rowCount
      || manifest.shapeHash !== planned.shapeHash
      || manifest.contentHash !== planned.contentHash) {
      throw new Error(`BACKUP MANIFEST BLOCK ${destination}: durable snapshot mismatch`);
    }
    return manifest;
  };

  if (!destinationExists && !backupExists) {
    const sourceColumns = await columnsOfFn(normalizedSource);
    const planned = {
      ...expected,
      rowCount: 0,
      shapeHash: backupShapeHash(sourceColumns),
      contentHash: emptyContentHash,
      status: 'PLANNED',
    };
    console.log(apply ? 'BACKUP CHECKPOINT' : '[DRY] BACKUP CHECKPOINT', normalizedDestination, '(missing; manifest only)', 'rows=0');
    if (!apply) return { destination, skipped: 'missing', rowCount: 0, manifestPlanned: true };
    let manifest = await persistSnapshot(planned);
    manifest = validateBackupManifestRecord(await store.markReady(manifest), expected);
    if (manifest.status !== 'READY') {
      throw new Error(`BACKUP MANIFEST BLOCK ${destination}: missing READY checkpoint not durable`);
    }
    return { destination, skipped: 'missing', rowCount: 0, manifestReady: true };
  }

  const rowCount = destinationExists ? await countOfFn(normalizedDestination) : 0;
  if (rowCount < 0) throw new Error(`BACKUP BLOCK ${destination}: row count unavailable`);

  if (backupExists) {
    await store.ensure();
    let manifest = validateBackupManifestRecord(
      await store.read(runId, normalizedDestination), expected,
    );
    const verifiedBackup = await validateTableAgainstManifest(backup, manifest, {
      countOfFn, columnsOfFn, contentHashOfFn,
    });
    if (destinationExists && rowCount > 0) {
      await validateTableAgainstManifest(normalizedDestination, manifest, {
        countOfFn, columnsOfFn, contentHashOfFn,
      });
    }
    manifest = validateBackupManifestRecord(await store.markReady(manifest), expected);
    if (manifest.status !== 'READY') {
      throw new Error(`BACKUP MANIFEST BLOCK ${destination}: READY checkpoint not durable`);
    }
    return {
      destination, backup, rowCount, backupCount: verifiedBackup.rowCount, resumed: true,
      destinationMissing: !destinationExists,
      destinationRecreatedEmpty: destinationExists && rowCount === 0,
      schemaHash: manifest.shapeHash,
      contentHash: manifest.contentHash,
    };
  }

  const destinationColumns = await columnsOfFn(normalizedDestination);
  const names = destinationColumns.map((column) => column.name);
  if (!names.length) throw new Error(`BACKUP BLOCK ${destination}: no columns`);
  const shapeHash = backupShapeHash(destinationColumns);
  const contentHash = await contentHashOfFn(normalizedDestination, destinationColumns);
  const plannedManifest = {
    ...expected, rowCount, shapeHash, contentHash, status: 'PLANNED',
  };
  console.log(
    apply ? 'BACKUP CHECKPOINT' : '[DRY] BACKUP CHECKPOINT',
    normalizedDestination, rowCount > 0 ? `-> ${backup}` : '(empty; manifest only)', `rows=${rowCount}`,
  );
  if (!apply) return {
    destination, backup: rowCount > 0 ? backup : null,
    rowCount, resumed: false, shapeHash, contentHash, manifestPlanned: true,
  };

  let manifest = await persistSnapshot(plannedManifest);
  if (rowCount === 0) {
    manifest = validateBackupManifestRecord(await store.markReady(manifest), expected);
    if (manifest.status !== 'READY') {
      throw new Error(`BACKUP MANIFEST BLOCK ${destination}: empty READY checkpoint not durable`);
    }
    return {
      destination, skipped: 'empty', rowCount, manifestReady: true,
      schemaHash: manifest.shapeHash, contentHash: manifest.contentHash,
    };
  }

  const sql = `CREATE TABLE ${backup} AS (SELECT ${names.join(', ')} FROM ${normalizedDestination}) WITH DATA`;
  await executeFn(sql);
  if (!(await tableExistsFn(backup))) throw new Error(`BACKUP BLOCK ${backup}: create not visible`);
  await validateTableAgainstManifest(backup, manifest, {
    countOfFn, columnsOfFn, contentHashOfFn,
  });
  manifest = validateBackupManifestRecord(await store.markReady(manifest), expected);
  if (manifest.status !== 'READY') {
    throw new Error(`BACKUP MANIFEST BLOCK ${destination}: READY checkpoint not durable`);
  }
  return {
    destination, backup, rowCount, resumed: false,
    schemaHash: manifest.shapeHash, contentHash: manifest.contentHash,
  };
}

async function backupMappedDestinations(pairs, runId, dependencies = {}) {
  const byDestination = new Map();
  for (const pair of pairs) {
    const existing = byDestination.get(pair.dst);
    if (existing && existing.src !== pair.src) {
      throw new Error(`BACKUP BLOCK ${pair.dst}: conflicting sources ${existing.src} and ${pair.src}`);
    }
    byDestination.set(pair.dst, pair);
  }
  const report = [];
  for (const pair of byDestination.values()) {
    report.push(await backupTestTable(pair.dst, runId, { ...dependencies, source: pair.src }));
  }
  return report;
}

async function backupNonSchemaCopyDestinations(pairs, runId, {
  ensureBackupManifestTableFn = ensureBackupManifestTable,
  backupMappedDestinationsFn = backupMappedDestinations,
  backupTestTableFn = backupTestTable,
  apply = APPLY,
} = {}) {
  // The durable manifest is a prerequisite for every APPLY backup checkpoint.
  // In dry-run this only plans the manifest DDL; it must not write anything.
  await ensureBackupManifestTableFn({ apply });
  await backupMappedDestinationsFn(pairs, runId);
  await backupTestTableFn(TEST_FIRMAS, runId, { source: PROD_FIRMAS });
}

async function preflightMappingPairs(pairs, {
  tableExistsFn = tableExists,
  columnsOfFn = columnsOf,
  operationalContractsOfFn = operationalContractsOf,
} = {}) {
  for (const pair of pairs) {
    const [sourceExists, destinationExists] = await Promise.all([
      tableExistsFn(pair.src),
      tableExistsFn(pair.dst),
    ]);
    if (!sourceExists || !destinationExists) {
      throw new Error(
        `COPY PREFLIGHT BLOCK ${pair.src} -> ${pair.dst}: `
        + `missing ${!sourceExists ? 'source' : ''}${!sourceExists && !destinationExists ? '+' : ''}`
        + `${!destinationExists ? 'destination' : ''} table`,
      );
    }

    const sourceColumns = await columnsOfFn(pair.src);
    const destinationColumns = await columnsOfFn(pair.dst);
    const comparison = compareTableMetadata(sourceColumns, destinationColumns);
    const auditOperationalContracts = shouldAuditOperationalContracts(pair);
    const sourceContracts = auditOperationalContracts
      ? await operationalContractsOfFn(pair.src) : [];
    const destinationContracts = auditOperationalContracts
      ? await operationalContractsOfFn(pair.dst) : [];
    const missingContracts = buildOperationalContractPlan(pair, sourceContracts, destinationContracts);
    if (!comparison.ok) {
      throw new Error(
        `COPY PREFLIGHT BLOCK ${pair.src} -> ${pair.dst}: `
        + `missing=[${comparison.missing.join(',')}], extra=[${comparison.extra.join(',')}], `
        + `deltas=[${comparison.deltas.map((delta) => delta.name).join(',')}], `
        + `identity=[${comparison.identityDeltas.join(',')}]`,
      );
    }
    if (missingContracts.length) {
      throw new Error(`OPERATIONAL PREFLIGHT BLOCK ${pair.src} -> ${pair.dst}: missing=[${missingContracts.map((operation) => operation.signature).join(';')}]`);
    }
    console.log(`PREFLIGHT OK ${pair.src} -> ${pair.dst}`);
  }
}

async function runAfterCopyPreflight(pairs, mutate, dependencies) {
  await preflightMappingPairs(pairs, dependencies);
  return mutate();
}

async function tableExists(schemaTable) {
  const [schema, table] = schemaTable.split('.');
  const rows = await queryWithParams(
    `SELECT 1 AS OK FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        AND TABLE_TYPE IN ('T', 'P')`,
    [schema, table],
  );
  return rows.length > 0;
}

async function sequenceExists(schemaSequence) {
  const [schema, sequence] = schemaSequence.split('.');
  const rows = await queryWithParams(
    `SELECT 1 AS OK FROM QSYS2.SYSSEQUENCES
      WHERE SEQUENCE_SCHEMA = ? AND SEQUENCE_NAME = ?`,
    [schema, sequence],
  );
  return rows.length > 0;
}

async function countOf(schemaTable, whereSql = '', params = []) {
  try {
    const sql = whereSql
      ? `SELECT COUNT(*) AS N FROM ${schemaTable} WHERE ${whereSql}`
      : `SELECT COUNT(*) AS N FROM ${schemaTable}`;
    let rows;
    if (activeTransactionConnection) {
      rows = params.length
        ? await activeTransactionConnection.query(sql, params)
        : await activeTransactionConnection.query(sql);
    } else {
      rows = params.length
        ? await queryWithParams(sql, params)
        : await query(sql);
    }
    return Number(rows?.[0]?.N ?? rows?.[0]?.n ?? 0);
  } catch {
    return -1;
  }
}


async function countNulls(schemaTable, column) {
  assertJavierTest(schemaTable);
  const safeColumn = String(column || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*$/.test(safeColumn)) {
    throw new Error(`Invalid TEST column identifier: ${column}`);
  }
  const rows = await query(`SELECT COUNT(*) AS N FROM ${schemaTable} WHERE ${safeColumn} IS NULL`);
  const count = Number(rows?.[0]?.N ?? rows?.[0]?.n);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`NULL count unavailable for ${schemaTable}.${safeColumn}`);
  }
  return count;
}
let activeTransactionConnection = null;
const tableStepReport = [];

async function runTableStep(label, destination, operation, {
  getPoolFn = getPool,
  apply = APPLY,
} = {}) {
  assertJavierTest(destination);
  if (!apply) {
    await operation();
    tableStepReport.push({ label, destination, status: 'DRY_RUN' });
    return;
  }
  const pool = getPoolFn();
  if (!pool || typeof pool.connect !== 'function') throw new Error('DB2 transaction pool unavailable');
  const connection = await pool.connect();
  try {
    await connection.beginTransaction();
    activeTransactionConnection = connection;
    await operation();
    await connection.commit();
    tableStepReport.push({ label, destination, status: 'COMMITTED' });
  } catch (error) {
    try { await connection.rollback(); } catch (_) { /* best effort */ }
    tableStepReport.push({ label, destination, status: 'ROLLED_BACK', error: error.message });
    throw error;
  } finally {
    activeTransactionConnection = null;
    await connection.close();
  }
}

async function run(sql, params = []) {
  refuseDsedacWriteSql(sql);
  if (!APPLY) {
    console.log('[DRY]', sql.replace(/\s+/g, ' ').slice(0, 200), params.length ? params : '');
    return { rowCount: 0 };
  }
  if (activeTransactionConnection) {
    return params.length
      ? activeTransactionConnection.query(sql, params)
      : activeTransactionConnection.query(sql);
  }
  if (params.length) return queryWithParams(sql, params);
  return query(sql);
}

function intersectionColumns(srcCols, dstCols) {
  const dstNames = new Set(dstCols.map((c) => c.name));
  return srcCols.map((c) => c.name).filter((n) => dstNames.has(n));
}

function ymdNumericExpr(ano, mes, dia) {
  return `(${ano} * 10000 + ${mes} * 100 + ${dia})`;
}

function cutoffYmdSql(days) {
  const n = Number(days);
  return `(YEAR(CURRENT DATE - ${n} DAYS) * 10000`
    + ` + MONTH(CURRENT DATE - ${n} DAYS) * 100`
    + ` + DAY(CURRENT DATE - ${n} DAYS))`;
}

function collectMappingPairs() {
  const prod = TABLE_MAPPINGS.production;
  const test = TABLE_MAPPINGS.isolated_test;
  const pairs = [];
  for (const group of Object.keys(prod)) {
    for (const key of Object.keys(prod[group])) {
      pairs.push({
        group,
        key,
        src: prod[group][key],
        dst: test[group][key],
        erpSeeded: ERP_SEEDED_KEYS.has(key),
        objectType: key === 'liquidationSequence' ? 'SEQUENCE' : 'TABLE',
      });
    }
  }
  return pairs;
}

async function clearTestRows(table, { executeFn = run } = {}) {
  assertJavierTest(table);
  console.log('DELETE', table);
  await executeFn(`DELETE FROM ${table}`);
}

async function copyIntersection(src, dst, {
  whereSql = '',
  params = [],
  label = 'COPY',
  allowErpSource = false,
} = {}) {
  if (allowErpSource) assertReadOnlyErp(src);
  else assertJavierSource(src);
  assertJavierTest(dst);

  if (!(await tableExists(src)) || !(await tableExists(dst))) {
    console.log('SKIP missing', src, '→', dst);
    summaryRows.push({ label, src, dst, srcCount: -1, destCount: -1, note: 'missing' });
    return;
  }

  const srcCols = await columnsOf(src);
  const dstCols = await columnsOf(dst);
  const common = intersectionColumns(srcCols, dstCols);
  if (common.length === 0) {
    console.log('SKIP no common columns', src, '→', dst);
    summaryRows.push({ label, src, dst, srcCount: 0, destCount: 0, note: 'no-common-cols' });
    return;
  }

  if (common.length !== srcCols.length || common.length !== dstCols.length) {
    console.log(
      `WARN subset ${src}→${dst}: common=${common.length} src=${srcCols.length} dst=${dstCols.length}`,
    );
  }

  const srcCount = await countOf(src, whereSql, params);
  const hasIdentity = dstCols.some((c) => c.identity && common.includes(c.name));
  const colList = common.join(', ');
  const sql = `
    INSERT INTO ${dst} (${colList})
    ${hasIdentity ? 'OVERRIDING SYSTEM VALUE' : ''}
    SELECT ${colList} FROM ${src}
    ${whereSql ? `WHERE ${whereSql}` : ''}
  `;
  console.log(
    `${label} ${src} → ${dst} (${common.length} cols, src≈${srcCount})`
    + `${APPLY ? '' : ' [dry-run]'}`,
  );
  await run(sql, params);
  const destCount = APPLY ? await countOf(dst) : srcCount;
  if (APPLY && destCount !== srcCount) {
    throw new Error(`COPY COUNT MISMATCH ${src} -> ${dst}: source=${srcCount} destination=${destCount}`);
  }
  summaryRows.push({
    label,
    src,
    dst,
    srcCount,
    destCount,
    note: hasIdentity ? 'OVERRIDING SYSTEM VALUE' : '',
  });
}

function confirmationBundlePlan(pairs) {
  const byKey = new Map(pairs.map((pair) => [pair.key, pair]));
  const required = ['confirmations', 'lines', 'evidences', 'confirmationEvidences'];
  const missing = required.filter((key) => !byKey.has(key));
  if (missing.length) {
    throw new Error(`CONFIRMATION BUNDLE BLOCK missing mappings [${missing.join(',')}]`);
  }
  return {
    // Link table first; confirmations reference evidences through FIRMA_EVIDENCE_ID.
    clear: [
      byKey.get('confirmationEvidences'),
      byKey.get('lines'),
      byKey.get('confirmations'),
      byKey.get('evidences'),
    ],
    // Evidence must exist before a confirmation can reference its signature.
    copy: [
      byKey.get('evidences'),
      byKey.get('confirmations'),
      byKey.get('lines'),
      byKey.get('confirmationEvidences'),
    ],
  };
}

async function copyConfirmationBundle(pairs) {
  const plan = confirmationBundlePlan(pairs);
  for (const pair of plan.clear) await clearTestRows(pair.dst);
  for (const pair of plan.copy) {
    await copyIntersection(pair.src, pair.dst, { label: `ISO ${pair.group}.${pair.key}` });
  }
}

async function ensureTestDeliveryStatus() {
  assertJavierTest(TEST_DELIVERY);
  if (await tableExists(TEST_DELIVERY)) {
    console.log('OK exists', TEST_DELIVERY);
    return;
  }
  if (await tableExists(BKP_DELIVERY)) {
    console.log('CREATE', TEST_DELIVERY, 'LIKE', BKP_DELIVERY);
    await run(`CREATE TABLE ${TEST_DELIVERY} LIKE ${BKP_DELIVERY}`);
    return;
  }
  console.log('CREATE', TEST_DELIVERY, '(explicit 8 cols)');
  await run(`
    CREATE TABLE ${TEST_DELIVERY} (
      ID INTEGER NOT NULL,
      STATUS VARCHAR(40),
      OBSERVACIONES VARCHAR(512),
      FIRMA_PATH VARCHAR(512),
      LATITUD DECIMAL(12, 8),
      LONGITUD DECIMAL(12, 8),
      REPARTIDOR_ID VARCHAR(20),
      UPDATED_AT TIMESTAMP
    )
  `);
}

async function seedLqdToLiquidacionOps() {
  const dst = TABLE_MAPPINGS.isolated_test.finance.liquidationOps;
  assertJavierTest(dst);
  assertReadOnlyErp(ERP_LQD);

  if (!(await tableExists(ERP_LQD)) || !(await tableExists(dst))) {
    console.log('SKIP ERP LQD seed — missing table');
    return;
  }

  await clearTestRows(dst);

  // TEST unique indexes:
  //  UX_T_RLO_TOKEN   → IDEMPOTENCY_TOKEN
  //  UX_T_RLO_MARKER  → IDMARCALIQUIDACION
  //  UX_T_RLO_REP_DAY → CODIGOVENDEDOR + DIA/MES/ANO
  // So: 1 row per repartidor/day, synthesize unique token/marker, omit ERP ID.
  const whereParts = [
    `${ymdNumericExpr('ANOLIQUIDACION', 'MESLIQUIDACION', 'DIALIQUIDACION')} >= ${cutoffYmdSql(DAYS)}`,
    'DIALIQUIDACION > 0',
    'MESLIQUIDACION > 0',
    'ANOLIQUIDACION > 0',
    "TRIM(COALESCE(CODIGOVENDEDOR, '')) <> ''",
  ];
  const params = [];
  if (REPARTIDOR) {
    whereParts.push('TRIM(CODIGOVENDEDOR) = ?');
    params.push(REPARTIDOR);
  }
  const whereSql = whereParts.join(' AND ');

  const srcCount = await countOf(ERP_LQD, whereSql, params);
  const sql = `
    INSERT INTO ${dst} (
      SUBEMPRESALIQUIDACION, EJERCICIOLIQUIDACION, SERIELIQUIDACION, TERMINALLIQUIDACION,
      NUMEROLIQUIDACION, DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION, HORALIQUIDACION,
      CODIGOVENDEDOR, CODIGOVENDEDORUSUARIO, CODIGOUSUARIO, MATRICULA,
      KILOMETROSSALIDA, KILOMETROSLLEGADA, KILOMETROSRECORRIDOS,
      IMPORTEEFECTIVO, IMPORTECHEQUES, IMPORTEPOSTDATADOS, IMPORTESALDOACTUAL,
      IMPORTETOTALAINGRESAR, IMPORTEINGRESOENBANCO, IMPORTEGASTOS, IMPRESOSN,
      CODIGOVEHICULO, REVISADOSN, IDMARCALIQUIDACION, IMPORTEEFECTIVO2,
      IMPORTEENTREGADO2, IMPORTETARJETA, MARCAACTUALIZACION,
      IDEMPOTENCY_TOKEN, STATUS, OPERADOR, PANTALLA_ORIGEN
    )
    SELECT
      SUBEMPRESALIQUIDACION, EJERCICIOLIQUIDACION, SERIELIQUIDACION, TERMINALLIQUIDACION,
      NUMEROLIQUIDACION, DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION, HORALIQUIDACION,
      CODIGOVENDEDOR, CODIGOVENDEDORUSUARIO, CODIGOUSUARIO, MATRICULA,
      KILOMETROSSALIDA, KILOMETROSLLEGADA, KILOMETROSRECORRIDOS,
      IMPORTEEFECTIVO, IMPORTECHEQUES, IMPORTEPOSTDATADOS, IMPORTESALDOACTUAL,
      IMPORTETOTALAINGRESAR, IMPORTEINGRESOENBANCO, IMPORTEGASTOS, IMPRESOSN,
      CODIGOVEHICULO, REVISADOSN,
      CAST(('ERP-' || TRIM(CODIGOVENDEDOR) || '-'
        || TRIM(VARCHAR(ANOLIQUIDACION * 10000 + MESLIQUIDACION * 100 + DIALIQUIDACION))
        || '-' || TRIM(VARCHAR(NUMEROLIQUIDACION))) AS CHAR(30)),
      IMPORTEEFECTIVO2, IMPORTEENTREGADO2, IMPORTETARJETA, MARCAACTUALIZACION,
      CAST(('ERP-LQD-' || TRIM(CODIGOVENDEDOR) || '-'
        || TRIM(VARCHAR(ANOLIQUIDACION * 10000 + MESLIQUIDACION * 100 + DIALIQUIDACION))
        || '-' || TRIM(VARCHAR(NUMEROLIQUIDACION))) AS VARCHAR(128)),
      'CLOSED', 'ERP-SEED', 'LIQUIDACIONDIARIA'
    FROM (
      SELECT L.*,
             ROW_NUMBER() OVER (
               PARTITION BY TRIM(CODIGOVENDEDOR), DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION
               ORDER BY HORALIQUIDACION DESC, NUMEROLIQUIDACION DESC
             ) AS RN
        FROM ${ERP_LQD} L
       WHERE ${whereSql}
    ) X
    WHERE RN = 1
  `;

  console.log(
    `ERP-SEED LQD→liquidacionOps ${ERP_LQD} → ${dst} (dedupe rep+day, src≈${srcCount})`
    + `${APPLY ? '' : ' [dry-run]'}`,
  );
  await run(sql, params);
  const destCount = APPLY ? await countOf(dst) : srcCount;
  summaryRows.push({
    label: 'ERP-SEED LQD→liquidacionOps',
    src: ERP_LQD,
    dst,
    srcCount,
    destCount,
    note: 'dedupe CODIGOVENDEDOR+day; unique token/marker',
  });
}

function lqdWindowWhere(alias = '') {
  const p = alias ? `${alias}.` : '';
  const parts = [
    `${ymdNumericExpr(`${p}ANOLIQUIDACION`, `${p}MESLIQUIDACION`, `${p}DIALIQUIDACION`)} >= ${cutoffYmdSql(DAYS)}`,
    `${p}DIALIQUIDACION > 0`,
    `${p}MESLIQUIDACION > 0`,
    `${p}ANOLIQUIDACION > 0`,
    `TRIM(COALESCE(${p}CODIGOVENDEDOR, '')) <> ''`,
  ];
  const params = [];
  if (REPARTIDOR) {
    parts.push(`TRIM(${p}CODIGOVENDEDOR) = ?`);
    params.push(REPARTIDOR);
  }
  return { whereSql: parts.join(' AND '), params };
}

function lqdDedupeSubquery() {
  const { whereSql } = lqdWindowWhere();
  return `
    SELECT L.*,
           ROW_NUMBER() OVER (
             PARTITION BY TRIM(CODIGOVENDEDOR), DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION
             ORDER BY HORALIQUIDACION DESC, NUMEROLIQUIDACION DESC
           ) AS RN
      FROM ${ERP_LQD} L
     WHERE ${whereSql}
  `;
}

const LQD_COBROS_SEED_COLUMNS = Object.freeze([
  'CODIGOVENDEDOR', 'CODIGOVENDEDORCOBRO', 'DIACOBRO', 'MESCOBRO', 'ANOCOBRO',
  'IMPORTEVENCIMIENTO', 'IMPORTEPENDIENTE', 'CODIGOFORMAPAGO', 'IDEMPOTENCY_TOKEN',
  'PANTALLA_ORIGEN', 'OPERADOR', 'LIQUIDADO_SN', 'LIQUIDACION_TOKEN', 'NUMEROLIQUIDACION',
]);

function assertLqdCobrosSeedCoverage(destinationColumns) {
  const id = destinationColumns.find((column) => column.name === 'ID');
  if (!id?.identity) throw new Error('ERP LQD COBROS PREFLIGHT BLOCK: destination ID must be identity before DELETE');
  const covered = new Set(LQD_COBROS_SEED_COLUMNS);
  const gaps = destinationColumns
    .filter((column) => column.isNullable === 'NO' && !column.hasDefault && !column.identity)
    .map((column) => column.name)
    .filter((name) => !covered.has(name));
  if (gaps.length) throw new Error(`ERP LQD COBROS PREFLIGHT BLOCK: mandatory columns missing=[${gaps.join(',')}]`);
}

function lqdCobrosSplitCte() {
  return `
    WITH LQD_DEDUP AS (${lqdDedupeSubquery()}),
    SPLIT (CODIGOVENDEDOR, DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION,
           NUMEROLIQUIDACION, FORMA, IMPORTE) AS (
      SELECT CODIGOVENDEDOR, DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION, NUMEROLIQUIDACION, 'EF' AS FORMA, IMPORTEEFECTIVO AS IMPORTE
        FROM LQD_DEDUP WHERE RN = 1 AND IMPORTEEFECTIVO > 0
      UNION ALL
      SELECT CODIGOVENDEDOR, DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION, NUMEROLIQUIDACION, 'CH', IMPORTECHEQUES
        FROM LQD_DEDUP WHERE RN = 1 AND IMPORTECHEQUES > 0
      UNION ALL
      SELECT CODIGOVENDEDOR, DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION, NUMEROLIQUIDACION, 'TJ', IMPORTETARJETA
        FROM LQD_DEDUP WHERE RN = 1 AND IMPORTETARJETA > 0
      UNION ALL
      SELECT CODIGOVENDEDOR, DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION, NUMEROLIQUIDACION, 'PD', IMPORTEPOSTDATADOS
        FROM LQD_DEDUP WHERE RN = 1 AND IMPORTEPOSTDATADOS > 0
    )
  `;
}

async function lqdCobrosSplitCount(params) {
  const sql = `${lqdCobrosSplitCte()} SELECT COUNT(*) AS N FROM SPLIT`;
  const rows = activeTransactionConnection
    ? await activeTransactionConnection.query(sql, params)
    : await queryWithParams(sql, params);
  const count = Number(rows?.[0]?.N ?? rows?.[0]?.n);
  if (!Number.isInteger(count) || count < 0) throw new Error('ERP LQD cobros source count unavailable');
  return count;
}

function lqdCobrosInsertSql(destination) {
  assertJavierTest(destination);
  return `
    INSERT INTO ${destination} (${LQD_COBROS_SEED_COLUMNS.join(', ')})
    ${lqdCobrosSplitCte()}
    SELECT CODIGOVENDEDOR, CODIGOVENDEDOR, DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION,
      IMPORTE, 0, FORMA,
      CAST(('ERP-COB-' || FORMA || '-' || TRIM(CODIGOVENDEDOR) || '-'
        || TRIM(VARCHAR(ANOLIQUIDACION * 10000 + MESLIQUIDACION * 100 + DIALIQUIDACION))
        || '-' || TRIM(VARCHAR(NUMEROLIQUIDACION))) AS VARCHAR(128)),
      'LIQUIDACIONDIARIA', 'ERP-SEED', 'S',
      CAST(('ERP-COB-' || FORMA || '-' || TRIM(CODIGOVENDEDOR) || '-'
        || TRIM(VARCHAR(ANOLIQUIDACION * 10000 + MESLIQUIDACION * 100 + DIALIQUIDACION))
        || '-' || TRIM(VARCHAR(NUMEROLIQUIDACION))) AS VARCHAR(128)),
      NUMEROLIQUIDACION
    FROM SPLIT
  `;
}

async function seedLqdDerivedCobros() {
  const dst = TABLE_MAPPINGS.isolated_test.finance.cobros;
  assertJavierTest(dst);
  assertReadOnlyErp(ERP_LQD);
  if (SKIP_CVC) {
    console.log('SKIP LQD-derived cobros (--skip-cvc)');
    return;
  }
  if (!(await tableExists(ERP_LQD)) || !(await tableExists(dst))) {
    console.log('SKIP LQD cobros seed — missing table');
    return;
  }

  const destinationColumns = await columnsOf(dst);
  assertLqdCobrosSeedCoverage(destinationColumns);
  const { params } = lqdWindowWhere();
  const sourceCount = await lqdCobrosSplitCount(params);
  await clearTestRows(dst);
  console.log(`ERP-SEED LQD→cobros EF/CH/TJ/PD rows=${sourceCount}${APPLY ? '' : ' [dry-run]'}`);
  await run(lqdCobrosInsertSql(dst), params);
  const destCount = APPLY ? await countOf(dst) : sourceCount;
  if (APPLY && destCount !== sourceCount) {
    throw new Error(`ERP LQD COBROS COUNT MISMATCH source=${sourceCount} destination=${destCount}`);
  }
  summaryRows.push({
    label: 'ERP-SEED LQD→cobros',
    src: ERP_LQD,
    dst,
    srcCount: sourceCount,
    destCount,
    note: 'one atomic INSERT; EF/CH/TJ/PD from LQD; CVC.DIACOBRO always 0',
  });
}

async function seedLqdDerivedIngresos() {
  const dst = TABLE_MAPPINGS.isolated_test.finance.bankDeposits;
  assertJavierTest(dst);
  assertReadOnlyErp(ERP_LQD);
  if (!(await tableExists(ERP_LQD)) || !(await tableExists(dst))) {
    console.log('SKIP LQD ingresos seed — missing table');
    return;
  }
  await clearTestRows(dst);
  const { whereSql, params } = lqdWindowWhere();
  const sql = `
    INSERT INTO ${dst} (
      IDEMPOTENCY_TOKEN, CODIGO_REPARTIDOR, DIA, MES, ANO, IMPORTE,
      REFERENCIA, OBSERVACION, STATUS, LIQUIDACION_MARKER, ACTOR_ID, ACTOR_ROLE,
      CREATED_AT
    )
    SELECT
      CAST(('ERP-ING-' || TRIM(CODIGOVENDEDOR) || '-'
        || TRIM(VARCHAR(ANOLIQUIDACION * 10000 + MESLIQUIDACION * 100 + DIALIQUIDACION))
        || '-' || TRIM(VARCHAR(NUMEROLIQUIDACION))) AS VARCHAR(128)),
      CODIGOVENDEDOR, DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION,
      IMPORTEINGRESOENBANCO,
      CAST(('LQD-' || TRIM(VARCHAR(NUMEROLIQUIDACION))) AS VARCHAR(80)),
      'ERP LQD IMPORTEINGRESOENBANCO',
      'LIQUIDATED',
      CAST(('ERP-' || TRIM(CODIGOVENDEDOR) || '-'
        || TRIM(VARCHAR(ANOLIQUIDACION * 10000 + MESLIQUIDACION * 100 + DIALIQUIDACION))
        || '-' || TRIM(VARCHAR(NUMEROLIQUIDACION))) AS CHAR(30)),
      'ERP-SEED', 'SYSTEM',
      CURRENT TIMESTAMP
    FROM (${lqdDedupeSubquery()}) X
    WHERE RN = 1 AND IMPORTEINGRESOENBANCO > 0
  `;
  console.log(`ERP-SEED LQD→ingresos ${dst}${APPLY ? '' : ' [dry-run]'}`);
  await run(sql, params);
  const destCount = APPLY ? await countOf(dst) : await countOf(ERP_LQD, `${whereSql} AND IMPORTEINGRESOENBANCO > 0`, params);
  summaryRows.push({
    label: 'ERP-SEED LQD→ingresos',
    src: ERP_LQD,
    dst,
    srcCount: destCount,
    destCount,
    note: 'IMPORTEINGRESOENBANCO>0',
  });
}

async function seedLqdDerivedGastos() {
  const dst = TABLE_MAPPINGS.isolated_test.finance.expenses;
  assertJavierTest(dst);
  assertReadOnlyErp(ERP_LQD);
  if (!(await tableExists(ERP_LQD)) || !(await tableExists(dst))) {
    console.log('SKIP LQD gastos seed — missing table');
    return;
  }
  await clearTestRows(dst);
  const { whereSql, params } = lqdWindowWhere();
  const sql = `
    INSERT INTO ${dst} (
      IDEMPOTENCY_TOKEN, CODIGO_REPARTIDOR, DIA, MES, ANO, IMPORTE,
      CATEGORIA, OBSERVACION, STATUS, LIQUIDACION_MARKER, ACTOR_ID, ACTOR_ROLE,
      CREATED_AT
    )
    SELECT
      CAST(('ERP-GAS-' || TRIM(CODIGOVENDEDOR) || '-'
        || TRIM(VARCHAR(ANOLIQUIDACION * 10000 + MESLIQUIDACION * 100 + DIALIQUIDACION))
        || '-' || TRIM(VARCHAR(NUMEROLIQUIDACION))) AS VARCHAR(128)),
      CODIGOVENDEDOR, DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION,
      IMPORTEGASTOS,
      'ERP', 'ERP LQD IMPORTEGASTOS', 'LIQUIDATED',
      CAST(('ERP-' || TRIM(CODIGOVENDEDOR) || '-'
        || TRIM(VARCHAR(ANOLIQUIDACION * 10000 + MESLIQUIDACION * 100 + DIALIQUIDACION))
        || '-' || TRIM(VARCHAR(NUMEROLIQUIDACION))) AS CHAR(30)),
      'ERP-SEED', 'SYSTEM',
      CURRENT TIMESTAMP
    FROM (${lqdDedupeSubquery()}) X
    WHERE RN = 1 AND IMPORTEGASTOS > 0
  `;
  console.log(`ERP-SEED LQD→gastos ${dst}${APPLY ? '' : ' [dry-run]'}`);
  await run(sql, params);
  const destCount = APPLY ? await countOf(dst) : await countOf(ERP_LQD, `${whereSql} AND IMPORTEGASTOS > 0`, params);
  summaryRows.push({
    label: 'ERP-SEED LQD→gastos',
    src: ERP_LQD,
    dst,
    srcCount: destCount,
    destCount,
    note: 'IMPORTEGASTOS>0 (often 0 in ERP)',
  });
}

async function seedLqdDerivedBalances() {
  const dst = TABLE_MAPPINGS.isolated_test.finance.balances;
  assertJavierTest(dst);
  assertReadOnlyErp(ERP_LQD);
  if (!(await tableExists(ERP_LQD)) || !(await tableExists(dst))) {
    console.log('SKIP LQD balances seed — missing table');
    return;
  }
  const window = lqdWindowWhere();
  await clearTestRows(dst);
  const sql = `
    INSERT INTO ${dst} (CODIGO_REPARTIDOR, SALDO_PENDIENTE)
    SELECT TRIM(CODIGOVENDEDOR), IMPORTESALDOACTUAL
      FROM (
        SELECT L.*,
               ROW_NUMBER() OVER (
                 PARTITION BY TRIM(CODIGOVENDEDOR)
                 ORDER BY ANOLIQUIDACION DESC, MESLIQUIDACION DESC, DIALIQUIDACION DESC,
                          HORALIQUIDACION DESC, NUMEROLIQUIDACION DESC
               ) AS RN_VENDOR
          FROM ${ERP_LQD} L
         WHERE ${window.whereSql}
      ) X
     WHERE RN_VENDOR = 1
  `;
  console.log(`ERP-SEED LQD→balances ${dst}${APPLY ? '' : ' [dry-run]'}`);
  const countSql = `
    SELECT COUNT(*) AS N
      FROM (
        SELECT ROW_NUMBER() OVER (
                 PARTITION BY TRIM(CODIGOVENDEDOR)
                 ORDER BY ANOLIQUIDACION DESC, MESLIQUIDACION DESC, DIALIQUIDACION DESC,
                          HORALIQUIDACION DESC, NUMEROLIQUIDACION DESC
               ) AS RN_VENDOR
          FROM ${ERP_LQD} L
         WHERE ${window.whereSql}
      ) X
     WHERE RN_VENDOR = 1
  `;
  const countRows = activeTransactionConnection
    ? await activeTransactionConnection.query(countSql, window.params)
    : await queryWithParams(countSql, window.params);
  const srcCount = Number(countRows?.[0]?.N ?? countRows?.[0]?.n);
  if (!Number.isInteger(srcCount) || srcCount < 0) {
    throw new Error('ERP LQD balances source count unavailable');
  }
  await run(sql, window.params);
  const destCount = APPLY ? await countOf(dst) : srcCount;
  summaryRows.push({
    label: 'ERP-SEED LQD→balances',
    src: ERP_LQD,
    dst,
    srcCount,
    destCount,
    note: 'latest LQD IMPORTESALDOACTUAL per vendor',
  });
}

async function recreateTestFirmasWithIdentity() {
  assertJavierTest(TEST_FIRMAS);
  if (await tableExists(TEST_FIRMAS)) {
    const cols = await columnsOf(TEST_FIRMAS);
    const idCol = cols.find((c) => c.name === 'ID');
    if (idCol && idCol.identity) {
      console.log('OK identity', TEST_FIRMAS);
      return;
    }
    throw new Error(`Refusing destructive recreate of ${TEST_FIRMAS}: ID is not IDENTITY`);
  }
  console.log(APPLY ? 'CREATE' : '[DRY] CREATE', TEST_FIRMAS, '(explicit IDENTITY)');
  await run(`
    CREATE TABLE ${TEST_FIRMAS} (
      SUBEMPRESAALBARAN CHAR(3) NOT NULL DEFAULT ' ',
      EJERCICIOALBARAN NUMERIC(4, 0) NOT NULL DEFAULT 0,
      SERIEALBARAN CHAR(1) NOT NULL DEFAULT ' ',
      TERMINALALBARAN NUMERIC(3, 0) NOT NULL DEFAULT 0,
      NUMEROALBARAN NUMERIC(6, 0) NOT NULL DEFAULT 0,
      CODIGOVENDEDOR CHAR(2) NOT NULL DEFAULT ' ',
      CODIGOUSUARIO CHAR(2) NOT NULL DEFAULT ' ',
      DIA NUMERIC(2, 0) NOT NULL DEFAULT 0,
      MES NUMERIC(2, 0) NOT NULL DEFAULT 0,
      ANO NUMERIC(4, 0) NOT NULL DEFAULT 0,
      HORA NUMERIC(6, 0) NOT NULL DEFAULT 0,
      FIRMANOMBRE CHAR(100) NOT NULL DEFAULT ' ',
      FIRMADNI CHAR(20) NOT NULL DEFAULT ' ',
      FIRMABASE64 CLOB(1M) NOT NULL DEFAULT ' ',
      LATITUD NUMERIC(15, 6) NOT NULL DEFAULT 0,
      LONGITUD NUMERIC(15, 6) NOT NULL DEFAULT 0,
      TIPOREGISTRO CHAR(1) NOT NULL DEFAULT ' ',
      ID INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY,
      MARCAACTUALIZACION VARCHAR(50) NOT NULL DEFAULT ' ',
      IDEMPOTENCY_TOKEN VARCHAR(128),
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UPDATED_AT TIMESTAMP,
      STATUS VARCHAR(20) DEFAULT 'CAPTURADA',
      OPERADOR VARCHAR(50) DEFAULT 'system',
      PANTALLA_ORIGEN VARCHAR(20) DEFAULT 'ENTREGA',
      PRIMARY KEY (ID)
    )
  `);
}

async function seedCacfirmasToTest() {
  assertJavierTest(TEST_FIRMAS);
  assertReadOnlyErp(ERP_CACFIRMAS);
  if (!(await tableExists(ERP_CACFIRMAS))) {
    console.log('SKIP CACFIRMAS — missing ERP table');
    return;
  }
  await recreateTestFirmasWithIdentity();
  if (APPLY && !(await tableExists(TEST_FIRMAS))) {
    console.log('SKIP firmas seed — TEST table still missing');
    return;
  }

  if (await tableExists(TEST_FIRMAS)) await clearTestRows(TEST_FIRMAS);

  const whereParts = [
    'DIA > 0',
    'MES > 0',
    'ANO > 0',
    `${ymdNumericExpr('ANO', 'MES', 'DIA')} >= ${cutoffYmdSql(DAYS)}`,
  ];
  const params = [];
  if (REPARTIDOR) {
    whereParts.push('TRIM(CODIGOVENDEDOR) = ?');
    params.push(REPARTIDOR);
  }
  const whereSql = whereParts.join(' AND ');
  const srcCount = await countOf(ERP_CACFIRMAS, whereSql, params);

  // Copy identity columns except FIRMABASE64 CLOB (418k ERP rows; 45d still heavy).
  const sql = `
    INSERT INTO ${TEST_FIRMAS} (
      SUBEMPRESAALBARAN, EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN,
      CODIGOVENDEDOR, CODIGOUSUARIO, DIA, MES, ANO, HORA,
      FIRMANOMBRE, FIRMADNI, LATITUD, LONGITUD, TIPOREGISTRO,
      IDEMPOTENCY_TOKEN, STATUS, OPERADOR, PANTALLA_ORIGEN
    )
    SELECT
      SUBEMPRESAALBARAN, EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN,
      CODIGOVENDEDOR, CODIGOUSUARIO, DIA, MES, ANO, HORA,
      FIRMANOMBRE, FIRMADNI, LATITUD, LONGITUD, TIPOREGISTRO,
      CAST(('ERP-FIR-' || TRIM(VARCHAR(EJERCICIOALBARAN)) || '-' || TRIM(SERIEALBARAN)
        || '-' || TRIM(VARCHAR(TERMINALALBARAN)) || '-' || TRIM(VARCHAR(NUMEROALBARAN))
        || '-' || TRIM(TIPOREGISTRO) || '-' || TRIM(VARCHAR(ANO * 10000 + MES * 100 + DIA))) AS VARCHAR(128)),
      'CAPTURADA', 'ERP-SEED', 'ENTREGA'
    FROM (
      SELECT F.*,
             ROW_NUMBER() OVER (
               PARTITION BY SUBEMPRESAALBARAN, EJERCICIOALBARAN, SERIEALBARAN,
                            TERMINALALBARAN, NUMEROALBARAN, TIPOREGISTRO
               ORDER BY HORA DESC, ANO DESC, MES DESC, DIA DESC
             ) AS RN
        FROM ${ERP_CACFIRMAS} F
       WHERE ${whereSql}
    ) X
    WHERE RN = 1
  `;
  console.log(`ERP-SEED CACFIRMAS→firmas ${TEST_FIRMAS} src≈${srcCount} (no CLOB)${APPLY ? '' : ' [dry-run]'}`);
  await run(sql, params);
  const destCount = APPLY ? await countOf(TEST_FIRMAS) : srcCount;
  summaryRows.push({
    label: 'ERP-SEED CACFIRMAS→firmas',
    src: ERP_CACFIRMAS,
    dst: TEST_FIRMAS,
    srcCount,
    destCount,
    note: 'FIRMANOMBRE+FIRMADNI; skip FIRMABASE64',
  });
}

async function copyNotificationRoleTargets() {
  const src = TABLE_MAPPINGS.production.notifications.roleTargets;
  const dst = TABLE_MAPPINGS.isolated_test.notifications.roleTargets;
  assertJavierSource(src);
  assertJavierTest(dst);
  if (!(await tableExists(src)) || !(await tableExists(dst))) {
    console.log('SKIP notification role targets missing');
    return;
  }
  await clearTestRows(dst);
  await copyIntersection(src, dst, { label: 'COPY notifications' });
}

async function printSummary() {
  console.log('\n=== COUNT SUMMARY ===');
  console.log(
    'label'.padEnd(36),
    'src'.padEnd(42),
    'srcN'.padStart(8),
    'dstN'.padStart(8),
    'note',
  );
  for (const row of summaryRows) {
    console.log(
      String(row.label).padEnd(36),
      String(row.src).padEnd(42),
      String(row.srcCount).padStart(8),
      String(row.destCount).padStart(8),
      row.note || '',
    );
  }
  if (!APPLY) {
    console.log('(dry-run: destN ≈ filtered source count; re-run --apply for real dest counts)');
  }
}

async function overlayDeliveryStatus() {
  await ensureTestDeliveryStatus();
  if (await tableExists(BKP_DELIVERY) && await tableExists(TEST_DELIVERY)) {
    await clearTestRows(TEST_DELIVERY);
    await copyIntersection(BKP_DELIVERY, TEST_DELIVERY, {
      label: 'BKP delivery overlay',
    });
  } else {
    console.log('SKIP BKP→TEST_DELIVERY_STATUS (missing source or dest)');
  }
}

async function main() {
  if (SCHEMA_ONLY && !RECONCILE_TEST_SCHEMA) {
    throw new Error('--schema-only requires --reconcile-test-schema');
  }
  if (APPLY) validateCopyRunId(COPY_RUN_ID);
  const runId = COPY_RUN_ID || 'DRY_RUN';
  console.log(`Mode=${APPLY ? 'APPLY' : 'DRY-RUN'} runId=${runId} days=${DAYS} repartidor=${REPARTIDOR || 'ALL'} skipCvc=${SKIP_CVC} resumeFirmas=${RESUME_FIRMAS} legacyDeliveryOverlay=${LEGACY_BKP_DELIVERY_OVERLAY}`);
  console.log('RULE: never touch DSEDAC/DSED writes. Only JAVIER.TEST_* writes.');
  if (ALLOW_TEST_ROW_CLEAR && (!APPLY || !RECONCILE_TEST_SCHEMA)) {
    throw new Error('--allow-test-row-clear requires --apply --reconcile-test-schema');
  }
  await initDb();
  try {
    // ERP-seeded paths below are deliberately non-isomorphic transformations.
    // Only TABLE_MAPPINGS production -> TEST application pairs are preflighted.
    const pairs = collectMappingPairs();
    const sequencePairs = pairs.filter((pair) => pair.objectType === 'SEQUENCE');
    const sequenceBlocks = [];
    for (const pair of sequencePairs) {
      const sourceExists = await sequenceExists(pair.src);
      const destinationExists = await sequenceExists(pair.dst);
      if (!sourceExists || !destinationExists) {
        const message = `SEQUENCE PREFLIGHT BLOCK ${pair.src} -> ${pair.dst}: sourceExists=${sourceExists} destinationExists=${destinationExists}; refusing orphan TEST sequence and false PASS`;
        sequenceBlocks.push(message);
        console.error(message);
      } else {
        console.log(`PREFLIGHT OK sequence ${pair.src} -> ${pair.dst}`);
      }
    }
    if (APPLY && sequenceBlocks.length) {
      throw new Error(sequenceBlocks.join('; '));
    }
    // ERP-seeded finance tables deliberately have an operational TEST shape:
    // LQD is transformed into TEST_REPARTIDOR_* by the seed functions below,
    // so comparing its columns as an isomorphic production pair creates a
    // false preflight block (the TEST-only audit/status columns are expected).
    // Keep the strict metadata gate for every true production -> TEST copy.
    const tablePairs = pairs.filter((pair) => pair.objectType === 'TABLE' && !pair.erpSeeded);
    if (RECONCILE_TEST_SCHEMA) {
      const schemaPreview = await reconcileMappingPairs(tablePairs, {
        apply: false,
        allowTestRowClear: !APPLY || ALLOW_TEST_ROW_CLEAR,
        allowTestTableRebuild: !APPLY || ALLOW_TEST_TABLE_REBUILD,
      });
      const affectedPairs = affectedSchemaPairs(schemaPreview);
      const manifestReport = await ensureBackupManifestTable({ apply: APPLY });
      await backupMappedDestinations(affectedPairs, runId);
      const schemaReport = APPLY
        ? await reconcileMappingPairs(tablePairs)
        : schemaPreview;
      const schemaOperations = schemaReport.reduce((sum, row) => sum + row.operations.length, 0);
      const manifestOperations = manifestReport.operations.length;
      const planned = schemaOperations + manifestOperations;
      console.log(`SCHEMA RECONCILIATION ${APPLY ? 'APPLIED' : 'PLANNED'} operations=${planned} schema=${schemaOperations} manifest=${manifestOperations}`);
      if (!APPLY) {
        console.log('Dry-run only: rerun with --apply --reconcile-test-schema --schema-only and the same --copy-run-id.');
        if (sequenceBlocks.length) throw new Error(sequenceBlocks.join('; '));
        return;
      }
      await preflightMappingPairs(tablePairs);
      if (SCHEMA_ONLY) {
        if (sequenceBlocks.length) throw new Error(sequenceBlocks.join('; '));
        console.log('SCHEMA-ONLY DONE. No destination rows were deleted or copied.');
        return;
      }
    } else {
      await preflightMappingPairs(tablePairs);
      await backupNonSchemaCopyDestinations(tablePairs, runId, { apply: APPLY });
    }
    if (sequenceBlocks.length) throw new Error(sequenceBlocks.join('; '));
    if (RESUME_FIRMAS) {
      await recreateTestFirmasWithIdentity();
      await runTableStep('ERP CACFIRMAS -> firmas', TEST_FIRMAS, seedCacfirmasToTest);
      if (LEGACY_BKP_DELIVERY_OVERLAY) {
        await runTableStep('BKP delivery overlay', TEST_DELIVERY, overlayDeliveryStatus);
      }
      await printSummary();
      console.log(APPLY ? 'DONE resume-firmas.' : 'DRY-RUN resume-firmas.');
      return;
    }

    if (LEGACY_BKP_DELIVERY_OVERLAY) await ensureTestDeliveryStatus();

    // 2) Isomorphic TABLE_MAPPINGS pairs (skip ERP-seeded keys)
    const confirmationPairs = pairs.filter((pair) => pair.group === 'confirmation' && pair.objectType === 'TABLE');
    if (confirmationPairs.length) {
      await runTableStep('ISO confirmation bundle', confirmationPairs[0].dst, async () => {
        await copyConfirmationBundle(confirmationPairs);
      });
    }

    for (const p of pairs) {
      if (p.group === 'confirmation') continue;
      if (p.objectType === 'SEQUENCE') {
        console.log(`PREFLIGHT ONLY sequence ${p.src} -> ${p.dst}; no row copy`);
        continue;
      }
      if (p.erpSeeded) {
        console.log(`DEFER isomorphic ${p.key} → ERP seed`);
        continue;
      }
      if (!(await tableExists(p.src)) || !(await tableExists(p.dst))) {
        console.log('SKIP missing pair', p.src, '→', p.dst);
        continue;
      }

      let whereSql = '';
      const params = [];
      if (p.key === 'order') {
        whereSql = `FECHA_RUTA >= CURRENT DATE - ${Number(DAYS)} DAYS`;
        if (REPARTIDOR) {
          whereSql += ' AND TRIM(REPARTIDOR_ID) = ?';
          params.push(REPARTIDOR);
        }
      }

      await runTableStep(`ISO ${p.group}.${p.key}`, p.dst, async () => {
        await clearTestRows(p.dst);
        await copyIntersection(p.src, p.dst, {
          whereSql,
          params,
          label: `ISO ${p.group}.${p.key}`,
        });
      });
    }

    // 3) ERP seeds (read-only DSEDAC → TEST)
    await runTableStep('ERP LQD -> liquidationOps', TABLE_MAPPINGS.isolated_test.finance.liquidationOps, seedLqdToLiquidacionOps);
    await runTableStep('ERP LQD -> cobros', TABLE_MAPPINGS.isolated_test.finance.cobros, seedLqdDerivedCobros);
    await runTableStep('ERP LQD -> bankDeposits', TABLE_MAPPINGS.isolated_test.finance.bankDeposits, seedLqdDerivedIngresos);
    await runTableStep('ERP LQD -> expenses', TABLE_MAPPINGS.isolated_test.finance.expenses, seedLqdDerivedGastos);
    await runTableStep('ERP LQD -> balances', TABLE_MAPPINGS.isolated_test.finance.balances, seedLqdDerivedBalances);
    await recreateTestFirmasWithIdentity();
    await runTableStep('ERP CACFIRMAS -> firmas', TEST_FIRMAS, seedCacfirmasToTest);

    // Historical recovery is explicit; canonical mode keeps the production table-set copy.
    if (LEGACY_BKP_DELIVERY_OVERLAY) {
      await runTableStep('BKP delivery overlay', TEST_DELIVERY, overlayDeliveryStatus);
    } else {
      console.log('SKIP legacy BKP delivery overlay (disabled by default)');
    }

    // 5) Notification role targets were already copied as an isomorphic pair.
    // 6) Summary
    await printSummary();

    console.log(APPLY
      ? 'DONE. ERP documents (albaranes/ruteros) still read live from DSEDAC (not copied).'
      : 'DRY-RUN complete. Re-run with --apply to execute.');
  } finally {
    console.log('\n=== TABLE STEP REPORT ===');
    for (const row of tableStepReport) {
      console.log(row.status, row.label, row.destination, row.error || '');
    }
    await closePool();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('FATAL', e.message);
    process.exit(1);
  });
}

module.exports = {
  compareTableMetadata,
  shouldSeedLegacyDeliveryOverlay,
  clearTestRows,
  confirmationBundlePlan,
  copyConfirmationBundle,
  normalizeCatalogYesNo,
  normalizeCatalogBoolean,
  normalizeColumnDefault,
  safeDefaultExpression,
  runtimeWriteCoverageGaps,
  assertRuntimeWriteCoverage,
  sqlTypeFor,
  safeTypeWidening,
  buildReconciliationPlan,
  reconcileMappingPairs,
  countNulls,
  validateCopyRunId,
  backupTableName,
  backupTestTable,
  backupMappedDestinations,
  backupNonSchemaCopyDestinations,
  backupShapeHash,
  BACKUP_MANIFEST_TABLE,
  BACKUP_MANIFEST_CREATE_SQL,
  validateBackupManifestColumns,
  validateBackupManifestRecord,
  ensureBackupManifestTable,
  createDbBackupManifestStore,
  commitBackupManifestWrite,
  contentHashOf,
  contentHashProjection,
  affectedSchemaPairs,
  lobChunkPlan,
  runTableStep,
  preflightMappingPairs,
  runAfterCopyPreflight,
  createLikeSql,
  normalizeOperationalContracts,
  operationalContractSignature,
  buildOperationalContractPlan,
  shouldAuditOperationalContracts,
  assertLqdCobrosSeedCoverage,
  lqdCobrosSplitCte,
  lqdCobrosInsertSql,
};
