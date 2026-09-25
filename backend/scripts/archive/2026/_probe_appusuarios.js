// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual appusuarios | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { initDb, closePool, query } = require('../config/db');

function mask(email) {
  const e = String(email || '').trim();
  if (!e.includes('@')) return { set: false };
  const [l, d] = e.split('@');
  return { set: true, domain: d, preview: `${l.slice(0, 2)}***@${d}` };
}

async function main() {
  await initDb();
  try {
    const cols = await query(`
      SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME='APPUSUARIOS'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('APPUSUARIOS_COLS', cols.map((r) => r.COLUMN_NAME).join(','));

    // Sample rows with corbal/lacal/carlos in any text-ish columns we can find
    const nameCols = cols
      .map((r) => r.COLUMN_NAME)
      .filter((c) => /NOMBRE|USER|LOGIN|EMAIL|CORREO|DESCRIP|VENDEDOR/i.test(c));
    console.log('NAMEISH', nameCols.join(','));

    const sample = await query(`
      SELECT * FROM DSEDAC.APPUSUARIOS
      FETCH FIRST 5 ROWS ONLY
    `);
    console.log('SAMPLE_KEYS', sample[0] ? Object.keys(sample[0]).filter((k) => !/^[a-z]/.test(k)).join(',') : 'none');

    // Try common patterns
    for (const sql of [
      `SELECT * FROM DSEDAC.APPUSUARIOS WHERE UPPER(NOMBRE) LIKE '%CORBAL%' OR UPPER(NOMBRE) LIKE '%LACAL%' OR UPPER(NOMBRE) LIKE '%CARLOS%' FETCH FIRST 20 ROWS ONLY`,
      `SELECT * FROM DSEDAC.APPUSUARIOS WHERE UPPER(USUARIO) LIKE '%CORBAL%' OR UPPER(USUARIO) LIKE '%LACAL%' OR UPPER(USUARIO) LIKE '%CARLOS%' FETCH FIRST 20 ROWS ONLY`,
      `SELECT * FROM DSEDAC.APPUSUARIOS WHERE UPPER(EMAIL) LIKE '%CORBAL%' OR UPPER(CORREOELECTRONICO) LIKE '%CORBAL%' FETCH FIRST 20 ROWS ONLY`,
    ]) {
      try {
        const rows = await query(sql);
        console.log('HIT', rows.length, sql.slice(0, 80));
        if (rows.length) {
          console.log(JSON.stringify(rows.slice(0, 5).map((r) => {
            const o = {};
            for (const [k, v] of Object.entries(r)) {
              if (/^[a-z]/.test(k)) continue;
              if (/correo|email/i.test(k)) o[k] = mask(v);
              else if (/nombre|user|login|vendedor|codigo/i.test(k)) o[k] = v;
            }
            return o;
          }), null, 2));
        }
      } catch (e) {
        console.log('SKIP', e.message.slice(0, 120));
      }
    }

    // CPC comercial columns for document link
    const cpc = await query(`
      SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME='CPC'
        AND (UPPER(COLUMN_NAME) LIKE '%COMERCIAL%' OR UPPER(COLUMN_NAME) LIKE '%VENDEDOR%'
          OR UPPER(COLUMN_NAME) LIKE '%EJERCICIO%' OR UPPER(COLUMN_NAME) LIKE '%SERIE%'
          OR UPPER(COLUMN_NAME) LIKE '%TERMINAL%' OR UPPER(COLUMN_NAME) LIKE '%NUMERO%')
      ORDER BY COLUMN_NAME
    `);
    console.log('CPC_KEYS', cpc.map((r) => r.COLUMN_NAME).join(','));
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
