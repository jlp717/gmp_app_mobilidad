'use strict';

/**
 * Read-only QSYS2 catalog for commercial TEST isolation.
 * Never writes. Never dumps CVC/CPC rows.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, queryWithParams } = require('../config/db');

const OBJECTS = [
  ['JAVIER', 'COBROS'],
  ['JAVIER', 'TEST_COBROS'],
  ['JAVIER', 'PEDIDOS_CAB'],
  ['JAVIER', 'PEDIDOS_LIN'],
  ['JAVIER', 'TEST_PEDIDOS_CAB'],
  ['JAVIER', 'TEST_PEDIDOS_LIN'],
  ['DSEDAC', 'CVC'],
  ['DSEDAC', 'CLX'],
  ['DSEDAC', 'LQD'],
  ['DSEDAC', 'FPG'],
  ['DSEDAC', 'CPC'],
  ['DSEDAC', 'LPC'],
  ['DSED', 'LACLAE'],
];

async function main() {
  await initDb();
  try {
    for (const [schema, table] of OBJECTS) {
      const exists = await queryWithParams(
        `SELECT TABLE_NAME FROM QSYS2.SYSTABLES
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          FETCH FIRST 1 ROW ONLY`,
        [schema, table],
      );
      const present = (exists || []).length > 0;
      const cols = present
        ? await queryWithParams(
          `SELECT TRIM(COLUMN_NAME) AS COLUMN_NAME, TRIM(DATA_TYPE) AS DATA_TYPE
             FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION`,
          [schema, table],
        )
        : [];
      console.log(`${present ? 'OK' : 'MISSING'} ${schema}.${table} cols=${cols.length}`);
      if (present && ['COBROS', 'TEST_COBROS', 'PEDIDOS_CAB', 'PEDIDOS_LIN', 'TEST_PEDIDOS_CAB', 'TEST_PEDIDOS_LIN', 'CLX', 'LQD'].includes(table)) {
        console.log(`  ${(cols || []).map((row) => String(row.COLUMN_NAME || row.column_name).trim()).join(',')}`);
      }
      if (table === 'CVC') {
        const wanted = ['IMPORTEPENDIENTE', 'TIPODOCUMENTO', 'CODIGOFORMAPAGO', 'SERIEDOCUMENTO', 'NUMERODOCUMENTO'];
        const names = new Set((cols || []).map((row) => String(row.COLUMN_NAME || row.column_name).trim().toUpperCase()));
        console.log(`  wanted ${wanted.map((name) => `${name}=${names.has(name) ? 'Y' : 'N'}`).join(' ')}`);
      }
      if (table === 'CLX') {
        const names = new Set((cols || []).map((row) => String(row.COLUMN_NAME || row.column_name).trim().toUpperCase()));
        console.log(`  PORCENTAJECOBRORIGUROSO=${names.has('PORCENTAJECOBRORIGUROSO') ? 'Y' : 'N'} COBRORIGUROSOSN=${names.has('COBRORIGUROSOSN') ? 'Y' : 'N'}`);
      }
    }
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
