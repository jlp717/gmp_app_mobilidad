// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-tmp | _-scratch gitignored; conteo puntual copia test | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

const path = require('path');

const dbModule = (() => {
  const candidates = [
    '/opt/gmp-api/backend/config/db',
    path.resolve(__dirname, '../config/db'),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) { /* next */ }
  }
  throw new Error('db module not found');
})();

const erpModule = (() => {
  const candidates = [
    '/opt/gmp-api/backend/utils/comercial-erp-tables',
    path.resolve(__dirname, '../utils/comercial-erp-tables'),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) { /* next */ }
  }
  throw new Error('comercial-erp-tables not found');
})();

const { initDb, closePool, queryWithParams } = dbModule;
const { comercialErpReadMap, isIsolatedCommercialTest } = erpModule;

const TABLES = [
  'TEST_CVC', 'TEST_CAC', 'TEST_CPC', 'TEST_LPC', 'TEST_LAC', 'TEST_LACLAE',
  'TEST_CLI', 'TEST_CLC', 'TEST_CLX', 'TEST_LQD', 'TEST_ARA', 'TEST_ART',
  'TEST_FPG', 'TEST_VDDX', 'TEST_PMR',
];

(async () => {
  await initDb();
  const out = {
    isolated: isIsolatedCommercialTest(),
    tableSet: process.env.REPARTO_TABLE_SET || null,
    readMap: comercialErpReadMap(),
    counts: {},
  };
  for (const table of TABLES) {
    try {
      const rows = await queryWithParams(`SELECT COUNT(*) AS C FROM JAVIER.${table}`, []);
      out.counts[table] = Number(rows?.[0]?.C ?? rows?.[0]?.c ?? 0);
    } catch (error) {
      out.counts[table] = `ERR:${String(error.message || error).slice(0, 80)}`;
    }
  }
  console.log(JSON.stringify(out));
  await closePool();
})().catch((error) => {
  console.error(String(error && error.message ? error.message : error).slice(0, 200));
  process.exit(1);
});
