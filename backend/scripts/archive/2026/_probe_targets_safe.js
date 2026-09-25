// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual targets safe v1 | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

const odbc = require('odbc');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

async function main() {
  const pwd = process.env.ODBC_PWD || process.env.DB2_PWD;
  const conn = await odbc.connect(
    `DSN=GMP;UID=JAVIER;PWD=${pwd};NAM=1;CCSID=1208;CMPTDM=1;DBQ=GMP`
  );
  try {
    const rows = await conn.query(`
      SELECT TRIM(V.CODIGOVENDEDOR) AS C,
             TRIM(V.NOMBREVENDEDOR) AS N,
             CASE WHEN NULLIF(TRIM(X.CORREOELECTRONICO),'') IS NULL THEN 'EMPTY' ELSE 'SET' END AS E,
             LENGTH(TRIM(COALESCE(X.CORREOELECTRONICO,''))) AS L,
             LOWER(TRIM(COALESCE(X.CORREOELECTRONICO,''))) AS EMAIL_LC
      FROM DSEDAC.VDD V
      LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
      WHERE UPPER(V.NOMBREVENDEDOR) LIKE '%LACAL%'
         OR UPPER(V.NOMBREVENDEDOR) LIKE '%CORBAL%'
         OR UPPER(V.NOMBREVENDEDOR) LIKE '%OFICINA%'
         OR UPPER(V.NOMBREVENDEDOR) LIKE '%ADMIN%'
         OR TRIM(V.CODIGOVENDEDOR) IN ('A2','30','98','99','00','32')
      ORDER BY C
    `);
    // Print names + SET/EMPTY only; mask email local-part
    const safe = rows.map((r) => ({
      code: r.C,
      name: r.N,
      emailStatus: r.E,
      emailLen: r.L,
      emailDomain: r.EMAIL_LC && r.EMAIL_LC.includes('@')
        ? r.EMAIL_LC.split('@')[1]
        : null,
    }));
    console.log('TARGETS', JSON.stringify(safe, null, 2));

    const corbal = await conn.query(`
      SELECT TRIM(CODIGOVENDEDOR) C, TRIM(NOMBREVENDEDOR) N
      FROM DSEDAC.VDD
      WHERE UPPER(NOMBREVENDEDOR) LIKE '%CORB%'
         OR UPPER(NOMBREVENDEDOR) LIKE '%CARLOS%'
      ORDER BY CODIGOVENDEDOR
    `);
    console.log('CARLOS_LIKE', JSON.stringify(corbal, null, 2));

    const crutCols = await conn.query(`
      SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME='CRUT'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('CRUT_COLS', crutCols.map((r) => r.COLUMN_NAME).join(','));

    const gps = await conn.query(`
      SELECT TRIM(CODIGOCLIENTE) C, LATITUD, LONGITUD
      FROM DSEDAC.CPC
      WHERE LATITUD IS NOT NULL AND ABS(LATITUD) > 0.1
      FETCH FIRST 5 ROWS ONLY
    `);
    console.log('CPC_GPS_OK', gps.length, gps[0] ? Object.keys(gps[0]) : []);

    // Preferencias / observaciones utiles en CRUT sample non-empty hours
    const windows = await conn.query(`
      SELECT COUNT(*) AS TOTAL,
             SUM(CASE WHEN HORAREPARTODESDE > 0 THEN 1 ELSE 0 END) AS CON_DESDE,
             SUM(CASE WHEN HORAREPARTOHASTA > 0 THEN 1 ELSE 0 END) AS CON_HASTA,
             SUM(CASE WHEN HORAVISITA > 0 THEN 1 ELSE 0 END) AS CON_VISITA,
             SUM(CASE WHEN HORALLAMADA > 0 THEN 1 ELSE 0 END) AS CON_LLAMADA
      FROM DSEDAC.CRUT
    `);
    console.log('CRUT_HOUR_STATS', JSON.stringify(windows));

    // How LAC links comercial for a delivery doc
    const lacSample = await conn.query(`
      SELECT TRIM(CODIGOVENDEDOR) VEND,
             TRIM(CODIGOCOMERCIAL) COM,
             TRIM(CODIGORUTAREPARTO) RUTA,
             COUNT(*) N
      FROM DSEDAC.LAC
      WHERE FECHAALBARAN >= CURRENT_DATE - 7 DAYS
      GROUP BY CODIGOVENDEDOR, CODIGOCOMERCIAL, CODIGORUTAREPARTO
      ORDER BY N DESC
      FETCH FIRST 15 ROWS ONLY
    `);
    console.log('LAC_LINK', JSON.stringify(lacSample, null, 2));
  } finally {
    await conn.close();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
