// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-inspect | _-scratch gitignored; inspect puntual tiers comision | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query } = require('../config/db');

async function main() {
  await initDb();
  try {
    const cols = await query(`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION,
             IS_NULLABLE, COLUMN_DEFAULT, IS_IDENTITY, HAS_DEFAULT, ORDINAL_POSITION
        FROM QSYS2.SYSCOLUMNS
       WHERE TABLE_SCHEMA = 'JAVIER'
         AND TABLE_NAME = 'REPARTIDOR_COMMISSION_TIERS'
       ORDER BY ORDINAL_POSITION
    `);
    console.log('COLS', JSON.stringify(cols, null, 2));
    const rows = await query('SELECT * FROM JAVIER.REPARTIDOR_COMMISSION_TIERS');
    console.log('ROWS', JSON.stringify(rows, null, 2));
    const idx = await query(`
      SELECT INDEX_NAME, COLUMN_NAMES, IS_UNIQUE
        FROM QSYS2.SYSINDEXES
       WHERE TABLE_SCHEMA = 'JAVIER'
         AND TABLE_NAME = 'REPARTIDOR_COMMISSION_TIERS'
    `);
    console.log('IDX', JSON.stringify(idx, null, 2));
    const dstCols = await query(`
      SELECT COLUMN_NAME, IS_IDENTITY, IS_NULLABLE, HAS_DEFAULT, DATA_TYPE
        FROM QSYS2.SYSCOLUMNS
       WHERE TABLE_SCHEMA = 'JAVIER'
         AND TABLE_NAME = 'TEST_REPARTIDOR_COMMISSION_TIERS'
       ORDER BY ORDINAL_POSITION
    `);
    console.log('DST_COLS', JSON.stringify(dstCols, null, 2));
    const dstRows = await query('SELECT * FROM JAVIER.TEST_REPARTIDOR_COMMISSION_TIERS');
    console.log('DST_ROWS', JSON.stringify(dstRows, null, 2));
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
