// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual targets safe v2 | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

const odbc = require('odbc');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

async function main() {
  const pwd = process.env.ODBC_PWD || process.env.DB2_PWD;
  const conn = await odbc.connect(
    `DSN=GMP;UID=JAVIER;PWD=${pwd};NAM=1;CCSID=1208;CMPTDM=1;DBQ=GMP`
  );
  try {
    const lacalEmail = await conn.query(`
      SELECT TRIM(CODIGOVENDEDOR) C, TRIM(CORREOELECTRONICO) E
      FROM DSEDAC.VDDX
      WHERE UPPER(CORREOELECTRONICO) LIKE '%LACAL%'
         OR UPPER(CORREOELECTRONICO) LIKE '%CORBAL%'
         OR UPPER(CORREOELECTRONICO) LIKE '%OFICINA%'
         OR UPPER(CORREOELECTRONICO) LIKE '%PEDIDOS@%'
         OR UPPER(CORREOELECTRONICO) LIKE '%ADMIN@%'
    `);
    console.log(
      'EMAIL_MATCH',
      JSON.stringify(
        lacalEmail.map((r) => ({
          c: r.C,
          domain: String(r.E || '').split('@')[1] || null,
          localLen: String(r.E || '').split('@')[0].length,
          hasLacal: /lacal/i.test(r.E || ''),
          hasCorbal: /corbal/i.test(r.E || ''),
        })),
        null,
        2
      )
    );

    const almacen = await conn.query(`
      SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='ALMACEN_PERSONAL'
    `);
    console.log('ALMACEN_COLS', almacen.map((r) => r.COLUMN_NAME).join(','));

    try {
      const ap = await conn.query(`
        SELECT NOMBRE, EMAIL, ROL, ACTIVO
        FROM JAVIER.ALMACEN_PERSONAL
        FETCH FIRST 40 ROWS ONLY
      `);
      console.log(
        'ALMACEN_ROWS',
        JSON.stringify(
          ap.map((r) => ({
            nombre: r.NOMBRE,
            rol: r.ROL,
            activo: r.ACTIVO,
            emailSet: !!(r.EMAIL && String(r.EMAIL).trim()),
            domain: r.EMAIL && String(r.EMAIL).includes('@')
              ? String(r.EMAIL).split('@')[1]
              : null,
          })),
          null,
          2
        )
      );
    } catch (e) {
      console.log('ALMACEN_SELECT_FAIL', e.message);
    }

    // CPC GPS without ABS if needed
    try {
      const gps = await conn.query(`
        SELECT TRIM(CODIGOCLIENTE) C, LATITUD, LONGITUD
        FROM DSEDAC.CPC
        WHERE LATITUD IS NOT NULL AND LATITUD <> 0
        FETCH FIRST 5 ROWS ONLY
      `);
      console.log('CPC_GPS', gps.length, gps[0]);
    } catch (e) {
      console.log('CPC_FAIL', e.message);
      const alt = await conn.query(`
        SELECT TABLE_NAME, COLUMN_NAME FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME IN ('CPC','LOC','RHJ','TPG')
          AND UPPER(COLUMN_NAME) IN ('CODIGOCLIENTE','LATITUD','LONGITUD','CODIGO')
        ORDER BY TABLE_NAME, COLUMN_NAME
      `);
      console.log('GPS_KEYS', JSON.stringify(alt));
    }

    const obsSample = await conn.query(`
      SELECT TRIM(CODIGOCLIENTE) C,
             TRIM(OBSERVACIONESREPARTO) O,
             HORAREPARTODESDE D,
             HORAREPARTOHASTA H,
             HORAVISITA V
      FROM DSEDAC.CRUT
      WHERE NULLIF(TRIM(OBSERVACIONESREPARTO),'') IS NOT NULL
      FETCH FIRST 15 ROWS ONLY
    `);
    console.log('OBS_REPARTO', JSON.stringify(obsSample, null, 2));

    const lac = await conn.query(`
      SELECT TRIM(CODIGOVENDEDOR) VEND,
             TRIM(CODIGOCOMERCIAL) COM,
             TRIM(CODIGORUTAREPARTO) RUTA,
             COUNT(*) AS N
      FROM DSEDAC.LAC
      WHERE FECHAALBARAN >= CURRENT DATE - 7 DAYS
      GROUP BY CODIGOVENDEDOR, CODIGOCOMERCIAL, CODIGORUTAREPARTO
      ORDER BY 4 DESC
      FETCH FIRST 12 ROWS ONLY
    `);
    console.log('LAC_LINK', JSON.stringify(lac, null, 2));
  } finally {
    await conn.close();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  if (e.odbcErrors) console.error(JSON.stringify(e.odbcErrors));
  process.exit(1);
});
