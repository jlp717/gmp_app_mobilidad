'use strict';

const fs = require('fs/promises');
const path = require('path');
const odbc = require('odbc');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const OUTPUT_DIR = path.resolve(__dirname, '..', 'tmp', 'db-exploration');

const REQUIRED = {
  CPC: [
    'SUBEMPRESAPEDIDO', 'EJERCICIOPEDIDO', 'SERIEPEDIDO', 'TERMINALPEDIDO', 'NUMEROPEDIDO',
    'DIADOCUMENTO', 'MESDOCUMENTO', 'ANODOCUMENTO', 'HORADOCUMENTO',
    'CODIGOCLIENTEALBARAN', 'CODIGOCLIENTEFACTURA', 'CODIGOVENDEDOR', 'CODIGORUTA',
    'CODIGOFORMAPAGO', 'CODIGOTARIFA', 'CODIGOALMACEN', 'IMPORTETOTAL',
    'SITUACIONPEDIDO', 'CODIGOOPERACION', 'DIASERVICIO', 'MESSERVICIO', 'ANOSERVICIO',
  ],
  LPC: [
    'SUBEMPRESAPEDIDO', 'EJERCICIOPEDIDO', 'SERIEPEDIDO', 'TERMINALPEDIDO', 'NUMEROPEDIDO',
    'SECUENCIAPEDIDO', 'CODIGOARTICULO', 'DESCRIPCION', 'CANTIDADENVASES',
    'CANTIDADUNIDADES', 'PRECIOVENTA', 'IMPORTEVENTA', 'PRECIOCOSTO', 'IMPORTECOSTO',
    'TIPOLINEA', 'TIPOVENTA', 'CLASELINEA', 'CAJASUNIDADES',
  ],
  OCPC: [
    'SUBEMPRESAPEDIDO', 'EJERCICIOPEDIDO', 'SERIEPEDIDO', 'TERMINALPEDIDO', 'NUMEROPEDIDO',
    'DIAOBSERVACION', 'MESOBSERVACION', 'ANOOBSERVACION', 'OBSERVACION01', 'CODIGOUSUARIO',
  ],
  PEDIDOS_CAB: [
    'TARGET_SCHEMA', 'SYNC_STATUS', 'SYNC_AT', 'SYSTEM_SUBEMPRESAPEDIDO',
    'SYSTEM_EJERCICIOPEDIDO', 'SYSTEM_SERIEPEDIDO', 'SYSTEM_TERMINALPEDIDO',
    'SYSTEM_NUMEROPEDIDO', 'FECHAREPARTO', 'CODIGOVEHICULO', 'CODIGOREPARTIDOR',
  ],
};

function connectionString() {
  const dsn = process.env.ODBC_DSN || 'GMP';
  const uid = process.env.ODBC_UID || 'JAVIER';
  const pwd = process.env.ODBC_PWD || 'JAVIER';
  return [
    `DSN=${dsn}`,
    `UID=${uid}`,
    `PWD=${pwd}`,
    'NAM=1',
    'CCSID=1208',
    'CMPTDM=1',
    `CPTOUT=${process.env.ODBC_TIMEOUT || 60}`,
    `COMMTIMEOUT=${process.env.ODBC_COMM_TIMEOUT || 90}`,
    `DBQ=${dsn}`,
  ].join(';');
}

async function safeQuery(conn, sql, params = []) {
  try {
    return { ok: true, rows: await conn.query(sql, params) };
  } catch (error) {
    return { ok: false, error: error.message, odbcErrors: error.odbcErrors || [] };
  }
}

async function tableColumns(conn, schema, table) {
  return safeQuery(conn, `
    SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE, HAS_DEFAULT, COLUMN_DEFAULT, COLUMN_TEXT
    FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION`, [schema, table]);
}

function requiredCoverage(columns, required) {
  if (!columns.ok) return { ok: false, missing: required, error: columns.error };
  const names = new Set(columns.rows.map(row => String(row.COLUMN_NAME || '').trim().toUpperCase()));
  const missing = required.filter(name => !names.has(name));
  return { ok: missing.length === 0, missing };
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const conn = await odbc.connect(connectionString());
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const result = {
    timestamp: new Date().toISOString(),
    env: {
      pedidosConfirmationSchema: process.env.PEDIDOS_CONFIRMATION_SCHEMA || 'JAVIER',
      pedidosSystemSubempresa: process.env.PEDIDOS_SYSTEM_SUBEMPRESA || 'GMP',
      pedidosSystemSerie: process.env.PEDIDOS_SYSTEM_SERIE || 'P',
      pedidosSystemTerminal: process.env.PEDIDOS_SYSTEM_TERMINAL || '10',
      pedidosSystemCodigoOperacion: process.env.PEDIDOS_SYSTEM_CODIGO_OPERACION || 'V',
      pedidosSystemSituacionPedido: process.env.PEDIDOS_SYSTEM_SITUACION_PEDIDO || 'A',
    },
    tables: {},
    checks: {},
    diagnostics: {},
  };

  try {
    for (const [table, required] of Object.entries(REQUIRED)) {
      const schema = table === 'PEDIDOS_CAB' ? 'JAVIER' : 'DSEDAC';
      const columns = await tableColumns(conn, schema, table);
      result.tables[`${schema}.${table}`] = columns;
      result.checks[`${schema}.${table}`] = requiredCoverage(columns, required);
    }

    result.diagnostics.recentCpcSeries = await safeQuery(conn, `
      SELECT TRIM(SERIEPEDIDO) AS SERIEPEDIDO,
             TERMINALPEDIDO,
             TRIM(CODIGOOPERACION) AS CODIGOOPERACION,
             TRIM(SITUACIONPEDIDO) AS SITUACIONPEDIDO,
             COUNT(*) AS CNT
      FROM DSEDAC.CPC
      WHERE EJERCICIOPEDIDO >= YEAR(CURRENT DATE) - 1
      GROUP BY TRIM(SERIEPEDIDO), TERMINALPEDIDO, TRIM(CODIGOOPERACION), TRIM(SITUACIONPEDIDO)
      ORDER BY CNT DESC
      FETCH FIRST 50 ROWS ONLY`);

    result.diagnostics.nextConfiguredNumber = await safeQuery(conn, `
      SELECT COALESCE(MAX(NUMEROPEDIDO), 0) + 1 AS NEXT_NUMERO
      FROM DSEDAC.CPC
      WHERE TRIM(SUBEMPRESAPEDIDO) = ?
        AND EJERCICIOPEDIDO = YEAR(CURRENT DATE)
        AND TRIM(SERIEPEDIDO) = ?
        AND TERMINALPEDIDO = ?`, [
      result.env.pedidosSystemSubempresa,
      result.env.pedidosSystemSerie,
      parseInt(result.env.pedidosSystemTerminal, 10) || 10,
    ]);
  } finally {
    await conn.close();
  }

  const jsonPath = path.join(OUTPUT_DIR, `pedidos-system-inventory-${timestamp}.json`);
  const mdPath = path.join(OUTPUT_DIR, `pedidos-system-inventory-${timestamp}.md`);
  await fs.writeFile(jsonPath, JSON.stringify(result, null, 2), 'utf8');

  const lines = [
    '# Pedidos System Inventory',
    '',
    `Timestamp: ${result.timestamp}`,
    `Target env: ${result.env.pedidosConfirmationSchema}`,
    '',
    '## Required Column Checks',
    ...Object.entries(result.checks).map(([name, check]) =>
      `- ${name}: ${check.ok ? 'OK' : `MISSING ${check.missing.join(', ')}`}`
    ),
    '',
    `JSON: ${jsonPath}`,
  ];
  await fs.writeFile(mdPath, lines.join('\n'), 'utf8');

  console.log(`[pedidos-system-inventory] wrote ${jsonPath}`);
  console.log(`[pedidos-system-inventory] wrote ${mdPath}`);
}

main().catch(error => {
  console.error(error.message);
  if (error.odbcErrors) console.error(JSON.stringify(error.odbcErrors, null, 2));
  process.exit(1);
});
