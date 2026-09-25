// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual mapeo nombres tabla | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { initDb, closePool, query } = require('../config/db');

async function count(t) {
  try {
    const r = await query(`SELECT COUNT(*) AS N FROM ${t}`);
    return Number(r?.[0]?.N || 0);
  } catch {
    return -1;
  }
}

async function cols(schema, table) {
  const r = await query(`
    SELECT TRIM(COLUMN_NAME) AS C FROM QSYS2.SYSCOLUMNS
     WHERE TABLE_SCHEMA='${schema}' AND TABLE_NAME='${table}'
     ORDER BY ORDINAL_POSITION`);
  return (r || []).map((x) => String(x.C).trim());
}

(async () => {
  await initDb();

  const sized = await query(`
    SELECT TRIM(TABLE_SCHEMA) AS SCH, TRIM(TABLE_NAME) AS TBL, NUMBER_ROWS AS NROWS
      FROM QSYS2.SYSTABLESTAT
     WHERE TABLE_SCHEMA IN ('JAVIER','DSEDAC','DSED','DSEMOVIL')
       AND (
         TABLE_NAME LIKE '%COBRO%' OR TABLE_NAME LIKE '%LIQUID%' OR TABLE_NAME LIKE '%REPARTO%'
         OR TABLE_NAME LIKE '%REPARTIDOR%' OR TABLE_NAME LIKE '%DELIVERY%' OR TABLE_NAME LIKE '%ENTREG%'
         OR TABLE_NAME LIKE '%FIRMA%' OR TABLE_NAME LIKE '%LQD%' OR TABLE_NAME LIKE '%CONFIRM%'
         OR TABLE_NAME LIKE '%CVC%' OR TABLE_NAME = 'CPC' OR TABLE_NAME = 'CRUT'
       )
       AND NUMBER_ROWS > 0
     ORDER BY NUMBER_ROWS DESC
     FETCH FIRST 60 ROWS ONLY
  `);
  console.log('=== SYSTABLESTAT >0 ===');
  for (const r of sized || []) console.log(`${r.SCH}.${r.TBL}=${r.NROWS}`);

  const exact = [
    'JAVIER.DELIVERY_STATUS','JAVIER.REPARTIDOR_ENTREGAS','JAVIER.REPARTIDOR_ENTREGA_LINEAS',
    'JAVIER.REPARTIDOR_FIRMAS','JAVIER.REPARTIDOR_COBROS','JAVIER.REPARTO_CONFIRMACIONES',
    'JAVIER.REPARTIDOR_LIQUIDACION_OPS','JAVIER.COBROS','JAVIER.COBROS_CAB','JAVIER.LQD_LIQUIDACIONES',
    'JAVIER.LQD_COBROS','JAVIER.BKP_DELIVERY_STATUS_20260427','JAVIER.BKP_REPARTIDOR_COBROS_20260427',
    'JAVIER.BKP_REPARTIDOR_ENTREGAS_20260427','JAVIER.BKP_REPARTIDOR_ENTREGA_LINEAS_20260427',
    'JAVIER.BKP_REPARTIDOR_LIQUIDACION_OPS_20260427','JAVIER.TEST_REPARTO_CONFIRMACIONES',
    'JAVIER.TEST_REPARTIDOR_COBROS','JAVIER.TEST_DELIVERY_STATUS','JAVIER.TEST_REPARTIDOR_ENTREGAS',
    'JAVIER.NOTIFICATION_ROLE_TARGETS','JAVIER.TEST_NOTIFICATION_ROLE_TARGETS',
  ];
  console.log('=== EXACT ===');
  for (const t of exact) console.log(t, await count(t));

  // libraries hosting same table names
  const libs = await query(`
    SELECT TRIM(TABLE_SCHEMA) AS SCH, TRIM(TABLE_NAME) AS TBL
      FROM QSYS2.SYSTABLES
     WHERE TABLE_NAME IN ('REPARTIDOR_COBROS','DELIVERY_STATUS','REPARTIDOR_ENTREGAS','LQD','CVC')
       AND TABLE_TYPE IN ('T','P')
     ORDER BY TABLE_NAME, TABLE_SCHEMA
  `);
  console.log('=== MULTI-LIB ===');
  for (const r of libs || []) console.log(`${r.SCH}.${r.TBL}`);

  const pairs = [
    ['DELIVERY_STATUS','TEST_REPARTO_CONFIRMACIONES'],
    ['DELIVERY_STATUS','REPARTO_CONFIRMACIONES'],
    ['REPARTIDOR_ENTREGAS','TEST_REPARTO_CONFIRMACIONES'],
    ['REPARTIDOR_COBROS','TEST_REPARTIDOR_COBROS'],
    ['BKP_REPARTIDOR_COBROS_20260427','TEST_REPARTIDOR_COBROS'],
    ['BKP_DELIVERY_STATUS_20260427','DELIVERY_STATUS'],
    ['REPARTIDOR_LIQUIDACION_OPS','TEST_REPARTIDOR_LIQUIDACION_OPS'],
    ['BKP_REPARTIDOR_LIQUIDACION_OPS_20260427','TEST_REPARTIDOR_LIQUIDACION_OPS'],
  ];
  console.log('=== OVERLAP ===');
  for (const [a,b] of pairs) {
    const ca = await cols('JAVIER', a);
    const cb = await cols('JAVIER', b);
    if (!ca.length || !cb.length) { console.log(`${a}<->${b} missing a=${ca.length} b=${cb.length}`); continue; }
    const setB = new Set(cb);
    const common = ca.filter((c) => setB.has(c));
    console.log(`${a}(${ca.length})<->${b}(${cb.length}) common=${common.length}`);
    if (common.length) console.log('  common:', common.join(','));
    const onlyA = ca.filter((c) => !setB.has(c)).slice(0, 12);
    const onlyB = cb.filter((c) => !new Set(ca).has(c)).slice(0, 12);
    if (onlyA.length) console.log('  onlyA:', onlyA.join(','));
    if (onlyB.length) console.log('  onlyB:', onlyB.join(','));
  }

  // sample BKP delivery
  try {
    const s = await query(`SELECT * FROM JAVIER.BKP_DELIVERY_STATUS_20260427 FETCH FIRST 3 ROWS ONLY`);
    console.log('=== BKP_DELIVERY sample keys ===', Object.keys(s?.[0] || {}).filter((k) => k === k.toUpperCase()).join(','));
    for (const row of s || []) {
      const clean = {};
      for (const [k,v] of Object.entries(row)) if (k === k.toUpperCase()) clean[k]=v;
      console.log(JSON.stringify(clean));
    }
  } catch (e) { console.log('BKP sample ERR', e.message); }

  await closePool();
})().catch((e) => { console.error(e); process.exit(1); });
