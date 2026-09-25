// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-count | _-scratch gitignored; conteo puntual post-hit | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query } = require('../config/db');

async function main() {
  await initDb();
  try {
    const rows = await query(`
      SELECT CAST('TEST_COBROS' AS VARCHAR(32)) T, COUNT(*) N FROM JAVIER.TEST_COBROS
      UNION ALL SELECT 'TEST_PEDIDOS_CAB', COUNT(*) FROM JAVIER.TEST_PEDIDOS_CAB
      UNION ALL SELECT 'TEST_PEDIDOS_LIN', COUNT(*) FROM JAVIER.TEST_PEDIDOS_LIN
      UNION ALL SELECT 'TEST_LIQCOM', COUNT(*) FROM JAVIER.TEST_LIQUIDACION_COMERCIAL
      UNION ALL SELECT 'TEST_DEVCOM', COUNT(*) FROM JAVIER.TEST_DEVOLUCIONES_COMERCIAL
      UNION ALL SELECT 'TEST_PMRC', COUNT(*) FROM JAVIER.TEST_PMRC
      UNION ALL SELECT 'TEST_LPC', COUNT(*) FROM JAVIER.TEST_LPC
      UNION ALL SELECT 'DSEDAC_FPG', COUNT(*) FROM DSEDAC.FPG
      UNION ALL SELECT 'DSEDAC_VDDX', COUNT(*) FROM DSEDAC.VDDX
      UNION ALL SELECT 'DSEDAC_PMR', COUNT(*) FROM DSEDAC.PMR
    `);
    console.log(JSON.stringify(rows.map((row) => ({ t: row.T || row.t, n: row.N || row.n }))));
  } finally {
    await closePool();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
