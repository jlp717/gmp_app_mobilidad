'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { initDb, closePool, queryWithParams } = require('../config/db');

const tableChecks = [
  ['JAVIER', 'REPARTIDOR_COBROS'],
  ['JAVIER', 'DELIVERY_STATUS'],
  ['JAVIER', 'REPARTIDOR_FINANCIAL_BALANCES'],
  ['JAVIER', 'REPARTIDOR_LIQUIDACION_OPS'],
  ['JAVIER', 'REPARTIDOR_LIQUIDACION_EMAILS'],
  ['JAVIER', 'REPARTIDOR_COMMISSION_TIERS'],
  ['DSEDAC', 'CLCL1'],
  ['DSEDAC', 'CLX'],
  ['DSEDAC', 'CVC'],
  ['DSEDAC', 'LQD'],
];

const columnChecks = [
  ['JAVIER', 'REPARTIDOR_COBROS', 'ENTREGA_APP_ID'],
  ['JAVIER', 'REPARTIDOR_COBROS', 'IDEMPOTENCY_TOKEN'],
  ['JAVIER', 'REPARTIDOR_COBROS', 'TIPO_DOCUMENTO'],
  ['JAVIER', 'REPARTIDOR_COBROS', 'ORIGEN_DOCUMENTO'],
  ['JAVIER', 'REPARTIDOR_COBROS', 'SUBEMPRESA_DOCUMENTO'],
  ['JAVIER', 'REPARTIDOR_COBROS', 'SERIE_DOCUMENTO'],
  ['JAVIER', 'REPARTIDOR_COBROS', 'TERMINAL_DOCUMENTO'],
  ['JAVIER', 'REPARTIDOR_COBROS', 'XDE_DOCUMENTO'],
  ['JAVIER', 'REPARTIDOR_COBROS', 'DEX_DOCUMENTO'],
  ['JAVIER', 'REPARTIDOR_COBROS', 'PANTALLA_ORIGEN'],
  ['JAVIER', 'REPARTIDOR_COBROS', 'OPERADOR'],
  ['JAVIER', 'REPARTIDOR_COBROS', 'LIQUIDADO_SN'],
  ['JAVIER', 'REPARTIDOR_COBROS', 'LIQUIDACION_TOKEN'],
  ['JAVIER', 'REPARTIDOR_COBROS', 'CREATED_AT'],
  ['JAVIER', 'REPARTIDOR_LIQUIDACION_OPS', 'IDEMPOTENCY_TOKEN'],
  ['JAVIER', 'REPARTIDOR_LIQUIDACION_OPS', 'SALDO_RESULTANTE'],
  ['JAVIER', 'REPARTIDOR_COMMISSION_TIERS', 'THRESHOLD_PCT'],
  ['DSEDAC', 'CLCL1', 'DIASLIMITECREDITO'],
  ['DSEDAC', 'CLCL1', 'DIASLIMITECREDITOCONFECHAALB'],
  ['DSEDAC', 'CLX', 'COBRORIGUROSOSN'],
  ['DSEDAC', 'LQD', 'IDMARCALIQUIDACION'],
];

const indexChecks = [
  ['JAVIER', 'UX_REP_COBROS_TOKEN'],
  ['JAVIER', 'IDX_REP_COBROS_REP_LIQ_FECHA'],
  ['JAVIER', 'IDX_REP_COBROS_LIQ_TOKEN'],
  ['JAVIER', 'IDX_REP_LIQ_REP_FECHA'],
  ['JAVIER', 'IDX_REP_COMM_ACTIVE'],
];

const constraintChecks = [
  ['JAVIER', 'UK_REP_LIQ_TOKEN'],
  ['JAVIER', 'UK_REP_LIQ_NUMERO'],
];

async function tableExists(schema, tableName) {
  const rows = await queryWithParams(`
    SELECT 1
    FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = ?
    FETCH FIRST 1 ROW ONLY
  `, [schema, tableName], false, false);
  return rows.length > 0;
}

async function columnExists(schema, tableName, columnName) {
  const rows = await queryWithParams(`
    SELECT 1
    FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    FETCH FIRST 1 ROW ONLY
  `, [schema, tableName, columnName], false, false);
  return rows.length > 0;
}

async function indexExists(schema, indexName) {
  const rows = await queryWithParams(`
    SELECT 1
    FROM QSYS2.SYSINDEXES
    WHERE INDEX_SCHEMA = ?
      AND INDEX_NAME = ?
    FETCH FIRST 1 ROW ONLY
  `, [schema, indexName], false, false);
  return rows.length > 0;
}

async function constraintExists(schema, constraintName) {
  const rows = await queryWithParams(`
    SELECT 1
    FROM QSYS2.SYSCST
    WHERE CONSTRAINT_SCHEMA = ?
      AND CONSTRAINT_NAME = ?
    FETCH FIRST 1 ROW ONLY
  `, [schema, constraintName], false, false);
  return rows.length > 0;
}

async function main() {
  await initDb();

  const missing = [];
  for (const [schema, tableName] of tableChecks) {
    if (await tableExists(schema, tableName)) {
      console.log(`[OK] TABLE ${schema}.${tableName}`);
    } else {
      missing.push(`TABLE ${schema}.${tableName}`);
      console.log(`[MISSING] TABLE ${schema}.${tableName}`);
    }
  }

  for (const [schema, tableName, columnName] of columnChecks) {
    if (await columnExists(schema, tableName, columnName)) {
      console.log(`[OK] COLUMN ${schema}.${tableName}.${columnName}`);
    } else {
      missing.push(`COLUMN ${schema}.${tableName}.${columnName}`);
      console.log(`[MISSING] COLUMN ${schema}.${tableName}.${columnName}`);
    }
  }

  for (const [schema, indexName] of indexChecks) {
    if (await indexExists(schema, indexName)) {
      console.log(`[OK] INDEX ${schema}.${indexName}`);
    } else {
      missing.push(`INDEX ${schema}.${indexName}`);
      console.log(`[MISSING] INDEX ${schema}.${indexName}`);
    }
  }

  for (const [schema, constraintName] of constraintChecks) {
    if (await constraintExists(schema, constraintName)) {
      console.log(`[OK] CONSTRAINT ${schema}.${constraintName}`);
    } else {
      missing.push(`CONSTRAINT ${schema}.${constraintName}`);
      console.log(`[MISSING] CONSTRAINT ${schema}.${constraintName}`);
    }
  }

  if (missing.length > 0) {
    console.error('\nSchema incompleto. Ejecuta backend/scripts/sql/020_repartidor_finance_tables.sql y repite esta verificacion.');
    process.exitCode = 1;
    return;
  }

  console.log('\nSchema repartidor-finanzas verificado correctamente.');
}

main()
  .catch((error) => {
    console.error(error.message);
    if (error.odbcErrors) {
      console.error(JSON.stringify(error.odbcErrors, null, 2));
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => {});
  });
