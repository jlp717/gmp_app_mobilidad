// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual cantidades decimales | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { initDb, closePool, query } = require('../config/db');

async function main() {
  await initDb();
  try {
    const units = await query(`
      SELECT TRIM(UNIDADMEDIDA) AS U, COUNT(*) AS N
      FROM DSEDAC.LAC
      WHERE ABS(CANTIDADUNIDADES - ROUND(CANTIDADUNIDADES, 0)) > 0.0001
      GROUP BY UNIDADMEDIDA
      ORDER BY 2 DESC
      FETCH FIRST 20 ROWS ONLY
    `);
    console.log('DECIMAL_UNITS', JSON.stringify(units));

    const samples = await query(`
      SELECT TRIM(UNIDADMEDIDA) AS U,
             CANTIDADUNIDADES AS Q,
             TRIM(CODIGOARTICULO) AS ART,
             TRIM(DESCRIPCION) AS D
      FROM DSEDAC.LAC
      WHERE ABS(CANTIDADUNIDADES - ROUND(CANTIDADUNIDADES, 0)) > 0.0001
      FETCH FIRST 12 ROWS ONLY
    `);
    console.log('SAMPLES', JSON.stringify(samples, null, 2));

    // LAC.UNIDADMEDIDA exists?
    const cols = await query(`
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME='LAC'
        AND COLUMN_NAME IN ('CANTIDADUNIDADES','UNIDADMEDIDA','CANTIDADENVASES','IMPORTEVENTA')
    `);
    console.log('COLS', JSON.stringify(cols));
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
