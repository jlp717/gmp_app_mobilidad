'use strict';

/**
 * Ensure JAVIER.TEST_REPARTIDOR_COMMISSION_TIERS exists and is seeded.
 * Prefer explicit DDL (CREATE LIKE INCLUDING IDENTITY fails on this IBM i).
 *
 * Usage:
 *   node backend/scripts/ensure-test-commission-tiers.js
 *   node backend/scripts/ensure-test-commission-tiers.js --apply
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query, queryWithParams } = require('../config/db');

const APPLY = process.argv.includes('--apply');
const SRC = 'JAVIER.REPARTIDOR_COMMISSION_TIERS';
const DST = 'JAVIER.TEST_REPARTIDOR_COMMISSION_TIERS';

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

async function createExplicit() {
  await query(`
    CREATE TABLE ${DST} (
      ID BIGINT GENERATED ALWAYS AS IDENTITY,
      THRESHOLD_PCT DECIMAL(7, 3) NOT NULL,
      COMMISSION_PCT DECIMAL(7, 3) NOT NULL,
      SORT_ORDER INTEGER NOT NULL,
      ACTIVE_SN CHAR(1) NOT NULL DEFAULT 'S',
      CREATED_BY VARCHAR(50) NOT NULL DEFAULT 'migration',
      CREATED_AT TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UPDATED_BY VARCHAR(50),
      UPDATED_AT TIMESTAMP,
      PRIMARY KEY (ID),
      CHECK (ACTIVE_SN IN ('S', 'N'))
    )
  `);
}

async function main() {
  console.log(`Mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  await initDb();
  try {
    if (!(await tableExists(SRC))) throw new Error(`Missing source ${SRC}`);
    if (!(await tableExists(DST))) {
      console.log(APPLY ? 'CREATE' : '[DRY] CREATE', DST, '(explicit DDL)');
      if (APPLY) await createExplicit();
    } else {
      console.log('OK exists', DST);
    }

    const srcCount = await query(`SELECT COUNT(*) AS N FROM ${SRC} WHERE ACTIVE_SN = 'S'`);
    console.log('SRC active tiers', Number(srcCount?.[0]?.N || 0));

    if (APPLY) {
      await query(`DELETE FROM ${DST}`);
      await query(`
        INSERT INTO ${DST} (
          THRESHOLD_PCT, COMMISSION_PCT, SORT_ORDER, ACTIVE_SN, CREATED_BY
        )
        SELECT
          THRESHOLD_PCT, COMMISSION_PCT, SORT_ORDER, ACTIVE_SN,
          COALESCE(NULLIF(TRIM(CREATED_BY), ''), 'seed-test')
        FROM ${SRC}
        ORDER BY SORT_ORDER, THRESHOLD_PCT
      `);
      const dstCount = await query(`SELECT COUNT(*) AS N FROM ${DST}`);
      console.log('DST rows', Number(dstCount?.[0]?.N || 0));
    } else {
      console.log('[DRY] would DELETE+INSERT tiers prod → TEST');
    }
    console.log('DONE');
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
