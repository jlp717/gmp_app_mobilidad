'use strict';

/**
 * PILAR 2 performance checks (2026-06-11). 100% read-only.
 * - Times the main list/filter queries of the Pedidos / Cobros / Bolsa tabs
 *   (SQL extracted verbatim from routes/services), 3 repetitions each.
 * - Captures indexes (QSYS2.SYSINDEXES + SYSPARTITIONINDEXSTAT) for the
 *   filter/sort columns involved, plus table sizes (SYSPARTITIONSTAT).
 * Output: backend/tmp/db-exploration/pilar2-perf-2026-06-11.json
 */

const fs = require('fs/promises');
const path = require('path');
const odbc = require('odbc');

const OUTPUT = path.resolve(__dirname, '..', 'tmp', 'db-exploration', 'pilar2-perf-2026-06-11.json');

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
    'NAM=1', 'CCSID=1208', 'CMPTDM=1', 'CPTOUT=120', 'COMMTIMEOUT=180', `DBQ=${dsn}`,
  ].join(';');
}

async function timed(conn, sql, params, repeats = 3) {
  const timings = [];
  let rowCount = 0;
  for (let i = 0; i < repeats; i++) {
    const start = Date.now();
    const rows = params && params.length ? await conn.query(sql, params) : await conn.query(sql);
    timings.push(Date.now() - start);
    rowCount = rows.length;
  }
  return { timings, rowCount };
}

async function main() {
  const conn = await odbc.connect(connectionString());
  const out = { ts: new Date().toISOString(), context: {}, queries: [], indexes: {}, tableStats: [] };
  try {
    // ---- contexto: parametros reales ----
    const cliRow = await conn.query(`SELECT TRIM(CODIGOCLIENTEALBARAN) AS CLI FROM DSEDAC.CVC WHERE IMPORTEPENDIENTE > 0.01 AND (ANULADOSN IS NULL OR ANULADOSN <> 'S') AND TRIM(CODIGOCLIENTEALBARAN) <> '' FETCH FIRST 1 ROW ONLY`);
    const clienteCVC = cliRow.length ? cliRow[0].CLI : null;
    const vndBolsa = await conn.query(`SELECT TRIM(CODIGOVENDEDOR) AS V, EJERCICIO, MES FROM JAVIER.BOLSA_COMERCIAL ORDER BY EJERCICIO DESC, MES DESC FETCH FIRST 1 ROW ONLY`);
    const bolsaVendor = vndBolsa.length ? vndBolsa[0] : { V: '01', EJERCICIO: 2026, MES: 6 };
    const vndPed = await conn.query(`SELECT V, N FROM (SELECT TRIM(CODIGOVENDEDOR) AS V, COUNT(*) AS N FROM JAVIER.PEDIDOS_CAB GROUP BY TRIM(CODIGOVENDEDOR)) T ORDER BY N DESC FETCH FIRST 1 ROW ONLY`);
    const pedidosVendor = vndPed.length ? vndPed[0].V : '01';
    out.context = { clienteCVC, bolsaVendor, pedidosVendor };
    console.log(`[perf] contexto: ${JSON.stringify(out.context)}`);

    const QUERIES = [
      {
        name: 'PEDIDOS getOrders (service 2167, vendor unico + join lineas, ORDER BY ID DESC, 50)',
        sql: `SELECT C.ID, C.EJERCICIO, C.NUMEROPEDIDO, C.SERIEPEDIDO,
                C.DIADOCUMENTO, C.MESDOCUMENTO, C.ANODOCUMENTO, C.HORADOCUMENTO,
                TRIM(C.CODIGOCLIENTE) AS CODIGOCLIENTE, TRIM(C.NOMBRECLIENTE) AS NOMBRECLIENTE,
                TRIM(C.CODIGOVENDEDOR) AS CODIGOVENDEDOR, TRIM(C.ESTADO) AS ESTADO,
                C.IMPORTETOTAL, COALESCE(NULLIF(C.IMPORTETOTAL, 0), LC.LINE_TOTAL, 0) AS IMPORTE_CALCULADO,
                COALESCE(LC.LINE_COUNT, 0) AS LINE_COUNT
              FROM JAVIER.PEDIDOS_CAB C
              LEFT JOIN (SELECT PEDIDO_ID, COUNT(*) AS LINE_COUNT, COALESCE(SUM(IMPORTEVENTA),0) AS LINE_TOTAL,
                                COALESCE(SUM(IMPORTECOSTO),0) AS LINE_COST
                         FROM JAVIER.PEDIDOS_LIN GROUP BY PEDIDO_ID) LC ON C.ID = LC.PEDIDO_ID
              WHERE 1=1 AND TRIM(C.CODIGOVENDEDOR) = ?
              ORDER BY C.ID DESC FETCH FIRST 50 ROWS ONLY`,
        params: [pedidosVendor],
      },
      {
        name: 'PEDIDOS list-estados (route 1698, vendor, 50)',
        sql: `SELECT ID, NUMEROPEDIDO, SERIE, CODIGOCLIENTE, ESTADO, IMPORTETOTAL,
                DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO
              FROM JAVIER.PEDIDOS_CAB
              WHERE TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(50))
              ORDER BY ID DESC FETCH FIRST 50 ROWS ONLY`,
        params: [pedidosVendor],
      },
      {
        name: 'COBROS pendientes CVC por cliente (route 251, 100)',
        sql: `SELECT C.NUMERODOCUMENTO AS NUMERO_DOCUMENTO, TRIM(C.SERIEDOCUMENTO) AS SERIE,
                C.IMPORTEVENCIMIENTO AS IMPORTE_TOTAL, C.IMPORTECANCELADO AS IMPORTE_COBRADO,
                C.IMPORTEPENDIENTE AS IMPORTE_PENDIENTE, C.ANOEMISION, C.MESEMISION, C.DIAEMISION,
                C.ANOVENCIMIENTO, C.MESVENCIMIENTO, C.DIAVENCIMIENTO,
                TRIM(C.SUBEMPRESADOCUMENTO) AS SUBEMPRESA, TRIM(C.TIPODOCUMENTO) AS TIPO_DOCUMENTO,
                TRIM(C.CODIGOFORMAPAGO) AS FORMA_PAGO
              FROM DSEDAC.CVC C
              WHERE TRIM(C.CODIGOCLIENTEALBARAN) = ?
                AND C.IMPORTEPENDIENTE > 0.01
                AND (C.ANULADOSN IS NULL OR C.ANULADOSN <> 'S')
              ORDER BY C.ANOVENCIMIENTO ASC, C.MESVENCIMIENTO ASC, C.DIAVENCIMIENTO ASC
              FETCH FIRST 100 ROWS ONLY`,
        params: [clienteCVC],
      },
      {
        name: 'COBROS pending-summary global JEFE_VENTAS (route 769, sin filtro vendedor)',
        sql: `SELECT TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                TRIM(CVC.SERIEDOCUMENTO) AS SERIE_DOCUMENTO,
                CVC.NUMERODOCUMENTO AS NUMERO_DOCUMENTO,
                SUM(CVC.IMPORTEPENDIENTE) AS TOTAL_PENDIENTE,
                SUM(CASE WHEN (CVC.ANOVENCIMIENTO * 10000 + CVC.MESVENCIMIENTO * 100 + CVC.DIAVENCIMIENTO)
                    <= (YEAR(CURRENT_DATE) * 10000 + MONTH(CURRENT_DATE) * 100 + DAY(CURRENT_DATE))
                    THEN CVC.IMPORTEPENDIENTE ELSE 0 END) AS TOTAL_VENCIDO,
                TRIM(MIN(CLI.NOMBREALTERNATIVO)) AS NOMBRE_ALT,
                TRIM(MIN(CLI.DESCRIPCIONCLIENTE)) AS NOMBRE_CLI
              FROM DSEDAC.CVC CVC
              LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
              WHERE CVC.IMPORTEPENDIENTE <> 0
                AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
              GROUP BY TRIM(CVC.CODIGOCLIENTEALBARAN), TRIM(CVC.SERIEDOCUMENTO), CVC.NUMERODOCUMENTO
              ORDER BY TOTAL_PENDIENTE DESC`,
        params: [],
      },
      {
        name: 'BOLSA por vendedor/mes (service 22)',
        sql: `SELECT ID, CODIGOVENDEDOR, EJERCICIO, MES, LIMITE_PCT, LIMITE_IMPORTE, SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO
              FROM JAVIER.BOLSA_COMERCIAL WHERE TRIM(CODIGOVENDEDOR) = ? AND EJERCICIO = ? AND MES = ?`,
        params: [bolsaVendor.V, bolsaVendor.EJERCICIO, bolsaVendor.MES],
      },
      {
        name: 'BOLSA historial 12 meses (service 441)',
        sql: `SELECT EJERCICIO, MES, SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO, LIMITE_PCT, LIMITE_IMPORTE
              FROM JAVIER.BOLSA_COMERCIAL
              WHERE TRIM(CODIGOVENDEDOR) = ? AND ( EJERCICIO > ? OR (EJERCICIO = ? AND MES >= ?) )
              ORDER BY EJERCICIO ASC, MES ASC`,
        params: [bolsaVendor.V, 2025, 2025, 7],
      },
    ];

    for (const q of QUERIES) {
      if (q.params.some(p => p === null || p === undefined)) {
        out.queries.push({ name: q.name, skipped: 'no real parameter available' });
        console.log(`[perf] SKIP ${q.name}`);
        continue;
      }
      try {
        const { timings, rowCount } = await timed(conn, q.sql, q.params);
        out.queries.push({ name: q.name, sql: q.sql.replace(/\s+/g, ' ').trim(), params: q.params, timingsMs: timings, rowCount });
        console.log(`[perf] ${q.name}: ${timings.join('/')} ms, rows=${rowCount}`);
      } catch (queryErr) {
        out.queries.push({
          name: q.name,
          sql: q.sql.replace(/\s+/g, ' ').trim(),
          params: q.params,
          error: queryErr.message,
          odbc: queryErr.odbcErrors || [],
        });
        console.log(`[perf] ERROR ${q.name}: ${queryErr.message} ${JSON.stringify(queryErr.odbcErrors || [])}`);
      }
    }

    // ---- indices sobre tablas DSEDAC criticas para cobros ----
    for (const table of ['CVC', 'CLI', 'CLP']) {
      const idx = await conn.query(`
        SELECT INDEX_SCHEMA, INDEX_NAME, IS_UNIQUE
        FROM QSYS2.SYSINDEXES WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = ? ORDER BY INDEX_NAME`, [table]);
      for (const i of idx) {
        const cols = await conn.query(`
          SELECT COLUMN_NAME FROM QSYS2.SYSKEYS WHERE INDEX_SCHEMA = ? AND INDEX_NAME = ? ORDER BY ORDINAL_POSITION`,
          [String(i.INDEX_SCHEMA).trim(), String(i.INDEX_NAME).trim()]);
        i.COLUMNS = cols.map(c => String(c.COLUMN_NAME).trim());
      }
      out.indexes[`DSEDAC.${table}`] = idx;
      console.log(`[perf] indexes DSEDAC.${table}: ${idx.length}`);
    }

    // ---- estadisticas de tamano y uso de indices ----
    out.tableStats = await conn.query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, NUMBER_ROWS
      FROM QSYS2.SYSPARTITIONSTAT
      WHERE (TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME IN ('CVC','CLI','CLP','CPC','LPC','CRC','CRCA'))
         OR (TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME IN ('PEDIDOS_CAB','PEDIDOS_LIN','COBROS','REPARTIDOR_COBROS','BOLSA_COMERCIAL','MOVIMIENTOS_BOLSA'))
      ORDER BY TABLE_SCHEMA, TABLE_NAME`);

    try {
      out.indexStats = await conn.query(`
        SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, NUMBER_KEYS, LAST_USED_TIMESTAMP
        FROM QSYS2.SYSPARTITIONINDEXSTAT
        WHERE TABLE_SCHEMA = 'JAVIER'
          AND TABLE_NAME IN ('PEDIDOS_CAB','PEDIDOS_LIN','COBROS','REPARTIDOR_COBROS','BOLSA_COMERCIAL','MOVIMIENTOS_BOLSA')
        ORDER BY TABLE_NAME, INDEX_NAME`);
    } catch (e) {
      out.indexStats = { error: e.message };
    }

    await fs.writeFile(OUTPUT, JSON.stringify(out, (key, value) =>
      typeof value === 'bigint' ? Number(value) : value, 1), 'utf8');
    console.log(`[perf] wrote ${OUTPUT}`);
  } finally {
    await conn.close();
  }
}

main().catch(error => {
  console.error(`[perf] FAIL: ${error.message}`);
  if (error.odbcErrors) console.error(JSON.stringify(error.odbcErrors));
  process.exit(1);
});
