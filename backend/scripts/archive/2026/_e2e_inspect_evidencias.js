// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-e2e | _-scratch gitignored; inspeccion puntual evidencias | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { initDb, closePool, query } = require('../config/db');

async function main() {
  await initDb();
  const r = await query(`
    SELECT COLUMN_NAME, DATA_TYPE, LENGTH
      FROM QSYS2.SYSCOLUMNS
     WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'TEST_REPARTO_EVIDENCIAS'
     ORDER BY ORDINAL_POSITION
  `);
  console.log(JSON.stringify(r, (_, v) => (typeof v === 'bigint' ? String(v) : v)));
  await closePool();
}
main().catch(async (e) => { console.error(e); try { await closePool(); } catch (_) {} process.exit(1); });
