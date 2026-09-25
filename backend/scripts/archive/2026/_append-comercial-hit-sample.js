// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-hit | _-scratch gitignored (.gitignore:198); hit comercial un solo uso | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query } = require('../config/db');
const { comercialErpWriteForbiddenSql } = require('../utils/comercial-erp-tables');

function refuse(sql) {
  if (comercialErpWriteForbiddenSql(sql)) throw new Error(`Refusing ERP write: ${sql.slice(0, 120)}`);
}

async function run(sql) {
  refuse(sql);
  try {
    await query(sql);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error.message || error).slice(0, 220) };
  }
}

async function main() {
  await initDb();
  try {
    const jobs = [
      `INSERT INTO JAVIER.TEST_CVC
         SELECT CVC.* FROM DSEDAC.CVC CVC
         JOIN DSEDAC.FPG FPG ON FPG.CODIGOFORMAPAGO = CVC.CODIGOFORMAPAGO
        WHERE CVC.TIPODOCUMENTO = 'PAG'
          AND CVC.IMPORTEPENDIENTE = 0
          AND CVC.IMPORTEVENCIMIENTO > 0
          AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
          AND FPG.PAGARESN = 'S'
          AND EXISTS (
                SELECT 1 FROM DSEDAC.CAC CAC
                 WHERE CAC.EJERCICIOFACTURA = CVC.EJERCICIODOCUMENTO
                   AND CAC.SERIEFACTURA = CVC.SERIEDOCUMENTO
                   AND CAC.TERMINALFACTURA = CVC.TERMINALDOCUMENTO
                   AND CAC.NUMEROFACTURA = CVC.NUMERODOCUMENTO
                   AND TRIM(CAC.CODIGOVENDEDOR) IN ('80','35','02','03','81','97')
              )
          AND NOT EXISTS (
                SELECT 1 FROM JAVIER.TEST_CVC T
                 WHERE T.EJERCICIODOCUMENTO = CVC.EJERCICIODOCUMENTO
                   AND T.SERIEDOCUMENTO = CVC.SERIEDOCUMENTO
                   AND T.TERMINALDOCUMENTO = CVC.TERMINALDOCUMENTO
                   AND T.NUMERODOCUMENTO = CVC.NUMERODOCUMENTO
                   AND T.TIPODOCUMENTO = CVC.TIPODOCUMENTO
              )
        FETCH FIRST 200 ROWS ONLY`,
      `INSERT INTO JAVIER.TEST_CVC
         SELECT CVC.* FROM DSEDAC.CVC CVC
        WHERE CVC.IMPORTEPENDIENTE <> 0
          AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
          AND TRIM(CVC.CODIGOCLIENTEALBARAN) IN (
                SELECT TRIM(CODIGOCLIENTE) FROM DSEDAC.CLP
                 WHERE TRIM(VENDEDORCOMERCIAL) IN ('80','35')
                 FETCH FIRST 60 ROWS ONLY
              )
          AND NOT EXISTS (
                SELECT 1 FROM JAVIER.TEST_CVC T
                 WHERE T.EJERCICIODOCUMENTO = CVC.EJERCICIODOCUMENTO
                   AND T.SERIEDOCUMENTO = CVC.SERIEDOCUMENTO
                   AND T.TERMINALDOCUMENTO = CVC.TERMINALDOCUMENTO
                   AND T.NUMERODOCUMENTO = CVC.NUMERODOCUMENTO
                   AND T.TIPODOCUMENTO = CVC.TIPODOCUMENTO
              )
        FETCH FIRST 400 ROWS ONLY`,
      `INSERT INTO JAVIER.TEST_CAC
         SELECT CAC.* FROM DSEDAC.CAC CAC
        WHERE EXISTS (
                SELECT 1 FROM JAVIER.TEST_CVC CVC
                 WHERE CAC.EJERCICIOFACTURA = CVC.EJERCICIODOCUMENTO
                   AND CAC.SERIEFACTURA = CVC.SERIEDOCUMENTO
                   AND CAC.TERMINALFACTURA = CVC.TERMINALDOCUMENTO
                   AND CAC.NUMEROFACTURA = CVC.NUMERODOCUMENTO
              )
          AND NOT EXISTS (
                SELECT 1 FROM JAVIER.TEST_CAC T
                 WHERE T.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
                   AND T.SERIEALBARAN = CAC.SERIEALBARAN
                   AND T.TERMINALALBARAN = CAC.TERMINALALBARAN
                   AND T.NUMEROALBARAN = CAC.NUMEROALBARAN
              )
        FETCH FIRST 400 ROWS ONLY`,
    ];
    for (const sql of jobs) {
      const result = await run(sql);
      console.log(JSON.stringify(result));
    }
    const sample = await query(`
      SELECT TRIM(CODIGOCLIENTE) AS CLIENTE
        FROM DSEDAC.CLP
       WHERE TRIM(VENDEDORCOMERCIAL) = '80'
       FETCH FIRST 5 ROWS ONLY
    `);
    console.log('clp80', JSON.stringify(sample));
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error('FATAL', error.message);
  process.exit(1);
});
