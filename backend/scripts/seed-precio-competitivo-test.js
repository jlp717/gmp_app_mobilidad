'use strict';

/**
 * Seed two competitive-price rows into JAVIER.TEST_PRECIO_COMPETITIVO.
 * Refuses unless REPARTO_TABLE_SET=isolated_test and REPARTO_ENVIRONMENT is not production.
 * Do not run against production. This file does not execute itself on import.
 *
 *   node backend/scripts/seed-precio-competitivo-test.js
 */

const { INSERT_SQL } = require('../services/precio-competitivo-service');

const ROWS = Object.freeze([
  ['ART0000001', '4300000354', 1, 4.5, 0, '2026-10-01', '2026-12-31', 'seed-test'],
  ['ART0000002', '4300000354', 1, 8.25, 100, '2026-10-01', null, 'seed-test'],
]);

function assertSeedAllowed(env = process.env) {
  if (String(env.REPARTO_TABLE_SET || '').trim().toLowerCase() !== 'isolated_test') {
    throw new Error('Seed refused: REPARTO_TABLE_SET must be isolated_test');
  }
  if (String(env.REPARTO_ENVIRONMENT || '').trim().toLowerCase() === 'production') {
    throw new Error('Seed refused: production');
  }
  if (!INSERT_SQL.includes('JAVIER.TEST_PRECIO_COMPETITIVO') || /DSEDAC|JAVIER\.(?!TEST_)/i.test(INSERT_SQL)) {
    throw new Error('Seed refused: insert target is not JAVIER.TEST_PRECIO_COMPETITIVO');
  }
}

async function seedPrecioCompetitivo(queryWithParams, env = process.env) {
  assertSeedAllowed(env);
  for (const params of ROWS) {
    await queryWithParams(INSERT_SQL, params, false, false);
  }
  return ROWS.length;
}

async function main() {
  assertSeedAllowed(process.env);
  const { queryWithParams, closePool } = require('../config/db');
  try {
    const count = await seedPrecioCompetitivo(queryWithParams);
    console.log(JSON.stringify({ seeded: count, table: 'JAVIER.TEST_PRECIO_COMPETITIVO' }));
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(String(error && error.message || error).slice(0, 300));
    process.exit(1);
  });
}

module.exports = {
  ROWS,
  assertSeedAllowed,
  seedPrecioCompetitivo,
};
