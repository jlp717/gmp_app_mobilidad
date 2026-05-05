'use strict';

const fs = require('fs/promises');
const path = require('path');
const odbc = require('odbc');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const OUTPUT_DIR = path.resolve(__dirname, '..', 'tmp', 'db-exploration');

const TABLES = [
  { schema: 'DSEDAC', table: 'OPP', role: 'Orden preparacion/reparto real: vehiculo, repartidor, fecha' },
  { schema: 'DSEDAC', table: 'VEH', role: 'Maestro vehiculos/camiones' },
  { schema: 'DSEDAC', table: 'VDD', role: 'Maestro vendedores/repartidores' },
  { schema: 'DSEDAC', table: 'CPC', role: 'Cabecera albaranes: cliente/ruta/vendedor' },
  { schema: 'DSEDAC', table: 'CLI', role: 'Maestro clientes' },
  { schema: 'DSEDAC', table: 'CRUT', role: 'Rutero/dias de reparto por cliente' },
  { schema: 'DSEDAC', table: 'CDVI', role: 'Planificacion visitas por vendedor' },
  { schema: 'JAVIER', table: 'PEDIDOS_CAB', role: 'Pedidos app test con reparto/camion' },
  { schema: 'JAVIER', table: 'RUTERO_CONFIG', role: 'Overrides ruta app' },
  { schema: 'JAVIER', table: 'ALMACEN_CAMIONES_CONFIG', role: 'Config dimensiones camion app' },
];

const DIAGNOSTICS = [
  {
    name: 'VEH_CAMPOS_CAMION_CONDUCTOR',
    sql: `
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'DSEDAC'
        AND TABLE_NAME = 'VEH'
        AND (
          UPPER(COLUMN_NAME) LIKE '%VEHIC%'
          OR UPPER(COLUMN_NAME) LIKE '%MATRIC%'
          OR UPPER(COLUMN_NAME) LIKE '%CONDUCT%'
          OR UPPER(COLUMN_NAME) LIKE '%VENDEDOR%'
          OR UPPER(COLUMN_NAME) LIKE '%REPART%'
        )
      ORDER BY ORDINAL_POSITION
    `,
  },
  {
    name: 'OPP_CAMPOS_REPARTO',
    sql: `
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'DSEDAC'
        AND TABLE_NAME = 'OPP'
        AND (
          UPPER(COLUMN_NAME) LIKE '%VEHIC%'
          OR UPPER(COLUMN_NAME) LIKE '%REPART%'
          OR UPPER(COLUMN_NAME) LIKE '%RUTA%'
          OR UPPER(COLUMN_NAME) LIKE '%ALBARAN%'
          OR UPPER(COLUMN_NAME) LIKE '%DIA%'
          OR UPPER(COLUMN_NAME) LIKE '%MES%'
          OR UPPER(COLUMN_NAME) LIKE '%ANO%'
        )
      ORDER BY ORDINAL_POSITION
    `,
  },
  {
    name: 'CPC_CAMPOS_RUTA_CLIENTE',
    sql: `
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'DSEDAC'
        AND TABLE_NAME = 'CPC'
        AND (
          UPPER(COLUMN_NAME) LIKE '%CLIENTE%'
          OR UPPER(COLUMN_NAME) LIKE '%VENDEDOR%'
          OR UPPER(COLUMN_NAME) LIKE '%RUTA%'
          OR UPPER(COLUMN_NAME) LIKE '%ALBARAN%'
        )
      ORDER BY ORDINAL_POSITION
    `,
  },
  {
    name: 'OPP_VEHICULO_REPARTIDOR_RECIENTE',
    sql: `
      SELECT TRIM(OPP.CODIGOVEHICULO) AS CODIGOVEHICULO,
             TRIM(OPP.CODIGOREPARTIDOR) AS CODIGOREPARTIDOR,
             COUNT(*) AS ENTREGAS,
             MAX(OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) AS ULTIMA_FECHA
      FROM DSEDAC.OPP OPP
      WHERE OPP.ANOREPARTO >= YEAR(CURRENT DATE) - 1
        AND TRIM(OPP.CODIGOVEHICULO) <> ''
      GROUP BY TRIM(OPP.CODIGOVEHICULO), TRIM(OPP.CODIGOREPARTIDOR)
      ORDER BY ENTREGAS DESC, ULTIMA_FECHA DESC
      FETCH FIRST 100 ROWS ONLY
    `,
  },
  {
    name: 'CLIENTE_RUTA_CAMION_HISTORICO',
    sql: `
      SELECT TRIM(CPC.CODIGOCLIENTEALBARAN) AS CODIGOCLIENTE,
             TRIM(CPC.CODIGOVENDEDOR) AS CODIGOVENDEDOR,
             TRIM(CPC.CODIGORUTA) AS CODIGORUTA,
             TRIM(OPP.CODIGOVEHICULO) AS CODIGOVEHICULO,
             TRIM(OPP.CODIGOREPARTIDOR) AS CODIGOREPARTIDOR,
             TRIM(VEH.MATRICULA) AS MATRICULA,
             TRIM(VDD.NOMBREVENDEDOR) AS REPARTIDOR,
             COUNT(*) AS ENTREGAS,
             MAX(OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) AS ULTIMA_FECHA
      FROM DSEDAC.OPP OPP
      LEFT JOIN DSEDAC.CPC CPC
        ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
       AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
      LEFT JOIN DSEDAC.VEH VEH ON TRIM(VEH.CODIGOVEHICULO) = TRIM(OPP.CODIGOVEHICULO)
      LEFT JOIN DSEDAC.VDD VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(OPP.CODIGOREPARTIDOR)
      WHERE OPP.ANOREPARTO >= YEAR(CURRENT DATE) - 1
        AND TRIM(OPP.CODIGOVEHICULO) <> ''
      GROUP BY TRIM(CPC.CODIGOCLIENTEALBARAN), TRIM(CPC.CODIGOVENDEDOR),
               TRIM(CPC.CODIGORUTA), TRIM(OPP.CODIGOVEHICULO),
               TRIM(OPP.CODIGOREPARTIDOR), TRIM(VEH.MATRICULA),
               TRIM(VDD.NOMBREVENDEDOR)
      ORDER BY ULTIMA_FECHA DESC, ENTREGAS DESC
      FETCH FIRST 100 ROWS ONLY
    `,
  },
  {
    name: 'CRUT_DIAS_REPARTO_SAMPLE',
    sql: `
      SELECT TRIM(CODIGOCLIENTE) AS CODIGOCLIENTE,
             TRIM(CODIGOVENDEDOR) AS CODIGOVENDEDOR,
             SECUENCIA,
             DIAREPARTOLUNESSN,
             DIAREPARTOMARTESSN,
             DIAREPARTOMIERCOLESSN,
             DIAREPARTOJUEVESSN,
             DIAREPARTOVIERNESSN,
             DIAREPARTOSABADOSN,
             DIAREPARTODOMINGOSN
      FROM DSEDAC.CRUT
      WHERE COALESCE(TRIM(MARCAACTUALIZACION), '') <> 'B'
      FETCH FIRST 100 ROWS ONLY
    `,
  },
  {
    name: 'PEDIDOS_CAB_REPARTO_COLUMNS',
    sql: `
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'JAVIER'
        AND TABLE_NAME = 'PEDIDOS_CAB'
        AND COLUMN_NAME IN (
          'FECHAREPARTO', 'DIAREPARTO', 'MESREPARTO', 'ANOREPARTO',
          'CODIGOREPARTIDOR', 'CODIGOVEHICULO', 'RUTA', 'DIASREPARTO',
          'REPARTO_VALIDADO_SN', 'REPARTO_VALIDADO_AT'
        )
      ORDER BY ORDINAL_POSITION
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

async function tableSnapshot(conn, schema, table) {
  const exists = await safeQuery(conn, `
    SELECT COUNT(*) AS COUNT
    FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = ?
  `, [schema, table]);

  if (!exists.ok || Number(exists.rows?.[0]?.COUNT || 0) === 0) {
    return { exists: false, columns: exists };
  }

  const columns = await safeQuery(conn, `
    SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE
    FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION
  `, [schema, table]);

  const sample = await safeQuery(conn, `
    SELECT *
    FROM ${schema}.${table}
    FETCH FIRST 5 ROWS ONLY
  `);

  return { exists: true, columns, sample };
}

function markdownReport(report) {
  const lines = [
    '# Truck Route Driver Inventory',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Tables',
    '',
  ];

  for (const table of report.tables) {
    lines.push(`### ${table.schema}.${table.table}`);
    lines.push('');
    lines.push(`Role: ${table.role}`);
    lines.push('');
    lines.push(`Exists: ${table.snapshot.exists ? 'yes' : 'no'}`);
    lines.push('');
    if (table.snapshot.columns?.ok) {
      lines.push(`Columns: ${table.snapshot.columns.rows.length}`);
      lines.push('');
    } else if (table.snapshot.columns?.error) {
      lines.push(`Column error: ${table.snapshot.columns.error}`);
      lines.push('');
    }
  }

  lines.push('## Diagnostics', '');
  for (const diag of report.diagnostics) {
    lines.push(`### ${diag.name}`);
    lines.push('');
    lines.push(`Status: ${diag.result.ok ? 'ok' : 'error'}`);
    lines.push('');
    if (diag.result.ok) {
      lines.push(`Rows: ${diag.result.rows.length}`);
    } else {
      lines.push(`Error: ${diag.result.error}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const conn = await odbc.connect(connectionString());

  try {
    const tables = [];
    for (const table of TABLES) {
      tables.push({
        ...table,
        snapshot: await tableSnapshot(conn, table.schema, table.table),
      });
    }

    const diagnostics = [];
    for (const diag of DIAGNOSTICS) {
      diagnostics.push({
        name: diag.name,
        result: await safeQuery(conn, diag.sql),
      });
    }

    const report = {
      generatedAt: new Date().toISOString(),
      tables,
      diagnostics,
    };

    const jsonPath = path.join(OUTPUT_DIR, `truck-route-driver-inventory-${stamp}.json`);
    const mdPath = path.join(OUTPUT_DIR, `truck-route-driver-inventory-${stamp}.md`);
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    await fs.writeFile(mdPath, markdownReport(report), 'utf8');

    console.log(`Wrote ${jsonPath}`);
    console.log(`Wrote ${mdPath}`);
  } finally {
    await conn.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
