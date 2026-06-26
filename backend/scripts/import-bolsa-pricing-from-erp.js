'use strict';

/**
 * Importador controlado para overlay de precios de bolsa en JAVIER.
 *
 * Por defecto no escribe nada. Para aplicar:
 *   CONFIRM_BOLSA_PRICING_IMPORT=YES node backend/scripts/import-bolsa-pricing-from-erp.js --apply
 *
 * Fuentes:
 * - DSEDAC.ARA tarifa 2: minimo base actual.
 * - DSEDAC.LAC ultimo PRECIOCOSTO: coste de fabricacion/compra observado.
 *
 * Los precios especiales/promociones de cliente NO se importan aqui:
 * se leen en runtime desde tablas ERP DSEDAC.PES/PPU.
 */

const { initDb, queryWithParams, closePool } = require('../config/db');

const APPLY = process.argv.includes('--apply');
const LIMIT_ARG = process.argv.find(arg => arg.startsWith('--limit='));
const LIMIT = Math.max(1, Math.min(10000, Number.parseInt(LIMIT_ARG?.split('=')[1] || '1000', 10) || 1000));
const DEFAULT_MARGIN = Number.parseFloat(process.env.BOLSA_DEFAULT_MARGIN_PCT || '20') || 20;
const CONFIRMED = process.env.CONFIRM_BOLSA_PRICING_IMPORT === 'YES';

function usageGuard() {
  if (APPLY && !CONFIRMED) {
    throw new Error('DML bloqueado: usa CONFIRM_BOLSA_PRICING_IMPORT=YES junto con --apply');
  }
}

function round4(value) {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 10000) / 10000;
}

async function loadProductPricingCandidates() {
  const sql = `
    SELECT
      TRIM(A.CODIGOARTICULO) AS CODIGOARTICULO,
      COALESCE(T2.PRECIOTARIFA, 0) AS PRECIO_MINIMO,
      COALESCE(LC.PRECIOCOSTO, 0) AS COSTE_FABRICACION
    FROM DSEDAC.ART A
    LEFT JOIN DSEDAC.ARA T2
      ON A.CODIGOARTICULO = T2.CODIGOARTICULO
     AND T2.CODIGOTARIFA = 2
    LEFT JOIN (
      SELECT TRIM(CODIGOARTICULO) AS CODIGOARTICULO,
             PRECIOCOSTO,
             ROW_NUMBER() OVER (
               PARTITION BY TRIM(CODIGOARTICULO)
               ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
             ) AS RN
      FROM DSEDAC.LAC
      WHERE PRECIOCOSTO > 0
    ) LC ON TRIM(A.CODIGOARTICULO) = LC.CODIGOARTICULO AND LC.RN = 1
    WHERE COALESCE(A.ANOBAJA, 0) = 0
      AND (COALESCE(T2.PRECIOTARIFA, 0) > 0 OR COALESCE(LC.PRECIOCOSTO, 0) > 0)
    ORDER BY A.CODIGOARTICULO
    FETCH FIRST ${LIMIT} ROWS ONLY`;

  return queryWithParams(sql, [], false);
}

async function countImportedToday() {
  const rows = await queryWithParams(
    `SELECT COUNT(*) AS TOTAL
       FROM JAVIER.BOLSA_PRODUCTO_PRECIO
      WHERE FECHA_DESDE = CURRENT DATE
        AND SOURCE = 'ERP_IMPORT'`,
    [],
    false,
    false
  );
  return Number.parseInt(rows?.[0]?.TOTAL ?? rows?.[0]?.total ?? '0', 10) || 0;
}

async function syncIdentityNextValue() {
  const rows = await queryWithParams(
    `SELECT COALESCE(MAX(ID), 0) + 1 AS NEXT_ID
       FROM JAVIER.BOLSA_PRODUCTO_PRECIO`,
    [],
    false,
    true
  );
  const nextId = Math.max(1, Number.parseInt(rows?.[0]?.NEXT_ID ?? rows?.[0]?.next_id ?? '1', 10) || 1);
  await queryWithParams(
    `ALTER TABLE JAVIER.BOLSA_PRODUCTO_PRECIO ALTER COLUMN ID RESTART WITH ${nextId}`,
    [],
    false,
    true
  );
  return nextId;
}

async function upsertProductPricing() {
  const margin = round4(DEFAULT_MARGIN);
  const nextIdentity = await syncIdentityNextValue();
  const before = await countImportedToday();
  const insertSql = `
    INSERT INTO JAVIER.BOLSA_PRODUCTO_PRECIO (
      CODIGOARTICULO, UNIDAD_BASE, FECHA_DESDE, COSTE_FABRICACION,
      MARGEN_OBJETIVO_PCT, PRECIO_MINIMO, ACTIVO, SOURCE, OBSERVACIONES
    )
    SELECT
      CAST(TRIM(S.CODIGOARTICULO) AS CHAR(10)),
      'CAJAS',
      CURRENT DATE,
      S.COSTE_FABRICACION,
      ${margin},
      S.PRECIO_MINIMO,
      'S',
      'ERP_IMPORT',
      'Importado desde DSEDAC.ARA/LAC'
    FROM (
      SELECT
        TRIM(A.CODIGOARTICULO) AS CODIGOARTICULO,
        COALESCE(T2.PRECIOTARIFA, 0) AS PRECIO_MINIMO,
        COALESCE(LC.PRECIOCOSTO, 0) AS COSTE_FABRICACION
      FROM DSEDAC.ART A
      LEFT JOIN DSEDAC.ARA T2
        ON A.CODIGOARTICULO = T2.CODIGOARTICULO
       AND T2.CODIGOTARIFA = 2
      LEFT JOIN (
        SELECT TRIM(CODIGOARTICULO) AS CODIGOARTICULO,
               PRECIOCOSTO,
               ROW_NUMBER() OVER (
                 PARTITION BY TRIM(CODIGOARTICULO)
                 ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
               ) AS RN
        FROM DSEDAC.LAC
        WHERE PRECIOCOSTO > 0
      ) LC ON TRIM(A.CODIGOARTICULO) = LC.CODIGOARTICULO AND LC.RN = 1
      WHERE COALESCE(A.ANOBAJA, 0) = 0
        AND (COALESCE(T2.PRECIOTARIFA, 0) > 0 OR COALESCE(LC.PRECIOCOSTO, 0) > 0)
    ) S
    WHERE NOT EXISTS (
      SELECT 1
      FROM JAVIER.BOLSA_PRODUCTO_PRECIO B
      WHERE TRIM(B.CODIGOARTICULO) = TRIM(S.CODIGOARTICULO)
        AND B.UNIDAD_BASE = 'CAJAS'
        AND B.FECHA_DESDE = CURRENT DATE
    )`;

  await queryWithParams(insertSql, [], false, true);
  const after = await countImportedToday();
  return { rowsWritten: Math.max(0, after - before), nextIdentity };
}

async function main() {
  usageGuard();
  await initDb();

  const productRows = await loadProductPricingCandidates();
  const sample = productRows.slice(0, 5).map(row => ({
    codigoArticulo: String(row.CODIGOARTICULO || '').trim(),
    precioMinimo: round4(row.PRECIO_MINIMO),
    costeFabricacion: round4(row.COSTE_FABRICACION),
    margenObjetivoPct: DEFAULT_MARGIN,
  }));

  const result = {
    mode: APPLY ? 'apply' : 'dry-run',
    productCandidates: productRows.length,
    productSample: sample,
    productRowsWritten: 0,
  };

  if (APPLY) {
    const writeResult = await upsertProductPricing();
    result.productRowsWritten = writeResult.rowsWritten;
    result.identityRestartedWith = writeResult.nextIdentity;
  }

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(`[import-bolsa-pricing] ERROR ${error.message}`);
    if (error.odbcErrors) {
      console.error(JSON.stringify(error.odbcErrors.map(err => ({
        state: err.state,
        code: err.code,
        message: err.message,
      })), null, 2));
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closePool();
    } catch (_) {
      // ignore close errors
    }
  });
