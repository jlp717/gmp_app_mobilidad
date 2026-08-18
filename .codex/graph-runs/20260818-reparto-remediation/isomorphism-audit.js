'use strict';

// Read-only DB2 audit. It never issues DML or DDL and intentionally reports
// every mapped pair instead of stopping at the first incompatibility.
const path = require('path');

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
const { compareTableMetadata } = require(path.resolve(
  __dirname,
  '../../../backend/scripts/copy-javier-prod-to-test',
));

async function columnsOf(schemaTable) {
  const [schema, table] = schemaTable.split('.');
  const rows = await queryWithParams(
    `SELECT TRIM(COLUMN_NAME) AS COLUMN_NAME,
            TRIM(DATA_TYPE) AS DATA_TYPE,
            LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE, IDENTITY
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
  return (rows || []).map((row) => ({
    name: String(row.COLUMN_NAME || row.column_name || '').trim().toUpperCase(),
    dataType: String(row.DATA_TYPE || row.data_type || '').trim().toUpperCase(),
    length: String(row.LENGTH ?? row.length ?? ''),
    numericPrecision: String(row.NUMERIC_PRECISION ?? row.numeric_precision ?? ''),
    numericScale: String(row.NUMERIC_SCALE ?? row.numeric_scale ?? ''),
    isNullable: String(row.IS_NULLABLE || row.is_nullable || '').trim().toUpperCase(),
    identity: String(row.IDENTITY || row.identity || '').trim().toUpperCase() === 'YES',
  }));
}

function pairs() {
  const result = [];
  for (const [group, productionTables] of Object.entries(TABLE_MAPPINGS.production)) {
    for (const [key, production] of Object.entries(productionTables)) {
      result.push({
        group,
        key,
        production,
        test: TABLE_MAPPINGS.isolated_test[group]?.[key],
      });
    }
  }
  return result;
}

async function main() {
  await initDb();
  let failed = false;
  try {
    for (const pair of pairs()) {
      const productionColumns = await columnsOf(pair.production);
      const testColumns = pair.test ? await columnsOf(pair.test) : [];
      const comparison = compareTableMetadata(productionColumns, testColumns);
      const exists = productionColumns.length > 0 && testColumns.length > 0;
      const ok = exists && comparison.ok;
      failed ||= !ok;
      console.log(JSON.stringify({
        group: pair.group,
        key: pair.key,
        production: pair.production,
        test: pair.test || null,
        status: ok ? 'PASS' : 'FAIL',
        productionColumns: productionColumns.length,
        testColumns: testColumns.length,
        missing: comparison.missing,
        extra: comparison.extra,
        deltas: comparison.deltas.map((delta) => delta.name),
      }));
    }
  } finally {
    await closePool();
  }
  if (failed) process.exitCode = 2;
}

main().catch((error) => {
  console.error(JSON.stringify({ status: 'ERROR', code: error.code || 'AUDIT_FAILED' }));
  process.exitCode = 1;
});
