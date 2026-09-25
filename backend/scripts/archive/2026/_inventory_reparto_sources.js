// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-inventory | _-scratch gitignored; inventario puntual fuentes reparto (superado por WS1) | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Read-only: where real repartidor data lives (prod JAVIER, BKP, ERP).
 * Usage: node backend/scripts/_inventory_reparto_sources.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query, queryWithParams } = require('../config/db');

async function exists(schema, table) {
  const rows = await queryWithParams(
    `SELECT 1 AS OK FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        AND TABLE_TYPE IN ('T', 'P')`,
    [schema, table],
  );
  return rows.length > 0;
}

async function count(qualified) {
  try {
    const rows = await query(`SELECT COUNT(*) AS N FROM ${qualified}`);
    return Number(rows?.[0]?.N || 0);
  } catch (err) {
    return `ERR:${String(err.message || err).slice(0, 80)}`;
  }
}

async function cols(schema, table) {
  const rows = await queryWithParams(
    `SELECT TRIM(COLUMN_NAME) AS C FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
  return (rows || []).map((r) => String(r.C || r.c).trim());
}

async function sample(qualified, n = 2) {
  try {
    const rows = await query(`SELECT * FROM ${qualified} FETCH FIRST ${n} ROWS ONLY`);
    return (rows || []).map((row) => {
      const clean = {};
      for (const [k, v] of Object.entries(row)) {
        if (k === k.toUpperCase() && k !== 'FIRMABASE64') {
          const s = v == null ? null : String(v);
          clean[k] = s && s.length > 80 ? `${s.slice(0, 80)}…` : v;
        }
      }
      return clean;
    });
  } catch (err) {
    return [{ ERR: String(err.message || err).slice(0, 120) }];
  }
}

const TABLES = [
  ['JAVIER', 'REPARTO_CONFIRMACIONES'],
  ['JAVIER', 'REPARTO_LINEAS'],
  ['JAVIER', 'REPARTO_EVIDENCIAS'],
  ['JAVIER', 'REPARTO_CONFIRM_EVIDENCIAS'],
  ['JAVIER', 'REPARTIDOR_COBROS'],
  ['JAVIER', 'REPARTIDOR_COBROS_AUDIT'],
  ['JAVIER', 'REPARTIDOR_COMMISSION_TIERS'],
  ['JAVIER', 'REPARTIDOR_FINANCIAL_BALANCES'],
  ['JAVIER', 'REPARTIDOR_LIQUIDACION_EMAILS'],
  ['JAVIER', 'REPARTIDOR_LIQUIDACION_OPS'],
  ['JAVIER', 'REPARTIDOR_LIQUIDACION_GASTOS'],
  ['JAVIER', 'REPARTIDOR_LIQUIDACION_AJUSTES'],
  ['JAVIER', 'REPARTIDOR_LIQUIDACION_INGRESOS'],
  ['JAVIER', 'REPARTIDOR_LIQUIDACION_OUTBOX'],
  ['JAVIER', 'COBROS'],
  ['JAVIER', 'REPARTIDOR_RUTERO_ORDEN'],
  ['JAVIER', 'NOTIFICATION_ROLE_TARGETS'],
  ['JAVIER', 'REPARTO_VARIANCE_OUTBOX'],
  ['JAVIER', 'DELIVERY_STATUS'],
  ['JAVIER', 'REPARTIDOR_ENTREGAS'],
  ['JAVIER', 'REPARTIDOR_ENTREGA_LINEAS'],
  ['JAVIER', 'REPARTIDOR_FIRMAS'],
  ['JAVIER', 'CLIENT_SIGNERS'],
  ['JAVIER', 'BKP_DELIVERY_STATUS_20260427'],
  ['JAVIER', 'BKP_REPARTIDOR_COBROS_20260427'],
  ['JAVIER', 'BKP_REPARTIDOR_LIQUIDACION_OPS_20260427'],
  ['JAVIER', 'BKP_REPARTIDOR_ENTREGAS_20260427'],
  ['JAVIER', 'BKP_REPARTIDOR_ENTREGA_LINEAS_20260427'],
  ['JAVIER', 'BKP_REPARTIDOR_FIRMAS_20260427'],
  ['JAVIER', 'BKP_CLIENT_SIGNERS_20260427'],
  ['DSEDAC', 'LQD'],
  ['DSEDAC', 'CVC'],
  ['DSEDAC', 'CACFIRMAS'],
  ['DSEDAC', 'CPC'],
  ['DSEDAC', 'OPP'],
  ['JAVIER', 'TEST_REPARTO_CONFIRMACIONES'],
  ['JAVIER', 'TEST_REPARTO_LINEAS'],
  ['JAVIER', 'TEST_REPARTO_EVIDENCIAS'],
  ['JAVIER', 'TEST_REPARTO_CONFIRM_EVIDENCIAS'],
  ['JAVIER', 'TEST_REPARTIDOR_COBROS'],
  ['JAVIER', 'TEST_REPARTIDOR_COBROS_AUDIT'],
  ['JAVIER', 'TEST_REPARTIDOR_COMMISSION_TIERS'],
  ['JAVIER', 'TEST_REPARTIDOR_FINANCIAL_BALANCES'],
  ['JAVIER', 'TEST_REPARTIDOR_LIQUIDACION_EMAILS'],
  ['JAVIER', 'TEST_REPARTIDOR_LIQUIDACION_OPS'],
  ['JAVIER', 'TEST_REPARTIDOR_LIQUIDACION_GASTOS'],
  ['JAVIER', 'TEST_REPARTIDOR_LIQUIDACION_AJUSTES'],
  ['JAVIER', 'TEST_REPARTIDOR_LIQUIDACION_INGRESOS'],
  ['JAVIER', 'TEST_REPARTIDOR_LIQUIDACION_OUTBOX'],
  ['JAVIER', 'TEST_COBROS'],
  ['JAVIER', 'TEST_REPARTIDOR_RUTERO_ORDEN'],
  ['JAVIER', 'TEST_NOTIFICATION_ROLE_TARGETS'],
  ['JAVIER', 'TEST_REPARTO_VARIANCE_OUTBOX'],
  ['JAVIER', 'TEST_DELIVERY_STATUS'],
];

async function main() {
  await initDb();
  try {
    console.log('=== COUNTS ===');
    for (const [schema, table] of TABLES) {
      const ok = await exists(schema, table);
      if (!ok) {
        console.log('MISSING'.padEnd(8), `${schema}.${table}`);
        continue;
      }
      const n = await count(`${schema}.${table}`);
      console.log('OK'.padEnd(8), String(n).padStart(10), `${schema}.${table}`);
    }

    console.log('\n=== FIRMA / DNI / NOMBRE COLUMNS ===');
    const firmaTables = [
      ['JAVIER', 'REPARTO_CONFIRMACIONES'],
      ['JAVIER', 'TEST_REPARTO_CONFIRMACIONES'],
      ['JAVIER', 'REPARTO_EVIDENCIAS'],
      ['JAVIER', 'DELIVERY_STATUS'],
      ['JAVIER', 'BKP_DELIVERY_STATUS_20260427'],
      ['JAVIER', 'REPARTIDOR_FIRMAS'],
      ['JAVIER', 'BKP_REPARTIDOR_FIRMAS_20260427'],
      ['JAVIER', 'CLIENT_SIGNERS'],
      ['DSEDAC', 'CACFIRMAS'],
    ];
    for (const [schema, table] of firmaTables) {
      if (!(await exists(schema, table))) {
        console.log('MISSING', `${schema}.${table}`);
        continue;
      }
      const names = await cols(schema, table);
      const hits = names.filter((c) =>
        /FIRMA|DNI|NOMBRE|APELLIDO|RECEPTOR|SIGNER|PATH/i.test(c));
      console.log(`${schema}.${table} (${names.length} cols)`, hits.join(', ') || '(none)');
    }

    console.log('\n=== CVC cobro dates (DIACOBRO>0) ===');
    try {
      const r = await query(`
        SELECT
          COUNT(*) AS TOTAL,
          SUM(CASE WHEN DIACOBRO > 0 THEN 1 ELSE 0 END) AS WITH_COBRO,
          SUM(CASE WHEN DIACOBRO > 0
            AND (ANOCOBRO * 10000 + MESCOBRO * 100 + DIACOBRO)
                >= (YEAR(CURRENT DATE - 45 DAYS) * 10000
                  + MONTH(CURRENT DATE - 45 DAYS) * 100
                  + DAY(CURRENT DATE - 45 DAYS))
            THEN 1 ELSE 0 END) AS COBRO_45D
        FROM DSEDAC.CVC
      `);
      console.log(JSON.stringify(r?.[0] || {}));
    } catch (err) {
      console.log('CVC date probe ERR', err.message);
    }

    console.log('\n=== LQD recent ===');
    try {
      const r = await query(`
        SELECT COUNT(*) AS TOTAL,
               SUM(CASE WHEN (ANOLIQUIDACION * 10000 + MESLIQUIDACION * 100 + DIALIQUIDACION)
                 >= (YEAR(CURRENT DATE - 45 DAYS) * 10000
                   + MONTH(CURRENT DATE - 45 DAYS) * 100
                   + DAY(CURRENT DATE - 45 DAYS)) THEN 1 ELSE 0 END) AS LAST_45D
          FROM DSEDAC.LQD
      `);
      console.log(JSON.stringify(r?.[0] || {}));
    } catch (err) {
      console.log('LQD probe ERR', err.message);
    }

    console.log('\n=== SAMPLES ===');
    for (const t of [
      'JAVIER.BKP_DELIVERY_STATUS_20260427',
      'JAVIER.BKP_REPARTIDOR_COBROS_20260427',
      'JAVIER.BKP_REPARTIDOR_LIQUIDACION_OPS_20260427',
      'JAVIER.BKP_REPARTIDOR_FIRMAS_20260427',
      'DSEDAC.CACFIRMAS',
      'JAVIER.DELIVERY_STATUS',
      'JAVIER.REPARTIDOR_FIRMAS',
    ]) {
      const [schema, table] = t.split('.');
      if (!(await exists(schema, table))) continue;
      const n = await count(t);
      if (n === 0) {
        console.log(t, 'empty');
        continue;
      }
      console.log(t, 'n=', n);
      console.log(JSON.stringify(await sample(t, 1)));
    }
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
