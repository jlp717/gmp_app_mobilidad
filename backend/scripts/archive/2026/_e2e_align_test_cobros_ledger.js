// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-e2e | _-scratch gitignored; e2e puntual ledger cobros test | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Align JAVIER.TEST_REPARTIDOR_COBROS to cobros write-port LEDGER_COLUMNS.
 * Never touches DSEDAC. Dry-run unless --apply.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query, queryWithParams } = require('../config/db');
const { LEDGER_COLUMNS, COMMERCIAL_COLUMNS } = require('../repositories/reparto-cobros-db2-port');

const APPLY = process.argv.includes('--apply');
const TEST_LEDGER = 'JAVIER.TEST_REPARTIDOR_COBROS';
const PROD_LEDGER = 'JAVIER.REPARTIDOR_COBROS';
const TEST_COMM = 'JAVIER.TEST_COBROS';
const INDEX_NAME = 'TRC_IDEM_UQ';

function refuseDsedac(sql) {
  const s = String(sql || '').toUpperCase().replace(/\s+/g, ' ');
  if (/\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|TRUNCATE|CREATE)\b.*\bDSEDAC\./.test(s)
    || /\bDSEDAC\.[A-Z0-9_]+\b.*\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP)\b/.test(s)) {
    throw new Error(`Refusing DSEDAC mutation: ${sql}`);
  }
  if (!s.includes('JAVIER.TEST_') && /\b(ALTER|UPDATE|CREATE UNIQUE INDEX|INSERT)\b/.test(s)) {
    throw new Error(`Refusing non-TEST mutation: ${sql}`);
  }
}

async function runMut(sql, params = []) {
  refuseDsedac(sql);
  console.log(APPLY ? 'APPLY' : '[DRY]', sql.replace(/\s+/g, ' ').trim(), params.length ? params : '');
  if (!APPLY) return;
  if (params.length) await queryWithParams(sql, params);
  else await query(sql);
}

function sqlType(row) {
  const dataType = String(row.DATA_TYPE || row.data_type || '').toUpperCase();
  const length = Number(row.LENGTH || row.length || 0);
  const precision = Number(row.NUMERIC_PRECISION || row.numeric_precision || length || 0);
  const scale = Number(row.NUMERIC_SCALE || row.numeric_scale || 0);
  const nullable = String(row.IS_NULLABLE || row.is_nullable || 'Y').toUpperCase() === 'Y';
  let decl;
  if (dataType === 'CHAR' || dataType === 'CHARACTER') decl = `CHAR(${length})`;
  else if (dataType === 'VARCHAR' || dataType === 'CHARACTER VARYING') decl = `VARCHAR(${length})`;
  else if (dataType === 'DECIMAL' || dataType === 'NUMERIC' || dataType === 'DECFLOAT') {
    decl = `DECIMAL(${precision || 10}, ${scale || 0})`;
  } else if (dataType === 'INTEGER' || dataType === 'INT') decl = 'INTEGER';
  else if (dataType === 'BIGINT') decl = 'BIGINT';
  else if (dataType === 'SMALLINT') decl = 'SMALLINT';
  else if (dataType === 'TIMESTMP' || dataType === 'TIMESTAMP') decl = 'TIMESTAMP';
  else throw new Error(`Unsupported type ${dataType} for ${row.COLUMN_NAME}`);
  return `${decl}${nullable ? '' : ''} DEFAULT NULL`;
}

async function columnsOf(schema, table) {
  return queryWithParams(
    `SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [schema, table],
  );
}

async function main() {
  await initDb();
  const testCols = await columnsOf('JAVIER', 'TEST_REPARTIDOR_COBROS');
  const testSet = new Set(testCols.map((r) => String(r.COLUMN_NAME || r.column_name).toUpperCase()));
  const prodCols = await columnsOf('JAVIER', 'REPARTIDOR_COBROS');
  const prodByName = new Map(
    prodCols.map((r) => [String(r.COLUMN_NAME || r.column_name).toUpperCase(), r]),
  );

  const missing = LEDGER_COLUMNS.filter((c) => !testSet.has(c));
  console.log(JSON.stringify({ testColumns: [...testSet].sort(), missing }));

  for (const col of missing) {
    const src = prodByName.get(col);
    if (!src) throw new Error(`Production ${PROD_LEDGER} missing ${col}`);
    const decl = sqlType(src);
    await runMut(`ALTER TABLE ${TEST_LEDGER} ADD COLUMN ${col} ${decl}`);
  }

  const commCols = await columnsOf('JAVIER', 'TEST_COBROS');
  const commSet = new Set(commCols.map((r) => String(r.COLUMN_NAME || r.column_name).toUpperCase()));
  const commMissing = COMMERCIAL_COLUMNS.filter((c) => !commSet.has(c));
  if (commMissing.length) {
    throw new Error(`${TEST_COMM} missing ${commMissing.join(',')}`);
  }

  await runMut(
    `UPDATE ${TEST_LEDGER}
        SET IDEMPOTENCY_TOKEN = 'SEED-' CONCAT TRIM(VARCHAR(ID))
      WHERE IDEMPOTENCY_TOKEN IS NULL OR TRIM(IDEMPOTENCY_TOKEN) = ''`,
  );

  const idx = await query(
    `SELECT I.INDEX_NAME, I.IS_UNIQUE, COUNT(*) AS KEYS, MAX(K.COLUMN_NAME) AS COL
       FROM QSYS2.SYSINDEXES I
       INNER JOIN QSYS2.SYSKEYS K
         ON K.INDEX_SCHEMA = I.INDEX_SCHEMA AND K.INDEX_NAME = I.INDEX_NAME
      WHERE I.TABLE_SCHEMA = 'JAVIER' AND I.TABLE_NAME = 'TEST_REPARTIDOR_COBROS'
        AND I.IS_UNIQUE IN ('U', 'V')
      GROUP BY I.INDEX_NAME, I.IS_UNIQUE
     HAVING COUNT(*) = 1 AND MAX(K.COLUMN_NAME) = 'IDEMPOTENCY_TOKEN'`,
  );
  if (!idx.length) {
    await runMut(
      `CREATE UNIQUE INDEX JAVIER.${INDEX_NAME} ON ${TEST_LEDGER} (IDEMPOTENCY_TOKEN)`,
    );
  } else {
    console.log('OK unique index', idx[0].INDEX_NAME || idx[0].index_name);
  }

  if (APPLY) {
    const after = await columnsOf('JAVIER', 'TEST_REPARTIDOR_COBROS');
    const afterSet = new Set(after.map((r) => String(r.COLUMN_NAME || r.column_name).toUpperCase()));
    const stillMissing = LEDGER_COLUMNS.filter((c) => !afterSet.has(c));
    if (stillMissing.length) throw new Error(`Still missing ${stillMissing.join(',')}`);
    console.log(JSON.stringify({ aligned: true, columns: LEDGER_COLUMNS.length }));
  }
  await closePool();
}

main().catch(async (err) => {
  console.error(String(err && err.stack || err));
  try { await closePool(); } catch (_) { /* ignore */ }
  process.exit(1);
});
