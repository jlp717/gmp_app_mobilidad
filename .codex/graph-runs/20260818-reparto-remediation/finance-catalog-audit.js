'use strict';

// Read-only QSYS2 catalog probe for the isolated TEST finance contracts.
// It emits table/column metadata only and never reads business rows or secrets.
const path = require('node:path');

require(path.resolve(__dirname, '../../../backend/node_modules/dotenv')).config({
  path: path.resolve(__dirname, '../../../.env'),
});
require(path.resolve(__dirname, '../../../backend/node_modules/dotenv')).config({
  path: path.resolve(__dirname, '../../../backend/.env'),
});

const { initDb, closePool, queryWithParams } = require(path.resolve(
  __dirname,
  '../../../backend/config/db',
));
const { TABLE_MAPPINGS } = require(path.resolve(
  __dirname,
  '../../../backend/config/reparto-runtime',
));

const keys = Object.freeze([
  ['finance', 'cobros'],
  ['finance', 'audit'],
  ['finance', 'liquidationOps'],
  ['finance', 'liquidationOutbox'],
  ['finance', 'liquidationExpenses'],
  ['finance', 'liquidationAdjustments'],
  ['finance', 'liquidationBankDeposits'],
  ['finance', 'balances'],
]);

async function columnsOf(schemaTable) {
  const [schema, table] = String(schemaTable || '').split('.');
  if (!schema || !table) return [];
  const rows = await queryWithParams(
    `SELECT TRIM(COLUMN_NAME) AS COLUMN_NAME,
            TRIM(DATA_TYPE) AS DATA_TYPE,
            LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE,
            TRIM(IS_NULLABLE) AS IS_NULLABLE,
            TRIM(IDENTITY) AS IDENTITY
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
  return (rows || []).map((row) => ({
    name: String(row.COLUMN_NAME || '').trim().toUpperCase(),
    type: String(row.DATA_TYPE || '').trim().toUpperCase(),
    length: Number(row.LENGTH) || 0,
    precision: Number(row.NUMERIC_PRECISION) || 0,
    scale: Number(row.NUMERIC_SCALE) || 0,
    nullable: String(row.IS_NULLABLE || '').trim().toUpperCase(),
    identity: String(row.IDENTITY || '').trim().toUpperCase(),
  }));
}

async function main() {
  await initDb();
  try {
    for (const [group, key] of keys) {
      const table = TABLE_MAPPINGS.isolated_test[group]?.[key];
      const columns = await columnsOf(table);
      process.stdout.write(`${JSON.stringify({ group, key, table, columns })}\n`);
    }
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ code: String(error?.code || 'CATALOG_AUDIT_FAILED') })}\n`);
  process.exitCode = 1;
});
