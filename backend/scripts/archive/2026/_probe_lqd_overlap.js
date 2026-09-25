// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual solape LQD | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { initDb, closePool, query } = require('../config/db');

async function cols(schema, table) {
  const r = await query(`
    SELECT TRIM(COLUMN_NAME) AS C FROM QSYS2.SYSCOLUMNS
     WHERE TABLE_SCHEMA='${schema}' AND TABLE_NAME='${table}'
     ORDER BY ORDINAL_POSITION`);
  return (r || []).map((x) => String(x.C).trim());
}

(async () => {
  await initDb();
  for (const t of ['JAVIER.LQD', 'DSEDAC.LQD', 'JAVIER.TEST_REPARTIDOR_LIQUIDACION_OPS']) {
    try {
      const r = await query(`SELECT COUNT(*) AS N FROM ${t}`);
      console.log('COUNT', t, Number(r?.[0]?.N || 0));
    } catch (e) {
      console.log('COUNT', t, 'ERR', e.message.slice(0, 60));
    }
  }

  const pairs = [
    ['DSEDAC', 'LQD', 'JAVIER', 'TEST_REPARTIDOR_LIQUIDACION_OPS'],
    ['DSEDAC', 'LQD', 'JAVIER', 'REPARTIDOR_LIQUIDACION_OPS'],
    ['DSEDAC', 'CVC', 'JAVIER', 'TEST_REPARTIDOR_COBROS'],
    ['DSEDAC', 'CVC', 'JAVIER', 'REPARTIDOR_COBROS'],
  ];
  for (const [sa, ta, sb, tb] of pairs) {
    const ca = await cols(sa, ta);
    const cb = await cols(sb, tb);
    const setB = new Set(cb);
    const common = ca.filter((c) => setB.has(c));
    console.log(`${sa}.${ta}(${ca.length})<->${sb}.${tb}(${cb.length}) common=${common.length}`);
    console.log('  common sample:', common.slice(0, 20).join(','));
  }

  // LQD sample
  const sample = await query(`SELECT * FROM DSEDAC.LQD FETCH FIRST 1 ROW ONLY`);
  const keys = Object.keys(sample?.[0] || {}).filter((k) => k === k.toUpperCase());
  console.log('LQD keys', keys.join(','));

  await closePool();
})().catch((e) => { console.error(e); process.exit(1); });
