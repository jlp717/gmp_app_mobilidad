'use strict';

/**
 * Ensure JAVIER.TEST_* overlay tables for commercial liquidation/returns.
 * Read-only by default; mutate with --apply. Never touches DSEDAC.
 *
 *   node backend/scripts/ensure-comercial-test-ddl.js
 *   node backend/scripts/ensure-comercial-test-ddl.js --apply
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query, queryWithParams } = require('../config/db');

const APPLY = process.argv.includes('--apply');

const TABLES = [
  {
    schema: 'JAVIER',
    table: 'TEST_LIQUIDACION_COMERCIAL',
    ddl: `CREATE TABLE JAVIER.TEST_LIQUIDACION_COMERCIAL (
      ID INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY,
      CODIGO_VENDEDOR CHAR(2) NOT NULL,
      FECHA DATE NOT NULL,
      INGRESO_BANCO DECIMAL(11, 2) NOT NULL DEFAULT 0,
      ENTREGADO DECIMAL(11, 2) NOT NULL DEFAULT 0,
      TOTAL_ESPERADO DECIMAL(11, 2) NOT NULL DEFAULT 0,
      TOTAL_EFECTIVO DECIMAL(11, 2) NOT NULL DEFAULT 0,
      TOTAL_CHEQUES DECIMAL(11, 2) NOT NULL DEFAULT 0,
      TOTAL_POSTDATADOS DECIMAL(11, 2) NOT NULL DEFAULT 0,
      SALDO_ACTUAL DECIMAL(11, 2) NOT NULL DEFAULT 0,
      DEVOLUCIONES_YA_COBRADAS DECIMAL(11, 2) NOT NULL DEFAULT 0,
      TOTAL_A_INGRESAR DECIMAL(11, 2) NOT NULL DEFAULT 0,
      STATUS VARCHAR(20) NOT NULL DEFAULT 'SAVED',
      IDEMPOTENCY_TOKEN VARCHAR(128) NOT NULL,
      CREATED_BY VARCHAR(20),
      CREATED_AT TIMESTAMP NOT NULL DEFAULT CURRENT TIMESTAMP,
      UPDATED_AT TIMESTAMP NOT NULL DEFAULT CURRENT TIMESTAMP,
      PRIMARY KEY (ID)
    )`,
    indexes: [
      'CREATE UNIQUE INDEX JAVIER.UX_TEST_LIQCOM_VENDOR_DAY ON JAVIER.TEST_LIQUIDACION_COMERCIAL (CODIGO_VENDEDOR, FECHA)',
      'CREATE UNIQUE INDEX JAVIER.UX_TEST_LIQCOM_TOKEN ON JAVIER.TEST_LIQUIDACION_COMERCIAL (IDEMPOTENCY_TOKEN)',
    ],
  },
  {
    schema: 'JAVIER',
    table: 'TEST_DEVOLUCIONES_COMERCIAL',
    ddl: `CREATE TABLE JAVIER.TEST_DEVOLUCIONES_COMERCIAL (
      ID INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY,
      SERIE CHAR(4) NOT NULL,
      NUMERO INTEGER NOT NULL,
      CLIENTE CHAR(10) NOT NULL,
      VENDEDOR CHAR(2) NOT NULL,
      FECHA DATE NOT NULL,
      IMPORTE DECIMAL(11, 2) NOT NULL,
      UNIDADES DECIMAL(11, 3) NOT NULL DEFAULT 0,
      DOCUMENTO_ORIGEN VARCHAR(40),
      YA_COBRADA SMALLINT NOT NULL DEFAULT 1,
      IDEMPOTENCY_TOKEN VARCHAR(128) NOT NULL,
      CREATED_BY VARCHAR(20),
      CREATED_AT TIMESTAMP NOT NULL DEFAULT CURRENT TIMESTAMP,
      PRIMARY KEY (ID)
    )`,
    indexes: [
      'CREATE UNIQUE INDEX JAVIER.UX_TEST_DEVCOM_TOKEN ON JAVIER.TEST_DEVOLUCIONES_COMERCIAL (IDEMPOTENCY_TOKEN)',
      'CREATE UNIQUE INDEX JAVIER.UX_TEST_DEVCOM_DOC ON JAVIER.TEST_DEVOLUCIONES_COMERCIAL (VENDEDOR, FECHA, SERIE, NUMERO, CLIENTE)',
    ],
  },
];

async function tableExists(schema, table) {
  const rows = await queryWithParams(
    `SELECT 1 AS OK FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        AND TABLE_TYPE IN ('T', 'P')
      FETCH FIRST 1 ROW ONLY`,
    [schema, table],
  );
  return (rows || []).length > 0;
}

async function indexExists(schema, name) {
  const rows = await queryWithParams(
    `SELECT 1 AS OK FROM QSYS2.SYSINDEXES
      WHERE INDEX_SCHEMA = ? AND INDEX_NAME = ?
      FETCH FIRST 1 ROW ONLY`,
    [schema, name],
  );
  return (rows || []).length > 0;
}

function indexNameFromDdl(ddl) {
  const match = /INDEX\s+JAVIER\.([A-Z0-9_]+)/i.exec(ddl);
  return match ? match[1].toUpperCase() : null;
}

async function main() {
  console.log(`Mode=${APPLY ? 'APPLY' : 'DRY-RUN'} schema=JAVIER (never DSEDAC)`);
  await initDb();
  try {
    for (const spec of TABLES) {
      const qualified = `${spec.schema}.${spec.table}`;
      if (await tableExists(spec.schema, spec.table)) {
        console.log('OK table', qualified);
      } else {
        console.log(APPLY ? 'CREATE' : '[DRY] CREATE', qualified);
        if (APPLY) await query(spec.ddl);
      }
      for (const indexDdl of spec.indexes || []) {
        const indexName = indexNameFromDdl(indexDdl);
        if (indexName && await indexExists('JAVIER', indexName)) {
          console.log('OK index', indexName);
          continue;
        }
        console.log(APPLY ? 'CREATE INDEX' : '[DRY] CREATE INDEX', indexName || indexDdl);
        if (APPLY) {
          try {
            await query(indexDdl);
          } catch (error) {
            const msg = String(error.message || error);
            if (!/SQL0601|already exists/i.test(msg)) throw error;
            console.log('OK index exists', indexName);
          }
        }
      }
    }
    console.log('DONE');
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error('FATAL', error.message);
  process.exit(1);
});
