'use strict';

/**
 * HIT SELECT-only: DSEDAC/DSED vs JAVIER.TEST_* sales for vendor 35 (2026-09-17)
 * and jefe-today (2026-09-18). Never prints PIN. Never writes.
 *
 *   node backend/scripts/hit-laclae-live-vs-test.js
 *   On 230: node /tmp/hit-laclae-live-vs-test.js  (db = /opt/gmp-api/backend/config/db)
 */

const fs = require('fs');
const path = require('path');

const localDb = path.resolve(__dirname, '../config/db.js');
const remoteDb = '/opt/gmp-api/backend/config/db.js';
const dbModule = fs.existsSync(localDb) ? localDb : remoteDb;

const { initDb, closePool, queryWithParams } = require(dbModule);

const VENDOR = '35';
const YEAR = 2026;
const MONTH = 9;
const DAY_ROUTE = 17;
const DAY_TODAY = 18;

function n(row, key) {
  const v = row?.[key] ?? row?.[key.toLowerCase()] ?? row?.[key.toUpperCase()];
  if (v == null) return 0;
  return Number(v);
}

async function qsysCols(schema, table) {
  const exists = await queryWithParams(
    `SELECT TABLE_NAME FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      FETCH FIRST 1 ROW ONLY`,
    [schema, table],
  );
  if (!exists?.length) return { present: false, cols: [] };
  const cols = await queryWithParams(
    `SELECT TRIM(COLUMN_NAME) AS COLUMN_NAME
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        AND COLUMN_NAME IN (
          'LCAADC','LCMMDC','LCDDDC','LCCDVD','R1_T8CDVD','LCIMVT',
          'ANODOCUMENTO','MESDOCUMENTO','DIADOCUMENTO','CODIGOVENDEDOR',
          'IMPORTEVENTA','LCTPVT','LCCLLN','LCSRAB','TPDC'
        )
      ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
  return {
    present: true,
    cols: (cols || []).map((r) => String(r.COLUMN_NAME || r.column_name || '').trim()),
  };
}

async function laclaeDay(table, year, month, day, vendorColSql) {
  const rows = await queryWithParams(
    `SELECT COALESCE(SUM(L.LCIMVT), 0) AS SALES,
            COUNT(*) AS LINES,
            COUNT(DISTINCT L.LCSRAB || CHAR(L.LCNRAB)) AS PEDIDOS
       FROM ${table} L
      WHERE L.LCAADC = ?
        AND L.LCMMDC = ?
        AND L.LCDDDC = ?
        AND L.TPDC = 'LAC'
        AND L.LCTPVT IN ('CC', 'VC')
        AND L.LCCLLN IN ('AB', 'VT')
        AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
        AND TRIM(${vendorColSql}) = CAST(? AS VARCHAR(2))`,
    [year, month, day, VENDOR],
  );
  return {
    sales: n(rows?.[0], 'SALES'),
    lines: n(rows?.[0], 'LINES'),
    pedidos: n(rows?.[0], 'PEDIDOS'),
  };
}

async function laclaeDayAll(table, year, month, day) {
  const rows = await queryWithParams(
    `SELECT COALESCE(SUM(L.LCIMVT), 0) AS SALES,
            COUNT(*) AS LINES,
            COUNT(DISTINCT L.LCNRAB) AS PEDIDOS
       FROM ${table} L
      WHERE L.LCAADC = ?
        AND L.LCMMDC = ?
        AND L.LCDDDC = ?
        AND L.TPDC = 'LAC'
        AND L.LCTPVT IN ('CC', 'VC')
        AND L.LCCLLN IN ('AB', 'VT')
        AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')`,
    [year, month, day],
  );
  return {
    sales: n(rows?.[0], 'SALES'),
    lines: n(rows?.[0], 'LINES'),
    pedidos: n(rows?.[0], 'PEDIDOS'),
  };
}

async function lacDay(table, year, month, day, vendorColSql) {
  const rows = await queryWithParams(
    `SELECT COALESCE(SUM(L.IMPORTEVENTA), 0) AS SALES,
            COUNT(*) AS LINES
       FROM ${table} L
      WHERE L.ANODOCUMENTO = ?
        AND L.MESDOCUMENTO = ?
        AND L.DIADOCUMENTO = ?
        AND TRIM(${vendorColSql}) = CAST(? AS VARCHAR(2))`,
    [year, month, day, VENDOR],
  );
  return { sales: n(rows?.[0], 'SALES'), lines: n(rows?.[0], 'LINES') };
}

async function maxDate(table, yearCol, monthCol, dayCol) {
  const rows = await queryWithParams(
    `SELECT MAX(${yearCol} * 10000 + ${monthCol} * 100 + ${dayCol}) AS YMD
       FROM ${table}
      WHERE ${yearCol} = ?`,
    [YEAR],
  );
  return n(rows?.[0], 'YMD');
}

async function main() {
  await initDb();
  try {
    const catalog = {
      'DSED.LACLAE': await qsysCols('DSED', 'LACLAE'),
      'DSEDAC.LAC': await qsysCols('DSEDAC', 'LAC'),
      'JAVIER.TEST_LACLAE': await qsysCols('JAVIER', 'TEST_LACLAE'),
      'JAVIER.TEST_LAC': await qsysCols('JAVIER', 'TEST_LAC'),
    };

    const vd35_17 = {
      dsed_r1: await laclaeDay('DSED.LACLAE', YEAR, MONTH, DAY_ROUTE, 'L.R1_T8CDVD'),
      dsed_lcc: await laclaeDay('DSED.LACLAE', YEAR, MONTH, DAY_ROUTE, 'L.LCCDVD'),
      test_r1: await laclaeDay('JAVIER.TEST_LACLAE', YEAR, MONTH, DAY_ROUTE, 'L.R1_T8CDVD'),
      test_lcc: await laclaeDay('JAVIER.TEST_LACLAE', YEAR, MONTH, DAY_ROUTE, 'L.LCCDVD'),
      lac_dsed_vd: await lacDay('DSEDAC.LAC', YEAR, MONTH, DAY_ROUTE, 'L.CODIGOVENDEDOR'),
      lac_dsed_lcc: await lacDay('DSEDAC.LAC', YEAR, MONTH, DAY_ROUTE, 'L.LCCDVD'),
      lac_test_vd: await lacDay('JAVIER.TEST_LAC', YEAR, MONTH, DAY_ROUTE, 'L.CODIGOVENDEDOR'),
      lac_test_lcc: await lacDay('JAVIER.TEST_LAC', YEAR, MONTH, DAY_ROUTE, 'L.LCCDVD'),
    };

    const jefeToday = {
      dsed: await laclaeDayAll('DSED.LACLAE', YEAR, MONTH, DAY_TODAY),
      test: await laclaeDayAll('JAVIER.TEST_LACLAE', YEAR, MONTH, DAY_TODAY),
    };
    const jefe17 = {
      dsed: await laclaeDayAll('DSED.LACLAE', YEAR, MONTH, DAY_ROUTE),
      test: await laclaeDayAll('JAVIER.TEST_LACLAE', YEAR, MONTH, DAY_ROUTE),
    };

    const maxYmd = {
      dsed_laclae: await maxDate('DSED.LACLAE', 'LCAADC', 'LCMMDC', 'LCDDDC'),
      test_laclae: await maxDate('JAVIER.TEST_LACLAE', 'LCAADC', 'LCMMDC', 'LCDDDC'),
      dsedac_lac: await maxDate('DSEDAC.LAC', 'ANODOCUMENTO', 'MESDOCUMENTO', 'DIADOCUMENTO'),
      test_lac: await maxDate('JAVIER.TEST_LAC', 'ANODOCUMENTO', 'MESDOCUMENTO', 'DIADOCUMENTO'),
    };

    const cause = vd35_17.dsed_r1.sales > 0 && vd35_17.test_r1.sales === 0
      ? 'CONFIRMED_SNAPSHOT_STALE'
      : (vd35_17.dsed_lcc.sales > 0 && vd35_17.test_lcc.sales === 0
        ? 'CONFIRMED_SNAPSHOT_STALE_LCCDVD'
        : 'NEED_REVIEW');

    console.log(JSON.stringify({
      dsedacWrite: false,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      nowIso: new Date().toISOString(),
      catalog,
      vd35_2026_09_17: vd35_17,
      jefe_all_2026_09_18: jefeToday,
      jefe_all_2026_09_17: jefe17,
      maxYmd2026: maxYmd,
      cause,
    }, null, 2));
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(String(error && error.message ? error.message : error).slice(0, 300));
  process.exit(1);
});
