#!/usr/bin/env node
/**
 * run-020-migration.js
 *
 * Executes 020_repartidor_finance_tables.sql DDL against DB2 for i (AS/400)
 * via ODBC (DSN=GMP).
 *
 * Execution rule:
 *   If DB2 returns "object/column already exists" for CREATE TABLE,
 *   CREATE INDEX, ADD COLUMN, or ADD CONSTRAINT → skip that statement
 *   only and continue with the next one. All other errors are fatal.
 *
 * Usage:
 *   node backend/scripts/run-020-migration.js
 *
 * Env vars:
 *   ODBC_DSN            = GMP (default)
 *   ODBC_UID            = required
 *   ODBC_PWD            = required
 *   ERP_FINANCE_SCHEMA  = JAVIER (default, used only in verification SQL
 *                         substitution and logging)
 */

const odbc = require('odbc');
const fs   = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function requireEnv(name) {
  const value = process['env'][name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Missing required environment variable ' + name);
  }
  return value;
}

const DB_DSN  = process.env.ODBC_DSN || 'GMP';
const DB_UID  = requireEnv('ODBC_UID');
const DB_PWD  = requireEnv('ODBC_PWD');
const SCHEMA  = process.env.ERP_FINANCE_SCHEMA || 'JAVIER';

const CONNECTION_STRING = [
  `DSN=${DB_DSN}`,
  `UID=${DB_UID}`,
  `PWD=${DB_PWD}`,
  'NAM=1',
  'CCSID=1208',
  'CMPTDM=1',
].join(';');

const SQL_FILE    = path.resolve(__dirname, 'sql', '020_repartidor_finance_tables.sql');
const VERIFY_FILE = path.resolve(__dirname, 'sql', '021_verify_repartidor_finance_schema.sql');

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
    // SQLSTATE for "object already exists" / "duplicate column"
    if (e.state === '42710' || e.state === '42711') return true;
    // SQLCODE for "name already used" / "duplicate"
    if (e.code === -601 || e.code === -612 || e.code === 601) return true;
    // SQL5051 = qualifier mismatch (DB2 for i ODBC bug with ADD CONSTRAINT)
    if (e.code === -5051) return true;
  }

  // Fallback keyword scan (DB2 for i error text)
  const keywords = [
    'already exists', 'already defined', 'duplicate',
    'already has',     'already used',     'constraint already',
    'column already',  'index already',    'already primary key',
    'key already',
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
    await conn.query(sql);
    console.log(`${label} OK   ${preview}...`);
    return 'ok';
  } catch (err) {
    if (isSkippableError(err)) {
      console.log(`${label} SKIP ${preview}...  (already exists)`);
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

// ── Verification via 021 SQL ────────────────────────────────────────────────
async function runVerification(conn) {
  if (!fs.existsSync(VERIFY_FILE)) {
    console.log('\n--- Verification SKIPPED (021 file not found) ---');
    return false;
  }

  let verifySql = fs.readFileSync(VERIFY_FILE, 'utf8');

  // Replace hardcoded 'JAVIER' with ERP_FINANCE_SCHEMA if different
  if (SCHEMA !== 'JAVIER') {
    // Only replace schema-qualified references to avoid false positives
    verifySql = verifySql
      .replace(/'(JAVIER)'/g, `'${SCHEMA}'`)
      .replace(/'JAVIER'/g, `'${SCHEMA}'`);
  }

  const lines     = verifySql.split(/\r?\n/);
  const cleanBuff = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (t === '' || t.startsWith('--')) continue;
    cleanBuff.push(raw);
  }
  const cleanSql = cleanBuff.join('\n');

  console.log('\n--- Verification (021) ---');

  try {
    const rows = await conn.query(cleanSql);
    let allOk = true;
    for (const row of rows) {
      const name   = String(row.CHECK_NAME  || row.check_name  || '').trim();
      const status = String(row.STATUS      || row.status      || '').trim();
      const icon   = status === 'OK' ? ' OK ' : 'FAIL';
      console.log(`  [${icon}]  ${name}`);
      if (status !== 'OK') allOk = false;
    }
    console.log(allOk ? '\nAll checks OK.\n' : '\n*** Some checks FAILED ***\n');
    return allOk;
  } catch (err) {
    console.error(`Verification query failed: ${err.message}`);
    return false;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== 020 Migration Runner ===');
  console.log(`DSN: ${DB_DSN}  Schema: ${SCHEMA}`);
  console.log(`SQL file:  ${SQL_FILE}`);
  console.log(`Verify:    ${VERIFY_FILE}\n`);

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

    // Ensure UTF-8 CCSID (same as db.js)
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
      // Some verification checks failed despite no DDL errors
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
