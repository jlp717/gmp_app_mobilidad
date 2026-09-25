// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual columnas liq-cobros | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const odbc = require('odbc');

function cs() {
  const dsn = process.env.ODBC_DSN || 'GMP';
  const uid = process.env.ODBC_UID || 'JAVIER';
  const pwd = process.env.ODBC_PWD || process.env.ODBC_PASSWORD;
  return [`DSN=${dsn}`, `UID=${uid}`, `PWD=${pwd}`, 'NAM=1', 'CCSID=1208'].join(';');
}

async function safe(conn, label, sql, params = []) {
  try {
    const rows = params.length ? await conn.query(sql, params) : await conn.query(sql);
    return { ok: true, label, count: rows.length, rows };
  } catch (err) {
    return { ok: false, label, error: String(err && err.message ? err.message : err) };
  }
}

async function main() {
  const conn = await odbc.connect(cs());
  const out = {};
  out.lqdCols = await safe(conn, 'lqdCols', `
    SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
     WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='TEST_LQD'
     ORDER BY ORDINAL_POSITION FETCH FIRST 60 ROWS ONLY
  `);
  out.cobrosCols = await safe(conn, 'cobrosCols', `
    SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
     WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='TEST_COBROS'
     ORDER BY ORDINAL_POSITION FETCH FIRST 60 ROWS ONLY
  `);
  out.repartidorCobrosCols = await safe(conn, 'repartidorCobrosCols', `
    SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
     WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='TEST_REPARTIDOR_COBROS'
     ORDER BY ORDINAL_POSITION FETCH FIRST 40 ROWS ONLY
  `);
  out.lqdCount = await safe(conn, 'lqdCount', `SELECT COUNT(*) AS C FROM JAVIER.TEST_LQD`);
  out.cobrosCount = await safe(conn, 'cobrosCount', `SELECT COUNT(*) AS C FROM JAVIER.TEST_COBROS`);
  out.repartidorCobrosCount = await safe(conn, 'repartidorCobrosCount', `SELECT COUNT(*) AS C FROM JAVIER.TEST_REPARTIDOR_COBROS`);
  console.log(JSON.stringify(out, null, 2));
  await conn.close();
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
