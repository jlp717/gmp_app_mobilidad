// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-rebuild | _-scratch gitignored; rebuild puntual LQD/PMRC test | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * One-shot: rebuild TEST_LQD/TEST_PMRC after APPEND duplicated rows.
 * Writes JAVIER.TEST_* only.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query } = require('../config/db');
const { comercialErpWriteForbiddenSql } = require('../utils/comercial-erp-tables');

function refuse(sql) {
  if (comercialErpWriteForbiddenSql(sql)) throw new Error(`refused ${sql.slice(0, 80)}`);
}

async function run(sql) {
  refuse(sql);
  await query(sql);
}

async function main() {
  await initDb();
  try {
    await run('DELETE FROM JAVIER.TEST_LQD');
    await run('INSERT INTO JAVIER.TEST_LQD SELECT * FROM DSEDAC.LQD');
    await run('DELETE FROM JAVIER.TEST_PMRC');
    await run('INSERT INTO JAVIER.TEST_PMRC SELECT * FROM DSEDAC.PMRC');
    const rows = await query(`
      SELECT CAST('TEST_LQD' AS VARCHAR(24)) T, COUNT(*) N FROM JAVIER.TEST_LQD
      UNION ALL SELECT 'TEST_PMRC', COUNT(*) FROM JAVIER.TEST_PMRC
    `);
    console.log(JSON.stringify({ dsedacWrite: false, rows }));
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
