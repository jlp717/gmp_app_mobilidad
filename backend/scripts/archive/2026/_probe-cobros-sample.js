// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual muestra cobros | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const odbc = require('odbc');
const fs = require('fs');
const path = require('path');

(async () => {
  const dsn = process.env.ODBC_DSN || 'GMP';
  const uid = process.env.ODBC_UID || 'JAVIER';
  const pwd = process.env.ODBC_PWD || process.env.ODBC_PASSWORD;
  const c = await odbc.connect(`DSN=${dsn};UID=${uid};PWD=${pwd};NAM=1;CCSID=1208`);
  const cols = await c.query(`
    SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
     WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='TEST_COBROS'
     ORDER BY ORDINAL_POSITION
  `);
  const sample = await c.query(`
    SELECT ID, CODIGOUSUARIO, IMPORTE, FECHA
      FROM JAVIER.TEST_COBROS
     ORDER BY FECHA DESC
     FETCH FIRST 3 ROWS ONLY
  `);
  const out = {
    cols: cols.map((r) => r.COLUMN_NAME),
    sample,
  };
  fs.writeFileSync(
    path.join(__dirname, '../../docs/audits/2026-09-21-comercial-demo/cobros-cols-sample.json'),
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));
  await c.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
