'use strict';

/**
 * Read-only: find REAL PMR/PMRC/CPES promotions + owning vendor.
 * Never prints PIN/secrets. SQL bound.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, queryWithParams } = require('../config/db');

function col(row, name) {
  const wanted = String(name).toUpperCase();
  for (const [key, value] of Object.entries(row || {})) {
    if (String(key).toUpperCase() === wanted) return value;
  }
  return undefined;
}

function trim(value) {
  return String(value == null ? '' : value).trim();
}

async function safe(sql, params = []) {
  try {
    return { ok: true, rows: await queryWithParams(sql, params) };
  } catch (error) {
    return { ok: false, error: String(error.message || error).slice(0, 220), rows: [] };
  }
}

async function cols(schema, table) {
  const result = await safe(
    `SELECT TRIM(COLUMN_NAME) AS COLUMN_NAME
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
  return result.ok
    ? (result.rows || []).map((row) => trim(col(row, 'COLUMN_NAME')))
    : [`ERR:${result.error}`];
}

async function main() {
  await initDb();
  const now = new Date();
  const today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  const report = { today, tables: {} };
  try {
    for (const [schema, table] of [
      ['DSEDAC', 'PMR'], ['DSEDAC', 'PMRC'], ['DSEDAC', 'PMP'],
      ['DSEDAC', 'CPES'], ['DSEDAC', 'PRD'], ['DSEDAC', 'CLX'],
      ['DSEDAC', 'VDDX'], ['DSEDAC', 'R1'], ['DSEDAC', 'T8CDVD'],
    ]) {
      const names = await cols(schema, table);
      report.tables[`${schema}.${table}`] = names.slice(0, 80);
    }

    const pmrYears = await safe(
      `SELECT ANOINICIO, ANOFIN, COUNT(*) AS N
         FROM DSEDAC.PMR
        GROUP BY ANOINICIO, ANOFIN
        ORDER BY N DESC
        FETCH FIRST 20 ROWS ONLY`,
    );
    report.pmrYearBuckets = pmrYears.ok
      ? (pmrYears.rows || []).map((row) => ({
        from: col(row, 'ANOINICIO'),
        to: col(row, 'ANOFIN'),
        n: Number(col(row, 'N') || 0),
      }))
      : { error: pmrYears.error };

    const pmrActive = await safe(
      `SELECT TRIM(P.CODIGOCLIENTE) AS CLIENTE,
              TRIM(P.CODIGOPROMOCIONREGALO) AS PROMO,
              TRIM(P.NOMBREPROMOCIONREGALO) AS NOMBRE,
              P.DIAINICIO, P.MESINICIO, P.ANOINICIO,
              P.DIAFIN, P.MESFIN, P.ANOFIN
         FROM DSEDAC.PMR P
        WHERE TRIM(COALESCE(P.CODIGOCLIENTE, '')) <> ''
          AND (P.ANOINICIO = 0 OR (P.ANOINICIO * 10000 + P.MESINICIO * 100 + P.DIAINICIO) <= ?)
          AND (P.ANOFIN = 0 OR (P.ANOFIN * 10000 + P.MESFIN * 100 + P.DIAFIN) >= ?)
        FETCH FIRST 12 ROWS ONLY`,
      [today, today],
    );
    report.pmrActiveDirect = pmrActive.ok
      ? (pmrActive.rows || []).map((row) => ({
        cliente: trim(col(row, 'CLIENTE')),
        promo: trim(col(row, 'PROMO')),
        nombre: trim(col(row, 'NOMBRE')).slice(0, 60),
        from: `${col(row, 'DIAINICIO')}/${col(row, 'MESINICIO')}/${col(row, 'ANOINICIO')}`,
        to: `${col(row, 'DIAFIN')}/${col(row, 'MESFIN')}/${col(row, 'ANOFIN')}`,
      }))
      : { error: pmrActive.error };

    const pmrAny = await safe(
      `SELECT TRIM(P.CODIGOCLIENTE) AS CLIENTE,
              TRIM(P.CODIGOPROMOCIONREGALO) AS PROMO,
              P.ANOINICIO, P.ANOFIN, P.MESINICIO, P.MESFIN, P.DIAINICIO, P.DIAFIN
         FROM DSEDAC.PMR P
        WHERE TRIM(COALESCE(P.CODIGOCLIENTE, '')) <> ''
        ORDER BY P.ANOFIN DESC
        FETCH FIRST 8 ROWS ONLY`,
    );
    report.pmrAnyDirect = pmrAny.ok
      ? (pmrAny.rows || []).map((row) => ({
        cliente: trim(col(row, 'CLIENTE')),
        promo: trim(col(row, 'PROMO')),
        from: `${col(row, 'DIAINICIO')}/${col(row, 'MESINICIO')}/${col(row, 'ANOINICIO')}`,
        to: `${col(row, 'DIAFIN')}/${col(row, 'MESFIN')}/${col(row, 'ANOFIN')}`,
      }))
      : { error: pmrAny.error };

    const emptyClient = await safe(
      `SELECT COUNT(*) AS N FROM DSEDAC.PMR
        WHERE TRIM(COALESCE(CODIGOCLIENTE, '')) = ''`,
    );
    report.pmrEmptyClient = emptyClient.ok ? Number(col(emptyClient.rows?.[0], 'N') || 0) : emptyClient.error;

    const pmrc = await safe(
      `SELECT TRIM(C.CODIGOCLIENTE) AS CLIENTE,
              TRIM(C.CODIGOPROMOCIONREGALO) AS PROMO,
              TRIM(P.NOMBREPROMOCIONREGALO) AS NOMBRE,
              P.ANOINICIO, P.ANOFIN, P.MESINICIO, P.MESFIN, P.DIAINICIO, P.DIAFIN
         FROM DSEDAC.PMRC C
         JOIN DSEDAC.PMR P
           ON TRIM(P.CODIGOPROMOCIONREGALO) = TRIM(C.CODIGOPROMOCIONREGALO)
        WHERE (P.ANOINICIO = 0 OR (P.ANOINICIO * 10000 + P.MESINICIO * 100 + P.DIAINICIO) <= ?)
          AND (P.ANOFIN = 0 OR (P.ANOFIN * 10000 + P.MESFIN * 100 + P.DIAFIN) >= ?)
        FETCH FIRST 12 ROWS ONLY`,
      [today, today],
    );
    report.pmrcActive = pmrc.ok
      ? (pmrc.rows || []).map((row) => ({
        cliente: trim(col(row, 'CLIENTE')),
        promo: trim(col(row, 'PROMO')),
        nombre: trim(col(row, 'NOMBRE')).slice(0, 60),
        from: `${col(row, 'DIAINICIO')}/${col(row, 'MESINICIO')}/${col(row, 'ANOINICIO')}`,
        to: `${col(row, 'DIAFIN')}/${col(row, 'MESFIN')}/${col(row, 'ANOFIN')}`,
      }))
      : { error: pmrc.error };

    const cpesActive = await safe(
      `SELECT TRIM(C.CODIGOCLIENTE) AS CLIENTE,
              TRIM(C.CODIGOARTICULO) AS ART,
              C.PRECIO, C.ANOINICIO, C.ANOFINAL
         FROM DSEDAC.CPES C
        WHERE TRIM(COALESCE(C.CODIGOARTICULO, '')) <> ''
          AND (C.ANOINICIO = 0 OR (C.ANOINICIO * 10000 + C.MESINICIO * 100 + C.DIAINICIO) <= ?)
          AND (C.ANOFINAL = 0 OR (C.ANOFINAL * 10000 + C.MESFINAL * 100 + C.DIAFINAL) >= ?)
        FETCH FIRST 8 ROWS ONLY`,
      [today, today],
    );
    report.cpesActive = cpesActive.ok
      ? (cpesActive.rows || []).map((row) => ({
        cliente: trim(col(row, 'CLIENTE')),
        art: trim(col(row, 'ART')),
        precio: col(row, 'PRECIO'),
        fromY: col(row, 'ANOINICIO'),
        toY: col(row, 'ANOFINAL'),
      }))
      : { error: cpesActive.error };

    const cpesAny = await safe(
      `SELECT COUNT(*) AS N, MIN(ANOINICIO) AS MINY, MAX(ANOFINAL) AS MAXY FROM DSEDAC.CPES`,
    );
    report.cpesCounts = cpesAny.ok
      ? {
        n: Number(col(cpesAny.rows?.[0], 'N') || 0),
        minY: col(cpesAny.rows?.[0], 'MINY'),
        maxY: col(cpesAny.rows?.[0], 'MAXY'),
      }
      : { error: cpesAny.error };

    const clients = [
      ...new Set([
        ...(report.pmrActiveDirect || []).map((item) => item.cliente),
        ...(report.pmrcActive || []).map((item) => item.cliente),
        ...(report.cpesActive || []).map((item) => item.cliente),
        ...(report.pmrAnyDirect || []).map((item) => item.cliente),
      ].filter(Boolean)),
    ].slice(0, 12);

    report.clientVendors = [];
    for (const client of clients) {
      const clx = await safe(
        `SELECT TRIM(CODIGOCLIENTE) AS CLIENTE,
                TRIM(CODIGOVENDEDOR) AS VENDEDOR,
                TRIM(COALESCE(COBRORIGUROSOSN, '')) AS RIG,
                COALESCE(PORCENTAJECOBRORIGUROSO, 0) AS PCT
           FROM DSEDAC.CLX
          WHERE TRIM(CODIGOCLIENTE) = CAST(? AS VARCHAR(12))
          FETCH FIRST 1 ROW ONLY`,
        [client],
      );
      if (!clx.ok) {
        report.clientVendors.push({ cliente: client, error: clx.error });
        continue;
      }
      const row = clx.rows?.[0];
      report.clientVendors.push({
        cliente: client,
        vendedor: trim(col(row, 'VENDEDOR')),
        cobroRiguroso: trim(col(row, 'RIG')),
        pct: Number(col(row, 'PCT') || 0),
      });
    }

    const vddx = await safe(
      `SELECT TRIM(CODIGOVENDEDOR) AS VENDEDOR,
              COALESCE(PORCENTAJEMINIMOCOBRO, 0) AS PCT
         FROM DSEDAC.VDDX
        WHERE COALESCE(PORCENTAJEMINIMOCOBRO, 0) > 0
        FETCH FIRST 8 ROWS ONLY`,
    );
    report.vddxMinCobro = vddx.ok
      ? (vddx.rows || []).map((row) => ({
        vendedor: trim(col(row, 'VENDEDOR')),
        pct: Number(col(row, 'PCT') || 0),
      }))
      : { error: vddx.error };

    const clxRig = await safe(
      `SELECT TRIM(CODIGOCLIENTE) AS CLIENTE,
              TRIM(CODIGOVENDEDOR) AS VENDEDOR,
              COALESCE(PORCENTAJECOBRORIGUROSO, 0) AS PCT
         FROM DSEDAC.CLX
        WHERE UPPER(TRIM(COBRORIGUROSOSN)) = CAST(? AS VARCHAR(1))
          AND COALESCE(PORCENTAJECOBRORIGUROSO, 0) > 0
        FETCH FIRST 6 ROWS ONLY`,
      ['S'],
    );
    report.clxRiguroso = clxRig.ok
      ? (clxRig.rows || []).map((row) => ({
        cliente: trim(col(row, 'CLIENTE')),
        vendedor: trim(col(row, 'VENDEDOR')),
        pct: Number(col(row, 'PCT') || 0),
      }))
      : { error: clxRig.error };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error('FATAL', error.message);
  process.exit(1);
});
