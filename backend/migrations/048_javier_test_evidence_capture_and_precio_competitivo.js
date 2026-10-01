'use strict';

/**
 * Idempotent JAVIER isolated_test migration.
 *
 * QSYS2 on 2026-10-01 (DSN GMP, REPARTO_TABLE_SET=isolated_test,
 * REPARTO_ENVIRONMENT=staging):
 * - DSEDAC.ART.CODIGOARTICULO CHAR(10) NOT NULL
 * - DSEDAC.ART.DESCRIPCIONARTICULO CHAR(40) NOT NULL
 * - DSEDAC.CLC.CODIGOCLIENTE CHAR(10) NOT NULL
 * - DSEDAC.CLC.CODIGOTARIFA NUMERIC(2,0) NOT NULL
 * - DSEDAC.ARA.CODIGOARTICULO CHAR(10) NOT NULL
 * - DSEDAC.ARA.CODIGOTARIFA NUMERIC(2,0) NOT NULL
 * - DSEDAC.ARA.PRECIOTARIFA NUMERIC(9,4) NOT NULL
 * - JAVIER.TEST_REPARTO_EVIDENCIAS exists without CAPTURED_AT or DEVICE_ID
 * - JAVIER.REPARTO_EVIDENCIAS exists (production shape). This script does not touch it.
 * - JAVIER.TEST_PRECIO_COMPETITIVO and JAVIER.PRECIO_COMPETITIVO do not exist.
 * - DSEDAC / DSED are read-only. No ALTER and no INSERT against them.
 *
 * Photo bytes: max 4 MiB (4194304). Signature bytes: max 1 MiB.
 * Idempotent upload key is sha256 of the bytes (evidence id ev_<sha256>).
 *
 * Rollback: 048_rollback.sql (do not run it from this module).
 * Production promotion: 048_promote_production.sql (NO EJECUTAR).
 */

const EVIDENCE_TABLE = 'TEST_REPARTO_EVIDENCIAS';
const PRICE_TABLE = 'TEST_PRECIO_COMPETITIVO';
const PRICE_INDEX = 'IX_TEST_PC_LOOKUP';
const SCHEMA = 'JAVIER';

const ADD_CAPTURED_AT_SQL = `ALTER TABLE ${SCHEMA}.${EVIDENCE_TABLE} ADD COLUMN CAPTURED_AT TIMESTAMP`;
const ADD_DEVICE_ID_SQL = `ALTER TABLE ${SCHEMA}.${EVIDENCE_TABLE} ADD COLUMN DEVICE_ID VARCHAR(80)`;

const CREATE_PRICE_SQL = `
CREATE TABLE ${SCHEMA}.${PRICE_TABLE} (
  ID INTEGER GENERATED ALWAYS AS IDENTITY NOT NULL,
  CODIGOARTICULO CHAR(10) NOT NULL,
  CODIGOCLIENTE CHAR(10) NOT NULL,
  CODIGOTARIFA NUMERIC(2, 0) NOT NULL,
  PRECIO_COMPETITIVO NUMERIC(9, 4) NOT NULL,
  MARGEN_PCT DECIMAL(5, 2) NOT NULL,
  VALIDO_DESDE DATE NOT NULL,
  VALIDO_HASTA DATE,
  USUARIO VARCHAR(40) NOT NULL,
  CREATED_AT TIMESTAMP NOT NULL DEFAULT CURRENT TIMESTAMP,
  UPDATED_AT TIMESTAMP NOT NULL DEFAULT CURRENT TIMESTAMP,
  CONSTRAINT PK_TEST_PRECIO_COMPETITIVO PRIMARY KEY (ID),
  CONSTRAINT CK_TEST_PC_MARGEN CHECK (MARGEN_PCT >= 0 AND MARGEN_PCT <= 100),
  CONSTRAINT CK_TEST_PC_PRECIO CHECK (PRECIO_COMPETITIVO > 0),
  CONSTRAINT CK_TEST_PC_VIGENCIA CHECK (VALIDO_HASTA IS NULL OR VALIDO_HASTA >= VALIDO_DESDE)
)`;

const CREATE_PRICE_INDEX_SQL = `
CREATE INDEX ${SCHEMA}.${PRICE_INDEX}
  ON ${SCHEMA}.${PRICE_TABLE} (CODIGOARTICULO, CODIGOCLIENTE, VALIDO_DESDE)`;

const APPLY_STATEMENTS = Object.freeze([
  ADD_CAPTURED_AT_SQL,
  ADD_DEVICE_ID_SQL,
  CREATE_PRICE_SQL,
  CREATE_PRICE_INDEX_SQL,
]);

function assertSqlTargetsTestOnly(statements) {
  for (const sql of statements) {
    const text = String(sql);
    if (/DSEDAC|DSED\./i.test(text)) {
      throw new Error('Migration refused: statement targets DSEDAC or DSED');
    }
    if (/JAVIER\.(?!TEST_|IX_TEST_)/i.test(text)) {
      throw new Error('Migration refused: statement is not a JAVIER.TEST_ object');
    }
  }
}

function assertIsolatedTest(env = process.env) {
  const tableSet = String(env.REPARTO_TABLE_SET || '').trim().toLowerCase();
  const environment = String(env.REPARTO_ENVIRONMENT || '').trim().toLowerCase();
  if (tableSet !== 'isolated_test') {
    throw new Error('Migration refused: REPARTO_TABLE_SET must be isolated_test');
  }
  if (environment === 'production') {
    throw new Error('Migration refused: REPARTO_ENVIRONMENT is production');
  }
  assertSqlTargetsTestOnly(APPLY_STATEMENTS);
}

function value(row, name) {
  return row?.[name] ?? row?.[name.toLowerCase()] ?? row?.[name.toUpperCase()];
}

function names(rows, column) {
  return new Set((rows || []).map((row) => String(value(row, column) || '').trim().toUpperCase()));
}

async function applyMigration(queryWithParams, env = process.env, connection = null) {
  assertIsolatedTest(env);
  const query = async (sql, params = []) => {
    if (connection && typeof connection.query === 'function') {
      return connection.query(sql, params);
    }
    return queryWithParams(sql, params, false, false);
  };
  if (connection && typeof connection.query === 'function') {
    // Unqualified constraint names follow the job schema. The pooled job
    // often has current schema DSEDAC, and CREATE TABLE JAVIER.* then fails
    // with SQL5051. Pin the session to JAVIER before DDL.
    await connection.query('SET CURRENT SCHEMA JAVIER');
  }
  const applied = [];

  const evidenceColumns = names(await query(
    `SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [SCHEMA, EVIDENCE_TABLE],
    false,
    false,
  ), 'COLUMN_NAME');
  if (!evidenceColumns.has('CAPTURED_AT')) {
    await query(ADD_CAPTURED_AT_SQL, [], false, false);
    applied.push('CAPTURED_AT');
  }
  if (!evidenceColumns.has('DEVICE_ID')) {
    await query(ADD_DEVICE_ID_SQL, [], false, false);
    applied.push('DEVICE_ID');
  }

  const tables = names(await query(
    `SELECT TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [SCHEMA, PRICE_TABLE],
    false,
    false,
  ), 'TABLE_NAME');
  if (!tables.has(PRICE_TABLE)) {
    await query(CREATE_PRICE_SQL, [], false, false);
    applied.push(PRICE_TABLE);
  }

  const indexes = names(await query(
    `SELECT INDEX_NAME FROM QSYS2.SYSINDEXES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [SCHEMA, PRICE_TABLE],
    false,
    false,
  ), 'INDEX_NAME');
  if (!indexes.has(PRICE_INDEX)) {
    await query(CREATE_PRICE_INDEX_SQL, [], false, false);
    applied.push(PRICE_INDEX);
  }

  return Object.freeze({ schema: SCHEMA, applied });
}

async function main() {
  assertIsolatedTest(process.env);
  const { acquireConfiguredConnection, closePool } = require('../config/db');
  const connection = await acquireConfiguredConnection();
  try {
    const result = await applyMigration(null, process.env, connection);
    console.log(JSON.stringify(result));
  } finally {
    try { await connection.close(); } catch (_) { /* ignore */ }
    await closePool();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(String(error && error.message || error).slice(0, 400));
    process.exit(1);
  });
}

module.exports = {
  SCHEMA,
  EVIDENCE_TABLE,
  PRICE_TABLE,
  APPLY_STATEMENTS,
  ADD_CAPTURED_AT_SQL,
  ADD_DEVICE_ID_SQL,
  CREATE_PRICE_SQL,
  CREATE_PRICE_INDEX_SQL,
  assertIsolatedTest,
  assertSqlTargetsTestOnly,
  applyMigration,
};
