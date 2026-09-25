// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-append | _-scratch gitignored; append puntual test CAC/PAG | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query } = require('../config/db');
const { comercialErpWriteForbiddenSql } = require('../utils/comercial-erp-tables');

async function main() {
  await initDb();
  try {
    const sql = `INSERT INTO JAVIER.TEST_CAC
      SELECT CAC.* FROM DSEDAC.CAC CAC
       WHERE EXISTS (
         SELECT 1 FROM JAVIER.TEST_CVC CVC
          WHERE CVC.TIPODOCUMENTO = 'PAG'
            AND CAC.EJERCICIOFACTURA = CVC.EJERCICIODOCUMENTO
            AND TRIM(CAC.SERIEFACTURA) = TRIM(CVC.SERIEDOCUMENTO)
            AND CAC.TERMINALFACTURA = CVC.TERMINALDOCUMENTO
            AND CAC.NUMEROFACTURA = CVC.NUMERODOCUMENTO
       )
       FETCH FIRST 400 ROWS ONLY`;
    if (comercialErpWriteForbiddenSql(sql)) throw new Error('refused');
    try {
      await query(sql);
      console.log('cac insert ok');
    } catch (error) {
      console.log('cac insert', String(error.message || error).slice(0, 200));
    }
    const counts = await query(`
      SELECT CAST('join_pg_s' AS VARCHAR(20)) K, COUNT(*) N
        FROM JAVIER.TEST_CVC CVC
        JOIN JAVIER.TEST_FPG FPG ON FPG.CODIGOFORMAPAGO = CVC.CODIGOFORMAPAGO
        JOIN JAVIER.TEST_CAC CAC
          ON CAC.EJERCICIOFACTURA = CVC.EJERCICIODOCUMENTO
         AND TRIM(CAC.SERIEFACTURA) = TRIM(CVC.SERIEDOCUMENTO)
         AND CAC.TERMINALFACTURA = CVC.TERMINALDOCUMENTO
         AND CAC.NUMEROFACTURA = CVC.NUMERODOCUMENTO
       WHERE CVC.TIPODOCUMENTO = 'PAG'
         AND CVC.IMPORTEPENDIENTE = 0
         AND FPG.PAGARESN = 'S'
         AND TRIM(CAC.CODIGOVENDEDOR) IN ('80','35','02','03','81','97')
    `);
    console.log(JSON.stringify(counts));
  } finally {
    await closePool();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
