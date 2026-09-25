// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-inventory | _-scratch gitignored; inventario puntual mapeos tablas (superado por WS1) | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Read-only inventory: TABLE_MAPPINGS prod vs isolated_test existence + counts.
 * Usage: node backend/scripts/_inventory_table_mappings.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { TABLE_MAPPINGS } = require('../config/reparto-runtime');
const { initDb, closePool, queryWithParams, query } = require('../config/db');

async function tableExists(schemaTable) {
  const [schema, table] = schemaTable.split('.');
  const rows = await queryWithParams(
    `SELECT 1 AS OK FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        AND TABLE_TYPE IN ('T', 'P')`,
    [schema, table],
  );
  return rows.length > 0;
}

async function countRows(schemaTable) {
  try {
    const rows = await query(`SELECT COUNT(*) AS N FROM ${schemaTable}`);
    return Number(rows?.[0]?.N || 0);
  } catch (err) {
    return `ERR:${err.message.slice(0, 80)}`;
  }
}

async function sequenceExists(schema, name) {
  const rows = await queryWithParams(
    `SELECT 1 AS OK FROM QSYS2.SYSSEQUENCES
      WHERE SEQUENCE_SCHEMA = ? AND SEQUENCE_NAME = ?`,
    [schema, name],
  );
  return rows.length > 0;
}

async function main() {
  await initDb();
  try {
    const lines = [];
    for (const set of ['production', 'isolated_test']) {
      for (const [bucket, tables] of Object.entries(TABLE_MAPPINGS[set])) {
        for (const [key, qualified] of Object.entries(tables)) {
          const isSequence = /_SEQ$/.test(qualified.split('.')[1] || '');
          let exists;
          let count;
          if (isSequence) {
            const [schema, name] = qualified.split('.');
            exists = await sequenceExists(schema, name);
            count = exists ? 'SEQ' : '-';
          } else {
            exists = await tableExists(qualified);
            count = exists ? await countRows(qualified) : '-';
          }
          lines.push({ set, bucket, key, table: qualified, exists, count });
          console.log(
            `${exists ? 'OK' : 'MISSING'}`.padEnd(8),
            String(count).padStart(8),
            set.padEnd(14),
            bucket.padEnd(14),
            key.padEnd(22),
            qualified,
          );
        }
      }
    }
    const missing = lines.filter((l) => !l.exists);
    const emptyTest = lines.filter(
      (l) => l.set === 'isolated_test' && l.exists && l.count === 0,
    );
    console.log('\nMISSING', missing.length);
    for (const m of missing) console.log(' -', m.table);
    console.log('EMPTY_TEST', emptyTest.length);
    for (const m of emptyTest) console.log(' -', m.table);
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
