// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual reverificacion bolsa-liq-cobros | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Read-only DB probe: bolsa / liquidacion / cobros (TEST schema).
 * Usage: node scripts/_probe-bolsa-liq-cobros-reverify.js
 * Does not print secrets. Exit 0 on connect+queries OK.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const odbc = require('odbc');

function connectionString() {
  const dsn = process.env.ODBC_DSN || 'GMP';
  const uid = process.env.ODBC_UID || process.env.DB2_USER || 'JAVIER';
  const pwd = process.env.ODBC_PWD || process.env.ODBC_PASSWORD;
  if (!pwd) throw new Error('Missing ODBC_PWD');
  return [
    `DSN=${dsn}`,
    `UID=${uid}`,
    `PWD=${pwd}`,
    'NAM=1',
    'CCSID=1208',
    'CMPTDM=1',
    'CPTOUT=120',
    'COMMTIMEOUT=180',
    `DBQ=${dsn}`,
  ].join(';');
}

async function q(conn, label, sql, params = []) {
  try {
    const rows = params.length ? await conn.query(sql, params) : await conn.query(sql);
    return { ok: true, label, count: rows.length, rows };
  } catch (err) {
    return { ok: false, label, error: String(err && err.message ? err.message : err) };
  }
}

async function main() {
  const conn = await odbc.connect(connectionString());
  const out = {};

  out.tables = await q(conn, 'tables', `
    SELECT TABLE_NAME
      FROM QSYS2.SYSTABLES
     WHERE TABLE_SCHEMA = 'JAVIER'
       AND (
         TABLE_NAME LIKE '%BOLSA%'
         OR TABLE_NAME LIKE 'TEST_L%'
         OR TABLE_NAME LIKE 'TEST_C%'
         OR TABLE_NAME LIKE '%PEDIDOS%'
       )
     ORDER BY TABLE_NAME
  `);

  out.bolsaRecent = await q(conn, 'bolsaRecent', `
    SELECT ID,
           TRIM(CODIGOVENDEDOR) AS V,
           EJERCICIO,
           MES,
           SALDO_DISPONIBLE,
           CONSUMIDO,
           ACUMULADO
      FROM JAVIER.BOLSA_COMERCIAL
     ORDER BY EJERCICIO DESC, MES DESC, ID DESC
     FETCH FIRST 5 ROWS ONLY
  `);

  out.movColumns = await q(conn, 'movColumns', `
    SELECT COLUMN_NAME
      FROM QSYS2.SYSCOLUMNS
     WHERE TABLE_SCHEMA = 'JAVIER'
       AND TABLE_NAME = 'MOVIMIENTOS_BOLSA'
     ORDER BY ORDINAL_POSITION
  `);

  out.movRecent = await q(conn, 'movRecent', `
    SELECT ID,
           TRIM(CODIGOVENDEDOR) AS V,
           PEDIDO_ID,
           TRIM(TIPO) AS TIPO,
           IMPORTE,
           PRECIO_VENTA,
           PRECIO_MINIMO_CONGELADO,
           CANTIDAD
      FROM JAVIER.MOVIMIENTOS_BOLSA
     ORDER BY ID DESC
     FETCH FIRST 10 ROWS ONLY
  `);

  out.pedidosCabRecent = await q(conn, 'pedidosCabRecent', `
    SELECT ID,
           TRIM(ESTADO) AS ESTADO,
           TRIM(CODIGOVENDEDOR) AS V,
           COALESCE(DESCUENTO_GLOBAL, 0) AS DESCUENTO_GLOBAL,
           COALESCE(PORCENTAJEDESCUENTO1, 0) AS PORCENTAJEDESCUENTO1,
           IMPORTETOTAL
      FROM JAVIER.TEST_PEDIDOS_CAB
     ORDER BY ID DESC
     FETCH FIRST 8 ROWS ONLY
  `);

  out.lqdRecent = await q(conn, 'lqdRecent', `
    SELECT TRIM(CODIGOVENDEDOR) AS V,
           DIA, MES, ANO,
           IMPORTECOBRADO,
           IMPORTEEFECTIVO,
           IMPORTETARJETA
      FROM JAVIER.TEST_LQD
     ORDER BY ANO DESC, MES DESC, DIA DESC
     FETCH FIRST 8 ROWS ONLY
  `);

  out.cacColumns = await q(conn, 'cacColumns', `
    SELECT COLUMN_NAME
      FROM QSYS2.SYSCOLUMNS
     WHERE TABLE_SCHEMA = 'JAVIER'
       AND TABLE_NAME = 'TEST_CAC'
     ORDER BY ORDINAL_POSITION
  `);

  out.discountedWithBolsa = await q(conn, 'discountedWithBolsa', `
    SELECT C.ID AS PEDIDO_ID,
           COALESCE(C.DESCUENTO_GLOBAL, 0) AS DESCUENTO_GLOBAL,
           TRIM(C.ESTADO) AS ESTADO,
           COUNT(M.ID) AS MOV_COUNT,
           COALESCE(SUM(CASE WHEN TRIM(M.TIPO)='CONSUMO' THEN M.IMPORTE ELSE 0 END), 0) AS CONSUMO,
           COALESCE(SUM(CASE WHEN TRIM(M.TIPO)='ACUMULACION' THEN M.IMPORTE ELSE 0 END), 0) AS ACUM
      FROM JAVIER.TEST_PEDIDOS_CAB C
      LEFT JOIN JAVIER.MOVIMIENTOS_BOLSA M ON M.PEDIDO_ID = C.ID
     WHERE COALESCE(C.DESCUENTO_GLOBAL, 0) > 0
        OR COALESCE(C.PORCENTAJEDESCUENTO1, 0) > 0
     GROUP BY C.ID, C.DESCUENTO_GLOBAL, C.ESTADO
     ORDER BY C.ID DESC
     FETCH FIRST 10 ROWS ONLY
  `);

  console.log(JSON.stringify(out, null, 2));
  await conn.close();
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
