#!/usr/bin/env node
const odbc = require('odbc');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const CONNECTION_STRING = [
  `DSN=${process.env.ODBC_DSN || 'GMP'}`,
  `UID=${process.env.ODBC_UID || 'JAVIER'}`,
  `PWD=${process.env.ODBC_PWD || 'JAVIER'}`,
  'NAM=1', 'CCSID=1208', 'CMPTDM=1',
].join(';');

const expectedCounts = {
  'REPARTIDOR_COBROS': 110,
  'REPARTIDOR_LIQUIDACION_OPS': 38,
  'REPARTIDOR_ENTREGAS': 50,
  'REPARTIDOR_ENTREGA_LINEAS': 132,
  'REPARTIDOR_FIRMAS': 25,
    'REPARTIDOR_OBJETIVOS': 15,
  'DELIVERY_STATUS': 146,
  'CLIENT_SIGNERS': 56,
};

async function main() {
  let pool = null, conn = null;
  try {
    pool = await odbc.pool(CONNECTION_STRING);
    conn = await pool.connect();

    const rows = await conn.query(`
      SELECT TABLE_NAME, COUNT(*) AS COLUMN_COUNT
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'JAVIER'
        AND TABLE_NAME IN (
          'REPARTIDOR_COBROS', 'REPARTIDOR_LIQUIDACION_OPS',
          'REPARTIDOR_ENTREGAS', 'REPARTIDOR_ENTREGA_LINEAS',
          'REPARTIDOR_FIRMAS', 'REPARTIDOR_OBJETIVOS',
          'DELIVERY_STATUS', 'CLIENT_SIGNERS'
        )
      GROUP BY TABLE_NAME
      ORDER BY TABLE_NAME
    `);

    let allOk = true;
    for (const row of rows) {
      const name = String(row.TABLE_NAME || row.table_name || '').trim();
      const count = parseInt(row.COLUMN_COUNT || row.column_count || 0);
      const expected = expectedCounts[name] || 0;
      const status = count === expected ? 'OK' : 'FAIL';
      console.log(`  [${status}] ${name}: ${count} columns (expected ${expected})`);
      if (count !== expected) allOk = false;
    }

    for (const [name, expected] of Object.entries(expectedCounts)) {
      const found = rows.some(r => String(r.TABLE_NAME || r.table_name || '').trim() === name);
      if (!found) {
        console.log(`  [FAIL] ${name}: TABLE NOT FOUND`);
        allOk = false;
      }
    }

    // Check app-specific columns exist
    const appCols = ['IDEMPOTENCY_TOKEN', 'CREATED_AT', 'UPDATED_AT', 'STATUS', 'OPERADOR', 'PANTALLA_ORIGEN'];
    console.log('\nApp-specific columns check:');
    for (const tbl of Object.keys(expectedCounts)) {
      const cols = await conn.query(`
        SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = '${tbl}'
          AND COLUMN_NAME IN ('IDEMPOTENCY_TOKEN','CREATED_AT','UPDATED_AT','STATUS','OPERADOR','PANTALLA_ORIGEN')
        ORDER BY COLUMN_NAME
      `);
      const found = cols.map(c => c.COLUMN_NAME);
      const missing = appCols.filter(c => !found.includes(c));
      if (missing.length === 0) {
        console.log(`  [OK] ${tbl}: all 6 app columns present`);
      } else {
        console.log(`  [FAIL] ${tbl}: missing ${missing.join(', ')}`);
        allOk = false;
      }
    }

    // Check backup tables
    const bkpRows = await conn.query(`
      SELECT TABLE_NAME FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME LIKE 'BKP_%_20260427'
      ORDER BY TABLE_NAME
    `);
    console.log(`\nBackup tables: ${bkpRows.length} found`);

    console.log(allOk ? '\nAll checks PASSED.' : '\nSome checks FAILED.');
    process.exitCode = allOk ? 0 : 1;

  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    if (conn) try { await conn.close(); } catch(_) {}
    if (pool) try { await pool.close(); } catch(_) {}
  }
}
main();
