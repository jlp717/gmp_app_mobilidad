'use strict';

const fs = require('fs/promises');
const path = require('path');
const odbc = require('odbc');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const OUTPUT_DIR = path.resolve(__dirname, '..', 'tmp', 'db-exploration');
const SAMPLE_ROWS = Number(process.env.DB_EXPLORATION_SAMPLE_ROWS || 5);

const TABLES = [
  { schema: 'DSEDAC', table: 'LQD', role: 'ERP liquidaciones reales' },
  { schema: 'JAVIER', table: 'LQD', role: 'Shadow test de LQD con estructura ERP' },
  { schema: 'DSEDAC', table: 'CVC', role: 'Deuda/vencimientos' },
  { schema: 'DSEDAC', table: 'CPC', role: 'Cabecera albaranes/entregas' },
  { schema: 'DSEDAC', table: 'CAC', role: 'Cabecera facturas/albaranes facturados' },
  { schema: 'DSEDAC', table: 'LAC', role: 'Lineas albaran/factura' },
  { schema: 'DSEDAC', table: 'OPP', role: 'Ordenes preparacion/repartidor' },
  { schema: 'DSEDAC', table: 'CLI', role: 'Maestro cliente' },
  { schema: 'DSEDAC', table: 'CLCL1', role: 'Credito cliente confirmado por codigo' },
  { schema: 'DSEDAC', table: 'CVCL1', role: 'Credito cliente candidato mencionado, confirmar existencia' },
  { schema: 'DSEDAC', table: 'CLX', role: 'Flags extra cliente, cobro riguroso' },
  { schema: 'DSEDAC', table: 'CLP', role: 'Contactos/email cliente candidato' },
  { schema: 'DSEDAC', table: 'VDD', role: 'Vendedores/repartidores nombres' },
  { schema: 'DSEDAC', table: 'VDC', role: 'Credenciales/usuarios vendedores' },
  { schema: 'DSEDAC', table: 'VEH', role: 'Vehiculos/repartidores' },
  { schema: 'DSEDAC', table: 'CDVI', role: 'Planificacion visitas/rutas' },
  { schema: 'DSEDAC', table: 'CACFIRMAS', role: 'Firmas ERP' },
  { schema: 'DSED', table: 'LACLAE', role: 'Historico ventas/visitas' },
  { schema: 'JAVIER', table: 'DELIVERY_STATUS', role: 'Estado entrega app test' },
  { schema: 'JAVIER', table: 'REPARTIDOR_COBROS', role: 'Cobros app test/auditoria' },
  { schema: 'JAVIER', table: 'REPARTIDOR_FINANCIAL_BALANCES', role: 'Saldo pendiente app test' },
  { schema: 'JAVIER', table: 'REPARTIDOR_LIQUIDACION_OPS', role: 'Ledger local idempotencia LQD' },
  { schema: 'JAVIER', table: 'REPARTIDOR_LIQUIDACION_EMAILS', role: 'Log emails liquidacion' },
  { schema: 'JAVIER', table: 'REPARTIDOR_COMMISSION_TIERS', role: 'Tramos comisiones repartidor' },
  { schema: 'JAVIER', table: 'REPARTIDOR_ENTREGAS', role: 'Entregas app legacy' },
  { schema: 'JAVIER', table: 'REPARTIDOR_FIRMAS', role: 'Firmas app legacy' },
  { schema: 'JAVIER', table: 'REPARTIDOR_ENTREGA_LINEAS', role: 'Lineas entrega app legacy' },
  { schema: 'JAVIER', table: 'CLIENT_SIGNERS', role: 'Firmantes habituales cliente' },
  { schema: 'JAVIER', table: 'RUTERO_CONFIG', role: 'Overrides ruta' },
];

const DIAGNOSTICS = [
  {
    name: 'CVC_TIPODOCUMENTO_PENDIENTE',
    sql: `
      SELECT TIPODOCUMENTO, COUNT(*) AS DOCUMENTOS, SUM(IMPORTEPENDIENTE) AS IMPORTE
      FROM DSEDAC.CVC
      WHERE COALESCE(ANULADOSN, '') <> 'S'
        AND IMPORTEPENDIENTE <> 0
      GROUP BY TIPODOCUMENTO
      ORDER BY DOCUMENTOS DESC
      FETCH FIRST 50 ROWS ONLY
    `,
  },
  {
    name: 'CLCL1_CAMPOS_CREDITO',
    sql: `
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'DSEDAC'
        AND TABLE_NAME = 'CLCL1'
        AND (
          UPPER(COLUMN_NAME) LIKE '%CREDITO%'
          OR UPPER(COLUMN_NAME) LIKE '%COBRO%'
          OR UPPER(COLUMN_NAME) LIKE '%PAGO%'
          OR UPPER(COLUMN_NAME) LIKE '%RIESGO%'
          OR UPPER(COLUMN_NAME) LIKE '%EMAIL%'
        )
      ORDER BY ORDINAL_POSITION
    `,
  },
  {
    name: 'CLX_CAMPOS_COBRO_RIGUROSO',
    sql: `
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'DSEDAC'
        AND TABLE_NAME = 'CLX'
        AND (
          UPPER(COLUMN_NAME) LIKE '%COBRO%'
          OR UPPER(COLUMN_NAME) LIKE '%RIGU%'
          OR UPPER(COLUMN_NAME) LIKE '%CREDITO%'
        )
      ORDER BY ORDINAL_POSITION
    `,
  },
  {
    name: 'ULTIMAS_LIQUIDACIONES_DSEDAC_LQD',
    sql: `
      SELECT *
      FROM DSEDAC.LQD
      ORDER BY ANOLIQUIDACION DESC, MESLIQUIDACION DESC, DIALIQUIDACION DESC,
               NUMEROLIQUIDACION DESC
      FETCH FIRST 10 ROWS ONLY
    `,
  },
  {
    name: 'ULTIMAS_LIQUIDACIONES_TEST_JAVIER_LQD',
    sql: `
      SELECT *
      FROM JAVIER.LQD
      ORDER BY ANOLIQUIDACION DESC, MESLIQUIDACION DESC, DIALIQUIDACION DESC,
               NUMEROLIQUIDACION DESC
      FETCH FIRST 10 ROWS ONLY
    `,
  },
  {
    name: 'REPARTIDORES_OPP_RECIENTES',
    sql: `
      SELECT TRIM(OPP.CODIGOREPARTIDOR) AS CODIGOREPARTIDOR,
             COUNT(*) AS ENTREGAS,
             MAX(OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) AS ULTIMA_FECHA
      FROM DSEDAC.OPP OPP
      WHERE OPP.ANOREPARTO >= YEAR(CURRENT DATE) - 1
      GROUP BY TRIM(OPP.CODIGOREPARTIDOR)
      ORDER BY ULTIMA_FECHA DESC, ENTREGAS DESC
      FETCH FIRST 50 ROWS ONLY
    `,
  },
  {
    name: 'PLANIFICACION_CDVI_SAMPLE',
    sql: `
      SELECT *
      FROM DSEDAC.CDVI
      FETCH FIRST 20 ROWS ONLY
    `,
  },
];

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
    return {
      ok: false,
      error: error.message,
      odbcErrors: error.odbcErrors || [],
    };
  }
}

async function tableExists(conn, schema, table) {
  const result = await safeQuery(conn, `
    SELECT 1
    FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = ?
    FETCH FIRST 1 ROW ONLY
  `, [schema, table]);
  return result.ok && result.rows.length > 0;
}

async function columns(conn, schema, table) {
  return safeQuery(conn, `
    SELECT
      ORDINAL_POSITION,
      COLUMN_NAME,
      DATA_TYPE,
      LENGTH,
      NUMERIC_SCALE,
      IS_NULLABLE,
      COLUMN_DEFAULT
    FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION
  `, [schema, table]);
}

async function indexes(conn, schema, table) {
  return safeQuery(conn, `
    SELECT INDEX_SCHEMA, INDEX_NAME, COLUMN_NAMES, IS_UNIQUE
    FROM QSYS2.SYSINDEXES
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = ?
    ORDER BY INDEX_SCHEMA, INDEX_NAME
  `, [schema, table]);
}

async function estimatedRows(conn, schema, table) {
  return safeQuery(conn, `
    SELECT NUMBER_ROWS
    FROM QSYS2.SYSTABLESTAT
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = ?
    FETCH FIRST 1 ROW ONLY
  `, [schema, table]);
}

async function sampleRows(conn, schema, table) {
  return safeQuery(conn, `
    SELECT *
    FROM ${schema}.${table}
    FETCH FIRST ${SAMPLE_ROWS} ROWS ONLY
  `);
}

function rowCount(result) {
  if (!result.ok || result.rows.length === 0) return null;
  return result.rows[0].NUMBER_ROWS ?? result.rows[0].number_rows ?? null;
}

function jsonReplacer(_key, value) {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function mdTable(headers, rows) {
  const escape = (value) => String(value ?? '').replace(/\|/g, '\\|');
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${headers.map((header) => escape(row[header])).join(' | ')} |`),
  ].join('\n');
}

function sampleShape(rows) {
  if (!rows || rows.length === 0) return [];
  return Object.keys(rows[0]).map((key) => `${key}=${rows[0][key] === null ? 'NULL' : typeof rows[0][key]}`);
}

function buildMarkdown(report) {
  const lines = [
    '# Repartidor Finanzas - Inventario DB2 Ejecutado',
    '',
    `Generado: ${report.generatedAt}`,
    `DSN: ${report.dsn}`,
    `Muestras por tabla: ${SAMPLE_ROWS}`,
    '',
    '> Este fichero puede contener datos reales si se guarda con muestras. No subirlo a Git.',
    '',
    '## Tablas',
    '',
  ];

  lines.push(mdTable(
    ['schema', 'table', 'role', 'exists', 'estimatedRows', 'columns', 'sampleShape'],
    report.tables.map((table) => ({
      schema: table.schema,
      table: table.table,
      role: table.role,
      exists: table.exists ? 'SI' : 'NO',
      estimatedRows: table.estimatedRows ?? '',
      columns: table.columns.ok ? table.columns.rows.length : `ERROR: ${table.columns.error}`,
      sampleShape: table.sample.ok ? sampleShape(table.sample.rows).join('<br>') : `ERROR: ${table.sample.error}`,
    })),
  ));

  lines.push('', '## Diagnosticos', '');
  for (const diagnostic of report.diagnostics) {
    lines.push(`### ${diagnostic.name}`, '');
    if (!diagnostic.result.ok) {
      lines.push(`ERROR: ${diagnostic.result.error}`, '');
      continue;
    }
    lines.push(`Filas: ${diagnostic.result.rows.length}`, '');
    if (diagnostic.result.rows.length > 0) {
      const headers = Object.keys(diagnostic.result.rows[0]);
      lines.push(mdTable(headers, diagnostic.result.rows), '');
    }
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  let conn;
  try {
    conn = await odbc.connect(connectionString());
    const report = {
      generatedAt: new Date().toISOString(),
      dsn: process.env.ODBC_DSN || 'GMP',
      tables: [],
      diagnostics: [],
    };

    for (const item of TABLES) {
      const exists = await tableExists(conn, item.schema, item.table);
      const tableReport = {
        ...item,
        exists,
        estimatedRows: null,
        columns: { ok: false, rows: [], error: 'TABLE_MISSING' },
        indexes: { ok: false, rows: [], error: 'TABLE_MISSING' },
        sample: { ok: false, rows: [], error: 'TABLE_MISSING' },
      };
      if (exists) {
        tableReport.estimatedRows = rowCount(await estimatedRows(conn, item.schema, item.table));
        tableReport.columns = await columns(conn, item.schema, item.table);
        tableReport.indexes = await indexes(conn, item.schema, item.table);
        tableReport.sample = await sampleRows(conn, item.schema, item.table);
      }
      report.tables.push(tableReport);
      console.log(`[${exists ? 'OK' : 'NO'}] ${item.schema}.${item.table}`);
    }

    for (const diagnostic of DIAGNOSTICS) {
      const result = await safeQuery(conn, diagnostic.sql);
      report.diagnostics.push({ name: diagnostic.name, sql: diagnostic.sql.trim(), result });
      console.log(`[${result.ok ? 'OK' : 'ERR'}] ${diagnostic.name}`);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = path.join(OUTPUT_DIR, `repartidor-finance-db-inventory-${stamp}.json`);
    const mdPath = path.join(OUTPUT_DIR, `repartidor-finance-db-inventory-${stamp}.md`);
    await fs.writeFile(jsonPath, JSON.stringify(report, jsonReplacer, 2), 'utf8');
    await fs.writeFile(mdPath, buildMarkdown(report), 'utf8');
    console.log(`\nInventario JSON: ${jsonPath}`);
    console.log(`Inventario MD:   ${mdPath}`);
  } finally {
    if (conn) await conn.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.message);
  if (error.odbcErrors) console.error(JSON.stringify(error.odbcErrors, null, 2));
  process.exitCode = 1;
});
