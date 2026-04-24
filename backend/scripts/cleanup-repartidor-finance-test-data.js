'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { initDb, closePool } = require('../config/db');
const {
  deleteTestData,
} = require('../services/repartidor-finance-service');

async function main() {
  const token = process.argv[2];
  if (!token) {
    throw new Error(
      'Uso: node scripts/cleanup-repartidor-finance-test-data.js <idempotency_token>',
    );
  }

  if (process.env.ALLOW_REPARTIDOR_FINANCE_CLEANUP !== 'true') {
    throw new Error(
      'Cleanup bloqueado. Define ALLOW_REPARTIDOR_FINANCE_CLEANUP=true para ejecutarlo.',
    );
  }

  await initDb();
  await deleteTestData(token);
  console.log(`Datos de prueba eliminados para token: ${token}`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => {});
  });
