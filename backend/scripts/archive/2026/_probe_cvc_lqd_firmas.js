// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual firmas CVC/LQD | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query } = require('../config/db');

async function main() {
  await initDb();
  try {
    const cobrosCols = await query(`
      SELECT TRIM(COLUMN_NAME) AS C, TRIM(DATA_TYPE) AS T, IS_IDENTITY
        FROM QSYS2.SYSCOLUMNS
       WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='TEST_REPARTIDOR_COBROS'
       ORDER BY ORDINAL_POSITION`);
    console.log('TEST_REPARTIDOR_COBROS cols', (cobrosCols || []).map((r) => r.C).join(','));

    const prodCobrosCols = await query(`
      SELECT COUNT(*) AS N FROM QSYS2.SYSCOLUMNS
       WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='REPARTIDOR_COBROS'`);
    console.log('PROD REPARTIDOR_COBROS colcount', prodCobrosCols?.[0]?.N);

    const cvc = await query(`
      SELECT
        SUM(CASE WHEN NUMEROLIQUIDACION > 0 THEN 1 ELSE 0 END) AS WITH_LIQ,
        SUM(CASE WHEN IMPORTECANCELADO > 0 THEN 1 ELSE 0 END) AS CANCELADO,
        SUM(CASE WHEN IMPORTEPENDIENTE = 0 THEN 1 ELSE 0 END) AS PENDIENTE0,
        SUM(CASE WHEN IMPORTEPENDIENTE > 0 THEN 1 ELSE 0 END) AS PENDIENTE_GT0
      FROM DSEDAC.CVC
    `);
    console.log('CVC flags', JSON.stringify(cvc?.[0]));

    const lqdMoney = await query(`
      SELECT
        SUM(CASE WHEN IMPORTEGASTOS > 0 THEN 1 ELSE 0 END) AS GASTOS_GT0,
        SUM(CASE WHEN IMPORTEINGRESOENBANCO > 0 THEN 1 ELSE 0 END) AS INGRESO_GT0,
        SUM(CASE WHEN IMPORTEEFECTIVO > 0 THEN 1 ELSE 0 END) AS EFECTIVO_GT0,
        SUM(CASE WHEN IMPORTESALDOACTUAL <> 0 THEN 1 ELSE 0 END) AS SALDO_NE0,
        COUNT(DISTINCT TRIM(CODIGOVENDEDOR)) AS VENDORS_45D
      FROM DSEDAC.LQD
      WHERE (ANOLIQUIDACION * 10000 + MESLIQUIDACION * 100 + DIALIQUIDACION)
            >= (YEAR(CURRENT DATE - 45 DAYS) * 10000
              + MONTH(CURRENT DATE - 45 DAYS) * 100
              + DAY(CURRENT DATE - 45 DAYS))
    `);
    console.log('LQD 45d money', JSON.stringify(lqdMoney?.[0]));

    const firmas = await query(`
      SELECT COUNT(*) AS N
        FROM DSEDAC.CACFIRMAS
       WHERE (ANO * 10000 + MES * 100 + DIA)
             >= (YEAR(CURRENT DATE - 45 DAYS) * 10000
               + MONTH(CURRENT DATE - 45 DAYS) * 100
               + DAY(CURRENT DATE - 45 DAYS))
         AND DIA > 0 AND MES > 0 AND ANO > 0
    `);
    console.log('CACFIRMAS 45d', JSON.stringify(firmas?.[0]));

    const firmaSample = await query(`
      SELECT CODIGOVENDEDOR, FIRMANOMBRE, FIRMADNI, NUMEROALBARAN, DIA, MES, ANO, TIPOREGISTRO
        FROM DSEDAC.CACFIRMAS
       WHERE DIA > 0 AND LENGTH(TRIM(FIRMANOMBRE)) > 1
       FETCH FIRST 3 ROWS ONLY
    `);
    console.log('CACFIRMAS sample', JSON.stringify(firmaSample));

    const testOps = await query('SELECT COUNT(*) AS N FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_OPS');
    console.log('TEST ops', testOps?.[0]?.N);

    const gastoCols = await query(`
      SELECT TRIM(COLUMN_NAME) AS C FROM QSYS2.SYSCOLUMNS
       WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='TEST_REPARTIDOR_LIQUIDACION_GASTOS'
       ORDER BY ORDINAL_POSITION`);
    console.log('GASTOS cols', (gastoCols || []).map((r) => r.C).join(','));
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
