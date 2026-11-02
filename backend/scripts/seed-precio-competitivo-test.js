'use strict';

/**
 * Seed two competitive-price rows into JAVIER.TEST_PRECIO_COMPETITIVO.
 * Refuses unless REPARTO_TABLE_SET=isolated_test and REPARTO_ENVIRONMENT is not production.
 * Do not run against production. This file does not execute itself on import.
 *
 *   node backend/scripts/seed-precio-competitivo-test.js
 */

const TABLE = 'JAVIER.TEST_PRECIO_COMPETITIVO';
const SEED_LOCK_SQL = `LOCK TABLE ${TABLE} IN EXCLUSIVE MODE`;
const SOURCE_ORDER_ID = 106;
const SOURCE_ORDER_SQL = `SELECT TRIM(L.CODIGOARTICULO) AS CODIGOARTICULO,
       TRIM(COALESCE(NULLIF(C.CODIGOCLIENTE, ''), C.CODIGOCLIENTEALBARAN)) AS CODIGOCLIENTE,
       C.CODIGOTARIFA, L.PRECIOVENTA, L.PORCENTAJEMARGEN,
       DATE(C.CREATED_AT) AS VALIDO_DESDE
  FROM JAVIER.TEST_PEDIDOS_CAB C
  JOIN JAVIER.TEST_PEDIDOS_LIN L ON L.PEDIDO_ID = C.ID
 WHERE C.ID = ?
   AND TRIM(C.ESTADO) = 'CONFIRMADO'
   AND TRIM(L.CODIGOARTICULO) IN (?, ?)
 ORDER BY L.ID`;

const UPSERT_SQL = `MERGE INTO ${TABLE} T
USING (VALUES (
  CAST(? AS VARCHAR(10)), CAST(? AS VARCHAR(10)), CAST(? AS SMALLINT),
  CAST(? AS DECIMAL(9,4)), CAST(? AS DECIMAL(5,2)),
  CAST(? AS DATE), CAST(? AS DATE), CAST(? AS VARCHAR(40))
))
  AS S (CODIGOARTICULO, CODIGOCLIENTE, CODIGOTARIFA, PRECIO_COMPETITIVO, MARGEN_PCT, VALIDO_DESDE, VALIDO_HASTA, USUARIO)
ON TRIM(T.CODIGOARTICULO) = S.CODIGOARTICULO
AND TRIM(T.CODIGOCLIENTE) = S.CODIGOCLIENTE
AND T.VALIDO_DESDE = S.VALIDO_DESDE
WHEN MATCHED THEN UPDATE SET
  CODIGOTARIFA = S.CODIGOTARIFA,
  PRECIO_COMPETITIVO = S.PRECIO_COMPETITIVO,
  MARGEN_PCT = S.MARGEN_PCT,
  VALIDO_HASTA = S.VALIDO_HASTA,
  USUARIO = S.USUARIO,
  UPDATED_AT = CURRENT TIMESTAMP
WHEN NOT MATCHED THEN INSERT
  (CODIGOARTICULO, CODIGOCLIENTE, CODIGOTARIFA, PRECIO_COMPETITIVO, MARGEN_PCT,
   VALIDO_DESDE, VALIDO_HASTA, USUARIO, CREATED_AT, UPDATED_AT)
VALUES
  (S.CODIGOARTICULO, S.CODIGOCLIENTE, S.CODIGOTARIFA, S.PRECIO_COMPETITIVO, S.MARGEN_PCT,
   S.VALIDO_DESDE, S.VALIDO_HASTA, S.USUARIO, CURRENT TIMESTAMP, CURRENT TIMESTAMP)`;

const ROWS = Object.freeze([
  ['3519', '4300032160', 1, 27.54, 24.69, '2026-09-28', null, 'pedido-106'],
  ['3075', '4300032160', 1, 49.572, 24.71, '2026-09-28', null, 'pedido-106'],
]);

function column(row, key) {
  return row?.[key] ?? row?.[key.toLowerCase()];
}

function dateOnly(raw) {
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(raw || '').trim());
  return match ? match[1] : '';
}

function canonicalSeedRows(rows) {
  const normalized = (Array.isArray(rows) ? rows : []).map((row) => [
    String(column(row, 'CODIGOARTICULO') || '').trim(),
    String(column(row, 'CODIGOCLIENTE') || '').trim(),
    Number(column(row, 'CODIGOTARIFA')),
    Number(column(row, 'PRECIOVENTA')),
    Number(column(row, 'PORCENTAJEMARGEN')),
    dateOnly(column(row, 'VALIDO_DESDE')),
    null,
    `pedido-${SOURCE_ORDER_ID}`,
  ]);
  const byArticle = new Map(normalized.map((row) => [row[0], row]));
  const expectedByArticle = new Map(ROWS.map((row) => [row[0], row]));
  const valid = normalized.length === 2
    && byArticle.size === 2
    && ['3519', '3075'].every((article) => byArticle.has(article))
    && normalized.every((row) => row[1] === '4300032160'
      && Number.isInteger(row[2])
      && row[2] >= 0
      && Number.isFinite(row[3])
      && row[3] > 0
      && Number.isFinite(row[4])
      && row[4] >= 0
      && row[4] <= 100
      && row[5] === '2026-09-28'
      && row[2] === expectedByArticle.get(row[0])?.[2]
      && row[3] === expectedByArticle.get(row[0])?.[3]
      && row[4] === expectedByArticle.get(row[0])?.[4]);
  if (!valid) {
    throw new Error('Seed refused: canonical confirmed order 106 is incomplete or changed');
  }
  return normalized;
}

function assertSeedAllowed(env = process.env) {
  if (String(env.APP_ENV || '').trim().toLowerCase() !== 'test') {
    throw new Error('Seed refused: APP_ENV must be test');
  }
  if (String(env.REPARTO_TABLE_SET || '').trim().toLowerCase() !== 'isolated_test') {
    throw new Error('Seed refused: REPARTO_TABLE_SET must be isolated_test');
  }
  if (String(env.REPARTO_ENVIRONMENT || '').trim().toLowerCase() === 'production') {
    throw new Error('Seed refused: production');
  }
  if (String(env.DB2_WRITE_SCHEMA || 'JAVIER').trim().toUpperCase() !== 'JAVIER') {
    throw new Error('Seed refused: DB2_WRITE_SCHEMA must be JAVIER');
  }
  if (!UPSERT_SQL.includes(TABLE) || /DSEDAC|JAVIER\.(?!TEST_)/i.test(UPSERT_SQL)) {
    throw new Error('Seed refused: insert target is not JAVIER.TEST_PRECIO_COMPETITIVO');
  }
}

async function seedPrecioCompetitivo(connection, env = process.env) {
  assertSeedAllowed(env);
  const required = ['query', 'beginTransaction', 'commit', 'rollback'];
  if (!connection || required.some((method) => typeof connection[method] !== 'function')) {
    throw new Error('Seed refused: dedicated transaction connection required');
  }
  await connection.beginTransaction();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await connection.query(SEED_LOCK_SQL);
    const sourceRows = await connection.query(
      SOURCE_ORDER_SQL,
      [SOURCE_ORDER_ID, '3519', '3075'],
    );
    const rows = canonicalSeedRows(sourceRows);
    for (const params of rows) {
      await connection.query(UPSERT_SQL, params);
    }
    await connection.commit();
    return rows.length;
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

async function main({
  env = process.env,
  argv = process.argv,
  loadEnvironment,
  applyProfile,
  openConnection,
  stdout = console.log,
} = {}) {
  const path = require('path');
  const load = loadEnvironment
    || (() => require('../config/load-env').loadEnv(path.resolve(__dirname, '..')));
  const apply = applyProfile
    || ((targetEnv) => require('../config/app-profile').applyAppProfile(targetEnv));
  load();
  apply(env);
  assertSeedAllowed(env);
  if (!argv.includes('--apply')) {
    stdout(JSON.stringify({ dryRun: true, rows: ROWS.length, table: TABLE }));
    return;
  }
  const connect = openConnection
    || (() => require('../adapters/pedidos-transaction-connection')
      .openDedicatedPedidosTransactionConnection());
  const connection = await connect();
  try {
    const count = await seedPrecioCompetitivo(connection, env);
    stdout(JSON.stringify({ seeded: count, table: 'JAVIER.TEST_PRECIO_COMPETITIVO' }));
  } finally {
    await connection.close();
  }
}

function safeCliError(error) {
  const diagnostic = Array.isArray(error?.odbcErrors) && error.odbcErrors.length > 0
    ? error.odbcErrors[0]
    : error;
  const state = String(
    diagnostic?.state || diagnostic?.sqlState || diagnostic?.sqlstate || '',
  ).trim().toUpperCase();
  const rawCode = diagnostic?.code ?? diagnostic?.nativeCode ?? diagnostic?.nativeError;
  const code = String(rawCode ?? '').trim().toUpperCase();
  return {
    error: 'COMPETITIVE_SEED_FAILED',
    ...(state && /^[0-9A-Z]{5}$/.test(state) ? { odbcState: state } : {}),
    ...(code && /^(?:-?\d{1,8}|SQL\d{4})$/.test(code) ? { odbcCode: code } : {}),
  };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify(safeCliError(error)));
    process.exit(1);
  });
}

module.exports = {
  ROWS,
  SEED_LOCK_SQL,
  SOURCE_ORDER_ID,
  SOURCE_ORDER_SQL,
  UPSERT_SQL,
  assertSeedAllowed,
  canonicalSeedRows,
  main,
  safeCliError,
  seedPrecioCompetitivo,
};
