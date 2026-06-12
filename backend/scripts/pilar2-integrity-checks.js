'use strict';

/**
 * PILAR 2 integrity checks on JAVIER (2026-06-11). 100% read-only SELECTs.
 * Each check prints: name, SQL, count, and up to 5 sample rows when count > 0.
 * Output JSON: backend/tmp/db-exploration/pilar2-integrity-2026-06-11.json
 */

const fs = require('fs/promises');
const path = require('path');
const odbc = require('odbc');

const OUTPUT = path.resolve(__dirname, '..', 'tmp', 'db-exploration', 'pilar2-integrity-2026-06-11.json');

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

// Estados validos segun backend/services/pedidos.service.js:207 (VALID_ORDER_STATES)
const VALID_STATE_FILTER = "('BORRADOR','PENDIENTE_APROBACION','CONFIRMANDO','CONFIRMADO','ENVIADO','ANULADO')";

const DOMAIN_QUERIES = [
  {
    name: 'dominio_estados_pedidos_cab',
    sql: `SELECT ESTADO, COUNT(*) AS N FROM (SELECT COALESCE(TRIM(ESTADO), '(NULL)') AS ESTADO FROM JAVIER.PEDIDOS_CAB) T GROUP BY ESTADO ORDER BY N DESC`,
  },
  {
    name: 'dominio_tipo_movimientos_bolsa',
    sql: `SELECT TIPO, COUNT(*) AS N, MIN(IMPORTE) AS MIN_IMPORTE, MAX(IMPORTE) AS MAX_IMPORTE FROM (SELECT TRIM(TIPO) AS TIPO, IMPORTE FROM JAVIER.MOVIMIENTOS_BOLSA) T GROUP BY TIPO ORDER BY N DESC`,
  },
  {
    name: 'dominio_referencia_cobros',
    sql: `SELECT PATRON, COUNT(*) AS N FROM (
            SELECT CASE WHEN REFERENCIA IS NULL THEN '(NULL)'
                        WHEN REFERENCIA LIKE 'PEDIDO:%' THEN 'PEDIDO:id:serie-num'
                        WHEN REFERENCIA LIKE 'CVC:%' THEN 'CVC:serie-num'
                        ELSE 'serie-num (legacy)' END AS PATRON
            FROM JAVIER.COBROS) T GROUP BY PATRON ORDER BY N DESC`,
  },
  {
    name: 'totales_filas',
    sql: `SELECT 'PEDIDOS_CAB' AS TABLA, COUNT(*) AS N FROM JAVIER.PEDIDOS_CAB
          UNION ALL SELECT 'PEDIDOS_LIN', COUNT(*) FROM JAVIER.PEDIDOS_LIN
          UNION ALL SELECT 'COBROS', COUNT(*) FROM JAVIER.COBROS
          UNION ALL SELECT 'REPARTIDOR_COBROS', COUNT(*) FROM JAVIER.REPARTIDOR_COBROS
          UNION ALL SELECT 'BOLSA_COMERCIAL', COUNT(*) FROM JAVIER.BOLSA_COMERCIAL
          UNION ALL SELECT 'MOVIMIENTOS_BOLSA', COUNT(*) FROM JAVIER.MOVIMIENTOS_BOLSA
          UNION ALL SELECT 'PEDIDOS_STOCK_RESERVE', COUNT(*) FROM JAVIER.PEDIDOS_STOCK_RESERVE
          UNION ALL SELECT 'PEDIDOS_SEQ', COUNT(*) FROM JAVIER.PEDIDOS_SEQ`,
  },
];

const CHECKS = [
  {
    name: 'estados_null_o_fuera_dominio',
    countSql: ['SELECT COUNT(*) AS N FROM JAVIER.PEDIDOS_CAB WHERE ESTADO IS NULL OR TRIM(ESTADO) NOT IN', VALID_STATE_FILTER].join(' '),
    sampleSql: ['SELECT ID, TRIM(ESTADO) AS ESTADO, TRIM(CODIGOCLIENTE) AS CLIENTE, CREATED_AT FROM JAVIER.PEDIDOS_CAB WHERE ESTADO IS NULL OR TRIM(ESTADO) NOT IN', VALID_STATE_FILTER, 'ORDER BY ID DESC FETCH FIRST 5 ROWS ONLY'].join(' '),
  },
  {
    name: 'lineas_sin_cabecera',
    countSql: `SELECT COUNT(*) AS N FROM JAVIER.PEDIDOS_LIN L LEFT JOIN JAVIER.PEDIDOS_CAB C ON L.PEDIDO_ID = C.ID WHERE C.ID IS NULL`,
    sampleSql: `SELECT L.ID, L.PEDIDO_ID, TRIM(L.CODIGOARTICULO) AS ARTICULO, L.CREATED_AT FROM JAVIER.PEDIDOS_LIN L LEFT JOIN JAVIER.PEDIDOS_CAB C ON L.PEDIDO_ID = C.ID WHERE C.ID IS NULL ORDER BY L.ID DESC FETCH FIRST 5 ROWS ONLY`,
  },
  {
    name: 'reservas_stock_sin_cabecera',
    countSql: `SELECT COUNT(*) AS N FROM JAVIER.PEDIDOS_STOCK_RESERVE R LEFT JOIN JAVIER.PEDIDOS_CAB C ON R.PEDIDO_ID = C.ID WHERE C.ID IS NULL`,
    sampleSql: `SELECT R.ID, R.PEDIDO_ID, TRIM(R.CODIGOARTICULO) AS ARTICULO FROM JAVIER.PEDIDOS_STOCK_RESERVE R LEFT JOIN JAVIER.PEDIDOS_CAB C ON R.PEDIDO_ID = C.ID WHERE C.ID IS NULL FETCH FIRST 5 ROWS ONLY`,
  },
  {
    name: 'cobros_huerfanos_de_pedido',
    countSql: `SELECT COUNT(*) AS N FROM JAVIER.COBROS CO
               WHERE CO.REFERENCIA LIKE 'PEDIDO:%'
                 AND NOT EXISTS (
                   SELECT 1 FROM JAVIER.PEDIDOS_CAB PC
                   WHERE PC.ID = CAST(SUBSTR(CO.REFERENCIA, 8, LOCATE(':', CO.REFERENCIA, 8) - 8) AS INTEGER))`,
    sampleSql: `SELECT CO.ID, TRIM(CO.REFERENCIA) AS REFERENCIA, CO.IMPORTE, CO.CREATED_AT FROM JAVIER.COBROS CO
               WHERE CO.REFERENCIA LIKE 'PEDIDO:%'
                 AND NOT EXISTS (
                   SELECT 1 FROM JAVIER.PEDIDOS_CAB PC
                   WHERE PC.ID = CAST(SUBSTR(CO.REFERENCIA, 8, LOCATE(':', CO.REFERENCIA, 8) - 8) AS INTEGER))
               ORDER BY CO.CREATED_AT DESC FETCH FIRST 5 ROWS ONLY`,
  },
  {
    name: 'movimientos_bolsa_sin_bolsa',
    countSql: `SELECT COUNT(*) AS N FROM JAVIER.MOVIMIENTOS_BOLSA M LEFT JOIN JAVIER.BOLSA_COMERCIAL B ON M.BOLSA_ID = B.ID WHERE B.ID IS NULL`,
    sampleSql: `SELECT M.ID, M.BOLSA_ID, TRIM(M.TIPO) AS TIPO, M.IMPORTE, M.CREATED_AT FROM JAVIER.MOVIMIENTOS_BOLSA M LEFT JOIN JAVIER.BOLSA_COMERCIAL B ON M.BOLSA_ID = B.ID WHERE B.ID IS NULL ORDER BY M.ID DESC FETCH FIRST 5 ROWS ONLY`,
  },
  {
    name: 'movimientos_bolsa_pedido_inexistente',
    countSql: `SELECT COUNT(*) AS N FROM JAVIER.MOVIMIENTOS_BOLSA M LEFT JOIN JAVIER.PEDIDOS_CAB C ON M.PEDIDO_ID = C.ID WHERE M.PEDIDO_ID IS NOT NULL AND C.ID IS NULL`,
    sampleSql: `SELECT M.ID, M.PEDIDO_ID, TRIM(M.TIPO) AS TIPO, M.IMPORTE, M.CREATED_AT FROM JAVIER.MOVIMIENTOS_BOLSA M LEFT JOIN JAVIER.PEDIDOS_CAB C ON M.PEDIDO_ID = C.ID WHERE M.PEDIDO_ID IS NOT NULL AND C.ID IS NULL ORDER BY M.ID DESC FETCH FIRST 5 ROWS ONLY`,
  },
  {
    name: 'lineas_cantidades_no_positivas',
    countSql: `SELECT COUNT(*) AS N FROM JAVIER.PEDIDOS_LIN WHERE COALESCE(CANTIDADENVASES,0) <= 0 AND COALESCE(CANTIDADUNIDADES,0) <= 0`,
    sampleSql: `SELECT ID, PEDIDO_ID, TRIM(CODIGOARTICULO) AS ARTICULO, CANTIDADENVASES, CANTIDADUNIDADES, TRIM(CLASELINEA) AS CLASE FROM JAVIER.PEDIDOS_LIN WHERE COALESCE(CANTIDADENVASES,0) <= 0 AND COALESCE(CANTIDADUNIDADES,0) <= 0 ORDER BY ID DESC FETCH FIRST 5 ROWS ONLY`,
  },
  {
    name: 'lineas_cantidades_negativas',
    countSql: `SELECT COUNT(*) AS N FROM JAVIER.PEDIDOS_LIN WHERE COALESCE(CANTIDADENVASES,0) < 0 OR COALESCE(CANTIDADUNIDADES,0) < 0`,
    sampleSql: `SELECT ID, PEDIDO_ID, TRIM(CODIGOARTICULO) AS ARTICULO, CANTIDADENVASES, CANTIDADUNIDADES FROM JAVIER.PEDIDOS_LIN WHERE COALESCE(CANTIDADENVASES,0) < 0 OR COALESCE(CANTIDADUNIDADES,0) < 0 ORDER BY ID DESC FETCH FIRST 5 ROWS ONLY`,
  },
  {
    name: 'pedidos_importe_negativo',
    countSql: `SELECT COUNT(*) AS N FROM JAVIER.PEDIDOS_CAB WHERE COALESCE(IMPORTETOTAL,0) < 0`,
    sampleSql: `SELECT ID, TRIM(ESTADO) AS ESTADO, IMPORTETOTAL, CREATED_AT FROM JAVIER.PEDIDOS_CAB WHERE COALESCE(IMPORTETOTAL,0) < 0 ORDER BY ID DESC FETCH FIRST 5 ROWS ONLY`,
  },
  {
    name: 'lineas_importe_negativo',
    countSql: `SELECT COUNT(*) AS N FROM JAVIER.PEDIDOS_LIN WHERE COALESCE(IMPORTEVENTA,0) < 0`,
    sampleSql: `SELECT ID, PEDIDO_ID, TRIM(CODIGOARTICULO) AS ARTICULO, IMPORTEVENTA FROM JAVIER.PEDIDOS_LIN WHERE COALESCE(IMPORTEVENTA,0) < 0 ORDER BY ID DESC FETCH FIRST 5 ROWS ONLY`,
  },
  {
    name: 'cobros_importe_no_positivo',
    countSql: `SELECT COUNT(*) AS N FROM JAVIER.COBROS WHERE IMPORTE <= 0`,
    sampleSql: `SELECT ID, TRIM(CODIGO_CLIENTE) AS CLIENTE, IMPORTE, TRIM(REFERENCIA) AS REFERENCIA, CREATED_AT FROM JAVIER.COBROS WHERE IMPORTE <= 0 ORDER BY CREATED_AT DESC FETCH FIRST 5 ROWS ONLY`,
  },
  {
    name: 'bolsa_saldo_negativo',
    countSql: `SELECT COUNT(*) AS N FROM JAVIER.BOLSA_COMERCIAL WHERE COALESCE(SALDO_DISPONIBLE,0) < 0`,
    sampleSql: `SELECT ID, TRIM(CODIGOVENDEDOR) AS VENDEDOR, EJERCICIO, MES, SALDO_DISPONIBLE, CONSUMIDO FROM JAVIER.BOLSA_COMERCIAL WHERE COALESCE(SALDO_DISPONIBLE,0) < 0 ORDER BY EJERCICIO DESC, MES DESC FETCH FIRST 5 ROWS ONLY`,
  },
  {
    name: 'pedidos_fechas_absurdas',
    countSql: `SELECT COUNT(*) AS N FROM JAVIER.PEDIDOS_CAB WHERE (EJERCICIO < 2000 OR EJERCICIO > 2027)
               OR (ANODOCUMENTO IS NOT NULL AND ANODOCUMENTO <> 0 AND (ANODOCUMENTO < 2000 OR ANODOCUMENTO > 2027))
               OR (CREATED_AT IS NOT NULL AND (CREATED_AT < TIMESTAMP('2000-01-01-00.00.00') OR CREATED_AT > TIMESTAMP('2027-12-31-23.59.59')))`,
    sampleSql: `SELECT ID, EJERCICIO, ANODOCUMENTO, CREATED_AT, TRIM(ESTADO) AS ESTADO FROM JAVIER.PEDIDOS_CAB WHERE (EJERCICIO < 2000 OR EJERCICIO > 2027)
               OR (ANODOCUMENTO IS NOT NULL AND ANODOCUMENTO <> 0 AND (ANODOCUMENTO < 2000 OR ANODOCUMENTO > 2027))
               OR (CREATED_AT IS NOT NULL AND (CREATED_AT < TIMESTAMP('2000-01-01-00.00.00') OR CREATED_AT > TIMESTAMP('2027-12-31-23.59.59')))
               ORDER BY ID DESC FETCH FIRST 5 ROWS ONLY`,
  },
  {
    name: 'cobros_fechas_absurdas',
    countSql: `SELECT COUNT(*) AS N FROM JAVIER.COBROS WHERE (ANODOCUMENTO IS NOT NULL AND ANODOCUMENTO <> 0 AND (ANODOCUMENTO < 2000 OR ANODOCUMENTO > 2027))
               OR (CREATED_AT IS NOT NULL AND (CREATED_AT < TIMESTAMP('2000-01-01-00.00.00') OR CREATED_AT > TIMESTAMP('2027-12-31-23.59.59')))`,
    sampleSql: `SELECT ID, ANODOCUMENTO, CREATED_AT, IMPORTE FROM JAVIER.COBROS WHERE (ANODOCUMENTO IS NOT NULL AND ANODOCUMENTO <> 0 AND (ANODOCUMENTO < 2000 OR ANODOCUMENTO > 2027))
               OR (CREATED_AT IS NOT NULL AND (CREATED_AT < TIMESTAMP('2000-01-01-00.00.00') OR CREATED_AT > TIMESTAMP('2027-12-31-23.59.59')))
               ORDER BY CREATED_AT DESC FETCH FIRST 5 ROWS ONLY`,
  },
  {
    name: 'estado_excede_varchar12',
    countSql: `SELECT COUNT(*) AS N FROM JAVIER.PEDIDOS_CAB WHERE LENGTH(TRIM(ESTADO)) > 12`,
    sampleSql: `SELECT ID, TRIM(ESTADO) AS ESTADO FROM JAVIER.PEDIDOS_CAB WHERE LENGTH(TRIM(ESTADO)) > 12 FETCH FIRST 5 ROWS ONLY`,
  },
];

async function main() {
  const conn = await odbc.connect(connectionString());
  const out = { ts: new Date().toISOString(), domain: [], checks: [] };
  try {
    for (const dq of DOMAIN_QUERIES) {
      const rows = await conn.query(dq.sql);
      out.domain.push({ name: dq.name, sql: dq.sql.replace(/\s+/g, ' ').trim(), rows });
      console.log(`[domain] ${dq.name}: ${rows.length} rows`);
    }
    for (const check of CHECKS) {
      const countRows = await conn.query(check.countSql);
      const count = Number(countRows[0].N);
      const entry = { name: check.name, sql: check.countSql.replace(/\s+/g, ' ').trim(), count, samples: [] };
      if (count > 0) {
        entry.sampleSql = check.sampleSql.replace(/\s+/g, ' ').trim();
        entry.samples = await conn.query(check.sampleSql);
      }
      out.checks.push(entry);
      console.log(`[check] ${check.name}: COUNT=${count}`);
    }
    await fs.writeFile(OUTPUT, JSON.stringify(out, null, 1), 'utf8');
    console.log(`[integrity] wrote ${OUTPUT}`);
  } finally {
    await conn.close();
  }
}

main().catch(error => {
  console.error(`[integrity] FAIL: ${error.message}`);
  if (error.odbcErrors) console.error(JSON.stringify(error.odbcErrors));
  process.exit(1);
});
