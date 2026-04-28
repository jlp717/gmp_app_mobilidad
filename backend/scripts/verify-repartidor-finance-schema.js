'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { initDb, closePool, queryWithParams } = require('../config/db');

function erpSchemaName(raw) {
  const schema = String(raw || 'JAVIER').trim().toUpperCase();
  if (!['JAVIER', 'DSEDAC'].includes(schema)) {
    throw new Error(
      `REPARTIDOR_FINANCE_ERP_SCHEMA invalido: ${schema}. Use JAVIER o DSEDAC.`,
    );
  }
  return schema;
}

const erpSchema = erpSchemaName(
  process.env.REPARTIDOR_FINANCE_ERP_SCHEMA || process.env.FINANCE_ERP_SCHEMA,
);

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
  [erpSchema, 'LQD'],
];

const columnChecks = [
  ['JAVIER', 'REPARTIDOR_COBROS', 'IDEMPOTENCY_TOKEN'],
  ['JAVIER', 'REPARTIDOR_COBROS', 'PANTALLA_ORIGEN'],
  ['JAVIER', 'REPARTIDOR_COBROS', 'OPERADOR'],
  ['JAVIER', 'REPARTIDOR_COBROS', 'CREATED_AT'],
  ['JAVIER', 'REPARTIDOR_LIQUIDACION_OPS', 'IDEMPOTENCY_TOKEN'],
  ['JAVIER', 'REPARTIDOR_LIQUIDACION_OPS', 'CODIGOVENDEDOR'],
  ['JAVIER', 'REPARTIDOR_COMMISSION_TIERS', 'THRESHOLD_PCT'],
  ['DSEDAC', 'CLCL1', 'DIASLIMITECREDITO'],
  ['DSEDAC', 'CLCL1', 'DIASLIMITECREDITOCONFECHAALB'],
  ['DSEDAC', 'CLX', 'COBRORIGUROSOSN'],
  ['DSEDAC', 'LQD', 'IDMARCALIQUIDACION'],
  [erpSchema, 'LQD', 'IDMARCALIQUIDACION'],
];

const columnGroupChecks = [
  {
    label: 'JAVIER.REPARTIDOR_COBROS document layout',
    alternatives: [
      [
        ['JAVIER', 'REPARTIDOR_COBROS', 'CODIGOVENDEDOR'],
        ['JAVIER', 'REPARTIDOR_COBROS', 'CODIGOCLIENTEALBARAN'],
        ['JAVIER', 'REPARTIDOR_COBROS', 'IMPORTEVENCIMIENTO'],
        ['JAVIER', 'REPARTIDOR_COBROS', 'NUMEROLIQUIDACION'],
      ],
      [
        ['JAVIER', 'REPARTIDOR_COBROS', 'CODIGO_REPARTIDOR'],
        ['JAVIER', 'REPARTIDOR_COBROS', 'CODIGO_CLIENTE'],
        ['JAVIER', 'REPARTIDOR_COBROS', 'IMPORTE_COBRADO'],
        ['JAVIER', 'REPARTIDOR_COBROS', 'LIQUIDADO_SN'],
      ],
    ],
  },
  {
    label: 'JAVIER.REPARTIDOR_FINANCIAL_BALANCES repartidor key',
    alternatives: [
      [['JAVIER', 'REPARTIDOR_FINANCIAL_BALANCES', 'CODIGO_REPARTIDOR']],
      [['JAVIER', 'REPARTIDOR_FINANCIAL_BALANCES', 'CODIGOVENDEDOR']],
    ],
  },
];

const indexChecks = [
  ['JAVIER', 'UX_REP_COBROS_TOKEN'],
  ['JAVIER', 'IDX_REP_COBROS_REP_LIQ_FECHA'],
  ['JAVIER', 'IDX_REP_LIQ_REP_FECHA'],
  ['JAVIER', 'IDX_REP_COMM_ACTIVE'],
];

const optionalIndexChecks = [
  ['JAVIER', 'IDX_REP_COBROS_LIQ_TOKEN'],
];

const optionalConstraintChecks = [
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

  for (const group of columnGroupChecks) {
    let ok = false;
    for (const alternative of group.alternatives) {
      const results = await Promise.all(
        alternative.map(([schema, tableName, columnName]) =>
          columnExists(schema, tableName, columnName)
        ),
      );
      if (results.every(Boolean)) {
        ok = true;
        break;
      }
    }
    if (ok) {
      console.log(`[OK] COLUMN GROUP ${group.label}`);
    } else {
      missing.push(`COLUMN GROUP ${group.label}`);
      console.log(`[MISSING] COLUMN GROUP ${group.label}`);
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

  for (const [schema, indexName] of optionalIndexChecks) {
    if (await indexExists(schema, indexName)) {
      console.log(`[OK] OPTIONAL INDEX ${schema}.${indexName}`);
    } else {
      console.log(`[WARN] OPTIONAL INDEX ${schema}.${indexName} no existe en este layout`);
    }
  }

  for (const [schema, constraintName] of optionalConstraintChecks) {
    if (await constraintExists(schema, constraintName)) {
      console.log(`[OK] OPTIONAL CONSTRAINT ${schema}.${constraintName}`);
    } else {
      console.log(`[WARN] OPTIONAL CONSTRAINT ${schema}.${constraintName} no existe en este layout`);
    }
  }

  if (missing.length > 0) {
    console.error('\nSchema incompleto. Revisa 020/024 de repartidor-finanzas y repite esta verificacion.');
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
