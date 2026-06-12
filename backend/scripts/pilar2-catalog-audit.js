'use strict';

/**
 * PILAR 2 pre-prod catalog audit (2026-06-11)
 * ===========================================
 * Read-only catalog extraction for the pre-production DB audit.
 * For each audited table it pulls from QSYS2 catalogs:
 *   - SYSCOLUMNS: name, type, length, precision, scale, CCSID, nullable,
 *     default, identity.
 *   - SYSCST + SYSKEYCST (+ SYSREFCST): PK / UNIQUE / FK constraints.
 *   - SYSINDEXES + SYSKEYS: indexes and their columns.
 *   - SYSTRIGGERS: triggers on the table.
 * Plus schema-level: SYSSEQUENCES and SYSVIEWS for JAVIER.
 *
 * No DML/DDL is executed. Output: JSON to backend/tmp/db-exploration/.
 */

const fs = require('fs/promises');
const path = require('path');
const odbc = require('odbc');

const OUTPUT_DIR = path.resolve(__dirname, '..', 'tmp', 'db-exploration');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function requireDb2Secret() {
  const value = process.env.ODBC_PWD ?? process.env.ODBC_PASSWORD;
  if (!value) throw new Error('Missing required environment variable ODBC_PWD or ODBC_PASSWORD');
  return value;
}

function connectionString() {
  const dsn = requireEnv('ODBC_DSN');
  const uid = requireEnv('ODBC_UID');
  const pwd = requireDb2Secret();
  return [
    `DSN=${dsn}`, `UID=${uid}`, `PWD=${pwd}`,
    'NAM=1', 'CCSID=1208', 'CMPTDM=1',
    `CPTOUT=${process.env.ODBC_TIMEOUT || 60}`,
    `COMMTIMEOUT=${process.env.ODBC_COMM_TIMEOUT || 90}`,
    `DBQ=${dsn}`,
  ].join(';');
}

// JAVIER tables that receive writes from the audited tabs, with their
// production equivalents (per backend/scripts/compare-javier-dsedac-alignment.js).
const PAIRS = [
  { javier: 'PEDIDOS_CAB', prod: 'CPC' },
  { javier: 'PEDIDOS_LIN', prod: 'LPC' },
  { javier: 'COBROS', prod: 'CRC' },
  { javier: 'REPARTIDOR_COBROS', prod: 'CRCA' },
];

// App-only JAVIER tables (no ERP equivalent by design).
const APP_ONLY = ['PEDIDOS_SEQ', 'PEDIDOS_STOCK_RESERVE', 'BOLSA_COMERCIAL', 'MOVIMIENTOS_BOLSA'];

async function getColumns(conn, schema, table) {
  return conn.query(`
    SELECT COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, LENGTH,
           NUMERIC_PRECISION, NUMERIC_SCALE, CHARACTER_MAXIMUM_LENGTH,
           CCSID, IS_NULLABLE, HAS_DEFAULT, COLUMN_DEFAULT, IS_IDENTITY
    FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION`, [schema, table]);
}

async function getConstraints(conn, schema, table) {
  const constraints = await conn.query(`
    SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
    FROM QSYS2.SYSCST
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    ORDER BY CONSTRAINT_TYPE, CONSTRAINT_NAME`, [schema, table]);

  for (const cst of constraints) {
    const cols = await conn.query(`
      SELECT COLUMN_NAME, ORDINAL_POSITION
      FROM QSYS2.SYSKEYCST
      WHERE CONSTRAINT_SCHEMA = ? AND CONSTRAINT_NAME = ?
        AND TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
      [schema, String(cst.CONSTRAINT_NAME).trim(), schema, table]);
    cst.COLUMNS = cols.map(c => String(c.COLUMN_NAME).trim());
  }
  return constraints;
}

async function getIndexes(conn, schema, table) {
  const indexes = await conn.query(`
    SELECT INDEX_SCHEMA, INDEX_NAME, IS_UNIQUE
    FROM QSYS2.SYSINDEXES
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    ORDER BY INDEX_NAME`, [schema, table]);

  for (const idx of indexes) {
    const cols = await conn.query(`
      SELECT COLUMN_NAME, ORDINAL_POSITION, ORDERING
      FROM QSYS2.SYSKEYS
      WHERE INDEX_SCHEMA = ? AND INDEX_NAME = ?
      ORDER BY ORDINAL_POSITION`,
      [String(idx.INDEX_SCHEMA).trim(), String(idx.INDEX_NAME).trim()]);
    idx.COLUMNS = cols.map(c => `${String(c.COLUMN_NAME).trim()} ${String(c.ORDERING || '').trim()}`.trim());
  }
  return indexes;
}

async function getTriggers(conn, schema, table) {
  return conn.query(`
    SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_TIMING, ENABLED
    FROM QSYS2.SYSTRIGGERS
    WHERE EVENT_OBJECT_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?
    ORDER BY TRIGGER_NAME`, [schema, table]);
}

async function tableMeta(conn, schema, table) {
  const exists = await conn.query(
    `SELECT TABLE_TYPE, ROW_LENGTH FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [schema, table]);
  if (!exists.length) return { schema, table, exists: false };
  return {
    schema,
    table,
    exists: true,
    type: String(exists[0].TABLE_TYPE).trim(),
    columns: await getColumns(conn, schema, table),
    constraints: await getConstraints(conn, schema, table),
    indexes: await getIndexes(conn, schema, table),
    triggers: await getTriggers(conn, schema, table),
  };
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const conn = await odbc.connect(connectionString());
  try {
    const report = { ts: new Date().toISOString(), pairs: [], appOnly: [], sequences: [], views: [] };

    for (const pair of PAIRS) {
      report.pairs.push({
        javier: await tableMeta(conn, 'JAVIER', pair.javier),
        prod: await tableMeta(conn, 'DSEDAC', pair.prod),
      });
      console.log(`[catalog] pair done: JAVIER.${pair.javier} <-> DSEDAC.${pair.prod}`);
    }

    for (const table of APP_ONLY) {
      report.appOnly.push(await tableMeta(conn, 'JAVIER', table));
      console.log(`[catalog] app-only done: JAVIER.${table}`);
    }

    report.sequences = await conn.query(
      `SELECT SEQUENCE_NAME, DATA_TYPE FROM QSYS2.SYSSEQUENCES WHERE SEQUENCE_SCHEMA = 'JAVIER'`);
    report.views = await conn.query(
      `SELECT TABLE_NAME, IS_INSERTABLE_INTO FROM QSYS2.SYSVIEWS WHERE TABLE_SCHEMA = 'JAVIER' ORDER BY TABLE_NAME`);

    const out = path.join(OUTPUT_DIR, 'pilar2-catalog-2026-06-11.json');
    await fs.writeFile(out, JSON.stringify(report, null, 1), 'utf8');
    console.log(`[catalog] wrote ${out}`);
  } finally {
    await conn.close();
  }
}

main().catch(error => {
  console.error(`[catalog] FAIL: ${error.message}`);
  if (error.odbcErrors) console.error(JSON.stringify(error.odbcErrors));
  process.exit(1);
});
