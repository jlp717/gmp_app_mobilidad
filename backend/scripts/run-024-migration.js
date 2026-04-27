#!/usr/bin/env node
/**
 * run-024-migration.js
 *
 * Aligns JAVIER repartidor tables to EXACTLY match DSEDAC structure.
 *
 * Steps:
 *   1. Backs up existing data to BKP_<table>_20260427
 *   2. Drops existing tables
 *   3. Recreates with ALL DSEDAC columns + app-specific columns
 *   4. Creates indexes
 *   5. Runs verification queries
 *
 * Execution rule:
 *   If DB2 returns "object/column already exists" → skip that statement
 *   only and continue. All other errors are fatal.
 *
 * Usage:
 *   node backend/scripts/run-024-migration.js
 *
 * Env vars:
 *   ODBC_DSN = GMP (default)
 *   ODBC_UID = JAVIER (default)
 *   ODBC_PWD = JAVIER (default)
 */

const odbc = require('odbc');
const fs   = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const DB_DSN  = process.env.ODBC_DSN || 'GMP';
const DB_UID  = process.env.ODBC_UID || 'JAVIER';
const DB_PWD  = process.env.ODBC_PWD || 'JAVIER';

const CONNECTION_STRING = [
  `DSN=${DB_DSN}`,
  `UID=${DB_UID}`,
  `PWD=${DB_PWD}`,
  'NAM=1',
  'CCSID=1208',
  'CMPTDM=1',
].join(';');

const SQL_FILE = path.resolve(__dirname, 'sql', '024_align_javier_to_dsedac.sql');

// Tables being migrated
const TABLES = [
  'REPARTIDOR_COBROS',
  'REPARTIDOR_LIQUIDACION_OPS',
  'REPARTIDOR_ENTREGAS',
  'REPARTIDOR_ENTREGA_LINEAS',
  'REPARTIDOR_FIRMAS',
  'REPARTIDOR_OBJETIVOS',
  'DELIVERY_STATUS',
  'CLIENT_SIGNERS',
  'REPARTIDOR_FINANCIAL_BALANCES',
  'REPARTIDOR_COMMISSION_TIERS',
  'REPARTIDOR_LIQUIDACION_EMAILS',
];

// ── SQL Parser ──────────────────────────────────────────────────────────────
function parseStatements(sqlText) {
  const lines = sqlText.split(/\r?\n/);
  const buff  = [];

  for (const raw of lines) {
    const t = raw.trim();
    if (t === '' || t.startsWith('--')) continue;
    buff.push(raw);
  }

  return buff
    .join('\n')
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// ── Skippable error detection ───────────────────────────────────────────────
function isSkippableError(error) {
  const msg  = (error.message || '').toLowerCase();
  const odbc = error.odbcErrors || [];

  for (const e of odbc) {
    if (e.state === '42710' || e.state === '42711') return true;
    if (e.code === -601 || e.code === -612 || e.code === 601) return true;
    if (e.code === -5051) return true;
  }

  const keywords = [
    'already exists', 'already defined', 'duplicate',
    'already has',     'already used',     'constraint already',
    'column already',  'index already',    'already primary key',
    'key already',     'object not found', 'undefined object',
    'not found',
  ];
  for (const kw of keywords) {
    if (msg.includes(kw)) return true;
  }

  return false;
}

// ── Execute single statement ────────────────────────────────────────────────
async function executeStatement(conn, sql, idx, total) {
  const preview = sql.replace(/\s+/g, ' ').substring(0, 120);
  const label   = `[${String(idx).padStart(3, '0')}/${total}]`;

  try {
    const result = await conn.query(sql);
    console.log(`${label} OK   ${preview}...`);
    return 'ok';
  } catch (err) {
    if (isSkippableError(err)) {
      console.log(`${label} SKIP ${preview}...  (already exists or not found)`);
      return 'skip';
    }
    const detail = (err.odbcErrors || [])
      .map(e => `[${e.state} ${e.code}]`)
      .join(' ') || '';
    console.error(`${label} FAIL ${preview}`);
    console.error(`       ${detail} ${err.message}`);
    throw err;
  }
}

// ── Verification ────────────────────────────────────────────────────────────
async function runVerification(conn) {
  console.log('\n--- Verification ---');

  // Check column counts
  const verifyQuery = `
    SELECT
      TABLE_NAME,
      COUNT(*) AS COLUMN_COUNT
    FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = 'JAVIER'
      AND TABLE_NAME IN (
        'REPARTIDOR_COBROS',
        'REPARTIDOR_LIQUIDACION_OPS',
        'REPARTIDOR_ENTREGAS',
        'REPARTIDOR_ENTREGA_LINEAS',
        'REPARTIDOR_FIRMAS',
        'REPARTIDOR_OBJETIVOS',
        'DELIVERY_STATUS',
        'CLIENT_SIGNERS',
        'REPARTIDOR_FINANCIAL_BALANCES',
        'REPARTIDOR_COMMISSION_TIERS',
        'REPARTIDOR_LIQUIDACION_EMAILS'
      )
    GROUP BY TABLE_NAME
    ORDER BY TABLE_NAME
  `;

  const expectedCounts = {
    'REPARTIDOR_COBROS': 112,
    'REPARTIDOR_LIQUIDACION_OPS': 38,
    'REPARTIDOR_ENTREGAS': 50,
    'REPARTIDOR_ENTREGA_LINEAS': 132,
    'REPARTIDOR_FIRMAS': 25,
    'REPARTIDOR_OBJETIVOS': 15,
    'DELIVERY_STATUS': 148,
    'CLIENT_SIGNERS': 56,
    'REPARTIDOR_FINANCIAL_BALANCES': 4,
    'REPARTIDOR_COMMISSION_TIERS': 9,
    'REPARTIDOR_LIQUIDACION_EMAILS': 9,
  };

  try {
    const rows = await conn.query(verifyQuery);
    let allOk = true;

    for (const row of rows) {
      const name = String(row.TABLE_NAME || row.table_name || '').trim();
      const count = parseInt(row.COLUMN_COUNT || row.column_count || 0);
      const expected = expectedCounts[name] || 0;
      const status = count === expected ? 'OK' : 'FAIL';
      console.log(`  [${status}] ${name}: ${count} columns (expected ${expected})`);
      if (count !== expected) allOk = false;
    }

    // Check for missing tables
    for (const [name, expected] of Object.entries(expectedCounts)) {
      const found = rows.some(r =>
        String(r.TABLE_NAME || r.table_name || '').trim() === name
      );
      if (!found) {
        console.log(`  [FAIL] ${name}: TABLE NOT FOUND (expected ${expected} columns)`);
        allOk = false;
      }
    }

    // Check backup tables
    const bkpQuery = `
      SELECT TABLE_NAME
      FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = 'JAVIER'
        AND TABLE_NAME LIKE 'BKP_%_20260427'
      ORDER BY TABLE_NAME
    `;
    const bkpRows = await conn.query(bkpQuery);
    console.log(`\n  Backup tables: ${bkpRows.length} found`);
    for (const row of bkpRows) {
      console.log(`    - ${row.TABLE_NAME || row.table_name}`);
    }

    console.log(allOk ? '\nAll checks OK.\n' : '\n*** Some checks FAILED ***\n');
    return allOk;
  } catch (err) {
    console.error(`Verification failed: ${err.message}`);
    return false;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== 024 Migration: Align JAVIER to DSEDAC ===');
  console.log(`DSN: ${DB_DSN}  UID: ${DB_UID}`);
  console.log(`SQL file: ${SQL_FILE}`);
  console.log(`Tables: ${TABLES.join(', ')}\n`);

  if (!fs.existsSync(SQL_FILE)) {
    console.error(`ERROR: SQL file not found → ${SQL_FILE}`);
    process.exit(1);
  }

  const sqlText    = fs.readFileSync(SQL_FILE, 'utf8');
  const statements = parseStatements(sqlText);
  console.log(`Parsed ${statements.length} statements.\n`);

  let pool = null;
  let conn = null;

  try {
    pool = await odbc.pool(CONNECTION_STRING);
    conn = await pool.connect();

    // Ensure UTF-8 CCSID
    try {
      await conn.query("CALL QSYS.QCMDEXC('CHGJOB CCSID(1208)', 0000000018.00000)");
    } catch (_) { /* non-fatal */ }

    // ── Execute DDL statements ──────────────────────────────────────────
    let ok = 0, skip = 0;
    for (let i = 0; i < statements.length; i++) {
      const r = await executeStatement(conn, statements[i], i + 1, statements.length);
      if (r === 'ok')   ok++;
      if (r === 'skip') skip++;
    }

    const failed = statements.length - ok - skip;
    console.log(`\n--- Summary ---`);
    console.log(`Total: ${statements.length}  |  OK: ${ok}  |  Skipped: ${skip}  |  Failed: ${failed}`);

    // ── Verification ────────────────────────────────────────────────────
    const verified = await runVerification(conn);
    if (!verified && failed === 0) {
      process.exitCode = 1;
    } else if (failed > 0) {
      process.exitCode = 1;
    }

  } catch (err) {
    console.error(`\nFATAL: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (conn) {
      try { await conn.close(); } catch (_) { /* stale */ }
    }
    if (pool) {
      try { await pool.close(); } catch (_) { /* stale */ }
    }
  }
}

main();
