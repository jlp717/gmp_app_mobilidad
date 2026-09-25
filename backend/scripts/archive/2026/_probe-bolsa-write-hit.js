// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe-write | _-scratch gitignored; probe puntual escritura bolsa test | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Live HIT: validate + consumirBolsa for pedido 67 (or synthetic).
 * Writes ONLY to JAVIER.TEST_* when REPARTO_TABLE_SET=isolated_test.
 * Usage: REPARTO_TABLE_SET=isolated_test node scripts/_probe-bolsa-write-hit.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.REPARTO_TABLE_SET = process.env.REPARTO_TABLE_SET || 'isolated_test';

const { queryWithParams } = require('../config/db');
const bolsa = require('../services/bolsa-comercial.service');
const { db2AppTable } = require('../utils/db2-schemas');

async function main() {
  const pedidoId = Number(process.argv[2] || 67);
  const out = {
    tableSet: process.env.REPARTO_TABLE_SET,
    movTable: db2AppTable('MOVIMIENTOS_BOLSA'),
    bolsaTable: db2AppTable('BOLSA_COMERCIAL'),
  };

  const cab = await queryWithParams(
    `SELECT ID, TRIM(ESTADO) ESTADO, TRIM(CODIGOVENDEDOR) V,
            COALESCE(DESCUENTO_GLOBAL,0) DG
       FROM ${db2AppTable('PEDIDOS_CAB')} WHERE ID = ?`,
    [pedidoId],
    false,
  );
  out.cab = cab;

  const lines = await queryWithParams(
    `SELECT ID, TRIM(CODIGOARTICULO) AS CODIGOARTICULO,
            CANTIDADENVASES, CANTIDADUNIDADES, TRIM(UNIDADMEDIDA) AS UNIDADMEDIDA,
            UNIDADESCAJA, PRECIOVENTA, PRECIOTARIFA, PRECIOTARIFACLIENTE, PRECIOMINIMO,
            COALESCE(DESCUENTO_LINEA,0) AS DESCUENTO_LINEA
       FROM ${db2AppTable('PEDIDOS_LIN')} WHERE PEDIDO_ID = ?`,
    [pedidoId],
    false,
  );
  out.lines = lines;

  const before = await queryWithParams(
    `SELECT COUNT(*) AS N FROM ${db2AppTable('MOVIMIENTOS_BOLSA')} WHERE PEDIDO_ID = ?`,
    [pedidoId],
    false,
  );
  out.before = before;

  const vendor = String(cab?.[0]?.V || '05').trim();
  const dg = Number(cab?.[0]?.DG || 0);
  const validation = await bolsa.validateOrderWithBolsa(vendor, lines || [], {
    globalDiscountPct: dg,
  });
  out.validation = {
    valid: validation.valid,
    consumo: validation.consumo,
    acumulacion: validation.acumulacion,
    nMovs: (validation.lineMovements || []).length,
    lineMovements: validation.lineMovements,
  };

  if (!(validation.consumo > 0)) {
    out.skipped = 'no_consumo';
    console.log(JSON.stringify(out, null, 2));
    process.exit(2);
  }

  const consumoMovements = (validation.lineMovements || []).filter((m) => m && m.tipo === 'CONSUMO');
  try {
    out.consumir = await bolsa.consumirBolsa(
      vendor,
      pedidoId,
      validation.consumo,
      consumoMovements.length ? consumoMovements : undefined,
    );
  } catch (err) {
    out.consumirError = {
      message: String(err && err.message ? err.message : err),
      odbc: err && err.odbcErrors ? err.odbcErrors : undefined,
    };
  }

  const after = await queryWithParams(
    `SELECT ID, PEDIDO_ID, TRIM(TIPO) AS TIPO, IMPORTE,
            TRIM(CODIGO_ARTICULO) AS ART, IDEMPOTENCY_KEY,
            PRECIO_VENTA, PRECIO_MINIMO_CONGELADO
       FROM ${db2AppTable('MOVIMIENTOS_BOLSA')}
      WHERE PEDIDO_ID = ?
      ORDER BY ID`,
    [pedidoId],
    false,
  );
  out.after = after;

  const bolsaRow = await queryWithParams(
    `SELECT ID, TRIM(CODIGOVENDEDOR) AS V, EJERCICIO, MES,
            SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO
       FROM ${db2AppTable('BOLSA_COMERCIAL')}
      WHERE TRIM(CODIGOVENDEDOR) = ?
      ORDER BY EJERCICIO DESC, MES DESC
      FETCH FIRST 3 ROWS ONLY`,
    [vendor],
    false,
  );
  out.bolsa = bolsaRow;

  console.log(JSON.stringify(out, null, 2));
  process.exit(out.consumirError ? 1 : ((after && after.length) ? 0 : 3));
}

main().catch((err) => {
  console.error(JSON.stringify({ fatal: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
