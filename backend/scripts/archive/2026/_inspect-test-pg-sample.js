// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-inspect | _-scratch gitignored; inspect puntual muestra PG test | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query, queryWithParams } = require('../config/db');

async function main() {
  await initDb();
  try {
    const pag = await query(`
      SELECT TRIM(TIPODOCUMENTO) TIPO, TRIM(SERIEDOCUMENTO) SERIE, TERMINALDOCUMENTO TERM,
             NUMERODOCUMENTO NUM, EJERCICIODOCUMENTO EJ, TRIM(CODIGOFORMAPAGO) FP
        FROM JAVIER.TEST_CVC
       WHERE TIPODOCUMENTO = 'PAG' AND IMPORTEPENDIENTE = 0
       FETCH FIRST 3 ROWS ONLY
    `);
    console.log('pag', JSON.stringify(pag, null, 2));
    const row = pag[0];
    if (!row) return;
    const serie = String(row.SERIE || row.serie || '').trim();
    const ej = Number(row.EJ || row.ej);
    const term = Number(row.TERM || row.term);
    const num = Number(row.NUM || row.num);
    const cac = await queryWithParams(
      `SELECT COUNT(*) AS N FROM DSEDAC.CAC
        WHERE EJERCICIOFACTURA = ? AND SERIEFACTURA = ? AND TERMINALFACTURA = ? AND NUMEROFACTURA = ?`,
      [ej, serie, term, num],
    );
    console.log('dsedac_cac', JSON.stringify(cac));
    const testCac = await queryWithParams(
      `SELECT COUNT(*) AS N FROM JAVIER.TEST_CAC
        WHERE EJERCICIOFACTURA = ? AND NUMEROFACTURA = ?`,
      [ej, num],
    );
    console.log('test_cac_num', JSON.stringify(testCac));
  } finally {
    await closePool();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
