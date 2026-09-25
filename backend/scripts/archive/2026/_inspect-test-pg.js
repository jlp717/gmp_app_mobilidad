// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-inspect | _-scratch gitignored; inspect puntual PG test | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query } = require('../config/db');

async function main() {
  await initDb();
  try {
    const rows = await query(`
      SELECT CAST('test_pag' AS VARCHAR(20)) AS K, COUNT(*) AS N
        FROM JAVIER.TEST_CVC
       WHERE TIPODOCUMENTO = 'PAG' AND IMPORTEPENDIENTE = 0
      UNION ALL
      SELECT 'test_cvc', COUNT(*) FROM JAVIER.TEST_CVC
      UNION ALL
      SELECT 'test_cac80', COUNT(*) FROM JAVIER.TEST_CAC
       WHERE TRIM(CODIGOVENDEDOR) IN ('80','35','02','03','81')
      UNION ALL
      SELECT 'join_pg', COUNT(*)
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
         AND TRIM(CAC.CODIGOVENDEDOR) IN ('80','35','02','03','81')
    `);
    console.log(JSON.stringify(rows, null, 2));
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
