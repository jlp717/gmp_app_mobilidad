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
const erpReadSchema = erpSchemaName(
  process.env.REPARTIDOR_FINANCE_READ_SCHEMA ||
  process.env.FINANCE_ERP_READ_SCHEMA ||
  process.env.ERP_READ_SCHEMA ||
  'DSEDAC',
);
const appSchema = erpSchemaName(
  process.env.REPARTIDOR_FINANCE_APP_SCHEMA ||
  process.env.PEDIDOS_CONFIRMATION_SCHEMA ||
  'JAVIER',
);

const tableChecks = [
  [appSchema, 'REPARTIDOR_COBROS'],
  [appSchema, 'DELIVERY_STATUS'],
  [appSchema, 'REPARTIDOR_FINANCIAL_BALANCES'],
  [appSchema, 'REPARTIDOR_LIQUIDACION_OPS'],
  [appSchema, 'REPARTIDOR_LIQUIDACION_EMAILS'],
  [appSchema, 'REPARTIDOR_COMMISSION_TIERS'],
  [erpReadSchema, 'CLI'],
  [erpReadSchema, 'CVC'],
  [erpReadSchema, 'CPC'],
  [erpReadSchema, 'OPP'],
  [erpReadSchema, 'LAC'],
  [erpReadSchema, 'ART'],
  [erpReadSchema, 'CLCL1'],
  [erpReadSchema, 'CLX'],
  [erpSchema, 'LQD'],
];

const columnChecks = [
  [appSchema, 'REPARTIDOR_COBROS', 'IDEMPOTENCY_TOKEN'],
  [appSchema, 'REPARTIDOR_COBROS', 'PANTALLA_ORIGEN'],
  [appSchema, 'REPARTIDOR_COBROS', 'OPERADOR'],
  [appSchema, 'REPARTIDOR_COBROS', 'CREATED_AT'],
  [appSchema, 'REPARTIDOR_LIQUIDACION_OPS', 'IDEMPOTENCY_TOKEN'],
  [appSchema, 'REPARTIDOR_LIQUIDACION_OPS', 'CODIGOVENDEDOR'],
  [appSchema, 'REPARTIDOR_COMMISSION_TIERS', 'THRESHOLD_PCT'],
  [erpReadSchema, 'CLI', 'CODIGOCLIENTE'],
  [erpReadSchema, 'CVC', 'IMPORTEPENDIENTE'],
  [erpReadSchema, 'CPC', 'NUMEROORDENPREPARACION'],
  [erpReadSchema, 'OPP', 'CODIGOREPARTIDOR'],
  [erpReadSchema, 'LAC', 'CODIGOARTICULO'],
  [erpReadSchema, 'ART', 'DESCRIPCIONARTICULO'],
  [erpReadSchema, 'CLCL1', 'DIASLIMITECREDITO'],
  [erpReadSchema, 'CLCL1', 'DIASLIMITECREDITOCONFECHAALB'],
  [erpReadSchema, 'CLX', 'COBRORIGUROSOSN'],
  [erpSchema, 'LQD', 'IDMARCALIQUIDACION'],
];

const columnGroupChecks = [
  {
    label: `${appSchema}.REPARTIDOR_COBROS document layout`,
    alternatives: [
      [
        [appSchema, 'REPARTIDOR_COBROS', 'CODIGOVENDEDOR'],
        [appSchema, 'REPARTIDOR_COBROS', 'CODIGOCLIENTEALBARAN'],
        [appSchema, 'REPARTIDOR_COBROS', 'IMPORTEVENCIMIENTO'],
        [appSchema, 'REPARTIDOR_COBROS', 'NUMEROLIQUIDACION'],
      ],
      [
        [appSchema, 'REPARTIDOR_COBROS', 'CODIGO_REPARTIDOR'],
        [appSchema, 'REPARTIDOR_COBROS', 'CODIGO_CLIENTE'],
        [appSchema, 'REPARTIDOR_COBROS', 'IMPORTE_COBRADO'],
        [appSchema, 'REPARTIDOR_COBROS', 'LIQUIDADO_SN'],
      ],
    ],
  },
  {
    label: `${appSchema}.REPARTIDOR_FINANCIAL_BALANCES repartidor key`,
    alternatives: [
      [[appSchema, 'REPARTIDOR_FINANCIAL_BALANCES', 'CODIGO_REPARTIDOR']],
      [[appSchema, 'REPARTIDOR_FINANCIAL_BALANCES', 'CODIGOVENDEDOR']],
    ],
  },
];

const indexChecks = [
  [appSchema, 'UX_REP_COBROS_TOKEN'],
  [appSchema, 'IDX_REP_COBROS_REP_LIQ_FECHA'],
  [appSchema, 'IDX_REP_LIQ_REP_FECHA'],
  [appSchema, 'IDX_REP_COMM_ACTIVE'],
];

const optionalIndexChecks = [
  [appSchema, 'IDX_REP_COBROS_LIQ_TOKEN'],
];

const optionalConstraintChecks = [
  [appSchema, 'UK_REP_LIQ_TOKEN'],
  [appSchema, 'UK_REP_LIQ_NUMERO'],
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
