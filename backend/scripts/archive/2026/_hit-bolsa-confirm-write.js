// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-hit-write | _-scratch gitignored; hit puntual escritura confirma bolsa test | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Live HIT: create BORRADOR with DESCUENTO_GLOBAL=10 at tariff prices,
 * confirmOrder through service, assert TEST_MOVIMIENTOS_BOLSA rows.
 *
 * Usage: REPARTO_TABLE_SET=isolated_test node scripts/_hit-bolsa-confirm-write.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.REPARTO_TABLE_SET = process.env.REPARTO_TABLE_SET || 'isolated_test';
process.env.PEDIDOS_EXPORT_TO_SYSTEM = 'false';
process.env.PEDIDOS_DSEDAC_EXPORT_APPROVED = 'false';

const { queryWithParams } = require('../config/db');
const { db2AppTable } = require('../utils/db2-schemas');
const pedidos = require('../services/pedidos.service');

async function main() {
  const cab = db2AppTable('PEDIDOS_CAB');
  const lin = db2AppTable('PEDIDOS_LIN');
  const mov = db2AppTable('MOVIMIENTOS_BOLSA');
  const marker = `BOLSAHIT${Date.now()}`;

  const beforeTotal = await queryWithParams(`SELECT COUNT(*) AS N FROM ${mov}`, [], false);

  // Minimal draft header (LOCAL only — no ERP export).
  await queryWithParams(
    `INSERT INTO ${cab} (
       EJERCICIO, NUMEROPEDIDO, SERIEPEDIDO, TERMINAL,
       DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, HORADOCUMENTO,
       CODIGOCLIENTE, NOMBRECLIENTE, CODIGOVENDEDOR, CODIGOFORMAPAGO,
       CODIGOTARIFA, CODIGOALMACEN, TIPOVENTA, ESTADO,
       IMPORTETOTAL, IMPORTEBASE, IMPORTEIVA, IMPORTECOSTO, IMPORTEMARGEN,
       OBSERVACIONES, DESCUENTO_GLOBAL, PORCENTAJEDESCUENTO1, ORIGEN,
       TARGET_SCHEMA, SYNC_STATUS, CREATED_AT, UPDATED_AT
     ) VALUES (
       2026, ?, 'T', 99,
       DAY(CURRENT DATE), MONTH(CURRENT DATE), YEAR(CURRENT DATE), 120000,
       'HITCLI', ?, '05', '01',
       1, 1, 'CC', 'BORRADOR',
       19.186, 19.186, 0, 10, 9.186,
       ?, 10, 10, 'A',
       'JAVIER', 'LOCAL', CURRENT TIMESTAMP, CURRENT TIMESTAMP
     )`,
    [Math.floor(Date.now() % 900000) + 100000, marker, marker],
    false,
  );

  const created = await queryWithParams(
    `SELECT ID FROM ${cab} WHERE TRIM(OBSERVACIONES) = ? ORDER BY ID DESC FETCH FIRST 1 ROW ONLY`,
    [marker],
    false,
  );
  const orderId = Number(created?.[0]?.ID);
  if (!orderId) throw new Error('draft insert failed');

  await queryWithParams(
    `INSERT INTO ${lin} (
       PEDIDO_ID, SECUENCIA, CODIGOARTICULO, DESCRIPCION,
       CANTIDADENVASES, CANTIDADUNIDADES, UNIDADMEDIDA, UNIDADESCAJA,
       PRECIOVENTA, PRECIOCOSTO, PRECIOTARIFA, PRECIOTARIFACLIENTE, PRECIOMINIMO,
       IMPORTEVENTA, IMPORTECOSTO, IMPORTEMARGEN, PORCENTAJEMARGEN,
       DESCUENTO_LINEA, PORCENTAJEDESCUENTO, TIPOLINEA, TIPOVENTA, CLASELINEA, CODIGOIVA, ORDEN
     ) VALUES (
       ?, 1, '1412', 'HIT bolsa dto',
       2, 2, 'CAJAS', 1,
       9.593, 5, 9.593, 9.593, 8.51,
       19.186, 10, 9.186, 47.8,
       0, 0, 'R', 'CC', 'VT', '2', 1
     )`,
    [orderId],
    false,
  );

  const out = { marker, orderId, movTable: mov, beforeTotal: beforeTotal?.[0]?.N };

  try {
    const result = await pedidos.confirmOrder(orderId, 'CC', {
      deliveryDate: undefined,
      userId: 'BOLSA_HIT',
      forceConfirm: true,
      forceConfirmReason: 'bolsa-confirm-write-hit',
      adminOverride: true,
      cobroPropio: true,
    });
    out.confirm = {
      blocked: result && result.blocked,
      reason: result && result.reason,
      estado: result && result.header && result.header.estado,
      id: result && result.header && result.header.id,
    };
  } catch (err) {
    out.confirmError = {
      message: String(err && err.message ? err.message : err),
      code: err && err.code,
    };
  }

  const movRows = await queryWithParams(
    `SELECT ID, PEDIDO_ID, TRIM(TIPO) AS TIPO, IMPORTE, TRIM(CODIGO_ARTICULO) AS ART
       FROM ${mov} WHERE PEDIDO_ID = ? ORDER BY ID`,
    [orderId],
    false,
  );
  out.movements = movRows;
  out.cab = await queryWithParams(
    `SELECT ID, TRIM(ESTADO) ESTADO, COALESCE(DESCUENTO_GLOBAL,0) DG FROM ${cab} WHERE ID = ?`,
    [orderId],
    false,
  );

  console.log(JSON.stringify(out, null, 2));
  const ok = Array.isArray(movRows) && movRows.length > 0
    && String(out.cab?.[0]?.ESTADO || '').trim() === 'CONFIRMADO';
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(JSON.stringify({ fatal: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
