'use strict';

/**
 * Create + populate JAVIER.LACLAE_MONTHLY from the commercial LACLAE source.
 * Never writes DSED / DSEDAC. Run on 230:
 *   DB_QUERY_TIMEOUT_MS=3600000 node backend/scripts/apply-laclae-monthly.js --apply
 */

process.env.DB_QUERY_TIMEOUT_MS = process.env.DB_QUERY_TIMEOUT_MS || '3600000';

const path = require('path');

const dbModule = (() => {
  const candidates = [
    '/opt/gmp-api/backend/config/db',
    path.resolve(__dirname, '../config/db'),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) { /* next */ }
  }
  throw new Error('db module not found');
})();

const { initDb, closePool, query, queryWithParams } = dbModule;
const { comercialErpTable, comercialErpWriteForbiddenSql } = require('../utils/comercial-erp-tables');
const { LACLAE_SALES_FILTER } = require('../utils/common');

const APPLY = process.argv.includes('--apply');
const YEAR = parseInt(process.env.HIT_YEAR || String(new Date().getFullYear()), 10);
const VENDOR = String(process.env.HIT_VENDOR || '98').trim();

function assertJavierOnly(sql) {
  if (comercialErpWriteForbiddenSql(sql)) {
    throw new Error('Refusing DSED/DSEDAC write');
  }
  const upper = String(sql).toUpperCase();
  if (/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)\b/.test(upper)
    && !upper.includes('JAVIER.')) {
    throw new Error('JAVIER schema required');
  }
}

async function tableExists() {
  const rows = await queryWithParams(
    `SELECT 1 AS OK FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      FETCH FIRST 1 ROW ONLY`,
    ['JAVIER', 'LACLAE_MONTHLY'],
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function createTable() {
  const ddl = [
    `CREATE TABLE JAVIER.LACLAE_MONTHLY (
      ANO NUMERIC(4, 0) NOT NULL,
      MES NUMERIC(2, 0) NOT NULL,
      VENDEDOR CHAR(2) NOT NULL,
      VENDEDOR_R1 CHAR(2) NOT NULL,
      CLIENTE CHAR(10) NOT NULL,
      SALES NUMERIC(14, 2) NOT NULL,
      COST NUMERIC(14, 2) NOT NULL,
      UNITS NUMERIC(16, 5) NOT NULL,
      BOXES NUMERIC(14, 2) NOT NULL,
      LINEAS INTEGER NOT NULL,
      PEDIDOS INTEGER NOT NULL
    )`,
    `CREATE INDEX JAVIER.IX_LACLAE_M_YM ON JAVIER.LACLAE_MONTHLY (ANO, MES)`,
    `CREATE INDEX JAVIER.IX_LACLAE_M_YMC ON JAVIER.LACLAE_MONTHLY (ANO, MES, CLIENTE)`,
    `CREATE INDEX JAVIER.IX_LACLAE_M_YMV ON JAVIER.LACLAE_MONTHLY (ANO, MES, VENDEDOR)`,
  ];
  for (const sql of ddl) {
    assertJavierOnly(sql);
    const started = Date.now();
    await query(sql, true, true);
    console.log(`ddl\t${Date.now() - started}ms`);
  }
}

async function populate(source) {
  const sql = `INSERT INTO JAVIER.LACLAE_MONTHLY
    (ANO, MES, VENDEDOR, VENDEDOR_R1, CLIENTE, SALES, COST, UNITS, BOXES, LINEAS, PEDIDOS)
    SELECT
      L.LCAADC,
      L.LCMMDC,
      L.LCCDVD,
      COALESCE(L.R1_T8CDVD, ''),
      L.LCCDCL,
      COALESCE(SUM(L.LCIMVT), 0),
      COALESCE(SUM(L.LCIMCT), 0),
      COALESCE(SUM(L.LCCTUD), 0),
      COALESCE(SUM(L.LCCTEV), 0),
      COUNT(*),
      0
    FROM ${source} L
    WHERE ${LACLAE_SALES_FILTER}
    GROUP BY L.LCAADC, L.LCMMDC, L.LCCDVD, COALESCE(L.R1_T8CDVD, ''), L.LCCDCL`;
  assertJavierOnly(sql);
  const started = Date.now();
  await query(sql, true, true);
  console.log(`populate\t${Date.now() - started}ms\tsource=${source}`);
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

async function validate(source) {
  const srcAll = await queryWithParams(
    `SELECT COALESCE(SUM(L.LCIMVT), 0) AS SALES, COALESCE(SUM(L.LCIMCT), 0) AS COST
       FROM ${source} L
      WHERE L.LCAADC = ?
        AND ${LACLAE_SALES_FILTER}`,
    [YEAR],
  );
  const monAll = await queryWithParams(
    `SELECT COALESCE(SUM(SALES), 0) AS SALES, COALESCE(SUM(COST), 0) AS COST
       FROM JAVIER.LACLAE_MONTHLY
      WHERE ANO = ?`,
    [YEAR],
  );
  const srcV = await queryWithParams(
    `SELECT COALESCE(SUM(L.LCIMVT), 0) AS SALES
       FROM ${source} L
      WHERE L.LCAADC = ?
        AND TRIM(L.LCCDVD) = CAST(? AS VARCHAR(2))
        AND ${LACLAE_SALES_FILTER}`,
    [YEAR, VENDOR],
  );
  const monV = await queryWithParams(
    `SELECT COALESCE(SUM(SALES), 0) AS SALES
       FROM JAVIER.LACLAE_MONTHLY
      WHERE ANO = ?
        AND TRIM(VENDEDOR) = CAST(? AS VARCHAR(2))`,
    [YEAR, VENDOR],
  );
  const count = await queryWithParams(
    `SELECT COUNT(*) AS N FROM JAVIER.LACLAE_MONTHLY`,
    [],
  );
  const report = {
    year: YEAR,
    vendor: VENDOR,
    rows: Number(count?.[0]?.N || 0),
    allSrc: money(srcAll?.[0]?.SALES),
    allMonthly: money(monAll?.[0]?.SALES),
    allCostSrc: money(srcAll?.[0]?.COST),
    allCostMonthly: money(monAll?.[0]?.COST),
    vendorSrc: money(srcV?.[0]?.SALES),
    vendorMonthly: money(monV?.[0]?.SALES),
  };
  report.allDelta = money(report.allMonthly - report.allSrc);
  report.vendorDelta = money(report.vendorMonthly - report.vendorSrc);
  report.ok = Math.abs(report.allDelta) < 0.02 && Math.abs(report.vendorDelta) < 0.02 && report.rows > 0;
  console.log(`validate\t${JSON.stringify(report)}`);
  return report;
}

(async () => {
  const source = comercialErpTable('LACLAE');
  console.log(`source\t${source}\tapply=${APPLY}`);
  await initDb();
  try {
    const exists = await tableExists();
    console.log(`exists\t${exists}`);
    if (!APPLY) {
      console.log('dry-run (pass --apply to CREATE/INSERT)');
      return;
    }
    if (!exists) await createTable();
    else {
      assertJavierOnly('DELETE FROM JAVIER.LACLAE_MONTHLY');
      await query('DELETE FROM JAVIER.LACLAE_MONTHLY', true, true);
    }
    await populate(source);
    const report = await validate(source);
    if (!report.ok) {
      console.error('BLOCKED numbers mismatch; DROP JAVIER.LACLAE_MONTHLY');
      await query('DROP TABLE JAVIER.LACLAE_MONTHLY', true, true);
      process.exit(2);
    }
  } finally {
    await closePool();
  }
})().catch((error) => {
  console.error(String(error.message || error).slice(0, 400));
  process.exit(1);
});
