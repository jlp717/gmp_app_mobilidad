// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual indices LQD | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { initDb, closePool, query } = require('../config/db');

(async () => {
  await initDb();
  for (const name of ['UX_T_RLO_TOKEN', 'UX_T_RLO_MARKER', 'UX_T_RLO_REP_DAY']) {
    try {
      const cols = await query(`
        SELECT TRIM(COLUMN_NAME) AS C, ORDINAL_POSITION AS O
          FROM QSYS2.SYSKEYS
         WHERE INDEX_SCHEMA='JAVIER' AND INDEX_NAME='${name}'
         ORDER BY ORDINAL_POSITION
      `);
      console.log(name, (cols || []).map((r) => r.C).join(','));
    } catch (e) {
      console.log(name, 'ERR', e.odbcErrors?.[0]?.message || e.message);
    }
  }
  await closePool();
})().catch((e) => { console.error(e); process.exit(1); });
