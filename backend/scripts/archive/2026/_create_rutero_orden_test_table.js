// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-ddl | _-scratch gitignored; DDL puntual tabla test rutero orden | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query } = require('../config/db');

async function main() {
  const existing = await query(`
    SELECT TABLE_NAME
    FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = 'JAVIER'
      AND TABLE_NAME IN ('TEST_REPARTIDOR_RUTERO_ORDEN', 'REPARTIDOR_RUTERO_ORDEN')
  `);
  console.log(JSON.stringify({ existing: existing.map((r) => r.TABLE_NAME || r.table_name) }));

  const hasTest = existing.some((r) => String(r.TABLE_NAME || r.table_name).toUpperCase() === 'TEST_REPARTIDOR_RUTERO_ORDEN');
  if (hasTest) {
    console.log(JSON.stringify({ ok: true, skipped: 'TEST_REPARTIDOR_RUTERO_ORDEN already exists' }));
    return;
  }

  await query(`
    CREATE TABLE JAVIER.TEST_REPARTIDOR_RUTERO_ORDEN (
      REPARTIDOR_ID VARCHAR(10) NOT NULL,
      FECHA_RUTA DATE NOT NULL,
      DOCUMENT_ID VARCHAR(80) NOT NULL,
      CLIENTE_CODIGO VARCHAR(20),
      ORDEN INTEGER NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT CURRENT TIMESTAMP,
      UPDATED_BY VARCHAR(40),
      PRIMARY KEY (REPARTIDOR_ID, FECHA_RUTA, DOCUMENT_ID)
    )
  `);
  console.log(JSON.stringify({ ok: true, created: 'TEST_REPARTIDOR_RUTERO_ORDEN' }));

  try {
    await query(`
      CREATE INDEX JAVIER.IX_TEST_REP_RUT_ORDEN_FECHA
        ON JAVIER.TEST_REPARTIDOR_RUTERO_ORDEN (REPARTIDOR_ID, FECHA_RUTA, ORDEN)
    `);
    console.log(JSON.stringify({ ok: true, created: 'IX_TEST_REP_RUT_ORDEN_FECHA' }));
  } catch (error) {
    console.log(JSON.stringify({
      ok: false,
      index: String(error && error.message || error).slice(0, 200),
    }));
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ fatal: String(error && error.message || error) }));
  process.exit(1);
});
