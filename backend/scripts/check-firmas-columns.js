#!/usr/bin/env node
const odbc = require('odbc');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });


function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(name + " environment variable is required");
  }
  return value;
}

const CONNECTION_STRING = [
  `DSN=${process.env.ODBC_DSN || 'GMP'}`,
  `UID=${requireEnv('ODBC_UID')}`,
  `PWD=${requireEnv('ODBC_PWD')}`,
  'NAM=1', 'CCSID=1208', 'CMPTDM=1',
].join(';');

async function main() {
  let pool = null, conn = null;
  try {
    pool = await odbc.pool(CONNECTION_STRING);
    conn = await pool.connect();

    // Check REPARTIDOR_FIRMAS columns
    const rows = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, ORDINAL_POSITION
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'REPARTIDOR_FIRMAS'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('REPARTIDOR_FIRMAS columns:');
    for (const r of rows) {
      const scale = r.NUMERIC_SCALE !== null ? `,${r.NUMERIC_SCALE}` : '';
      console.log(`  ${r.ORDINAL_POSITION}. ${r.COLUMN_NAME} ${r.DATA_TYPE}${r.LENGTH}${scale}`);
    }
    console.log(`Total: ${rows.length}`);

    // Compare with DSEDAC.CACFIRMAS
    const dsedac = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, ORDINAL_POSITION
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CACFIRMAS'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('\nDSEDAC.CACFIRMAS columns:');
    for (const r of dsedac) {
      const scale = r.NUMERIC_SCALE !== null ? `,${r.NUMERIC_SCALE}` : '';
      console.log(`  ${r.ORDINAL_POSITION}. ${r.COLUMN_NAME} ${r.DATA_TYPE}${r.LENGTH}${scale}`);
    }
    console.log(`Total: ${dsedac.length}`);

    // Find columns in JAVIER not in DSEDAC
    const dsedacNames = new Set(dsedac.map(r => r.COLUMN_NAME));
    const javierNames = rows.map(r => r.COLUMN_NAME);
    const extra = javierNames.filter(n => !dsedacNames.has(n));
    console.log('\nExtra columns in JAVIER (not in DSEDAC):', extra);

  } catch (err) {
    console.error(err.message);
  } finally {
    if (conn) try { await conn.close(); } catch(_) {}
    if (pool) try { await pool.close(); } catch(_) {}
  }
}
main();
