'use strict';

/**
 * Recreate + seed JAVIER.TEST_REPARTIDOR_COMMISSION_TIERS (explicit DDL).
 * Usage: node backend/scripts/recreate-test-commission-tiers.js --apply
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

async function main() {
  console.log(`Mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  await initDb();
  try {
    if (!(await tableExists(SRC))) throw new Error(`Missing ${SRC}`);
    const exists = await tableExists(DST);
    console.log('DST exists?', exists);
    if (!APPLY) {
      console.log('[DRY] DROP IF EXISTS + explicit CREATE + INSERT from prod');
      return;
    }

    if (exists) {
      try {
        await query(`DROP TABLE ${DST}`);
        console.log('DROPPED', DST);
      } catch (err) {
        console.log('DROP warn', err.message);
      }
    }

    // Explicit DDL — CREATE LIKE INCLUDING IDENTITY is unsupported/broken here (42000).
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
    console.log('CREATED', DST);

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
    const rows = await query(
      `SELECT ID, THRESHOLD_PCT, COMMISSION_PCT, SORT_ORDER, ACTIVE_SN FROM ${DST} ORDER BY SORT_ORDER`,
    );
    console.log('DST rows', rows.length, JSON.stringify(rows));
    console.log('DONE');
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
