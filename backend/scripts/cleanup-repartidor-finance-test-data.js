'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { initDb, closePool } = require('../config/db');
const {
  deleteTestData,
} = require('../services/repartidor-finance-service');

async function main() {
  const token = process.argv[2];
  const deleteDeliveryStatus = process.argv.includes('--delete-delivery-status');
  const deliveryIdArg = process.argv.find((arg) => arg.startsWith('--delivery-id='));
  const deliveryId = deliveryIdArg ? deliveryIdArg.split('=').slice(1).join('=').trim() : undefined;

  if (!token) {
    throw new Error(
      'Uso: node scripts/cleanup-repartidor-finance-test-data.js <idempotency_token> [--delete-delivery-status] [--delivery-id=<id>]',
    );
  }

  if (process.env.ALLOW_REPARTIDOR_FINANCE_CLEANUP !== 'true') {
    throw new Error(
      'Cleanup bloqueado. Define ALLOW_REPARTIDOR_FINANCE_CLEANUP=true para ejecutarlo.',
    );
  }

  if (
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_PRODUCTION_REPARTIDOR_FINANCE_CLEANUP !== 'true'
  ) {
    throw new Error(
      'Cleanup bloqueado en production. Requiere ALLOW_PRODUCTION_REPARTIDOR_FINANCE_CLEANUP=true ademas de la flag general.',
    );
  }

  await initDb();
  await deleteTestData(token, { deleteDeliveryStatus, deliveryId });
  console.log(`Datos de prueba eliminados para token: ${token}`);
  if (deleteDeliveryStatus) {
    console.log('Tambien se elimino DELIVERY_STATUS asociado al cobro de prueba.');
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => {});
  });
