// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual GPS LAC | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

const odbc = require('odbc');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

async function main() {
  const pwd = process.env.ODBC_PWD || process.env.DB2_PWD;
  const conn = await odbc.connect(
    `DSN=GMP;UID=JAVIER;PWD=${pwd};NAM=1;CCSID=1208;CMPTDM=1;DBQ=GMP`
  );
  try {
    const loc = await conn.query(`
      SELECT TRIM(CODIGOCLIENTE) C, LATITUD, LONGITUD
      FROM DSEDAC.LOC
      WHERE LATITUD IS NOT NULL AND LATITUD <> 0
      FETCH FIRST 5 ROWS ONLY
    `);
    console.log('LOC_GPS', loc.length, loc[0]);

    const lacCols = await conn.query(`
      SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME='LAC'
        AND (UPPER(COLUMN_NAME) LIKE '%FECHA%'
          OR UPPER(COLUMN_NAME) LIKE '%VENDEDOR%'
          OR UPPER(COLUMN_NAME) LIKE '%COMERCIAL%'
          OR UPPER(COLUMN_NAME) LIKE '%REPART%')
      ORDER BY COLUMN_NAME
    `);
    console.log('LAC_DATE_VENDOR', lacCols.map((r) => r.COLUMN_NAME).join(','));

    // Any table with Lacal email text
    const tables = await conn.query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA IN ('DSEDAC','JAVIER')
        AND UPPER(COLUMN_NAME) LIKE '%CORREO%'
        AND TABLE_NAME NOT LIKE '%L1'
      ORDER BY TABLE_SCHEMA, TABLE_NAME
      FETCH FIRST 80 ROWS ONLY
    `);
    console.log('CORREO_TABLES', tables.map((t) => `${t.TABLE_SCHEMA}.${t.TABLE_NAME}.${t.COLUMN_NAME}`).join('\n'));

    // BKIABE might be address book
    try {
      const bki = await conn.query(`
        SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME='BKIABE'
        ORDER BY ORDINAL_POSITION
        FETCH FIRST 40 ROWS ONLY
      `);
      console.log('BKIABE', bki.map((r) => r.COLUMN_NAME).join(','));
      const bkiRows = await conn.query(`
        SELECT * FROM DSEDAC.BKIABE
        WHERE UPPER(CORREOELECTRONICO) LIKE '%LACAL%'
           OR UPPER(CORREOELECTRONICO) LIKE '%CORBAL%'
           OR UPPER(NOMBRE) LIKE '%LACAL%'
           OR UPPER(NOMBRE) LIKE '%CORBAL%'
        FETCH FIRST 20 ROWS ONLY
      `);
      console.log('BKIABE_HIT', bkiRows.length);
    } catch (e) {
      console.log('BKIABE_FAIL', e.message);
    }
  } finally {
    await conn.close();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
