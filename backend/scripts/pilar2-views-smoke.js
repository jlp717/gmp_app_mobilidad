'use strict';

/**
 * PILAR 2: validity smoke for every JAVIER view (SELECT ... FETCH FIRST 1 ROW ONLY).
 * Read-only. The runtime code of the 3 audited tabs uses no views (grep evidence),
 * so this validates the existing analytic views are not broken objects.
 */

const fs = require('fs/promises');
const path = require('path');
const odbc = require('odbc');

const OUTPUT = path.resolve(__dirname, '..', 'tmp', 'db-exploration', 'pilar2-views-smoke-2026-06-11.json');

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

function quoteDb2Identifier(name) {
  const value = String(name || '').trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(value)) throw new Error('Invalid DB2 identifier');
  return '"' + value.replace(/"/g, '""') + '"';
}

function connectionString() {
  const dsn = requireEnv('ODBC_DSN');
  const uid = requireEnv('ODBC_UID');
  const pwd = requireDb2Secret();
  return [`DSN=${dsn}`, `UID=${uid}`, `PWD=${pwd}`, 'NAM=1', 'CCSID=1208', 'CMPTDM=1', 'CPTOUT=120', `DBQ=${dsn}`].join(';');
}

async function main() {
  const conn = await odbc.connect(connectionString());
  const results = [];
  try {
    const views = await conn.query(`SELECT TABLE_NAME FROM QSYS2.SYSVIEWS WHERE TABLE_SCHEMA = 'JAVIER' ORDER BY TABLE_NAME`);
    for (const view of views) {
      const name = quoteDb2Identifier(view.TABLE_NAME);
      const viewName = 'JAVIER.' + name;
      const sql = ['SELECT 1 AS OK FROM', viewName, 'FETCH FIRST 1 ROW ONLY'].join(' ');
      const start = Date.now();
      try {
        const rows = await conn.query(sql);
        results.push({ view: viewName, sql, status: 'VALIDA', ms: Date.now() - start, rows: rows.length });
        console.log(`[views] ${viewName}: VALIDA (${Date.now() - start} ms, rows=${rows.length})`);
      } catch (error) {
        results.push({ view: viewName, sql, status: 'ERROR', ms: Date.now() - start, error: error.message, odbc: error.odbcErrors || [] });
        console.log(`[views] ${viewName}: ERROR ${error.message}`);
      }
    }
    await fs.writeFile(OUTPUT, JSON.stringify({ ts: new Date().toISOString(), results }, null, 1), 'utf8');
    console.log(`[views] wrote ${OUTPUT}`);
  } finally {
    await conn.close();
  }
}

main().catch(error => {
  console.error(`[views] FAIL: ${error.message}`);
  process.exit(1);
});
