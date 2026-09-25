// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual emails v2 | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

const odbc = require('odbc');

function connectionString() {
  const uid = process.env.DB2_UID || process.env.ODBC_UID || 'JAVIER';
  const pwd = process.env.DB2_PWD || process.env.ODBC_PWD;
  if (!pwd) throw new Error('DB2_PWD / ODBC_PWD required');
  return `DSN=GMP;UID=${uid};PWD=${pwd};NAM=1;CCSID=1208;CMPTDM=1;CPTOUT=120;COMMTIMEOUT=180;DBQ=GMP`;
}

async function q(conn, sql, params = []) {
  try {
    return params.length ? await conn.query(sql, params) : await conn.query(sql);
  } catch (error) {
    const odbc0 = error.odbcErrors && error.odbcErrors[0];
    return {
      __error: true,
      message: error.message,
      odbc: odbc0 ? { state: odbc0.state, code: odbc0.code, message: odbc0.message } : null,
      sql: sql.replace(/\s+/g, ' ').slice(0, 240),
    };
  }
}

function section(title, data) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(data, null, 2));
}

async function main() {
  const conn = await odbc.connect(connectionString());
  try {
    section('VDC columns', await q(conn, `
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME='VDC'
      ORDER BY ORDINAL_POSITION
    `));

    section('VDD emails join probe', await q(conn, `
      SELECT TRIM(X.CODIGOVENDEDOR) AS CODIGO,
             TRIM(X.CORREOELECTRONICO) AS EMAIL,
             TRIM(X.JEFEVENTASSN) AS JEFE
      FROM DSEDAC.VDDX X
      WHERE NULLIF(TRIM(X.CORREOELECTRONICO),'') IS NOT NULL
      ORDER BY X.CODIGOVENDEDOR
      FETCH FIRST 120 ROWS ONLY
    `));

    // Try common name columns across vendor tables
    for (const table of ['VDC', 'VDD', 'VDX', 'VEN', 'VEND']) {
      section(`${table} name-like cols`, await q(conn, `
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME=?
          AND (UPPER(COLUMN_NAME) LIKE '%NOMBRE%'
            OR UPPER(COLUMN_NAME) LIKE '%DESCRIP%'
            OR UPPER(COLUMN_NAME) LIKE '%RAZON%')
        ORDER BY COLUMN_NAME
      `, [table]));
    }

    section('Vendors with name from VDC*', await q(conn, `
      SELECT COLUMN_NAME, TABLE_NAME
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA='DSEDAC'
        AND TABLE_NAME LIKE 'VD%'
        AND UPPER(COLUMN_NAME) LIKE '%NOMBRE%'
      ORDER BY TABLE_NAME, COLUMN_NAME
      FETCH FIRST 80 ROWS ONLY
    `));

    // Known names via APP users / almacen
    section('ALMACEN_PERSONAL cols', await q(conn, `
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='ALMACEN_PERSONAL'
      ORDER BY ORDINAL_POSITION
    `));

    section('ALMACEN_PERSONAL emails', await q(conn, `
      SELECT * FROM JAVIER.ALMACEN_PERSONAL
      FETCH FIRST 40 ROWS ONLY
    `));

    for (const table of ['APP_USERS', 'APP_USUARIOS', 'APPUSUARIOS', 'USUARIOS_APP']) {
      section(`${table} exists`, await q(conn, `
        SELECT TABLE_SCHEMA, TABLE_NAME
        FROM QSYS2.SYSTABLES
        WHERE UPPER(TABLE_NAME)=?
        FETCH FIRST 5 ROWS ONLY
      `, [table]));
    }

    section('JAVIER tables with EMAIL col', await q(conn, `
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, LENGTH
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA='JAVIER'
        AND UPPER(COLUMN_NAME) LIKE '%EMAIL%'
      ORDER BY TABLE_NAME, COLUMN_NAME
    `));

    section('REPARTIDOR_LIQUIDACION_EMAILS schema', await q(conn, `
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='REPARTIDOR_LIQUIDACION_EMAILS'
      ORDER BY ORDINAL_POSITION
    `));

    section('REPARTIDOR_LIQUIDACION_EMAILS sample', await q(conn, `
      SELECT * FROM JAVIER.REPARTIDOR_LIQUIDACION_EMAILS
      FETCH FIRST 20 ROWS ONLY
    `));

    section('CUSTOMER_EMAILS schema', await q(conn, `
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='CUSTOMER_EMAILS'
      ORDER BY ORDINAL_POSITION
    `));

    // Find Lacal / Corbalan by scanning VDDX emails domain + any description table
    section('VDD base table?', await q(conn, `
      SELECT TABLE_NAME FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME IN ('VDD','VDC','VDX','VDDX','VEND')
    `));

    // How getVendorName works in codebase usually uses a view — check R1 or similar
    section('get vendor names via common pattern', await q(conn, `
      SELECT TRIM(V.CODIGOVENDEDOR) AS CODIGO,
             TRIM(V.NOMBREVENDEDOR) AS NOMBRE
      FROM DSEDAC.VDD V
      FETCH FIRST 5 ROWS ONLY
    `));

    section('VDD columns', await q(conn, `
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME='VDD'
      ORDER BY ORDINAL_POSITION
      FETCH FIRST 40 ROWS ONLY
    `));

    section('Emails + names join VDD+VDDX', await q(conn, `
      SELECT TRIM(V.CODIGOVENDEDOR) AS CODIGO,
             TRIM(V.NOMBREVENDEDOR) AS NOMBRE,
             TRIM(X.CORREOELECTRONICO) AS EMAIL,
             TRIM(X.JEFEVENTASSN) AS JEFE,
             TRIM(X.PERMITEREPARTOSN) AS REPARTO
      FROM DSEDAC.VDD V
      LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
      WHERE NULLIF(TRIM(X.CORREOELECTRONICO),'') IS NOT NULL
         OR UPPER(V.NOMBREVENDEDOR) LIKE '%LACAL%'
         OR UPPER(V.NOMBREVENDEDOR) LIKE '%CORBAL%'
         OR UPPER(V.NOMBREVENDEDOR) LIKE '%OFICINA%'
      ORDER BY V.CODIGOVENDEDOR
      FETCH FIRST 200 ROWS ONLY
    `));

    // Lat/lng usable for map — planner used LATITUD
    section('Tables with LATITUD+CODIGOCLIENTE', await q(conn, `
      SELECT c1.TABLE_NAME
      FROM QSYS2.SYSCOLUMNS c1
      JOIN QSYS2.SYSCOLUMNS c2
        ON c1.TABLE_SCHEMA=c2.TABLE_SCHEMA AND c1.TABLE_NAME=c2.TABLE_NAME
      WHERE c1.TABLE_SCHEMA='DSEDAC'
        AND UPPER(c1.COLUMN_NAME)='LATITUD'
        AND UPPER(c2.COLUMN_NAME)='LONGITUD'
      ORDER BY c1.TABLE_NAME
    `));

    section('CLX email cols sample', await q(conn, `
      SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME='CLX'
        AND UPPER(COLUMN_NAME) LIKE '%CORREO%'
      ORDER BY COLUMN_NAME
    `));

    section('CRUT notes/obs columns', await q(conn, `
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH, COLUMN_TEXT
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME='CRUT'
        AND (UPPER(COLUMN_NAME) LIKE '%OBS%'
          OR UPPER(COLUMN_NAME) LIKE '%NOTA%'
          OR UPPER(COLUMN_NAME) LIKE '%COME%'
          OR UPPER(COLUMN_NAME) LIKE '%INSTRU%'
          OR UPPER(COLUMN_NAME) LIKE '%PREFER%')
      ORDER BY COLUMN_NAME
    `));
  } finally {
    await conn.close();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
