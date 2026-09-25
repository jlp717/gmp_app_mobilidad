// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-append | _-scratch gitignored; append puntual alcance hit | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * One-shot: extra CVC/CAC/CPC for HIT vendors 80/35 CLP clients.
 * Writes JAVIER.TEST_* only.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query } = require('../config/db');
const { comercialErpWriteForbiddenSql } = require('../utils/comercial-erp-tables');

function refuse(sql) {
  if (comercialErpWriteForbiddenSql(sql)) throw new Error(`refused ${sql.slice(0, 80)}`);
}

async function runWrite(label, sql) {
  refuse(sql);
  try {
    await query(sql);
    console.log('OK', label);
  } catch (error) {
    console.log('ERR', label, String(error.message || error).slice(0, 220));
  }
}

async function main() {
  await initDb();
  try {
    await runWrite('cvc clp 80/35', `
      INSERT INTO JAVIER.TEST_CVC
      SELECT CVC.* FROM DSEDAC.CVC CVC
       WHERE TRIM(CVC.CODIGOCLIENTEALBARAN) IN (
               SELECT TRIM(CLP.CODIGOCLIENTE)
                 FROM DSEDAC.CLP CLP
                WHERE TRIM(CLP.VENDEDORCOMERCIAL) IN ('80', '35')
                FETCH FIRST 200 ROWS ONLY
             )
         AND NOT EXISTS (
               SELECT 1 FROM JAVIER.TEST_CVC T
                WHERE T.EJERCICIODOCUMENTO = CVC.EJERCICIODOCUMENTO
                  AND TRIM(T.SERIEDOCUMENTO) = TRIM(CVC.SERIEDOCUMENTO)
                  AND T.TERMINALDOCUMENTO = CVC.TERMINALDOCUMENTO
                  AND T.NUMERODOCUMENTO = CVC.NUMERODOCUMENTO
                  AND TRIM(T.TIPODOCUMENTO) = TRIM(CVC.TIPODOCUMENTO)
             )
       FETCH FIRST 600 ROWS ONLY`);

    await runWrite('cac trim pag+clp', `
      INSERT INTO JAVIER.TEST_CAC
      SELECT CAC.* FROM DSEDAC.CAC CAC
       WHERE EXISTS (
               SELECT 1 FROM JAVIER.TEST_CVC CVC
                WHERE CAC.EJERCICIOFACTURA = CVC.EJERCICIODOCUMENTO
                  AND TRIM(CAC.SERIEFACTURA) = TRIM(CVC.SERIEDOCUMENTO)
                  AND CAC.TERMINALFACTURA = CVC.TERMINALDOCUMENTO
                  AND CAC.NUMEROFACTURA = CVC.NUMERODOCUMENTO
             )
         AND NOT EXISTS (
               SELECT 1 FROM JAVIER.TEST_CAC T
                WHERE T.EJERCICIOFACTURA = CAC.EJERCICIOFACTURA
                  AND TRIM(T.SERIEFACTURA) = TRIM(CAC.SERIEFACTURA)
                  AND T.TERMINALFACTURA = CAC.TERMINALFACTURA
                  AND T.NUMEROFACTURA = CAC.NUMEROFACTURA
             )
       FETCH FIRST 600 ROWS ONLY`);

    await runWrite('cpc trim cac', `
      INSERT INTO JAVIER.TEST_CPC
      SELECT CPC.* FROM DSEDAC.CPC CPC
       WHERE EXISTS (
               SELECT 1 FROM JAVIER.TEST_CAC CAC
                WHERE CPC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
                  AND TRIM(CPC.SERIEALBARAN) = TRIM(CAC.SERIEALBARAN)
                  AND CPC.TERMINALALBARAN = CAC.TERMINALALBARAN
                  AND CPC.NUMEROALBARAN = CAC.NUMEROALBARAN
             )
         AND NOT EXISTS (
               SELECT 1 FROM JAVIER.TEST_CPC T
                WHERE T.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                  AND TRIM(T.SERIEALBARAN) = TRIM(CPC.SERIEALBARAN)
                  AND T.TERMINALALBARAN = CPC.TERMINALALBARAN
                  AND T.NUMEROALBARAN = CPC.NUMEROALBARAN
             )
       FETCH FIRST 600 ROWS ONLY`);

    const counts = await query(`
      SELECT CAST('cvc' AS VARCHAR(24)) K, COUNT(*) N FROM JAVIER.TEST_CVC
      UNION ALL SELECT 'cac', COUNT(*) FROM JAVIER.TEST_CAC
      UNION ALL SELECT 'cpc', COUNT(*) FROM JAVIER.TEST_CPC
      UNION ALL SELECT 'join_trim', COUNT(*)
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
      UNION ALL SELECT 'join_notrim', COUNT(*)
        FROM JAVIER.TEST_CVC CVC
        JOIN JAVIER.TEST_FPG FPG ON FPG.CODIGOFORMAPAGO = CVC.CODIGOFORMAPAGO
        JOIN JAVIER.TEST_CAC CAC
          ON CAC.EJERCICIOFACTURA = CVC.EJERCICIODOCUMENTO
         AND CAC.SERIEFACTURA = CVC.SERIEDOCUMENTO
         AND CAC.TERMINALFACTURA = CVC.TERMINALDOCUMENTO
         AND CAC.NUMEROFACTURA = CVC.NUMERODOCUMENTO
       WHERE CVC.TIPODOCUMENTO = 'PAG'
         AND CVC.IMPORTEPENDIENTE = 0
         AND FPG.PAGARESN = 'S'
         AND CAC.CODIGOVENDEDOR IN ('80','35','02','03','81','97')
    `);
    console.log(JSON.stringify(counts));
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
