// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual pedido67 bolsa | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const odbc = require('odbc');

function cs() {
  const dsn = process.env.ODBC_DSN || 'GMP';
  const uid = process.env.ODBC_UID || 'JAVIER';
  const pwd = process.env.ODBC_PWD || process.env.ODBC_PASSWORD;
  return [`DSN=${dsn}`, `UID=${uid}`, `PWD=${pwd}`, 'NAM=1', 'CCSID=1208'].join(';');
}

async function safe(conn, label, sql, params = []) {
  try {
    const rows = params.length ? await conn.query(sql, params) : await conn.query(sql);
    return { ok: true, label, count: rows.length, rows };
  } catch (err) {
    return { ok: false, label, error: String(err && err.message ? err.message : err) };
  }
}

async function main() {
  const conn = await odbc.connect(cs());
  const out = {};

  out.tables = await safe(conn, 'tables', `
    SELECT TABLE_NAME FROM QSYS2.SYSTABLES
     WHERE TABLE_SCHEMA='JAVIER'
       AND TABLE_NAME IN (
         'BOLSA_COMERCIAL','TEST_BOLSA_COMERCIAL',
         'MOVIMIENTOS_BOLSA','TEST_MOVIMIENTOS_BOLSA'
       )
     ORDER BY TABLE_NAME
  `);

  out.pedido67Cab = await safe(conn, 'pedido67Cab', `
    SELECT ID, TRIM(ESTADO) ESTADO, TRIM(CODIGOVENDEDOR) V,
           COALESCE(DESCUENTO_GLOBAL,0) DG,
           COALESCE(PORCENTAJEDESCUENTO1,0) PD1,
           IMPORTETOTAL, IMPORTEBASE
      FROM JAVIER.TEST_PEDIDOS_CAB WHERE ID = ?
  `, [67]);

  out.pedido67Lin = await safe(conn, 'pedido67Lin', `
    SELECT ID, TRIM(CODIGOARTICULO) ART, CANTIDADENVASES, CANTIDADUNIDADES,
           TRIM(UNIDADMEDIDA) UM, PRECIOVENTA, PRECIOTARIFA, PRECIOTARIFACLIENTE, PRECIOMINIMO,
           IMPORTEVENTA, COALESCE(DESCUENTO_LINEA,0) DL
      FROM JAVIER.TEST_PEDIDOS_LIN WHERE PEDIDO_ID = ?
     ORDER BY SECUENCIA
  `, [67]);

  out.movProd67 = await safe(conn, 'movProd67', `
    SELECT ID, TRIM(TIPO) TIPO, IMPORTE, PEDIDO_ID
      FROM JAVIER.MOVIMIENTOS_BOLSA WHERE PEDIDO_ID = ?
  `, [67]);

  out.movTestExists = await safe(conn, 'movTestExists', `
    SELECT COUNT(*) AS C FROM QSYS2.SYSTABLES
     WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='TEST_MOVIMIENTOS_BOLSA'
  `);

  out.movTest67 = await safe(conn, 'movTest67', `
    SELECT ID, TRIM(TIPO) TIPO, IMPORTE, PEDIDO_ID, PRECIO_VENTA, PRECIO_MINIMO_CONGELADO
      FROM JAVIER.TEST_MOVIMIENTOS_BOLSA WHERE PEDIDO_ID = ?
  `, [67]);

  out.movTestRecent = await safe(conn, 'movTestRecent', `
    SELECT ID, PEDIDO_ID, TRIM(CODIGOVENDEDOR) V, TRIM(TIPO) TIPO, IMPORTE
      FROM JAVIER.TEST_MOVIMIENTOS_BOLSA
     ORDER BY ID DESC FETCH FIRST 15 ROWS ONLY
  `);

  out.testBolsa = await safe(conn, 'testBolsa', `
    SELECT ID, TRIM(CODIGOVENDEDOR) V, EJERCICIO, MES, SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO
      FROM JAVIER.TEST_BOLSA_COMERCIAL
     ORDER BY ID DESC FETCH FIRST 8 ROWS ONLY
  `);

  out.discountedWithTestMov = await safe(conn, 'discountedWithTestMov', `
    SELECT C.ID AS PEDIDO_ID,
           COALESCE(C.DESCUENTO_GLOBAL, 0) AS DESCUENTO_GLOBAL,
           TRIM(C.ESTADO) AS ESTADO,
           COUNT(M.ID) AS MOV_COUNT,
           COALESCE(SUM(CASE WHEN TRIM(M.TIPO)='CONSUMO' THEN M.IMPORTE ELSE 0 END), 0) AS CONSUMO,
           COALESCE(SUM(CASE WHEN TRIM(M.TIPO)='ACUMULACION' THEN M.IMPORTE ELSE 0 END), 0) AS ACUM
      FROM JAVIER.TEST_PEDIDOS_CAB C
      LEFT JOIN JAVIER.TEST_MOVIMIENTOS_BOLSA M ON M.PEDIDO_ID = C.ID
     WHERE COALESCE(C.DESCUENTO_GLOBAL, 0) > 0
        OR COALESCE(C.PORCENTAJEDESCUENTO1, 0) > 0
     GROUP BY C.ID, C.DESCUENTO_GLOBAL, C.ESTADO
     ORDER BY C.ID DESC
     FETCH FIRST 10 ROWS ONLY
  `);

  out.lqdSample = await safe(conn, 'lqdSample', `
    SELECT TRIM(CODIGOVENDEDOR) V, DIA, MES, ANO, IMPORTECOBRADO, IMPORTEEFECTIVO
      FROM JAVIER.TEST_LQD
     ORDER BY ANO DESC, MES DESC, DIA DESC
     FETCH FIRST 5 ROWS ONLY
  `);

  out.cobrosRecent = await safe(conn, 'cobrosRecent', `
    SELECT ID, TRIM(CODIGOCLIENTE) CLIENTE, TRIM(CODIGOUSUARIO) V, IMPORTE, TRIM(FORMAPAGO) FP
      FROM JAVIER.TEST_COBROS
     ORDER BY ID DESC
     FETCH FIRST 8 ROWS ONLY
  `);

  console.log(JSON.stringify(out, null, 2));
  await conn.close();
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
