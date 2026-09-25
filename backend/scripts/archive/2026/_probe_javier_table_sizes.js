// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual tamanos tablas JAVIER | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { initDb, closePool, query } = require('../config/db');

(async () => {
  await initDb();
  const sql = `
    SELECT TRIM(TABLE_NAME) AS TABLE_NAME,
           NUMBER_ROWS
      FROM QSYS2.SYSTABLESTAT
     WHERE TABLE_SCHEMA = 'JAVIER'
       AND (
         TABLE_NAME LIKE '%REPARTO%'
         OR TABLE_NAME LIKE '%REPARTIDOR%'
         OR TABLE_NAME LIKE '%DELIVERY%'
         OR TABLE_NAME LIKE '%LIQUID%'
         OR TABLE_NAME LIKE '%COBRO%'
         OR TABLE_NAME LIKE '%CONFIRM%'
       )
     ORDER BY NUMBER_ROWS DESC
     FETCH FIRST 50 ROWS ONLY
  `;
  const rows = await query(sql);
  for (const r of rows || []) {
    console.log(String(r.TABLE_NAME || '').trim(), Number(r.NUMBER_ROWS || 0));
  }
  await closePool();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
