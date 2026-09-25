// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual conteos seed test | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query, queryWithParams } = require('../config/db');

async function main() {
  await initDb();
  try {
    const cols = await queryWithParams(
      `SELECT TRIM(COLUMN_NAME) AS N,
              TRIM(DATA_TYPE) AS T,
              IDENTITY,
              IS_NULLABLE,
              COLUMN_DEFAULT
         FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'JAVIER'
          AND TABLE_NAME = 'TEST_REPARTIDOR_FIRMAS'
        ORDER BY ORDINAL_POSITION`,
      [],
    );
    console.log('COLS', JSON.stringify(cols.map((c) => ({
      n: c.N || c.n,
      t: c.T || c.t,
      id: c.IDENTITY,
      nullable: c.IS_NULLABLE,
      def: c.COLUMN_DEFAULT,
    })), null, 2));

    const tables = [
      'TEST_REPARTIDOR_LIQUIDACION_OPS',
      'TEST_REPARTIDOR_COBROS',
      'TEST_REPARTIDOR_LIQUIDACION_INGRESOS',
      'TEST_REPARTIDOR_LIQUIDACION_GASTOS',
      'TEST_REPARTIDOR_FINANCIAL_BALANCES',
      'TEST_REPARTIDOR_COMMISSION_TIERS',
      'TEST_REPARTIDOR_FIRMAS',
      'TEST_NOTIFICATION_ROLE_TARGETS',
      'TEST_DELIVERY_STATUS',
      'TEST_REPARTIDOR_LIQUIDACION_EMAILS',
      'TEST_COBROS',
    ];
    for (const t of tables) {
      const r = await query(`SELECT COUNT(*) AS N FROM JAVIER.${t}`);
      console.log('COUNT', t, Number(r[0].N || r[0].n));
    }
    const sample = await query(`
      SELECT TRIM(CODIGOVENDEDOR) AS V, TRIM(FIRMANOMBRE) AS N, TRIM(FIRMADNI) AS D
        FROM JAVIER.TEST_REPARTIDOR_FIRMAS
       WHERE TRIM(FIRMANOMBRE) <> ''
       FETCH FIRST 3 ROWS ONLY
    `);
    console.log('FIRMAS_SAMPLE', JSON.stringify(sample));
    const ing = await query(`
      SELECT TRIM(CODIGO_REPARTIDOR) AS V, DIA, MES, ANO, IMPORTE
        FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_INGRESOS
       WHERE TRIM(CODIGO_REPARTIDOR) = '08'
       ORDER BY ANO DESC, MES DESC, DIA DESC
       FETCH FIRST 5 ROWS ONLY
    `);
    console.log('INGRESOS_08', JSON.stringify(ing));
    const ops = await query(`
      SELECT TRIM(CODIGOVENDEDOR) AS V, DIALIQUIDACION AS DIA, MESLIQUIDACION AS MES,
             ANOLIQUIDACION AS ANO, IMPORTEINGRESOENBANCO AS ING, STATUS
        FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_OPS
       WHERE TRIM(CODIGOVENDEDOR) = '08'
       ORDER BY ANOLIQUIDACION DESC, MESLIQUIDACION DESC, DIALIQUIDACION DESC
       FETCH FIRST 3 ROWS ONLY
    `);
    console.log('OPS_08', JSON.stringify(ops));
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
