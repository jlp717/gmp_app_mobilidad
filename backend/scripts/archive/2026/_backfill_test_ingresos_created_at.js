// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-backfill | _-scratch gitignored; backfill puntual TEST ingresos created_at | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query } = require('../config/db');

async function main() {
  await initDb();
  try {
    await query(`
      UPDATE JAVIER.TEST_REPARTIDOR_LIQUIDACION_INGRESOS
         SET CREATED_AT = CURRENT TIMESTAMP
       WHERE CREATED_AT IS NULL
    `);
    await query(`
      UPDATE JAVIER.TEST_REPARTIDOR_LIQUIDACION_GASTOS
         SET CREATED_AT = CURRENT TIMESTAMP
       WHERE CREATED_AT IS NULL
    `);
    const ing = await query(`
      SELECT COUNT(*) AS N,
             SUM(CASE WHEN CREATED_AT IS NULL THEN 1 ELSE 0 END) AS NULLS
        FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_INGRESOS
    `);
    console.log('INGRESOS', ing[0]);
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
