// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual columnas test | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { initDb, closePool, query } = require('../config/db');

async function cols(schema, table) {
    const rows = await query(
      "SELECT TRIM(COLUMN_NAME) AS C FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = '"
        + table + "' ORDER BY ORDINAL_POSITION",
    );
  return rows.map((r) => r.C || r.c).join(',');
}

async function main() {
  await initDb();
  try {
    console.log('DS', await cols('JAVIER', 'TEST_DELIVERY_STATUS'));
    console.log('COBROS', await cols('JAVIER', 'TEST_REPARTIDOR_COBROS'));
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
