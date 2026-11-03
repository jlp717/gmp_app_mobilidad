#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const path = require('path');

const TARGET = 'JAVIER.TEST_POLITICA_PRECIO_ART';
const EXPECTED_SOURCE_ROWS = 6235;
const EXPECTED_ACTIVE_ROWS = 2937;
const EXPECTED_SOURCE_FINGERPRINT = '64f2a6c72049ea4d232c8e7b1862c7f48770f116d3ad7a3468dffa897843993b';
const EXPECTED_CHECKS = Object.freeze([
  'CK_TEST_PPA_ACTIVO', 'CK_TEST_PPA_TARIFA_STATE', 'CK_TEST_PPA_TARIFA_CANDIDATE',
  'CK_TEST_PPA_UNIDAD_STATE', 'CK_TEST_PPA_POLICY_STATE', 'CK_TEST_PPA_MARGIN',
  'CK_TEST_PPA_UNPROVEN',
]);
const EXPECTED_CHECK_CLAUSES = Object.freeze({
  CK_TEST_PPA_ACTIVO: "ACTIVO_SN IN ('S', 'N')",
  CK_TEST_PPA_TARIFA_STATE: "TARIFA_ESTADO IN ('AUSENTE', 'PRESENTE', 'ALTERNATIVA', 'CONFLICTIVA')",
  CK_TEST_PPA_TARIFA_CANDIDATE: `
    (TARIFA_ESTADO IN ('PRESENTE', 'ALTERNATIVA')
      AND TARIFA_CANDIDATA_CODIGO IS NOT NULL
      AND PRECIO_CANDIDATO IS NOT NULL
      AND TARIFA_VARIANTES = 1)
    OR (TARIFA_ESTADO = 'AUSENTE'
      AND TARIFA_CANDIDATA_CODIGO IS NULL
      AND PRECIO_CANDIDATO IS NULL
      AND TARIFA_VARIANTES = 0)
    OR (TARIFA_ESTADO = 'CONFLICTIVA'
      AND TARIFA_CANDIDATA_CODIGO IS NULL
      AND PRECIO_CANDIDATO IS NULL
      AND TARIFA_VARIANTES >= 2)`,
  CK_TEST_PPA_UNIDAD_STATE: "UNIDAD_ESTADO IN ('NO_VERIFICADA', 'VERIFICADA', 'CONFLICTIVA')",
  CK_TEST_PPA_POLICY_STATE: `POLITICA_ESTADO IN (
      'SIN_EVIDENCIA', 'ALTERNATIVA_NO_EFECTIVA',
      'CONFLICTIVA', 'UOM_NO_VERIFICADA', 'VERIFICADA'
    )`,
  CK_TEST_PPA_MARGIN: `MARGEN_OBJETIVO_PCT IS NULL
    OR (MARGEN_OBJETIVO_PCT >= 0 AND MARGEN_OBJETIVO_PCT < 100)`,
  CK_TEST_PPA_UNPROVEN: `UNIDAD_ESTADO = 'VERIFICADA'
    OR (COSTE_FABRICACION IS NULL
        AND MARGEN_OBJETIVO_PCT IS NULL
        AND PRECIO_MINIMO IS NULL)`,
});
const TARGET_COLUMNS = Object.freeze([
  ['CODIGOARTICULO', 'CHAR', 10, null, 'N'],
  ['DESCRIPCIONARTICULO', 'CHAR', 40, null, 'N'],
  ['UNIDAD_ERP', 'CHAR', 10, null, 'N'],
  ['UNIDADES_CAJA', 'DECIMAL', 10, 5, 'N'],
  ['ANO_BAJA', 'DECIMAL', 4, 0, 'N'],
  ['ACTIVO_SN', 'CHAR', 1, null, 'N'],
  ['TARIFA_CANDIDATA_CODIGO', 'DECIMAL', 2, 0, 'Y'],
  ['PRECIO_CANDIDATO', 'DECIMAL', 9, 4, 'Y'],
  ['TARIFA_VARIANTES', 'INTEGER', 9, 0, 'N'],
  ['TARIFA_ESTADO', 'VARCHAR', 24, null, 'N'],
  ['UNIDAD_ESTADO', 'VARCHAR', 24, null, 'N'],
  ['POLITICA_ESTADO', 'VARCHAR', 32, null, 'N'],
  ['COSTE_FABRICACION', 'DECIMAL', 11, 4, 'Y'],
  ['MARGEN_OBJETIVO_PCT', 'DECIMAL', 7, 4, 'Y'],
  ['PRECIO_MINIMO', 'DECIMAL', 11, 4, 'Y'],
  ['SOURCE_FINGERPRINT', 'CHAR', 64, null, 'N'],
  ['SOURCE_SNAPSHOT_AT', 'TIMESTAMP', null, null, 'N'],
  ['CREATED_AT', 'TIMESTAMP', null, null, 'N'],
  ['UPDATED_AT', 'TIMESTAMP', null, null, 'N'],
]);

const SOURCE_BASE_SQL = `SELECT TRIM(A.CODIGOARTICULO) AS CODIGOARTICULO,
       A.DESCRIPCIONARTICULO AS DESCRIPCIONARTICULO,
       A.UNIDADMEDIDA AS UNIDAD_ERP,
       A.UNIDADESCAJA AS UNIDADES_CAJA,
       A.ANOBAJA AS ANO_BAJA,
       CASE WHEN A.ANOBAJA = 0 THEN 'S' ELSE 'N' END AS ACTIVO_SN,
       CASE WHEN COALESCE(T.TARIFA2_VARIANTES, 0) = 1 THEN 2
            WHEN COALESCE(T.TARIFA2_VARIANTES, 0) = 0
             AND COALESCE(T.ALTERNATIVAS, 0) = 1 THEN T.ALTERNATIVA_CODIGO
            ELSE NULL END AS TARIFA_CANDIDATA_CODIGO,
       CASE WHEN COALESCE(T.TARIFA2_VARIANTES, 0) = 1 THEN T.TARIFA2_PRECIO
            WHEN COALESCE(T.TARIFA2_VARIANTES, 0) = 0
             AND COALESCE(T.ALTERNATIVAS, 0) = 1 THEN T.ALTERNATIVA_PRECIO
            ELSE NULL END AS PRECIO_CANDIDATO,
       CASE WHEN COALESCE(T.TARIFA2_VARIANTES, 0) > 0 THEN T.TARIFA2_VARIANTES
            ELSE COALESCE(T.ALTERNATIVAS, 0) END AS TARIFA_VARIANTES,
       CASE WHEN COALESCE(T.TARIFA2_VARIANTES, 0) = 1 THEN 'PRESENTE'
            WHEN COALESCE(T.TARIFA2_VARIANTES, 0) > 1 THEN 'CONFLICTIVA'
            WHEN COALESCE(T.ALTERNATIVAS, 0) = 1 THEN 'ALTERNATIVA'
            WHEN COALESCE(T.ALTERNATIVAS, 0) > 1 THEN 'CONFLICTIVA'
            ELSE 'AUSENTE' END AS TARIFA_ESTADO
  FROM DSEDAC.ART A
  LEFT JOIN (
    SELECT V.CODIGOARTICULO,
           SUM(CASE WHEN V.CODIGOTARIFA = 2 THEN 1 ELSE 0 END) AS TARIFA2_VARIANTES,
           MIN(CASE WHEN V.CODIGOTARIFA = 2 THEN V.PRECIOTARIFA END) AS TARIFA2_PRECIO,
           SUM(CASE WHEN V.CODIGOTARIFA <> 2 THEN 1 ELSE 0 END) AS ALTERNATIVAS,
           MIN(CASE WHEN V.CODIGOTARIFA <> 2 THEN V.CODIGOTARIFA END) AS ALTERNATIVA_CODIGO,
           MIN(CASE WHEN V.CODIGOTARIFA <> 2 THEN V.PRECIOTARIFA END) AS ALTERNATIVA_PRECIO
      FROM (
        SELECT TRIM(CODIGOARTICULO) AS CODIGOARTICULO, CODIGOTARIFA, PRECIOTARIFA
          FROM DSEDAC.ARA
         WHERE PRECIOTARIFA > 0
         GROUP BY TRIM(CODIGOARTICULO), CODIGOTARIFA, PRECIOTARIFA
      ) V
     GROUP BY V.CODIGOARTICULO
  ) T ON T.CODIGOARTICULO = TRIM(A.CODIGOARTICULO)
 WHERE TRIM(A.CODIGOARTICULO) <> ''`;
const SOURCE_SQL = `${SOURCE_BASE_SQL} ORDER BY A.CODIGOARTICULO`;
const LOCK_SQL = `LOCK TABLE ${TARGET} IN EXCLUSIVE MODE`;
const TARGET_COUNT_SQL = `SELECT COUNT(*) AS N FROM ${TARGET}`;

function policyStateSql(alias = 'S') {
  return `CASE WHEN ${alias}.TARIFA_ESTADO='AUSENTE' THEN 'SIN_EVIDENCIA'
              WHEN ${alias}.TARIFA_ESTADO='CONFLICTIVA' THEN 'CONFLICTIVA'
              ELSE 'ALTERNATIVA_NO_EFECTIVA' END`;
}

const INSERT_SQL = `INSERT INTO ${TARGET} (
  CODIGOARTICULO,DESCRIPCIONARTICULO,UNIDAD_ERP,UNIDADES_CAJA,ANO_BAJA,ACTIVO_SN,
  TARIFA_CANDIDATA_CODIGO,PRECIO_CANDIDATO,TARIFA_VARIANTES,TARIFA_ESTADO,
  UNIDAD_ESTADO,POLITICA_ESTADO,COSTE_FABRICACION,MARGEN_OBJETIVO_PCT,PRECIO_MINIMO,
  SOURCE_FINGERPRINT,SOURCE_SNAPSHOT_AT,CREATED_AT,UPDATED_AT
)
SELECT S.CODIGOARTICULO,S.DESCRIPCIONARTICULO,S.UNIDAD_ERP,S.UNIDADES_CAJA,S.ANO_BAJA,S.ACTIVO_SN,
       S.TARIFA_CANDIDATA_CODIGO,S.PRECIO_CANDIDATO,S.TARIFA_VARIANTES,S.TARIFA_ESTADO,
       'NO_VERIFICADA',${policyStateSql('S')},
       CAST(NULL AS DECIMAL(11,4)),CAST(NULL AS DECIMAL(7,4)),CAST(NULL AS DECIMAL(11,4)),
       CAST(? AS CHAR(64)),CURRENT TIMESTAMP,CURRENT TIMESTAMP,CURRENT TIMESTAMP
  FROM (${SOURCE_BASE_SQL}) S`;

function nullableDifferent(left, right) {
  return `((${left} IS NULL AND ${right} IS NOT NULL)
        OR (${left} IS NOT NULL AND ${right} IS NULL)
        OR ${left} <> ${right})`;
}

const NATIVE_MISMATCH_SQL = `SELECT COUNT(*) AS N
  FROM ${TARGET} T
  FULL OUTER JOIN (
    SELECT S.*, CAST(? AS CHAR(64)) AS SOURCE_FINGERPRINT,
           'NO_VERIFICADA' AS UNIDAD_ESTADO,
           ${policyStateSql('S')} AS POLITICA_ESTADO
      FROM (${SOURCE_BASE_SQL}) S
  ) S ON T.CODIGOARTICULO=S.CODIGOARTICULO
 WHERE T.CODIGOARTICULO IS NULL OR S.CODIGOARTICULO IS NULL
    OR T.DESCRIPCIONARTICULO<>S.DESCRIPCIONARTICULO
    OR T.UNIDAD_ERP<>S.UNIDAD_ERP
    OR T.UNIDADES_CAJA<>S.UNIDADES_CAJA
    OR T.ANO_BAJA<>S.ANO_BAJA
    OR T.ACTIVO_SN<>S.ACTIVO_SN
    OR ${nullableDifferent('T.TARIFA_CANDIDATA_CODIGO', 'S.TARIFA_CANDIDATA_CODIGO')}
    OR ${nullableDifferent('T.PRECIO_CANDIDATO', 'S.PRECIO_CANDIDATO')}
    OR T.TARIFA_VARIANTES<>S.TARIFA_VARIANTES
    OR T.TARIFA_ESTADO<>S.TARIFA_ESTADO
    OR T.SOURCE_FINGERPRINT<>S.SOURCE_FINGERPRINT`;
const INITIAL_POLICY_MISMATCH_SQL = `SELECT COUNT(*) AS N FROM ${TARGET}
 WHERE UNIDAD_ESTADO<>'NO_VERIFICADA'
    OR POLITICA_ESTADO NOT IN ('SIN_EVIDENCIA','ALTERNATIVA_NO_EFECTIVA','CONFLICTIVA')
    OR COSTE_FABRICACION IS NOT NULL
    OR MARGEN_OBJETIVO_PCT IS NOT NULL
    OR PRECIO_MINIMO IS NOT NULL`;

function value(row, name) {
  return row?.[name] ?? row?.[name.toLowerCase()];
}

function fixedDecimal(raw, scale) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || (match[2] || '').length > scale) return null;
  if (scale === 0) return match[1];
  return `${match[1]}.${(match[2] || '').padEnd(scale, '0')}`;
}

function canonicalSourceRows(rows) {
  if (!Array.isArray(rows) || rows.length !== EXPECTED_SOURCE_ROWS) {
    throw Object.assign(new Error('Unexpected ART snapshot size'), { code: 'POLICY_SOURCE_COUNT_MISMATCH' });
  }
  const seen = new Set();
  let active = 0;
  const normalized = rows.map((row) => {
    const article = String(value(row, 'CODIGOARTICULO') || '').trim();
    const description = String(value(row, 'DESCRIPCIONARTICULO') || '').trimEnd();
    const unit = String(value(row, 'UNIDAD_ERP') || '').trimEnd();
    const unitsPerBox = fixedDecimal(value(row, 'UNIDADES_CAJA'), 5);
    const retirementYear = fixedDecimal(value(row, 'ANO_BAJA'), 0);
    const activeFlag = String(value(row, 'ACTIVO_SN') || '').trim();
    const tariffState = String(value(row, 'TARIFA_ESTADO') || '').trim();
    const tariffVariants = Number(value(row, 'TARIFA_VARIANTES'));
    const candidateTariffCode = fixedDecimal(value(row, 'TARIFA_CANDIDATA_CODIGO'), 0);
    const candidatePrice = fixedDecimal(value(row, 'PRECIO_CANDIDATO'), 4);
    const candidateExpected = ['PRESENTE', 'ALTERNATIVA'].includes(tariffState);
    if (!article || article.length > 10 || seen.has(article)
      || description.length > 40 || unit.length > 10 || unitsPerBox === null
      || retirementYear === null || !['S', 'N'].includes(activeFlag)
      || !['AUSENTE', 'PRESENTE', 'ALTERNATIVA', 'CONFLICTIVA'].includes(tariffState)
      || !Number.isInteger(tariffVariants) || tariffVariants < 0
      || candidateExpected !== (tariffVariants === 1 && candidateTariffCode !== null && candidatePrice !== null)
      || (tariffState === 'PRESENTE' && candidateTariffCode !== '2')
      || (tariffState === 'ALTERNATIVA' && candidateTariffCode === '2')
      || (tariffState === 'AUSENTE' && tariffVariants !== 0)
      || (tariffState === 'CONFLICTIVA' && tariffVariants < 2)
      || (!candidateExpected && (candidateTariffCode !== null || candidatePrice !== null))) {
      throw Object.assign(new Error('Invalid ART policy snapshot row'), { code: 'POLICY_SOURCE_ROW_INVALID' });
    }
    seen.add(article);
    if (activeFlag === 'S') active += 1;
    const policyState = tariffState === 'AUSENTE'
      ? 'SIN_EVIDENCIA'
      : (tariffState === 'CONFLICTIVA' ? 'CONFLICTIVA' : 'ALTERNATIVA_NO_EFECTIVA');
    return { article, description, unit, unitsPerBox, retirementYear, activeFlag,
      candidateTariffCode, candidatePrice, tariffVariants, tariffState,
      unitState: 'NO_VERIFICADA', policyState,
      manufacturingCost: null, targetMarginPct: null, minimumPrice: null };
  });
  if (active !== EXPECTED_ACTIVE_ROWS) {
    throw Object.assign(new Error('Unexpected active ART snapshot size'), { code: 'POLICY_ACTIVE_COUNT_MISMATCH' });
  }
  return normalized;
}

function snapshotFingerprint(rows) {
  const evidence = rows.map((row) => [row.article, row.description, row.unit,
    row.unitsPerBox, row.retirementYear, row.activeFlag, row.candidateTariffCode,
    row.candidatePrice, row.tariffVariants, row.tariffState]);
  return crypto.createHash('sha256').update(JSON.stringify(evidence), 'utf8').digest('hex');
}

function parseArgs(argv) {
  const args = (Array.isArray(argv) ? argv : []).slice(2);
  if (args.length === 0) return Object.freeze({ apply: false });
  if (args.length === 1 && args[0] === '--apply') return Object.freeze({ apply: true });
  throw Object.assign(new Error('Only --apply is supported'), { code: 'POLICY_SEED_ARGS_INVALID' });
}

function assertSeedProfile(env) {
  const { resolveAppProfile } = require('../../config/app-profile');
  const resolved = resolveAppProfile(env);
  const profile = resolved.publicProfile;
  const assignments = resolved.assignments || {};
  if (!resolved.valid || !['test', 'demo'].includes(profile.profile)
    || profile.verified !== true || profile.readSchema !== 'DSEDAC'
    || profile.writeSchema !== 'JAVIER' || profile.tableSet !== 'isolated_test'
    || profile.writesEnabled !== true || profile.productionWritesEnabled !== false
    || profile.erpExportEnabled !== false || assignments.REPARTO_WRITES_ENABLED !== 'true'
    || assignments.PEDIDOS_EXPORT_TO_SYSTEM !== 'false') {
    const error = new Error('Policy seed requires a coherent TEST/DEMO isolated profile');
    error.code = 'POLICY_SEED_PROFILE_INVALID';
    throw error;
  }
  return profile;
}

function normalizeType(type) {
  const normalized = String(type || '').trim().toUpperCase();
  return normalized === 'TIMESTMP' ? 'TIMESTAMP' : normalized;
}

function stripWrappingParentheses(text) {
  let current = text;
  while (current.startsWith('(') && current.endsWith(')')) {
    let depth = 0;
    let wrapsAll = true;
    for (let index = 0; index < current.length; index += 1) {
      if (current[index] === '(') depth += 1;
      if (current[index] === ')') depth -= 1;
      if (depth === 0 && index < current.length - 1) {
        wrapsAll = false;
        break;
      }
    }
    if (!wrapsAll) break;
    current = current.slice(1, -1);
  }
  return current;
}

function normalizeCheckClause(clause) {
  const compact = String(clause || '').trim().toUpperCase()
    .replace(/^CHECK\s*/u, '')
    .replace(/"/gu, '')
    .replace(/\s+/gu, '');
  return stripWrappingParentheses(compact);
}

async function verifyTarget(connection) {
  const binds = ['JAVIER', 'TEST_POLITICA_PRECIO_ART'];
  const tables = await connection.query(
    'SELECT SYSTEM_TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', binds);
  if (tables.length !== 1) throw Object.assign(new Error('Policy target unavailable'), { code: 'POLICY_TARGET_UNAVAILABLE' });
  const columns = await connection.query(
    `SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE
       FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`, binds);
  const actual = columns.map((row) => {
    const type = normalizeType(row.DATA_TYPE);
    const numeric = ['DECIMAL', 'INTEGER'].includes(type);
    const character = ['CHAR', 'VARCHAR'].includes(type);
    return [String(row.COLUMN_NAME).trim(), type,
      numeric ? (Number(row.NUMERIC_PRECISION) || null)
        : (character ? (Number(row.LENGTH) || null) : null),
      numeric && row.NUMERIC_SCALE != null ? Number(row.NUMERIC_SCALE) : null,
      String(row.IS_NULLABLE).trim().toUpperCase()];
  });
  if (JSON.stringify(actual) !== JSON.stringify(TARGET_COLUMNS)) {
    throw Object.assign(new Error('Policy target columns do not match'), { code: 'POLICY_TARGET_SCHEMA_MISMATCH' });
  }
  const keys = await connection.query(
    `SELECT C.CONSTRAINT_TYPE, C.ENABLED, K.COLUMN_NAME, K.ORDINAL_POSITION
       FROM QSYS2.SYSCST C JOIN QSYS2.SYSKEYCST K
         ON K.CONSTRAINT_SCHEMA=C.CONSTRAINT_SCHEMA AND K.CONSTRAINT_NAME=C.CONSTRAINT_NAME
      WHERE C.TABLE_SCHEMA=? AND C.TABLE_NAME=?`, binds);
  const primary = keys.filter((row) => String(row.CONSTRAINT_TYPE).trim().toUpperCase() === 'PRIMARY KEY');
  if (primary.length !== 1 || !['Y', 'YES'].includes(String(primary[0].ENABLED).trim().toUpperCase())
    || String(primary[0].COLUMN_NAME).trim() !== 'CODIGOARTICULO'
    || Number(primary[0].ORDINAL_POSITION) !== 1) {
    throw Object.assign(new Error('Policy target primary key is not verified'), { code: 'POLICY_TARGET_KEY_MISMATCH' });
  }
  const checks = await connection.query(
    `SELECT C.CONSTRAINT_NAME, C.ENABLED, H.CHECK_CLAUSE
       FROM QSYS2.SYSCST C JOIN QSYS2.SYSCHKCST H
         ON H.CONSTRAINT_SCHEMA=C.CONSTRAINT_SCHEMA AND H.CONSTRAINT_NAME=C.CONSTRAINT_NAME
      WHERE C.TABLE_SCHEMA=? AND C.TABLE_NAME=? AND C.CONSTRAINT_TYPE='CHECK'`, binds);
  const actualChecks = new Map(checks
    .filter((row) => ['Y', 'YES'].includes(String(row.ENABLED).trim().toUpperCase()))
    .map((row) => [String(row.CONSTRAINT_NAME).trim(), normalizeCheckClause(row.CHECK_CLAUSE)]));
  const checksMatch = EXPECTED_CHECKS.every((name) => (
    actualChecks.get(name) === normalizeCheckClause(EXPECTED_CHECK_CLAUSES[name])
  )) && actualChecks.size === EXPECTED_CHECKS.length;
  if (!checksMatch) {
    throw Object.assign(new Error('Policy target checks are not verified'), { code: 'POLICY_TARGET_CHECK_MISMATCH' });
  }
  const physicalName = String(tables[0].SYSTEM_TABLE_NAME || '').trim();
  const journal = await connection.query(
    `SELECT JOURNALED, JOURNAL_LIBRARY, JOURNAL_NAME, JOURNAL_IMAGES
       FROM TABLE(QSYS2.OBJECT_STATISTICS('JAVIER','*FILE')) X WHERE OBJNAME=?`, [physicalName]);
  const journalRow = journal[0] || {};
  if (journal.length !== 1 || String(journalRow.JOURNALED).trim() !== 'YES'
    || String(journalRow.JOURNAL_LIBRARY).trim() !== 'JAVIER'
    || String(journalRow.JOURNAL_NAME).trim() !== 'QSQJRN'
    || String(journalRow.JOURNAL_IMAGES).trim() !== '*BOTH') {
    throw Object.assign(new Error('Policy target journal is not verified'), { code: 'POLICY_TARGET_JOURNAL_MISMATCH' });
  }
  return true;
}

async function seedPolicySnapshot(connection, env, {
  expectedSourceFingerprint = EXPECTED_SOURCE_FINGERPRINT,
} = {}) {
  assertSeedProfile(env);
  const required = ['query', 'beginTransaction', 'commit', 'rollback', 'close'];
  if (!connection || required.some((name) => typeof connection[name] !== 'function')) {
    throw Object.assign(new Error('Dedicated physical transaction connection required'), { code: 'POLICY_SEED_CONNECTION_INVALID' });
  }
  await verifyTarget(connection);
  await connection.beginTransaction();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', []);
    const source = canonicalSourceRows(await connection.query(SOURCE_SQL, []));
    const fingerprint = snapshotFingerprint(source);
    if (fingerprint !== expectedSourceFingerprint) {
      throw Object.assign(new Error('Policy source fingerprint has changed'), {
        code: 'POLICY_SOURCE_FINGERPRINT_MISMATCH',
      });
    }
    await connection.query(LOCK_SQL, []);
    const beforeRows = await connection.query(TARGET_COUNT_SQL, []);
    const before = Number(beforeRows[0]?.N);
    if (!Number.isInteger(before) || ![0, EXPECTED_SOURCE_ROWS].includes(before)) {
      throw Object.assign(new Error('Policy target cardinality has drifted'), { code: 'POLICY_SNAPSHOT_DRIFT' });
    }
    if (before === 0) await connection.query(INSERT_SQL, [fingerprint]);
    const mismatchRows = await connection.query(NATIVE_MISMATCH_SQL, [fingerprint]);
    const initialPolicyRows = before === 0
      ? await connection.query(INITIAL_POLICY_MISMATCH_SQL, [])
      : [{ N: 0 }];
    const finalRows = await connection.query(TARGET_COUNT_SQL, []);
    if (Number(mismatchRows[0]?.N) !== 0 || Number(initialPolicyRows[0]?.N) !== 0
      || Number(finalRows[0]?.N) !== EXPECTED_SOURCE_ROWS) {
      throw Object.assign(new Error('Policy snapshot differs from its sealed source'), { code: 'POLICY_SNAPSHOT_DRIFT' });
    }
    await connection.commit();
    return { source: source.length, inserted: before === 0 ? source.length : 0,
      updated: 0, unchanged: before === 0 ? 0 : source.length, fingerprint };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original failure and keep DB diagnostics out of CLI output.
    }
    throw error;
  }
}

function safeCliError(error) {
  void error;
  return { error: 'POLICY_SEED_FAILED' };
}

async function main({ env = process.env, argv = process.argv, loadEnvironment, applyProfile,
  openConnection, stdout = console.log, seedOptions } = {}) {
  const args = parseArgs(argv);
  const load = loadEnvironment
    || (() => require('../../config/load-env').loadEnv(path.resolve(__dirname, '..', '..')));
  const apply = applyProfile || ((target) => require('../../config/app-profile').applyAppProfile(target));
  load();
  apply(env);
  const profile = assertSeedProfile(env);
  if (!args.apply) {
    stdout(JSON.stringify({ dryRun: true, target: TARGET, source: 'DSEDAC.ART',
      expectedRows: EXPECTED_SOURCE_ROWS, activeRows: EXPECTED_ACTIVE_ROWS,
      profile: profile.profile, mutationEnabled: false }));
    return;
  }
  const connect = openConnection || (() => require('../../adapters/pedidos-transaction-connection')
    .openDedicatedPedidosTransactionConnection());
  const connection = await connect();
  let result;
  try {
    result = await seedPolicySnapshot(connection, env, seedOptions);
  } finally {
    await connection.close();
  }
  stdout(JSON.stringify({ seeded: true, target: TARGET, ...result }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify(safeCliError(error)));
    process.exit(1);
  });
}

module.exports = { TARGET, EXPECTED_SOURCE_ROWS, EXPECTED_ACTIVE_ROWS, EXPECTED_SOURCE_FINGERPRINT,
  EXPECTED_CHECKS,
  EXPECTED_CHECK_CLAUSES, TARGET_COLUMNS, SOURCE_SQL, INSERT_SQL, NATIVE_MISMATCH_SQL,
  INITIAL_POLICY_MISMATCH_SQL, LOCK_SQL, TARGET_COUNT_SQL, normalizeCheckClause,
  canonicalSourceRows, snapshotFingerprint, parseArgs, assertSeedProfile, verifyTarget,
  seedPolicySnapshot, safeCliError, main };
