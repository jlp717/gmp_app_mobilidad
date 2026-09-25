// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual backfill bolsa descontada | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Backfill bolsa CONSUMO for confirmed TEST pedidos with DESCUENTO_GLOBAL
 * that never received TEST_MOVIMIENTOS_BOLSA rows.
 *
 * Usage:
 *   REPARTO_TABLE_SET=isolated_test node scripts/_probe-bolsa-backfill-discounted.js
 *   REPARTO_TABLE_SET=isolated_test node scripts/_probe-bolsa-backfill-discounted.js --apply
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.REPARTO_TABLE_SET = process.env.REPARTO_TABLE_SET || 'isolated_test';

const { queryWithParams } = require('../config/db');
const bolsa = require('../services/bolsa-comercial.service');
const { db2AppTable } = require('../utils/db2-schemas');

const APPLY = process.argv.includes('--apply');

async function main() {
  const cabTable = db2AppTable('PEDIDOS_CAB');
  const linTable = db2AppTable('PEDIDOS_LIN');
  const movTable = db2AppTable('MOVIMIENTOS_BOLSA');

  const candidates = await queryWithParams(
    `SELECT C.ID AS PEDIDO_ID,
            TRIM(C.CODIGOVENDEDOR) AS V,
            COALESCE(C.DESCUENTO_GLOBAL, 0) AS DG,
            COALESCE(C.PORCENTAJEDESCUENTO1, 0) AS PD1,
            (SELECT COUNT(*) FROM ${movTable} M WHERE M.PEDIDO_ID = C.ID) AS MOV_N
       FROM ${cabTable} C
      WHERE TRIM(C.ESTADO) = 'CONFIRMADO'
        AND (COALESCE(C.DESCUENTO_GLOBAL, 0) > 0 OR COALESCE(C.PORCENTAJEDESCUENTO1, 0) > 0)
      ORDER BY C.ID`,
    [],
    false,
  );

  const out = { apply: APPLY, movTable, candidates: candidates.length, results: [] };

  for (const row of candidates || []) {
    const pedidoId = Number(row.PEDIDO_ID);
    const movN = Number(row.MOV_N || 0);
    const vendor = String(row.V || '').trim();
    const dg = Math.max(Number(row.DG || 0), Number(row.PD1 || 0));
    const entry = { pedidoId, vendor, dg, movN };

    if (movN > 0) {
      entry.skipped = 'already_has_movements';
      out.results.push(entry);
      continue;
    }

    const lines = await queryWithParams(
      `SELECT ID, TRIM(CODIGOARTICULO) AS CODIGOARTICULO,
              CANTIDADENVASES, CANTIDADUNIDADES, TRIM(UNIDADMEDIDA) AS UNIDADMEDIDA,
              UNIDADESCAJA, PRECIOVENTA, PRECIOTARIFA, PRECIOTARIFACLIENTE, PRECIOMINIMO,
              COALESCE(DESCUENTO_LINEA,0) AS DESCUENTO_LINEA
         FROM ${linTable} WHERE PEDIDO_ID = ?`,
      [pedidoId],
      false,
    );

    const validation = await bolsa.validateOrderWithBolsa(vendor, lines || [], {
      globalDiscountPct: dg,
    });
    entry.consumo = validation.consumo;
    entry.nMovs = (validation.lineMovements || []).length;

    if (!(validation.consumo > 0)) {
      entry.skipped = 'no_consumo';
      out.results.push(entry);
      continue;
    }

    if (!APPLY) {
      entry.skipped = 'dry_run';
      out.results.push(entry);
      continue;
    }

    const consumoMovements = (validation.lineMovements || []).filter((m) => m && m.tipo === 'CONSUMO');
    try {
      entry.consumir = await bolsa.consumirBolsa(
        vendor,
        pedidoId,
        validation.consumo,
        consumoMovements.length ? consumoMovements : undefined,
      );
      const after = await queryWithParams(
        `SELECT COUNT(*) AS N FROM ${movTable} WHERE PEDIDO_ID = ?`,
        [pedidoId],
        false,
      );
      entry.afterMovN = Number(after?.[0]?.N || 0);
    } catch (err) {
      entry.error = String(err && err.message ? err.message : err);
    }
    out.results.push(entry);
  }

  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(JSON.stringify({ fatal: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
