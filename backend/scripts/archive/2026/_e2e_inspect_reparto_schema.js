// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-e2e | _-scratch gitignored; inspeccion puntual schema reparto | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Read-only: JAVIER.TEST_* + DSEDAC counts. Never DML DSEDAC.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query, queryWithParams } = require('../config/db');
const { LEDGER_COLUMNS, COMMERCIAL_COLUMNS } = require('../repositories/reparto-cobros-db2-port');

const TABLES = [
  'JAVIER.TEST_REPARTIDOR_COBROS',
  'JAVIER.REPARTIDOR_COBROS',
  'JAVIER.TEST_COBROS',
  'JAVIER.COBROS',
  'JAVIER.TEST_DELIVERY_STATUS',
  'JAVIER.TEST_REPARTO_CONFIRMACIONES',
  'JAVIER.TEST_REPARTO_LINEAS',
  'JAVIER.TEST_REPARTO_EVIDENCIAS',
  'JAVIER.TEST_REPARTO_CONFIRM_EVIDENCIAS',
  'JAVIER.TEST_REPARTIDOR_LIQUIDACION_INGRESOS',
  'JAVIER.TEST_REPARTIDOR_LIQUIDACION_GASTOS',
  'JAVIER.TEST_REPARTIDOR_LIQUIDACION_AJUSTES',
  'JAVIER.TEST_REPARTIDOR_RUTERO_ORDEN',
];

async function cols(schema, table) {
  return queryWithParams(
    `SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE, COLUMN_DEFAULT
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
}

async function idx(schema, table) {
  return queryWithParams(
    `SELECT I.INDEX_NAME, I.IS_UNIQUE, K.COLUMN_NAME, K.ORDINAL_POSITION
       FROM QSYS2.SYSINDEXES I
       INNER JOIN QSYS2.SYSKEYS K
         ON K.INDEX_SCHEMA = I.INDEX_SCHEMA AND K.INDEX_NAME = I.INDEX_NAME
      WHERE I.TABLE_SCHEMA = ? AND I.TABLE_NAME = ?
      ORDER BY I.INDEX_NAME, K.ORDINAL_POSITION`,
    [schema, table],
  );
}

async function count(qualified) {
  const rows = await query(`SELECT COUNT(*) AS C FROM ${qualified}`);
  return Number(rows[0]?.C ?? rows[0]?.c ?? 0);
}

function names(rows) {
  return rows.map((r) => String(r.COLUMN_NAME || r.column_name).toUpperCase());
}

async function main() {
  await initDb();
  const report = { tables: {}, dsedac: {}, driver08: {} };

  for (const q of TABLES) {
    const [schema, table] = q.split('.');
    try {
      const c = await cols(schema, table);
      const n = names(c);
      const i = await idx(schema, table);
      const cnt = await count(q);
      report.tables[q] = {
        exists: true,
        count: cnt,
        columns: n,
        indexes: i.map((r) => ({
          name: r.INDEX_NAME || r.index_name,
          unique: r.IS_UNIQUE || r.is_unique,
          col: r.COLUMN_NAME || r.column_name,
        })),
      };
    } catch (err) {
      report.tables[q] = { exists: false, error: String(err.message || err).slice(0, 200) };
    }
  }

  const testCobros = report.tables['JAVIER.TEST_REPARTIDOR_COBROS']?.columns || [];
  const testSet = new Set(testCobros);
  report.cobrosLedgerGap = LEDGER_COLUMNS.filter((c) => !testSet.has(c));
  const testComm = report.tables['JAVIER.TEST_COBROS']?.columns || [];
  const commSet = new Set(testComm);
  report.commercialGap = COMMERCIAL_COLUMNS.filter((c) => !commSet.has(c));

  report.dsedac.lqd = await count('DSEDAC.LQD');
  report.dsedac.cvc = await count('DSEDAC.CVC');
  const cpc = await query(`SELECT COUNT(*) AS C, SUM(CASE WHEN TRIM(CONFORMADOSN)='S' THEN 1 ELSE 0 END) AS S FROM DSEDAC.CPC`);
  report.dsedac.cpc = Number(cpc[0]?.C ?? 0);
  report.dsedac.cpcConformadoS = Number(cpc[0]?.S ?? 0);

  const ing08 = await queryWithParams(
    `SELECT ID, CODIGO_REPARTIDOR, DIA, MES, ANO, IMPORTE, REFERENCIA, STATUS, CREATED_AT
       FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_INGRESOS
      WHERE TRIM(CODIGO_REPARTIDOR) = ?
        AND ANO = 2026 AND MES = 8 AND DIA = 12
      FETCH FIRST 5 ROWS ONLY`,
    ['08'],
  );
  report.driver08.ingresos12 = ing08;
  const gas08 = await queryWithParams(
    `SELECT COUNT(*) AS C FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_GASTOS
      WHERE TRIM(CODIGO_REPARTIDOR) = ?`,
    ['08'],
  );
  report.driver08.gastos = Number(gas08[0]?.C ?? 0);

  const dsCols = report.tables['JAVIER.TEST_DELIVERY_STATUS']?.columns || [];
  report.deliveryStatusShape = {
    hasStatus: dsCols.includes('STATUS'),
    hasConformado: dsCols.includes('CONFORMADOSN'),
    hasEstado: dsCols.includes('ESTADO'),
    hasIdempotency: dsCols.includes('IDEMPOTENCY_TOKEN'),
    hasEjercicio: dsCols.includes('EJERCICIOALBARAN'),
  };

  console.log(JSON.stringify(report, (_, v) => (typeof v === 'bigint' ? String(v) : v), 2));
  await closePool();
}

main().catch(async (err) => {
  console.error(String(err && err.stack || err));
  try { await closePool(); } catch (_) { /* ignore */ }
  process.exit(1);
});
