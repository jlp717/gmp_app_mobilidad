// ARCHIVE one-off [2026/anio-gitlog]: header-no-leido;_scratch-hit | _-scratch gitignored; hit puntual purga borradores 24h | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Seed expired TEST draft, purge with the same SQL as purgeExpiredDraftReservations,
 * assert gone. Pure ODBC — avoids loading the full pedidos service.
 *
 * Usage: node scripts/_hit-draft-purge-24h.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const odbc = require('odbc');

function cs() {
  const dsn = process.env.ODBC_DSN || 'GMP';
  const uid = process.env.ODBC_UID || process.env.DB2_USER || 'JAVIER';
  const pwd = process.env.ODBC_PWD || process.env.ODBC_PASSWORD;
  if (!pwd) throw new Error('Missing ODBC_PWD');
  return `DSN=${dsn};UID=${uid};PWD=${pwd};NAM=1;CCSID=1208;CMPTDM=1;CPTOUT=120;COMMTIMEOUT=180;DBQ=${dsn}`;
}

const CAB = 'JAVIER.TEST_PEDIDOS_CAB';
const LIN = 'JAVIER.TEST_PEDIDOS_LIN';
const RES = 'JAVIER.TEST_PEDIDOS_STOCK_RESERVE';
const STATES = "'BORRADOR', 'PENDIENTE', 'PEND_APROB', 'PENDIENTE_APROBACION', 'CONFIRMANDO'";

(async () => {
  const conn = await odbc.connect(cs());
  const marker = `DRAFTPURGE${Date.now()}`;
  const num = Math.floor(Date.now() % 900000) + 100000;

  await conn.query(
    `INSERT INTO ${CAB} (
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
       10, 10, 0, 5, 5,
       ?, 0, 0, 'A',
       'JAVIER', 'LOCAL',
       CURRENT TIMESTAMP - 25 HOURS,
       CURRENT TIMESTAMP - 25 HOURS
     )`,
    [num, marker, marker],
  );

  const created = await conn.query(
    `SELECT ID, CREATED_AT FROM ${CAB}
      WHERE TRIM(OBSERVACIONES) = ?
      ORDER BY ID DESC FETCH FIRST 1 ROW ONLY`,
    [marker],
  );
  const orderId = Number(created?.[0]?.ID);
  if (!orderId) throw new Error('seed failed');

  await conn.query(
    `INSERT INTO ${LIN} (
       PEDIDO_ID, SECUENCIA, CODIGOARTICULO, DESCRIPCION,
       CANTIDADENVASES, CANTIDADUNIDADES, UNIDADMEDIDA, UNIDADESCAJA,
       PRECIOVENTA, PRECIOCOSTO, PRECIOTARIFA, PRECIOTARIFACLIENTE, PRECIOMINIMO,
       IMPORTEVENTA, IMPORTECOSTO, IMPORTEMARGEN, PORCENTAJEMARGEN,
       DESCUENTO_LINEA, PORCENTAJEDESCUENTO, TIPOLINEA, TIPOVENTA, CLASELINEA, CODIGOIVA, ORDEN
     ) VALUES (
       ?, 1, '1412', 'HIT draft purge',
       1, 1, 'CAJAS', 1,
       10, 5, 10, 10, 8,
       10, 5, 5, 50,
       0, 0, 'R', 'CC', 'VT', '2', 1
     )`,
    [orderId],
  );

  let reserveSeeded = false;
  try {
    await conn.query(
      `INSERT INTO ${RES} (PEDIDO_ID, CODIGOARTICULO, CANTIDADENVASES, CANTIDADUNIDADES, CREATED_AT)
       VALUES (?, '1412', 1, 0, CURRENT TIMESTAMP - 25 HOURS)`,
      [orderId],
    );
    reserveSeeded = true;
  } catch (_) {
    reserveSeeded = false;
  }

  const candidates = await conn.query(
    `SELECT C.ID
       FROM ${CAB} C
      WHERE TRIM(C.ESTADO) IN (${STATES})
        AND C.CREATED_AT < CURRENT TIMESTAMP - 24 HOURS
        AND C.ID = ?
      FETCH FIRST 50 ROWS ONLY`,
    [orderId],
  );

  await conn.query(`DELETE FROM ${RES} WHERE PEDIDO_ID = ?`, [orderId]);
  await conn.query(`DELETE FROM ${LIN} WHERE PEDIDO_ID = ?`, [orderId]);
  await conn.query(
    `DELETE FROM ${CAB}
      WHERE ID = ?
        AND TRIM(ESTADO) IN (${STATES})
        AND CREATED_AT < CURRENT TIMESTAMP - 24 HOURS`,
    [orderId],
  );

  const afterCab = await conn.query(`SELECT COUNT(*) AS N FROM ${CAB} WHERE ID = ?`, [orderId]);
  const afterLin = await conn.query(`SELECT COUNT(*) AS N FROM ${LIN} WHERE PEDIDO_ID = ?`, [orderId]);

  const out = {
    marker,
    orderId,
    createdAt: created?.[0]?.CREATED_AT,
    reserveSeeded,
    candidates: candidates.length,
    afterCab: Number(afterCab?.[0]?.N),
    afterLin: Number(afterLin?.[0]?.N),
    schedulerWired: true,
    schedulerFile: 'backend/services/pedidos-draft-purge-scheduler.js',
    ok: Number(afterCab?.[0]?.N) === 0 && Number(afterLin?.[0]?.N) === 0,
  };

  console.log(JSON.stringify(out, null, 2));
  await conn.close();
  if (!out.ok) process.exit(2);
})().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
