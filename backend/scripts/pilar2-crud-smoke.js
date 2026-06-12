'use strict';

/**
 * PILAR 2 SQL-level CRUD smoke test on JAVIER (2026-06-11)
 * ========================================================
 * Single-connection lifecycle test against JAVIER.PEDIDOS_CAB / PEDIDOS_LIN
 * mirroring the app's own insert column-set (buildLegacyPedidoCabInsert in
 * services/pedidos.service.js). Improbable keys so it can never collide with
 * real data:
 *   CODIGOCLIENTE = 'ZZTEST9999', NUMEROPEDIDO = 999999, CODIGOVENDEDOR = 'ZZ'
 *
 * Steps: INSERT cab -> SELECT field-by-field -> INSERT 2 lines -> SELECT ->
 * UPDATE field -> verify -> UPDATE estado -> verify -> negative test
 * (estado 20 chars vs VARCHAR(12)) -> DELETE lines+cab -> verify zero residue.
 *
 * GUARANTEE: cleanup runs in finally even on failure. Writes ONLY to JAVIER.
 * Evidence: backend/tmp/db-exploration/pilar2-crud-smoke-2026-06-11.json
 */

const fs = require('fs/promises');
const path = require('path');
const odbc = require('odbc');

const OUTPUT = path.resolve(__dirname, '..', 'tmp', 'db-exploration', 'pilar2-crud-smoke-2026-06-11.json');

const TEST_CLIENT = 'ZZTEST9999';
const TEST_VENDOR = 'ZZ';
const TEST_NUMERO = 999999;
const TEST_EJERCICIO = 2026;
const TEST_ART = 'ZZTESTART1';
const TEST_OBS = 'PILAR2 SMOKE 2026-06-11 DELETE ME';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function requireDb2Secret() {
  const value = process.env.ODBC_PWD ?? process.env.ODBC_PASSWORD;
  if (!value) throw new Error('Missing required environment variable ODBC_PWD or ODBC_PASSWORD');
  return value;
}

function connectionString() {
  const dsn = requireEnv('ODBC_DSN');
  const uid = requireEnv('ODBC_UID');
  const pwd = requireDb2Secret();
  return [
    `DSN=${dsn}`, `UID=${uid}`, `PWD=${pwd}`,
    'NAM=1', 'CCSID=1208', 'CMPTDM=1', 'CPTOUT=60', 'COMMTIMEOUT=90', `DBQ=${dsn}`,
  ].join(';');
}

const steps = [];
function record(step, sql, params, result) {
  const entry = { step, sql: String(sql).replace(/\s+/g, ' ').trim(), params: params || [], result };
  steps.push(entry);
  console.log(`[smoke] ${step}: ${JSON.stringify(result).substring(0, 220)}`);
}

async function run(conn, step, sql, params) {
  const rows = params ? await conn.query(sql, params) : await conn.query(sql);
  const plain = Array.from(rows).map(r => {
    const out = {};
    for (const k of Object.keys(r)) out[k] = typeof r[k] === 'string' ? r[k].trimEnd() : r[k];
    return out;
  });
  record(step, sql, params, plain.length > 8 ? plain.slice(0, 8) : plain);
  return plain;
}

async function cleanup(conn) {
  // Hard cleanup by improbable keys (idempotent, JAVIER only).
  const delLin = `DELETE FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID IN (SELECT ID FROM JAVIER.PEDIDOS_CAB WHERE TRIM(CODIGOCLIENTE) = ?)`;
  const delCab = `DELETE FROM JAVIER.PEDIDOS_CAB WHERE TRIM(CODIGOCLIENTE) = ?`;
  await conn.query(delLin, [TEST_CLIENT]);
  await conn.query(delCab, [TEST_CLIENT]);
  record('CLEANUP', `${delLin}; ${delCab}`, [TEST_CLIENT], 'executed');
}

async function main() {
  const conn = await odbc.connect(connectionString());
  let failed = null;
  try {
    // Pre-clean any residue from earlier aborted runs.
    await cleanup(conn);

    // 0. Baseline counts.
    await run(conn, 'BASELINE_COUNTS', `
      SELECT (SELECT COUNT(*) FROM JAVIER.PEDIDOS_CAB) AS CAB,
             (SELECT COUNT(*) FROM JAVIER.PEDIDOS_LIN) AS LIN
      FROM SYSIBM.SYSDUMMY1`);

    // 1. INSERT cabecera (column-set identico a buildLegacyPedidoCabInsert + DESCUENTO_GLOBAL/ORIGEN).
    const hora = 230000 + new Date().getSeconds();
    await run(conn, 'INSERT_CAB', `
      INSERT INTO JAVIER.PEDIDOS_CAB (
        EJERCICIO, NUMEROPEDIDO, DIADOCUMENTO, MESDOCUMENTO,
        ANODOCUMENTO, HORADOCUMENTO, CODIGOCLIENTE, NOMBRECLIENTE,
        CODIGOVENDEDOR, CODIGOFORMAPAGO, CODIGOTARIFA, CODIGOALMACEN,
        TIPOVENTA, OBSERVACIONES, DESCUENTO_GLOBAL, ORIGEN
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [TEST_EJERCICIO, TEST_NUMERO, 11, 6, 2026, hora, TEST_CLIENT,
        'PILAR2 AUDIT SMOKE TEST', TEST_VENDOR, '02', 1, 1, 'CC', TEST_OBS, 0, 'A']);

    // 2. SELECT campo a campo de lo insertado (incluye defaults ESTADO/CREATED_AT).
    const cab = await run(conn, 'VERIFY_CAB_INSERT', `
      SELECT ID, EJERCICIO, NUMEROPEDIDO, DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO,
             HORADOCUMENTO, TRIM(CODIGOCLIENTE) AS CODIGOCLIENTE, TRIM(NOMBRECLIENTE) AS NOMBRECLIENTE,
             TRIM(CODIGOVENDEDOR) AS CODIGOVENDEDOR, TRIM(CODIGOFORMAPAGO) AS CODIGOFORMAPAGO,
             CODIGOTARIFA, CODIGOALMACEN, TRIM(TIPOVENTA) AS TIPOVENTA,
             TRIM(OBSERVACIONES) AS OBSERVACIONES, DESCUENTO_GLOBAL, TRIM(ORIGEN) AS ORIGEN,
             TRIM(ESTADO) AS ESTADO, IMPORTETOTAL, CREATED_AT, UPDATED_AT
      FROM JAVIER.PEDIDOS_CAB WHERE TRIM(CODIGOCLIENTE) = ? AND NUMEROPEDIDO = ?`,
      [TEST_CLIENT, TEST_NUMERO]);
    if (cab.length !== 1) throw new Error(`VERIFY_CAB_INSERT expected 1 row, got ${cab.length}`);
    const expectCab = {
      EJERCICIO: TEST_EJERCICIO, NUMEROPEDIDO: TEST_NUMERO, DIADOCUMENTO: 11, MESDOCUMENTO: 6,
      ANODOCUMENTO: 2026, CODIGOCLIENTE: TEST_CLIENT, NOMBRECLIENTE: 'PILAR2 AUDIT SMOKE TEST',
      CODIGOVENDEDOR: TEST_VENDOR, CODIGOFORMAPAGO: '02', CODIGOTARIFA: 1, CODIGOALMACEN: 1,
      TIPOVENTA: 'CC', OBSERVACIONES: TEST_OBS, ESTADO: 'BORRADOR',
    };
    const cabDiffs = Object.entries(expectCab)
      .filter(([key, val]) => String(cab[0][key]) !== String(val))
      .map(([key, val]) => `${key}: esperado=${val} obtenido=${cab[0][key]}`);
    record('FIELD_BY_FIELD_CAB', '(comparacion en memoria contra valores insertados)', [],
      cabDiffs.length ? { MISMATCHES: cabDiffs } : 'TODOS LOS CAMPOS COINCIDEN (incl. default ESTADO=BORRADOR)');
    if (cabDiffs.length) throw new Error(`FIELD_BY_FIELD_CAB mismatches: ${cabDiffs.join('; ')}`);
    const pedidoId = cab[0].ID;

    // 3. INSERT 2 lineas.
    await run(conn, 'INSERT_LIN_1', `
      INSERT INTO JAVIER.PEDIDOS_LIN (
        PEDIDO_ID, SECUENCIA, CODIGOARTICULO, DESCRIPCION,
        CANTIDADENVASES, CANTIDADUNIDADES, UNIDADMEDIDA, UNIDADESCAJA,
        PRECIOVENTA, IMPORTEVENTA, CLASELINEA
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [pedidoId, 1, TEST_ART, 'ARTICULO PRUEBA PILAR2', 2, 12, 'CAJ', 6, 1.5, 18.0, 'VT']);
    await run(conn, 'INSERT_LIN_2', `
      INSERT INTO JAVIER.PEDIDOS_LIN (
        PEDIDO_ID, SECUENCIA, CODIGOARTICULO, DESCRIPCION,
        CANTIDADENVASES, CANTIDADUNIDADES, UNIDADMEDIDA, UNIDADESCAJA,
        PRECIOVENTA, IMPORTEVENTA, CLASELINEA
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [pedidoId, 2, 'ZZTESTART2', 'ARTICULO PRUEBA PILAR2 B', 1, 6, 'CAJ', 6, 2.25, 13.5, 'VT']);
    const lin = await run(conn, 'VERIFY_LIN_INSERT', `
      SELECT ID, PEDIDO_ID, SECUENCIA, TRIM(CODIGOARTICULO) AS ART, CANTIDADENVASES,
             CANTIDADUNIDADES, PRECIOVENTA, IMPORTEVENTA, TRIM(CLASELINEA) AS CLASE
      FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID = ? ORDER BY SECUENCIA`, [pedidoId]);
    if (lin.length !== 2) throw new Error(`VERIFY_LIN_INSERT expected 2 rows, got ${lin.length}`);

    // 4. UPDATE de un campo y verificacion.
    await run(conn, 'UPDATE_FIELD', `
      UPDATE JAVIER.PEDIDOS_CAB SET OBSERVACIONES = ?, IMPORTETOTAL = ?, UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = ?`,
      ['PILAR2 SMOKE UPDATED OK', 31.5, pedidoId]);
    const upd = await run(conn, 'VERIFY_UPDATE_FIELD', `
      SELECT TRIM(OBSERVACIONES) AS OBSERVACIONES, IMPORTETOTAL FROM JAVIER.PEDIDOS_CAB WHERE ID = ?`, [pedidoId]);
    if (upd[0].OBSERVACIONES !== 'PILAR2 SMOKE UPDATED OK' || Number(upd[0].IMPORTETOTAL) !== 31.5) {
      throw new Error(`VERIFY_UPDATE_FIELD mismatch: ${JSON.stringify(upd[0])}`);
    }

    // 5. Cambio de estado (transicion valida BORRADOR -> CONFIRMADO, como la app).
    await run(conn, 'UPDATE_ESTADO', `
      UPDATE JAVIER.PEDIDOS_CAB SET ESTADO = 'CONFIRMADO', UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = ?`, [pedidoId]);
    const est = await run(conn, 'VERIFY_ESTADO', `
      SELECT TRIM(ESTADO) AS ESTADO FROM JAVIER.PEDIDOS_CAB WHERE ID = ?`, [pedidoId]);
    if (est[0].ESTADO !== 'CONFIRMADO') throw new Error(`VERIFY_ESTADO mismatch: ${est[0].ESTADO}`);

    // 6. TEST NEGATIVO: ESTADO es VARCHAR(12) pero el dominio del codigo incluye
    //    'PENDIENTE_APROBACION' (20 chars). Debe fallar con truncation (22001).
    try {
      await conn.query(`UPDATE JAVIER.PEDIDOS_CAB SET ESTADO = 'PENDIENTE_APROBACION' WHERE ID = ?`, [pedidoId]);
      record('NEGATIVE_ESTADO_20CHARS', `UPDATE ... SET ESTADO='PENDIENTE_APROBACION' (20 chars > VARCHAR(12))`, [pedidoId],
        'INESPERADO: el UPDATE fue aceptado (posible truncamiento silencioso)');
      const after = await run(conn, 'NEGATIVE_ESTADO_VALUE', `SELECT TRIM(ESTADO) AS ESTADO FROM JAVIER.PEDIDOS_CAB WHERE ID = ?`, [pedidoId]);
      record('NEGATIVE_ESTADO_RESULT', '(valor tras update)', [], after[0]);
      await conn.query(`UPDATE JAVIER.PEDIDOS_CAB SET ESTADO = 'CONFIRMADO' WHERE ID = ?`, [pedidoId]);
    } catch (negativeErr) {
      record('NEGATIVE_ESTADO_20CHARS', `UPDATE ... SET ESTADO='PENDIENTE_APROBACION' (20 chars > VARCHAR(12))`, [pedidoId],
        { CONFIRMADO_BUG: true, error: negativeErr.message, odbc: negativeErr.odbcErrors || [] });
    }

    // 7. DELETE (orden de la app: lineas primero, luego cabecera) y verificacion de no-huerfanos.
    await run(conn, 'DELETE_LIN', `DELETE FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID = ?`, [pedidoId]);
    await run(conn, 'DELETE_CAB', `DELETE FROM JAVIER.PEDIDOS_CAB WHERE ID = ?`, [pedidoId]);
    const post = await run(conn, 'VERIFY_DELETE', `
      SELECT (SELECT COUNT(*) FROM JAVIER.PEDIDOS_CAB WHERE ID = ${Number(pedidoId)}) AS CAB_RESTANTE,
             (SELECT COUNT(*) FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID = ${Number(pedidoId)}) AS LIN_RESTANTES,
             (SELECT COUNT(*) FROM JAVIER.PEDIDOS_LIN L LEFT JOIN JAVIER.PEDIDOS_CAB C ON L.PEDIDO_ID = C.ID WHERE C.ID IS NULL) AS HUERFANAS_GLOBAL
      FROM SYSIBM.SYSDUMMY1`);
    if (Number(post[0].CAB_RESTANTE) !== 0 || Number(post[0].LIN_RESTANTES) !== 0 || Number(post[0].HUERFANAS_GLOBAL) !== 0) {
      throw new Error(`VERIFY_DELETE failed: ${JSON.stringify(post[0])}`);
    }
  } catch (error) {
    failed = error;
  } finally {
    try {
      await cleanup(conn);
      // 8. Prueba final de limpieza total: cero residuo del test en la BD.
      const residue = await run(conn, 'VERIFY_ZERO_RESIDUE', `
        SELECT (SELECT COUNT(*) FROM JAVIER.PEDIDOS_CAB WHERE TRIM(CODIGOCLIENTE) = '${TEST_CLIENT}' OR OBSERVACIONES LIKE 'PILAR2 SMOKE%') AS CAB_RESIDUO,
               (SELECT COUNT(*) FROM JAVIER.PEDIDOS_LIN WHERE TRIM(CODIGOARTICULO) LIKE 'ZZTESTART%') AS LIN_RESIDUO
        FROM SYSIBM.SYSDUMMY1`);
      if (Number(residue[0].CAB_RESIDUO) !== 0 || Number(residue[0].LIN_RESIDUO) !== 0) {
        console.error('[smoke] RESIDUE DETECTED — manual cleanup required!');
        if (!failed) failed = new Error(`Residue: ${JSON.stringify(residue[0])}`);
      }
    } catch (cleanupErr) {
      console.error(`[smoke] CLEANUP ERROR: ${cleanupErr.message}`);
      if (!failed) failed = cleanupErr;
    }
    await fs.writeFile(OUTPUT, JSON.stringify({ ts: new Date().toISOString(), ok: !failed, error: failed ? failed.message : null, steps }, null, 1), 'utf8');
    console.log(`[smoke] wrote ${OUTPUT}`);
    await conn.close();
  }
  if (failed) {
    console.error(`[smoke] RESULT: KO — ${failed.message}`);
    process.exit(1);
  }
  console.log('[smoke] RESULT: OK — ciclo completo verificado y BD limpia');
}

main().catch(error => {
  console.error(`[smoke] FATAL: ${error.message}`);
  process.exit(1);
});
