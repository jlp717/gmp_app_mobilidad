'use strict';

/**
 * PILAR 2 pre-prod audit SQL runner (2026-06-11)
 * ==============================================
 *
 * Generic evidence-grade SQL runner for the pre-production DB2 audit.
 * - Read queries: allowed against any schema (catalog + DSEDAC + JAVIER).
 * - Write/DDL statements (INSERT/UPDATE/DELETE/ALTER/CREATE/DROP/MERGE/TRUNCATE):
 *   HARD-BLOCKED unless the statement target is the JAVIER schema.
 *   DSEDAC (ERP production) is read-only without exception.
 *
 * Usage:
 *   node scripts/pilar2-sql-runner.js --sql "SELECT ..." [--params '["A",1]'] [--time N]
 *   node scripts/pilar2-sql-runner.js --file path/to/query.sql
 *
 * Output: JSON { ok, elapsedMs, rowCount, rows } on stdout.
 * --time N repeats the query N times and reports each elapsed ms (perf evidence).
 */

const fs = require('fs');
const odbc = require('odbc');

const APP_SCHEMA = 'JAVIER';

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
    `DSN=${dsn}`,
    `UID=${uid}`,
    `PWD=${pwd}`,
    'NAM=1',
    'CCSID=1208',
    'CMPTDM=1',
    `CPTOUT=${process.env.ODBC_TIMEOUT || 60}`,
    `COMMTIMEOUT=${process.env.ODBC_COMM_TIMEOUT || 90}`,
    `DBQ=${dsn}`,
  ].join(';');
}

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const WRITE_VERBS = /^\s*(INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|DROP|TRUNCATE|RENAME|GRANT|REVOKE|CALL)\b/i;

function assertWriteSafety(sql) {
  const normalized = String(sql).replace(/\s+/g, ' ').trim();
  if (!WRITE_VERBS.test(normalized)) return; // read-only statement

  // Statement mutates state: its target MUST be JAVIER.<obj>
  const targetPatterns = [
    /^INSERT\s+INTO\s+([A-Z0-9_"]+)\./i,
    /^UPDATE\s+([A-Z0-9_"]+)\./i,
    /^DELETE\s+FROM\s+([A-Z0-9_"]+)\./i,
    /^MERGE\s+INTO\s+([A-Z0-9_"]+)\./i,
    /^(?:ALTER|CREATE|DROP|TRUNCATE|RENAME)\s+(?:TABLE|VIEW|INDEX|SEQUENCE|TRIGGER)\s+([A-Z0-9_"]+)\./i,
  ];

  for (const pattern of targetPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const schema = match[1].replace(/"/g, '').toUpperCase();
      if (schema !== APP_SCHEMA) {
        throw new Error(`GUARDRAIL: write target schema "${schema}" is forbidden. Only ${APP_SCHEMA} accepts writes.`);
      }
      return;
    }
  }
  throw new Error('GUARDRAIL: mutating statement without explicit JAVIER.<table> target is forbidden.');
}

async function main() {
  let sql = getArg('--sql');
  const file = getArg('--file');
  if (!sql && file) sql = fs.readFileSync(file, 'utf8');
  if (!sql) throw new Error('Provide --sql "..." or --file path');

  const params = JSON.parse(getArg('--params') || '[]');
  const repeat = Math.max(1, parseInt(getArg('--time') || '1', 10));
  const maxRows = Math.max(0, parseInt(getArg('--max-rows') || '200', 10));

  assertWriteSafety(sql);

  const connection = await odbc.connect(connectionString());
  try {
    const timings = [];
    let rows = [];
    for (let i = 0; i < repeat; i++) {
      const start = Date.now();
      rows = params.length ? await connection.query(sql, params) : await connection.query(sql);
      timings.push(Date.now() - start);
    }
    const plain = Array.from(rows).map(row => {
      const out = {};
      for (const key of Object.keys(row)) {
        const value = row[key];
        out[key] = typeof value === 'string' ? value.trimEnd() : value;
      }
      return out;
    });
    console.log(JSON.stringify({
      ok: true,
      elapsedMs: timings.length === 1 ? timings[0] : timings,
      rowCount: plain.length,
      rows: plain.slice(0, maxRows),
    }, (key, value) => (typeof value === 'bigint' ? Number(value) : value), 1));
  } finally {
    await connection.close();
  }
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
    odbcErrors: error.odbcErrors || [],
  }, null, 1));
  process.exit(1);
});
