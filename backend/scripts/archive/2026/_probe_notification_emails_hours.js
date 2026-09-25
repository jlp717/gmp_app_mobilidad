// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual emails notificacion | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Discover production email + delivery-window columns for notification/route features.
 * Read-only. Uses ODBC DSN=GMP.
 */
const odbc = require('odbc');

function connectionString() {
  const uid = process.env.DB2_UID || process.env.ODBC_UID || 'JAVIER';
  const pwd = process.env.DB2_PWD || process.env.ODBC_PWD;
  if (!pwd) throw new Error('DB2_PWD / ODBC_PWD required');
  return `DSN=GMP;UID=${uid};PWD=${pwd};NAM=1;CCSID=1208;CMPTDM=1;CPTOUT=120;COMMTIMEOUT=180;DBQ=GMP`;
}

async function q(conn, sql, params = []) {
  try {
    const rows = params.length ? await conn.query(sql, params) : await conn.query(sql);
    return rows;
  } catch (error) {
    const odbc0 = error.odbcErrors && error.odbcErrors[0];
    return {
      __error: true,
      message: error.message,
      odbc: odbc0 ? { state: odbc0.state, code: odbc0.code, message: odbc0.message } : null,
    };
  }
}

function printSection(title, data) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(data, null, 2));
}

async function main() {
  const conn = await odbc.connect(connectionString());
  try {
    // Columns with CORREO* across DSEDAC + JAVIER
    const correoCols = await q(
      conn,
      `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, LENGTH
       FROM QSYS2.SYSCOLUMNS
       WHERE UPPER(COLUMN_NAME) LIKE '%CORREO%'
         AND TABLE_SCHEMA IN ('DSEDAC', 'JAVIER')
       ORDER BY TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME
       FETCH FIRST 200 ROWS ONLY`
    );
    printSection('CORREO columns DSEDAC/JAVIER', correoCols);

    // VDDX / VDC columns (vendors)
    const vddxCols = await q(
      conn,
      `SELECT COLUMN_NAME, SYSTEM_COLUMN_NAME, DATA_TYPE, LENGTH, COLUMN_TEXT
       FROM QSYS2.SYSCOLUMNS
       WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'VDDX'
       ORDER BY ORDINAL_POSITION`
    );
    printSection('DSEDAC.VDDX columns', vddxCols);

    // Sample vendor emails: Lacal, Corbalan, oficina-ish names
    const vendorEmails = await q(
      conn,
      `SELECT
         TRIM(V.CODIGOVENDEDOR) AS CODIGO,
         TRIM(V.NOMBREVENDEDOR) AS NOMBRE,
         TRIM(X.CORREOELECTRONICO) AS EMAIL,
         TRIM(X.JEFEVENTASSN) AS JEFE
       FROM DSEDAC.VDC V
       LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
       WHERE UPPER(V.NOMBREVENDEDOR) LIKE '%LACAL%'
          OR UPPER(V.NOMBREVENDEDOR) LIKE '%CORBAL%'
          OR UPPER(V.NOMBREVENDEDOR) LIKE '%OFICINA%'
          OR UPPER(V.NOMBREVENDEDOR) LIKE '%ADMIN%'
          OR TRIM(V.CODIGOVENDEDOR) IN ('01','02','98','99','00')
       ORDER BY V.CODIGOVENDEDOR
       FETCH FIRST 80 ROWS ONLY`
    );
    printSection('Vendor emails sample (Lacal/Corbalan/oficina)', vendorEmails);

    // All non-empty VDDX emails (capped)
    const allEmails = await q(
      conn,
      `SELECT
         TRIM(V.CODIGOVENDEDOR) AS CODIGO,
         TRIM(V.NOMBREVENDEDOR) AS NOMBRE,
         TRIM(X.CORREOELECTRONICO) AS EMAIL
       FROM DSEDAC.VDC V
       JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
       WHERE NULLIF(TRIM(X.CORREOELECTRONICO), '') IS NOT NULL
       ORDER BY V.CODIGOVENDEDOR
       FETCH FIRST 200 ROWS ONLY`
    );
    printSection('All non-empty VDDX emails (first 200)', allEmails);

    // CRUT / client route hours
    const hourCols = await q(
      conn,
      `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, SYSTEM_COLUMN_NAME, DATA_TYPE, LENGTH, COLUMN_TEXT
       FROM QSYS2.SYSCOLUMNS
       WHERE TABLE_SCHEMA = 'DSEDAC'
         AND (
           UPPER(COLUMN_NAME) LIKE '%HORA%'
           OR UPPER(COLUMN_NAME) LIKE '%APERT%'
           OR UPPER(COLUMN_NAME) LIKE '%CIERR%'
           OR UPPER(SYSTEM_COLUMN_NAME) LIKE '%HRR%'
           OR UPPER(SYSTEM_COLUMN_NAME) LIKE '%CHO%'
           OR UPPER(SYSTEM_COLUMN_NAME) LIKE '%CIE%'
         )
         AND TABLE_NAME IN ('CRUT', 'CLX', 'CLC', 'CLD', 'CLI', 'RUT', 'RUTC', 'CLIENTES')
       ORDER BY TABLE_NAME, COLUMN_NAME
       FETCH FIRST 300 ROWS ONLY`
    );
    printSection('Hour/open/close columns on client/route tables', hourCols);

    // Broader HRR/CHO/CIE system names anywhere in DSEDAC
    const sysHour = await q(
      conn,
      `SELECT TABLE_NAME, COLUMN_NAME, SYSTEM_COLUMN_NAME, COLUMN_TEXT
       FROM QSYS2.SYSCOLUMNS
       WHERE TABLE_SCHEMA = 'DSEDAC'
         AND (
           TRIM(SYSTEM_COLUMN_NAME) IN ('HRR','CHO','CIE','T8HRRD','T8HRRH','T8HRVI','T8HRLL')
           OR UPPER(TRIM(SYSTEM_COLUMN_NAME)) LIKE 'T8HR%'
           OR UPPER(COLUMN_NAME) LIKE 'HORAREPARTO%'
           OR UPPER(COLUMN_NAME) LIKE 'HORAVISITA%'
           OR UPPER(COLUMN_NAME) LIKE '%APERTURA%'
         )
       ORDER BY TABLE_NAME, COLUMN_NAME
       FETCH FIRST 150 ROWS ONLY`
    );
    printSection('System hour columns DSEDAC', sysHour);

    // Sample CRUT hours with client
    const crutSample = await q(
      conn,
      `SELECT
         TRIM(CODIGOCLIENTE) AS CLIENTE,
         HORAREPARTODESDE,
         HORAREPARTOHASTA,
         HORAVISITA,
         HORALLAMADA
       FROM DSEDAC.CRUT
       WHERE HORAREPARTODESDE IS NOT NULL
          OR HORAREPARTOHASTA IS NOT NULL
          OR HORAVISITA IS NOT NULL
       FETCH FIRST 30 ROWS ONLY`
    );
    printSection('CRUT hour sample', crutSample);

    // JAVIER notification / outbox tables
    const javierNotify = await q(
      conn,
      `SELECT TABLE_NAME
       FROM QSYS2.SYSTABLES
       WHERE TABLE_SCHEMA = 'JAVIER'
         AND (
           UPPER(TABLE_NAME) LIKE '%EMAIL%'
           OR UPPER(TABLE_NAME) LIKE '%OUTBOX%'
           OR UPPER(TABLE_NAME) LIKE '%NOTIF%'
           OR UPPER(TABLE_NAME) LIKE '%ALERT%'
         )
       ORDER BY TABLE_NAME`
    );
    printSection('JAVIER email/outbox/notif tables', javierNotify);

    // GPS lat/lng on clients
    const gpsCols = await q(
      conn,
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, LENGTH
       FROM QSYS2.SYSCOLUMNS
       WHERE TABLE_SCHEMA = 'DSEDAC'
         AND (
           UPPER(COLUMN_NAME) LIKE '%LATIT%'
           OR UPPER(COLUMN_NAME) LIKE '%LONGIT%'
           OR UPPER(COLUMN_NAME) LIKE '%COORD%'
         )
       ORDER BY TABLE_NAME, COLUMN_NAME
       FETCH FIRST 80 ROWS ONLY`
    );
    printSection('GPS columns DSEDAC', gpsCols);

    // How albaran links to comercial / repartidor
    const docVendorCols = await q(
      conn,
      `SELECT TABLE_NAME, COLUMN_NAME
       FROM QSYS2.SYSCOLUMNS
       WHERE TABLE_SCHEMA = 'DSEDAC'
         AND TABLE_NAME IN ('LAC', 'LACX', 'FAC', 'ALB', 'ALC', 'PED', 'PEDC')
         AND (
           UPPER(COLUMN_NAME) LIKE '%VENDEDOR%'
           OR UPPER(COLUMN_NAME) LIKE '%REPART%'
           OR UPPER(COLUMN_NAME) LIKE '%COMERCIAL%'
         )
       ORDER BY TABLE_NAME, COLUMN_NAME
       FETCH FIRST 120 ROWS ONLY`
    );
    printSection('Document vendor/repartidor columns', docVendorCols);
  } finally {
    await conn.close();
  }
}

main().catch((error) => {
  console.error('FATAL', error.message);
  process.exit(1);
});
