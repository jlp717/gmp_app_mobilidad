'use strict';

/**
 * Ensure missing TABLE_MAPPINGS DDL for isolated_test (+ prod gaps that block mapping).
 * Read-only by default; mutate with --apply.
 *
 *   node backend/scripts/ensure-missing-reparto-ddl.js
 *   node backend/scripts/ensure-missing-reparto-ddl.js --apply
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query, queryWithParams } = require('../config/db');

const APPLY = process.argv.includes('--apply');

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

async function sequenceExists(schema, name) {
  const rows = await queryWithParams(
    `SELECT 1 AS OK FROM QSYS2.SYSSEQUENCES
      WHERE SEQUENCE_SCHEMA = ? AND SEQUENCE_NAME = ?`,
    [schema, name],
  );
  return rows.length > 0;
}

async function ensureTableLike(dst, src, label) {
  if (await tableExists(dst)) {
    console.log('OK table', dst);
    return;
  }
  if (!(await tableExists(src))) {
    console.log('SKIP', label, '- missing source', src);
    return;
  }
  console.log(APPLY ? 'CREATE' : '[DRY] CREATE', dst, 'LIKE', src);
  if (APPLY) {
    await query(`CREATE TABLE ${dst} LIKE ${src}`);
  }
}

async function ensureSequence(schema, name) {
  const qualified = `${schema}.${name}`;
  if (await sequenceExists(schema, name)) {
    console.log('OK sequence', qualified);
    return;
  }
  console.log(APPLY ? 'CREATE SEQUENCE' : '[DRY] CREATE SEQUENCE', qualified);
  if (APPLY) {
    await query(`
      CREATE SEQUENCE ${qualified} AS BIGINT
        START WITH 1 INCREMENT BY 1
        MINVALUE 1 MAXVALUE 9223372036854775807
        NO CYCLE CACHE 20 NO ORDER
    `);
  }
}

async function ensureProdRuteroOrden() {
  const dst = 'JAVIER.REPARTIDOR_RUTERO_ORDEN';
  const srcLike = 'JAVIER.TEST_REPARTIDOR_RUTERO_ORDEN';
  if (await tableExists(dst)) {
    console.log('OK table', dst);
    return;
  }
  if (await tableExists(srcLike)) {
    console.log(APPLY ? 'CREATE' : '[DRY] CREATE', dst, 'LIKE', srcLike);
    if (APPLY) {
      await query(`CREATE TABLE ${dst} LIKE ${srcLike}`);
    }
    return;
  }
  console.log(APPLY ? 'CREATE' : '[DRY] CREATE', dst, '(inline short names)');
  if (!APPLY) return;
  await query(`
    CREATE TABLE JAVIER.REPARTIDOR_RUTERO_ORDEN (
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
  await query(`
    CREATE INDEX JAVIER.IX_RUTORD_F
      ON JAVIER.REPARTIDOR_RUTERO_ORDEN (REPARTIDOR_ID, FECHA_RUTA, ORDEN)
  `);
}

async function main() {
  console.log(`Mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  await initDb();
  try {
    const { TABLE_MAPPINGS } = require('../config/reparto-runtime');
    const extras = [
      ['JAVIER.TEST_REPARTIDOR_FIRMAS', 'JAVIER.REPARTIDOR_FIRMAS', 'firmas'],
      ['JAVIER.TEST_REPARTIDOR_ENTREGAS', 'JAVIER.REPARTIDOR_ENTREGAS', 'entregas'],
      ['JAVIER.TEST_REPARTIDOR_ENTREGA_LINEAS', 'JAVIER.REPARTIDOR_ENTREGA_LINEAS', 'entregaLineas'],
      ['JAVIER.TEST_CLIENT_SIGNERS', 'JAVIER.CLIENT_SIGNERS', 'clientSigners'],
    ];

    for (const [bucket, tables] of Object.entries(TABLE_MAPPINGS.isolated_test)) {
      for (const [key, dst] of Object.entries(tables)) {
        if (/_SEQ$/.test(String(dst).split('.')[1] || '')) continue;
        const prod = TABLE_MAPPINGS.production[bucket]?.[key];
        if (!prod) {
          console.log('SKIP no prod pair', key, dst);
          continue;
        }
        await ensureTableLike(dst, prod, `${bucket}.${key}`);
      }
    }
    for (const [dst, src, label] of extras) {
      await ensureTableLike(dst, src, label);
    }
    await ensureProdRuteroOrden();
    await ensureSequence('JAVIER', 'REPARTIDOR_LIQUIDACION_SEQ');
    await ensureSequence('JAVIER', 'TEST_REPARTIDOR_LIQUIDACION_SEQ');
    console.log('DONE');
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
