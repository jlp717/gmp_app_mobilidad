'use strict';

const { initDb, closePool, queryWithParams } = require('../config/db');

async function main() {
  await initDb();
  try {
    const cols = await queryWithParams(
      `SELECT TRIM(COLUMN_NAME) AS COLUMN_NAME, TRIM(DATA_TYPE) AS DATA_TYPE, LENGTH
         FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'ENB'
        ORDER BY ORDINAL_POSITION`,
      [],
    );
    console.log('ENB columns:');
    for (const row of cols || []) {
      console.log(`  ${String(row.COLUMN_NAME || row.column_name).trim()} ${String(row.DATA_TYPE || row.data_type).trim()}(${row.LENGTH || row.length})`);
    }
    const rows = await queryWithParams(
      `SELECT TRIM(CODIGOENTIDADBANCARIA) AS CODIGO, TRIM(DESCRICIONENTIDADBANCARIA) AS NOMBRE
         FROM DSEDAC.ENB
        WHERE TRIM(CODIGOENTIDADBANCARIA) <> ''
        ORDER BY CODIGOENTIDADBANCARIA
        FETCH FIRST 8 ROWS ONLY`,
      [],
    );
    console.log('ENB sample:');
    for (const row of rows || []) {
      console.log(`  ${String(row.CODIGO || row.codigo).trim()} | ${String(row.NOMBRE || row.nombre).trim()}`);
    }
    const cobrosCols = await queryWithParams(
      `SELECT TRIM(COLUMN_NAME) AS COLUMN_NAME
         FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'TEST_REPARTIDOR_COBROS'
          AND COLUMN_NAME IN ('NUMEROTALON','CODIGOENTIDADBANCARIA','NOMBREENTIDADBANCARIA','CUENTATALONES','CUENTABANCO','DIAVENCIMIENTO','EFECTIVOTALON')
        ORDER BY COLUMN_NAME`,
      [],
    );
    console.log('TEST_REPARTIDOR_COBROS talon-ish:');
    for (const row of cobrosCols || []) {
      console.log(`  ${String(row.COLUMN_NAME || row.column_name).trim()}`);
    }
    const talonCount = await queryWithParams(
      `SELECT COUNT(*) AS N
         FROM JAVIER.TEST_REPARTIDOR_COBROS
        WHERE NUMEROTALON IS NOT NULL AND TRIM(NUMEROTALON) <> ''`,
      [],
    );
    const n = Number(talonCount?.[0]?.N ?? talonCount?.[0]?.n ?? 0);
    console.log(`TEST_REPARTIDOR_COBROS talon rows: ${n}`);
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
