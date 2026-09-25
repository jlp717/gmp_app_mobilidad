// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual datos readiness | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { initDb, closePool, query } = require('../config/db');

(async () => {
  await initDb();

  const lines = await query(`
    SELECT TRIM(CHAR(LAC.NUMEROALBARAN)) AS ALB,
           TRIM(LAC.CODIGOARTICULO) AS ART,
           LAC.CANTIDADUNIDADES AS QTY,
           TRIM(COALESCE(LAC.UNIDADMEDIDA,'')) AS UM
      FROM DSEDAC.LAC LAC
     WHERE LAC.CANTIDADUNIDADES <> TRUNC(LAC.CANTIDADUNIDADES)
     FETCH FIRST 10 ROWS ONLY
  `);
  console.log('--- fractional LAC ---');
  for (const r of lines || []) console.log(JSON.stringify(r));

  const debt = await query(`
    SELECT TRIM(CVC.CODIGOVENDEDORCOBRO) AS REP,
           COUNT(*) AS N,
           SUM(CAST(CVC.IMPORTEPENDIENTE AS DECIMAL(15,2))) AS DEUDA
      FROM DSEDAC.CVC CVC
     WHERE COALESCE(CVC.ANULADOSN,'') <> 'S'
       AND CVC.TIPODOCUMENTO IN ('CAC','COC','DEV')
       AND COALESCE(CVC.IMPORTEPENDIENTE,0) <> 0
       AND TRIM(CVC.CODIGOVENDEDORCOBRO) <> ''
     GROUP BY CVC.CODIGOVENDEDORCOBRO
     ORDER BY 3 DESC
     FETCH FIRST 8 ROWS ONLY
  `);
  console.log('--- top debt ---');
  for (const r of debt || []) console.log(JSON.stringify(r));

  try {
    const roles = await query(`SELECT * FROM JAVIER.NOTIFICATION_ROLE_TARGETS`);
    console.log('--- roles ---');
    for (const r of roles || []) console.log(JSON.stringify(r));
  } catch (e) {
    console.log('roles ERR', e.message.slice(0, 120));
  }

  for (const t of [
    'REPARTO_CONFIRMACIONES',
    'REPARTIDOR_COBROS',
    'REPARTIDOR_FINANCIAL_BALANCES',
    'REPARTIDOR_LIQUIDACION_OPS',
    'BKP_DELIVERY_STATUS_20260427',
  ]) {
    try {
      const r = await query(`SELECT COUNT(*) AS N FROM JAVIER.${t}`);
      console.log('COUNT', t, Number(r?.[0]?.N || 0));
    } catch (e) {
      console.log('COUNT', t, 'ERR');
    }
  }

  await closePool();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
