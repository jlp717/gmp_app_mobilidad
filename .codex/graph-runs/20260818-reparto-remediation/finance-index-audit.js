'use strict';

// Read-only QSYS2 index probe; emits metadata only.
const path = require('node:path');
for (const file of ['../../../.env', '../../../backend/.env']) {
  require(path.resolve(__dirname, '../../../backend/node_modules/dotenv')).config({
    path: path.resolve(__dirname, file),
  });
}
const { initDb, closePool, queryWithParams } = require(path.resolve(
  __dirname,
  '../../../backend/config/db',
));
const { TABLE_MAPPINGS } = require(path.resolve(
  __dirname,
  '../../../backend/config/reparto-runtime',
));

const tables = [
  TABLE_MAPPINGS.isolated_test.finance.cobros,
  TABLE_MAPPINGS.isolated_test.finance.liquidationOps,
  TABLE_MAPPINGS.isolated_test.finance.liquidationOutbox,
  TABLE_MAPPINGS.isolated_test.finance.audit,
].filter(Boolean);

async function main() {
  await initDb();
  try {
    for (const qualified of tables) {
      const [schema, table] = qualified.split('.');
      const rows = await queryWithParams(
        `SELECT TRIM(I.INDEX_NAME) AS INDEX_NAME,
                TRIM(I.IS_UNIQUE) AS IS_UNIQUE,
                TRIM(K.COLUMN_NAME) AS COLUMN_NAME,
                K.ORDINAL_POSITION
           FROM QSYS2.SYSINDEXES I
           JOIN QSYS2.SYSKEYS K
             ON K.INDEX_SCHEMA = I.INDEX_SCHEMA
            AND K.INDEX_NAME = I.INDEX_NAME
          WHERE I.TABLE_SCHEMA = ? AND I.TABLE_NAME = ?
          ORDER BY I.INDEX_NAME, K.ORDINAL_POSITION`,
        [schema, table],
      );
      const indexes = new Map();
      for (const row of rows || []) {
        const name = String(row.INDEX_NAME || '').trim();
        if (!indexes.has(name)) indexes.set(name, {
          name,
          unique: String(row.IS_UNIQUE || '').trim().toUpperCase(),
          columns: [],
        });
        indexes.get(name).columns.push(String(row.COLUMN_NAME || '').trim().toUpperCase());
      }
      process.stdout.write(`${JSON.stringify({ table: qualified, indexes: [...indexes.values()] })}\n`);
    }
  } finally {
    await closePool();
  }
}
main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ code: String(error?.code || 'INDEX_AUDIT_FAILED') })}\n`);
  process.exitCode = 1;
});
