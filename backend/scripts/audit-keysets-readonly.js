#!/usr/bin/env node
'use strict';

const odbc = require('odbc');

const connStr =
  process.env.ODBC_CONN ||
  `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1`;

const queries = [
  {
    name: 'vendors_with_debt',
    sql: `SELECT CODIGOVENDEDOR, COUNT(*) AS CLIENTES, SUM(IMPORTEPENDIENTE) AS DEUDA
          FROM JAVIER.VISTA_DEUDA_BASE
          WHERE IMPORTEPENDIENTE > 0
          GROUP BY CODIGOVENDEDOR
          ORDER BY DEUDA DESC
          FETCH FIRST 5 ROWS ONLY`,
  },
  {
    name: 'clients_with_debt',
    sql: `SELECT CODIGOCLIENTE, SUM(IMPORTEPENDIENTE) AS DEUDA
          FROM JAVIER.VISTA_DEUDA_BASE
          WHERE IMPORTEPENDIENTE > 0
          GROUP BY CODIGOCLIENTE
          ORDER BY DEUDA DESC
          FETCH FIRST 5 ROWS ONLY`,
  },
  {
    name: 'active_promos',
    sql: `SELECT TRIM(CODIGOARTICULO) AS ARTICULO_ID,
                 PROMOCIONPRECIOESPECIAL AS PROMO_ID,
                 PRECIO,
                 DATE(TIMESTAMP_FORMAT(DIGITS(ANOINICIO) CONCAT RIGHT(DIGITS(MESINICIO), 2) CONCAT RIGHT(DIGITS(DIAINICIO), 2), 'YYYYMMDD')) AS FECHA_INICIO,
                 DATE(TIMESTAMP_FORMAT(DIGITS(ANOFINAL) CONCAT RIGHT(DIGITS(MESFINAL), 2) CONCAT RIGHT(DIGITS(DIAFINAL), 2), 'YYYYMMDD')) AS FECHA_FIN
          FROM DSEDAC.PES
          WHERE CURRENT_DATE BETWEEN DATE(TIMESTAMP_FORMAT(DIGITS(ANOINICIO) CONCAT RIGHT(DIGITS(MESINICIO), 2) CONCAT RIGHT(DIGITS(DIAINICIO), 2), 'YYYYMMDD'))
                                 AND DATE(TIMESTAMP_FORMAT(DIGITS(ANOFINAL) CONCAT RIGHT(DIGITS(MESFINAL), 2) CONCAT RIGHT(DIGITS(DIAFINAL), 2), 'YYYYMMDD'))
            AND PRECIO > 0
          ORDER BY ANOINICIO DESC, MESINICIO DESC, DIAINICIO DESC
          FETCH FIRST 5 ROWS ONLY`,
  },
  {
    name: 'latest_pedidos_javier',
    sql: `SELECT ID, NUMEROPEDIDO, CODIGOCLIENTE, CODIGOVENDEDOR, ESTADO, IMPORTETOTAL, CREATED_AT
          FROM JAVIER.PEDIDOS_CAB
          ORDER BY CREATED_AT DESC
          FETCH FIRST 5 ROWS ONLY`,
  },
  {
    name: 'bolsa_latest',
    sql: `SELECT CODIGOVENDEDOR, EJERCICIO, MES, SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO
          FROM JAVIER.BOLSA_COMERCIAL
          ORDER BY UPDATED_AT DESC
          FETCH FIRST 5 ROWS ONLY`,
  },
  {
    name: 'pmr_promos_client_4300001091',
    sql: `SELECT TRIM(CODIGOPROMOCIONREGALO) AS PROMO_CODE, TRIM(NOMBREPROMOCIONREGALO) AS PROMO_NAME,
                 DIAINICIO, MESINICIO, ANOINICIO, DIAFIN, MESFIN, ANOFIN
          FROM DSEDAC.PMR
          WHERE TRIM(CODIGOCLIENTE) = '4300001091'
          FETCH FIRST 10 ROWS ONLY`,
  },
  {
    name: 'client_deuda_4300001091',
    sql: `SELECT CODIGOCLIENTE, SUM(IMPORTEPENDIENTE) AS DEUDA, COUNT(*) AS VENCIMIENTOS
          FROM JAVIER.VISTA_DEUDA_BASE
          WHERE TRIM(CODIGOCLIENTE) = '4300001091'
          GROUP BY CODIGOCLIENTE`,
  },
  {
    name: 'stock_apf_candidate',
    sql: `SELECT CODIGOARTICULO, ANOVENTA, MESVENTA, DIAVENTA, STOCKAFECHA
          FROM DSEDAC.APF
          WHERE STOCKAFECHA IS NOT NULL
          ORDER BY ANOVENTA DESC, MESVENTA DESC, DIAVENTA DESC
          FETCH FIRST 5 ROWS ONLY`,
  },
];

async function main() {
  const c = await odbc.connect(connStr);
  const out = { ok: true, results: {} };
  for (const q of queries) {
    const rows = await c.query(q.sql);
    out.results[q.name] = rows;
    console.log(`\n== ${q.name} (${rows.length} rows) ==`);
    console.log(JSON.stringify(rows, null, 2));
  }
  await c.close();
}

main().catch((e) => {
  console.error('AUDIT_KEYSETS_ERR', e.message);
  process.exit(1);
});
