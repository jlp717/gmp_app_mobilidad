// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual veredicto claims | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Read-only senior verdict probe (TEST schema). No secrets printed.
 * Usage: node scripts/_probe-senior-verdict-claims.js
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

async function q(conn, sql, params = []) {
  try {
    const rows = params.length ? await conn.query(sql, params) : await conn.query(sql);
    return { ok: true, count: rows.length, rows };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

async function main() {
  const conn = await odbc.connect(connectionString());
  const out = {};

  out.tables = await q(conn, `
    SELECT TABLE_NAME
      FROM QSYS2.SYSTABLES
     WHERE TABLE_SCHEMA = 'JAVIER'
       AND TABLE_NAME IN (
         'MOVIMIENTOS_BOLSA', 'TEST_MOVIMIENTOS_BOLSA',
         'BOLSA_COMERCIAL', 'TEST_BOLSA_COMERCIAL',
         'TEST_PEDIDOS_CAB', 'TEST_VDDX', 'TEST_COBROS', 'TEST_LQD',
         'TEST_PEDIDOS_STOCK_RESERVE'
       )
     ORDER BY TABLE_NAME
  `);

  out.movCounts = await q(conn, `
    SELECT 'MOVIMIENTOS_BOLSA' AS T, COUNT(*) AS N FROM JAVIER.MOVIMIENTOS_BOLSA
    UNION ALL
    SELECT 'TEST_MOVIMIENTOS_BOLSA', COUNT(*) FROM JAVIER.TEST_MOVIMIENTOS_BOLSA
    UNION ALL
    SELECT 'TEST_COBROS', COUNT(*) FROM JAVIER.TEST_COBROS
    UNION ALL
    SELECT 'TEST_LQD', COUNT(*) FROM JAVIER.TEST_LQD
  `);

  out.discountedVsTestMov = await q(conn, `
    SELECT C.ID AS PEDIDO_ID,
           COALESCE(C.DESCUENTO_GLOBAL, 0) AS DESCUENTO_GLOBAL,
           TRIM(C.ESTADO) AS ESTADO,
           (SELECT COUNT(*) FROM JAVIER.TEST_MOVIMIENTOS_BOLSA M WHERE M.PEDIDO_ID = C.ID) AS MOV_TEST,
           (SELECT COUNT(*) FROM JAVIER.MOVIMIENTOS_BOLSA M WHERE M.PEDIDO_ID = C.ID) AS MOV_APP,
           (SELECT COALESCE(SUM(CASE WHEN TRIM(M.TIPO)='CONSUMO' THEN M.IMPORTE ELSE 0 END),0)
              FROM JAVIER.TEST_MOVIMIENTOS_BOLSA M WHERE M.PEDIDO_ID = C.ID) AS CONSUMO_TEST
      FROM JAVIER.TEST_PEDIDOS_CAB C
     WHERE COALESCE(C.DESCUENTO_GLOBAL, 0) > 0
     ORDER BY C.ID DESC
     FETCH FIRST 20 ROWS ONLY
  `);

  out.recentTestMov = await q(conn, `
    SELECT ID, TRIM(CODIGOVENDEDOR) AS V, PEDIDO_ID, TRIM(TIPO) AS TIPO, IMPORTE, CREATED_AT
      FROM JAVIER.TEST_MOVIMIENTOS_BOLSA
     ORDER BY ID DESC
     FETCH FIRST 15 ROWS ONLY
  `);

  out.vddxThresholds = await q(conn, `
    SELECT TRIM(CODIGOVENDEDOR) AS V,
           PEDIDOSPENDIENTESSINCRONIZAR AS TH
      FROM JAVIER.TEST_VDDX
     WHERE PEDIDOSPENDIENTESSINCRONIZAR > 0
     ORDER BY PEDIDOSPENDIENTESSINCRONIZAR DESC
     FETCH FIRST 25 ROWS ONLY
  `);

  out.vddxZeroCount = await q(conn, `
    SELECT
      SUM(CASE WHEN PEDIDOSPENDIENTESSINCRONIZAR > 0 THEN 1 ELSE 0 END) AS WITH_TH,
      SUM(CASE WHEN COALESCE(PEDIDOSPENDIENTESSINCRONIZAR,0) = 0 THEN 1 ELSE 0 END) AS ZERO_TH,
      COUNT(*) AS TOTAL
      FROM JAVIER.TEST_VDDX
  `);

  out.expiredDrafts = await q(conn, `
    SELECT COUNT(*) AS N
      FROM JAVIER.TEST_PEDIDOS_CAB
     WHERE TRIM(ESTADO) IN ('BORRADOR','PENDIENTE','PEND_APROB','PENDIENTE_APROBACION','CONFIRMANDO')
       AND CREATED_AT < CURRENT TIMESTAMP - 24 HOURS
  `);

  out.cobrosIdempotencyCols = await q(conn, `
    SELECT COLUMN_NAME
      FROM QSYS2.SYSCOLUMNS
     WHERE TABLE_SCHEMA = 'JAVIER'
       AND TABLE_NAME = 'TEST_COBROS'
       AND UPPER(COLUMN_NAME) LIKE '%IDEMP%'
     ORDER BY ORDINAL_POSITION
  `);

  out.cobrosRecent = await q(conn, `
    SELECT ID, TRIM(CODIGOVENDEDOR) AS V, IMPORTE, FECHA, IDEMPOTENCY_TOKEN
      FROM JAVIER.TEST_COBROS
     ORDER BY ID DESC
     FETCH FIRST 8 ROWS ONLY
  `);

  // Frontier: DSEDAC.LQD / COMMERCIAL_TARGETS must remain readable, not mutated here.
  out.frontierReadOnly = await q(conn, `
    SELECT COUNT(*) AS LQD_PROD FROM DSEDAC.LQD FETCH FIRST 1 ROW ONLY
  `);

  console.log(JSON.stringify(out, null, 2));
  await conn.close();
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
