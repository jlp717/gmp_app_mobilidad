// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual corbalan | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { initDb, closePool, query } = require('../config/db');

function mask(email) {
  const e = String(email || '').trim();
  if (!e || !e.includes('@')) return { set: false };
  const [local, domain] = e.split('@');
  return { set: true, domain, preview: `${local.slice(0, 2)}***@${domain}` };
}

async function main() {
  await initDb();
  try {
    // Search Corbalan across name + email
    const byName = await query(`
      SELECT TRIM(CODIGOVENDEDOR) C, TRIM(NOMBREVENDEDOR) N
      FROM DSEDAC.VDD
      WHERE TRANSLATE(UPPER(NOMBREVENDEDOR), 'AEIOU', 'ÁÉÍÓÚ') LIKE '%CORBAL%'
         OR TRANSLATE(UPPER(NOMBREVENDEDOR), 'AEIOU', 'ÁÉÍÓÚ') LIKE '%CORVAL%'
         OR UPPER(NOMBREVENDEDOR) LIKE '%CORBALAN%'
         OR UPPER(NOMBREVENDEDOR) LIKE '%CORBALÁN%'
    `);
    console.log('BY_NAME', JSON.stringify(byName));

    const byEmail = await query(`
      SELECT TRIM(V.CODIGOVENDEDOR) C, TRIM(V.NOMBREVENDEDOR) N,
             TRIM(X.CORREOELECTRONICO) E
      FROM DSEDAC.VDD V
      JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
      WHERE UPPER(X.CORREOELECTRONICO) LIKE '%CORBAL%'
         OR UPPER(X.CORREOELECTRONICO) LIKE '%CORVAL%'
    `);
    console.log('BY_EMAIL', JSON.stringify(byEmail.map((r) => ({
      c: r.C, n: r.N, e: mask(r.E),
    }))));

    // All names containing CORB or BALAN
    const fuzzy = await query(`
      SELECT TRIM(CODIGOVENDEDOR) C, TRIM(NOMBREVENDEDOR) N
      FROM DSEDAC.VDD
      WHERE UPPER(NOMBREVENDEDOR) LIKE '%CORB%'
         OR UPPER(NOMBREVENDEDOR) LIKE '%BALAN%'
         OR UPPER(NOMBREVENDEDOR) LIKE '%CARLOS%'
      ORDER BY CODIGOVENDEDOR
    `);
    console.log('FUZZY', JSON.stringify(fuzzy, null, 2));

    // COF company contacts?
    try {
      const cofCols = await query(`
        SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME='COF'
          AND (UPPER(COLUMN_NAME) LIKE '%NOMBRE%' OR UPPER(COLUMN_NAME) LIKE '%CORREO%' OR UPPER(COLUMN_NAME) LIKE '%CODIGO%')
        ORDER BY COLUMN_NAME
      `);
      console.log('COF_COLS', cofCols.map((r) => r.COLUMN_NAME).join(','));
      const cof = await query(`
        SELECT * FROM DSEDAC.COF
        WHERE UPPER(CORREOELECTRONICO) LIKE '%CORBAL%'
           OR UPPER(NOMBRE) LIKE '%CORBAL%'
        FETCH FIRST 10 ROWS ONLY
      `);
      console.log('COF_HIT', cof.length);
    } catch (e) {
      console.log('COF_FAIL', e.message);
    }

    // APP users tables
    const appTables = await query(`
      SELECT TABLE_SCHEMA, TABLE_NAME FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA IN ('JAVIER','DSEDAC')
        AND (UPPER(TABLE_NAME) LIKE '%USUARIO%' OR UPPER(TABLE_NAME) LIKE '%APP_USER%' OR UPPER(TABLE_NAME)='APPUSUARIOS')
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `);
    console.log('APP_TABLES', JSON.stringify(appTables));
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
