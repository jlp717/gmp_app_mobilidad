// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual dim vendedor | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

const odbc = require('odbc');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

async function main() {
  const pwd = process.env.ODBC_PWD || process.env.DB2_PWD;
  const conn = await odbc.connect(
    `DSN=GMP;UID=JAVIER;PWD=${pwd};NAM=1;CCSID=1208;CMPTDM=1;DBQ=GMP`
  );
  try {
    const cols = await conn.query(`
      SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='V_DIM_VENDEDOR'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('V_DIM_VENDEDOR', cols.map((r) => r.COLUMN_NAME).join(','));

    const rows = await conn.query(`
      SELECT *
      FROM JAVIER.V_DIM_VENDEDOR
      WHERE UPPER(NOMBRE) LIKE '%LACAL%'
         OR UPPER(NOMBRE) LIKE '%CORBAL%'
         OR UPPER(NOMBRE) LIKE '%CARLOS%'
         OR CODIGO IN ('A2','30','32','98')
      FETCH FIRST 30 ROWS ONLY
    `);
    console.log(
      'DIM_ROWS',
      JSON.stringify(
        rows.map((r) => {
          const out = {};
          for (const [k, v] of Object.entries(r)) {
            if (/correo|email/i.test(k)) {
              out[k] = v && String(v).trim()
                ? { set: true, domain: String(v).split('@')[1] || null }
                : { set: false };
            } else if (/nombre|codigo|jefe|reparto/i.test(k)) {
              out[k] = v;
            }
          }
          return out;
        }),
        null,
        2
      )
    );

    const dsemovil = await conn.query(`
      SELECT TABLE_SCHEMA, TABLE_NAME FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA='DSEMOVIL' AND TABLE_NAME='CLIENTES'
    `);
    console.log('DSEMOVIL.CLIENTES', dsemovil);

    const gps = await conn.query(`
      SELECT CODIGO, LATITUD, LONGITUD
      FROM DSEMOVIL.CLIENTES
      WHERE LATITUD IS NOT NULL AND LATITUD <> 0
      FETCH FIRST 3 ROWS ONLY
    `);
    console.log('DSEMOVIL_GPS', gps.length, gps[0]);
  } finally {
    await conn.close();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
