'use strict';

/**
 * JAVIER <-> DSEDAC alignment audit
 * =================================
 *
 * Non-destructive DB2 audit for the commercial Pedidos/Cobros cutover path.
 * It verifies the app-side test schema (JAVIER by default) against the ERP
 * production schema (DSEDAC by default), then writes JSON and Markdown reports.
 *
 * This script does not execute DDL/DML. Any migration suggestion is emitted as
 * text only and must be reviewed before execution.
 */

const fs = require('fs/promises');
const path = require('path');
const odbc = require('odbc');
const db2ConnectionString = require('./db2-connection');

const OUTPUT_DIR = path.resolve(__dirname, '..', 'tmp', 'db-exploration');

const APP_SCHEMA = String(process.env.PEDIDOS_CONFIRMATION_SCHEMA || 'JAVIER')
  .trim()
  .toUpperCase();
const ERP_SCHEMA = String(process.env.ERP_SCHEMA || 'DSEDAC')
  .trim()
  .toUpperCase();

const TABLE_PAIRS = [
  {
    feature: 'PEDIDOS_COMERCIAL',
    severity: 'BLOCK',
    test: `${APP_SCHEMA}.PEDIDOS_CAB`,
    production: `${ERP_SCHEMA}.CPC`,
    reason: 'Cabecera de pedidos comerciales. Debe migrar a CPC sin perdida.',
  },
  {
    feature: 'PEDIDOS_COMERCIAL',
    severity: 'BLOCK',
    test: `${APP_SCHEMA}.PEDIDOS_LIN`,
    production: `${ERP_SCHEMA}.LPC`,
    reason: 'Lineas de pedidos comerciales. Debe migrar a LPC sin perdida.',
  },
  {
    feature: 'COBROS_COMERCIAL',
    severity: 'BLOCK',
    test: `${APP_SCHEMA}.COBROS`,
    production: `${ERP_SCHEMA}.CRC`,
    reason: 'Registro de cobros comerciales. Debe poder exportarse al ERP.',
  },
  {
    feature: 'COBROS_COMERCIAL',
    severity: 'REVIEW',
    test: `${APP_SCHEMA}.REPARTIDOR_COBROS`,
    production: `${ERP_SCHEMA}.CRCA`,
    reason: 'Aplicacion de cobros contra albaranes; afecta saldos mostrados a comerciales.',
  },
  {
    feature: 'RUTERO_ENTREGAS',
    severity: 'REVIEW',
    test: `${APP_SCHEMA}.DELIVERY_STATUS`,
    production: `${ERP_SCHEMA}.CPC`,
    reason: 'Estado app-side de entregas comparado con cabecera ERP.',
  },
  {
    feature: 'RUTERO_ENTREGAS',
    severity: 'REVIEW',
    test: `${APP_SCHEMA}.REPARTIDOR_ENTREGA_LINEAS`,
    production: `${ERP_SCHEMA}.LAC`,
    reason: 'Lineas de entrega/albaran para validacion cruzada de stock y firmas.',
  },
  {
    feature: 'CLIENTES',
    severity: 'REVIEW',
    test: `${APP_SCHEMA}.CLIENT_SIGNERS`,
    production: `${ERP_SCHEMA}.CLI`,
    reason: 'Firmantes app-side vinculados a clientes ERP.',
  },
];

const REQUIRED_PRODUCTION_TABLES = [
  { feature: 'PEDIDOS_COMERCIAL', table: `${ERP_SCHEMA}.CPC`, purpose: 'cabeceras de pedido' },
  { feature: 'PEDIDOS_COMERCIAL', table: `${ERP_SCHEMA}.LPC`, purpose: 'lineas de pedido' },
  { feature: 'PEDIDOS_COMERCIAL', table: `${ERP_SCHEMA}.OCPC`, purpose: 'observaciones de pedido' },
  { feature: 'PEDIDOS_COMERCIAL', table: `${ERP_SCHEMA}.ART`, purpose: 'catalogo de articulos' },
  { feature: 'PEDIDOS_COMERCIAL', table: `${ERP_SCHEMA}.ARO`, purpose: 'stock por almacen usado por pedidos.service.js' },
  { feature: 'COBROS_COMERCIAL', table: `${ERP_SCHEMA}.CVC`, purpose: 'deuda viva y vencimientos' },
  { feature: 'COBROS_COMERCIAL', table: `${ERP_SCHEMA}.CRC`, purpose: 'cabecera de cobro' },
  { feature: 'COBROS_COMERCIAL', table: `${ERP_SCHEMA}.CRCA`, purpose: 'aplicacion de cobro' },
  { feature: 'CLIENTES', table: `${ERP_SCHEMA}.CLI`, purpose: 'clientes' },
  { feature: 'CLIENTES', table: `${ERP_SCHEMA}.CLC`, purpose: 'datos comerciales cliente' },
  { feature: 'CLIENTES', table: `${ERP_SCHEMA}.CLP`, purpose: 'vendedor/riesgo cliente' },
];

const REQUIRED_APP_ONLY_TABLES = [
  {
    feature: 'BOLSA_COMERCIAL',
    table: `${APP_SCHEMA}.BOLSA_COMERCIAL`,
    purpose: 'saldo mensual por vendedor; vive solo en JAVIER por diseno',
    severity: 'BLOCK',
  },
  {
    feature: 'BOLSA_COMERCIAL',
    table: `${APP_SCHEMA}.MOVIMIENTOS_BOLSA`,
    purpose: 'ledger idempotente de movimientos de bolsa; vive solo en JAVIER por diseno',
    severity: 'BLOCK',
  },
  {
    feature: 'PEDIDOS_COMERCIAL',
    table: `${APP_SCHEMA}.PEDIDOS_SEQ`,
    purpose: 'secuencia app-side de pedidos',
    severity: 'REVIEW',
  },
  {
    feature: 'PEDIDOS_COMERCIAL',
    table: `${APP_SCHEMA}.PEDIDOS_STOCK_RESERVE`,
    purpose: 'reservas app-side de stock',
    severity: 'REVIEW',
  },
];


const ACCEPTED_SEMANTIC_TYPE_MISMATCHES = [
  {
    test: `${APP_SCHEMA}.COBROS`,
    production: `${ERP_SCHEMA}.CRC`,
    column: 'ID',
    category: 'SEMANTIC_OVERRIDE',
    reason: 'JAVIER.COBROS.ID is the app UUID/idempotency token; DSEDAC.CRC.ID is the ERP integer identifier. They intentionally share a name but not semantics or type.',
  },
];
function splitQualifiedName(qualifiedName) {
  const [schema, table] = String(qualifiedName || '').split('.');
  if (!schema || !table) {
    throw new Error(`Invalid qualified table name: ${qualifiedName}`);
  }
  return { schema, table };
}

function normalizeName(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeColumn(row) {
  return {
    name: normalizeName(row.COLUMN_NAME),
    type: normalizeName(row.DATA_TYPE),
    length: Number(row.LENGTH || row.CHARACTER_MAXIMUM_LENGTH || 0),
    scale: Number(row.NUMERIC_SCALE || row.SCALE || 0),
    nullable: normalizeName(row.IS_NULLABLE || row.NULLS),
    defaulted: normalizeName(row.HAS_DEFAULT || ''),
    text: String(row.COLUMN_TEXT || row.LONG_COMMENT || '').trim(),
    ordinal: Number(row.ORDINAL_POSITION || 0),
  };
}

function typeSignature(column) {
  return `${column.type}(${column.length},${column.scale})`;
}

function isCompatibleType(testColumn, productionColumn) {
  if (typeSignature(testColumn) === typeSignature(productionColumn)) return true;

  const numericTypes = new Set([
    'BIGINT',
    'DECIMAL',
    'DECFLOAT',
    'DOUBLE',
    'FLOAT',
    'INTEGER',
    'NUMERIC',
    'PACKED',
    'REAL',
    'SMALLINT',
    'ZONED',
  ]);
  const stringTypes = new Set(['CHAR', 'CHARACTER', 'VARCHAR', 'CLOB']);
  const dateTypes = new Set(['DATE', 'TIME', 'TIMESTAMP']);

  const bothNumeric = numericTypes.has(testColumn.type) && numericTypes.has(productionColumn.type);
  const bothString = stringTypes.has(testColumn.type) && stringTypes.has(productionColumn.type);
  const bothDate = dateTypes.has(testColumn.type) && dateTypes.has(productionColumn.type);

  if (bothNumeric) {
    return testColumn.length >= productionColumn.length && testColumn.scale >= productionColumn.scale;
  }
  if (bothString) {
    return testColumn.length >= productionColumn.length;
  }
  return bothDate;
}

function sqlTypeFor(column) {
  const type = column.type;
  const length = Number(column.length || 0);
  const scale = Number(column.scale || 0);

  if (['DECIMAL', 'NUMERIC', 'PACKED', 'ZONED'].includes(type)) {
    return `${type}(${length || 10},${scale || 0})`;
  }
  if (['CHAR', 'CHARACTER', 'VARCHAR', 'GRAPHIC', 'VARGRAPHIC'].includes(type)) {
    return `${type}(${length || 1})`;
  }
  if (['BIGINT', 'INTEGER', 'SMALLINT', 'DATE', 'TIME', 'TIMESTAMP'].includes(type)) {
    return type;
  }
  if (length > 0 && scale > 0) return `${type}(${length},${scale})`;
  if (length > 0) return `${type}(${length})`;
  return type;
}

async function queryRows(connection, sql, params = []) {
  return connection.query(sql, params);
}

async function getTableInfo(connection, schema, table) {
  const rows = await queryRows(connection, `
    SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
    FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = ?
    FETCH FIRST 1 ROW ONLY
  `, [schema, table]);

  if (!rows.length) {
    return { exists: false, schema, table, type: null };
  }

  return {
    exists: true,
    schema,
    table,
    type: normalizeName(rows[0].TABLE_TYPE),
  };
}

async function getColumns(connection, schema, table) {
  const rows = await queryRows(connection, `
    SELECT COLUMN_NAME,
           DATA_TYPE,
           LENGTH,
           NUMERIC_SCALE,
           IS_NULLABLE,
           HAS_DEFAULT,
           COLUMN_TEXT,
           ORDINAL_POSITION
    FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION
  `, [schema, table]);

  return rows.map(normalizeColumn);
}

function acceptedSemanticTypeMismatch(pair, columnName) {
  const column = normalizeName(columnName);
  return ACCEPTED_SEMANTIC_TYPE_MISMATCHES.find(override =>
    normalizeName(override.test) === normalizeName(pair.test) &&
    normalizeName(override.production) === normalizeName(pair.production) &&
    normalizeName(override.column) === column
  ) || null;
}

function compareColumnSets(pair, testColumns, productionColumns) {
  const testByName = new Map(testColumns.map(column => [column.name, column]));
  const productionByName = new Map(productionColumns.map(column => [column.name, column]));
  const shared = [];
  const missingInTest = [];
  const appOnly = [];
  const typeMismatches = [];
  const acceptedSemanticTypeMismatches = [];

  for (const productionColumn of productionColumns) {
    const testColumn = testByName.get(productionColumn.name);
    if (!testColumn) {
      missingInTest.push(productionColumn);
      continue;
    }

    shared.push(productionColumn.name);
    if (!isCompatibleType(testColumn, productionColumn)) {
      const mismatch = {
        column: productionColumn.name,
        test: typeSignature(testColumn),
        production: typeSignature(productionColumn),
      };
      const semanticOverride = acceptedSemanticTypeMismatch(pair, productionColumn.name);
      if (semanticOverride) {
        acceptedSemanticTypeMismatches.push({
          ...mismatch,
          accepted: true,
          category: semanticOverride.category,
          reason: semanticOverride.reason,
        });
      } else {
        typeMismatches.push(mismatch);
      }
    }
  }

  for (const testColumn of testColumns) {
    if (!productionByName.has(testColumn.name)) {
      appOnly.push(testColumn);
    }
  }

  return {
    shared,
    missingInTest,
    appOnly,
    typeMismatches,
    acceptedSemanticTypeMismatches,
    productionColumnCount: productionColumns.length,
    testColumnCount: testColumns.length,
  };
}
function classifyPair(pair, diff, tableStatus) {
  if (!tableStatus.test.exists || !tableStatus.production.exists) return 'BLOCK';
  if (tableStatus.test.type !== tableStatus.production.type) {
    return pair.severity === 'BLOCK' ? 'BLOCK' : 'REVIEW';
  }
  if (diff.missingInTest.length > 0 || diff.typeMismatches.length > 0) {
    return pair.severity === 'BLOCK' ? 'BLOCK' : 'REVIEW';
  }
  return 'OK';
}

function buildMigrationSuggestions(pair, diff) {
  if (!diff.missingInTest.length) return [];
  const test = splitQualifiedName(pair.test);

  return diff.missingInTest.map(column => {
    const nullable = column.nullable === 'NO' ? ' NOT NULL WITH DEFAULT' : '';
    return `ALTER TABLE ${test.schema}.${test.table} ADD COLUMN ${column.name} ${sqlTypeFor(column)}${nullable};`;
  });
}

async function auditPair(connection, pair) {
  const test = splitQualifiedName(pair.test);
  const production = splitQualifiedName(pair.production);
  const tableStatus = {
    test: await getTableInfo(connection, test.schema, test.table),
    production: await getTableInfo(connection, production.schema, production.table),
  };

  if (!tableStatus.test.exists || !tableStatus.production.exists) {
    return {
      ...pair,
      status: 'BLOCK',
      tableStatus,
      tableTypeMismatch: null,
      diff: null,
      migrationSuggestions: [],
    };
  }

  const testColumns = await getColumns(connection, test.schema, test.table);
  const productionColumns = await getColumns(connection, production.schema, production.table);
  const diff = compareColumnSets(pair, testColumns, productionColumns);
  const status = classifyPair(pair, diff, tableStatus);
  const tableTypeMismatch = tableStatus.test.type !== tableStatus.production.type
    ? { test: tableStatus.test.type, production: tableStatus.production.type }
    : null;

  return {
    ...pair,
    status,
    tableStatus,
    tableTypeMismatch,
    diff,
    migrationSuggestions: buildMigrationSuggestions(pair, diff),
  };
}

async function auditProductionTable(connection, item) {
  const table = splitQualifiedName(item.table);
  const tableStatus = await getTableInfo(connection, table.schema, table.table);
  const columns = tableStatus.exists ? await getColumns(connection, table.schema, table.table) : [];
  return {
    ...item,
    status: tableStatus.exists ? 'OK' : 'BLOCK',
    tableStatus,
    columnCount: columns.length,
  };
}

async function auditAppOnlyTable(connection, item) {
  const table = splitQualifiedName(item.table);
  const tableStatus = await getTableInfo(connection, table.schema, table.table);
  const columns = tableStatus.exists ? await getColumns(connection, table.schema, table.table) : [];
  return {
    ...item,
    status: tableStatus.exists ? 'OK' : item.severity,
    tableStatus,
    columnCount: columns.length,
    columns,
  };
}

function markdownList(items, formatter) {
  if (!items.length) return ['- none'];
  return items.map(formatter);
}

function renderMarkdown(report) {
  const lines = [
    '# JAVIER vs DSEDAC Alignment Audit',
    '',
    `Timestamp: ${report.timestamp}`,
    `App schema: ${report.appSchema}`,
    `ERP schema: ${report.erpSchema}`,
    `Overall status: ${report.status}`,
    '',
    '## Summary',
    '',
    `- Pairs audited: ${report.summary.pairsTotal}`,
    `- OK: ${report.summary.ok}`,
    `- Review: ${report.summary.review}`,
    `- Block: ${report.summary.block}`,
    `- Required production tables: ${report.summary.productionTablesOk}/${report.summary.productionTablesTotal}`,
    `- Required app-only tables: ${report.summary.appOnlyTablesOk || 0}/${report.summary.appOnlyTablesTotal || 0}`,
    `- Accepted semantic/type mismatches: ${report.summary.acceptedSemanticTypeMismatches || 0}`,
    '',
    '## Pair Results',
    '',
  ];

  if (report.error) {
    lines.splice(
      7,
      0,
      '## Blocking Error',
      '',
      `- ${report.error}`,
      ...((report.odbcErrors || []).map(error =>
        `- ODBC ${error.state || 'UNKNOWN'}: ${error.message || ''}`)),
      '',
    );
  }

  for (const pair of report.pairs) {
    lines.push(
      `### ${pair.feature}: ${pair.test} -> ${pair.production}`,
      '',
      `Status: ${pair.status}`,
      `Reason: ${pair.reason}`,
      `Table types: test=${pair.tableStatus?.test?.type || 'missing'}, production=${pair.tableStatus?.production?.type || 'missing'}`,
      '',
    );

    if (pair.tableTypeMismatch) {
      lines.push(`Table type mismatch: test=${pair.tableTypeMismatch.test}, production=${pair.tableTypeMismatch.production}`, '');
    }

    if (!pair.diff) {
      lines.push(
        `- Test table exists: ${pair.tableStatus.test.exists}`,
        `- Production table exists: ${pair.tableStatus.production.exists}`,
        '',
      );
      continue;
    }

    lines.push(
      `- Shared columns: ${pair.diff.shared.length}`,
      `- Test columns: ${pair.diff.testColumnCount}`,
      `- Production columns: ${pair.diff.productionColumnCount}`,
      `- Missing in ${pair.test}: ${pair.diff.missingInTest.length}`,
      `- App-only columns: ${pair.diff.appOnly.length}`,
      `- Type mismatches: ${pair.diff.typeMismatches.length}`,
      `- Accepted semantic/type mismatches: ${pair.diff.acceptedSemanticTypeMismatches.length}`,
      '',
      'Missing production columns in test:',
      ...markdownList(pair.diff.missingInTest, column => `- ${column.name} ${sqlTypeFor(column)}`),
      '',
      'Type mismatches:',
      ...markdownList(
        pair.diff.typeMismatches,
        mismatch => `- ${mismatch.column}: test=${mismatch.test}, production=${mismatch.production}`,
      ),
      '',
      'Accepted semantic/type mismatches:',
      ...markdownList(
        pair.diff.acceptedSemanticTypeMismatches,
        mismatch => `- ${mismatch.column}: test=${mismatch.test}, production=${mismatch.production}, category=${mismatch.category}, reason=${mismatch.reason}`,
      ),
      '',
    );

    if (pair.migrationSuggestions.length) {
      lines.push('DDL suggestions (review before running):', '', '```sql');
      lines.push(...pair.migrationSuggestions);
      lines.push('```', '');
    }
  }

  lines.push('## Required Production Tables', '');
  lines.push('| Feature | Table | Purpose | Status | Columns |');
  lines.push('|---|---|---|---|---|');
  for (const item of report.productionTables) {
    lines.push(`| ${item.feature} | ${item.table} | ${item.purpose} | ${item.status} | ${item.columnCount} |`);
  }

  lines.push('', '## Required App-Only Tables', '');
  lines.push('| Feature | Table | Purpose | Status | Columns |');
  lines.push('|---|---|---|---|---|');
  for (const item of report.appOnlyTables || []) {
    lines.push(`| ${item.feature} | ${item.table} | ${item.purpose} | ${item.status} | ${item.columnCount} |`);
  }

  return `${lines.join('\n')}\n`;
}

function renderSqlPlan(report) {
  const lines = [
    '-- JAVIER vs DSEDAC alignment review plan',
    `-- Generated: ${report.timestamp}`,
    `-- App schema: ${report.appSchema}`,
    `-- ERP schema: ${report.erpSchema}`,
    '-- This file is generated for review only. It was not executed.',
    '-- Run DDL only after staging verification, QA/AppSec/SRE gates, and explicit production approval.',
    '',
  ];

  if (report.error) {
    lines.push(`-- BLOCK: ${report.error}`, '');
    return `${lines.join('\n')}\n`;
  }

  for (const pair of report.pairs || []) {
    lines.push(`-- ${pair.feature}: ${pair.test} -> ${pair.production}`);
    lines.push(`-- Status: ${pair.status}`);
    if (pair.tableTypeMismatch) {
      lines.push(`-- TABLE TYPE MISMATCH: test=${pair.tableTypeMismatch.test}, production=${pair.tableTypeMismatch.production}`);
    }
    for (const mismatch of pair.diff?.typeMismatches || []) {
      lines.push(`-- TYPE REVIEW: ${mismatch.column}: test=${mismatch.test}, production=${mismatch.production}`);
    }
    if (pair.migrationSuggestions?.length) {
      lines.push(...pair.migrationSuggestions);
    } else {
      lines.push('-- No additive DDL suggestion for this pair.');
    }
    lines.push('');
  }

  lines.push('-- App-only tables intentionally remain in JAVIER and are not mirrored to DSEDAC.');
  for (const item of report.appOnlyTables || []) {
    lines.push(`-- ${item.status}: ${item.table} (${item.purpose}) columns=${item.columnCount || 0}`);
  }

  return `${lines.join('\n')}\n`;
}

async function writeFailedReport(error) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const timestamp = new Date().toISOString();
  const stamp = timestamp.replace(/[:.]/g, '-');
  const report = {
    timestamp,
    appSchema: APP_SCHEMA,
    erpSchema: ERP_SCHEMA,
    status: 'BLOCK',
    error: error.message,
    odbcErrors: error.odbcErrors || [],
    pairs: [],
    productionTables: [],
    appOnlyTables: [],
    summary: {
      pairsTotal: TABLE_PAIRS.length,
      ok: 0,
      review: 0,
      block: TABLE_PAIRS.length,
      productionTablesOk: 0,
      productionTablesTotal: REQUIRED_PRODUCTION_TABLES.length,
      appOnlyTablesOk: 0,
      appOnlyTablesTotal: REQUIRED_APP_ONLY_TABLES.length,
    },
  };
  const jsonPath = path.join(OUTPUT_DIR, `javier-dsedac-alignment-${stamp}.json`);
  const mdPath = path.join(OUTPUT_DIR, `javier-dsedac-alignment-${stamp}.md`);
  const sqlPath = path.join(OUTPUT_DIR, `javier-dsedac-alignment-plan-${stamp}.sql`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await fs.writeFile(mdPath, renderMarkdown(report), 'utf8');
  await fs.writeFile(sqlPath, renderSqlPlan(report), 'utf8');
  return { report, jsonPath, mdPath, sqlPath };
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const timestamp = new Date().toISOString();
  const stamp = timestamp.replace(/[:.]/g, '-');
  const connection = await odbc.connect(db2ConnectionString());

  try {
    const pairs = [];
    for (const pair of TABLE_PAIRS) {
      pairs.push(await auditPair(connection, pair));
    }

    const productionTables = [];
    for (const item of REQUIRED_PRODUCTION_TABLES) {
      productionTables.push(await auditProductionTable(connection, item));
    }

    const appOnlyTables = [];
    for (const item of REQUIRED_APP_ONLY_TABLES) {
      appOnlyTables.push(await auditAppOnlyTable(connection, item));
    }

    const summary = {
      pairsTotal: pairs.length,
      ok: pairs.filter(pair => pair.status === 'OK').length,
      review: pairs.filter(pair => pair.status === 'REVIEW').length,
      block: pairs.filter(pair => pair.status === 'BLOCK').length,
      productionTablesOk: productionTables.filter(item => item.status === 'OK').length,
      productionTablesTotal: productionTables.length,
      appOnlyTablesOk: appOnlyTables.filter(item => item.status === 'OK').length,
      appOnlyTablesReview: appOnlyTables.filter(item => item.status === 'REVIEW').length,
      appOnlyTablesBlock: appOnlyTables.filter(item => item.status === 'BLOCK').length,
      appOnlyTablesTotal: appOnlyTables.length,
      acceptedSemanticTypeMismatches: pairs.reduce((total, pair) =>
        total + (pair.diff?.acceptedSemanticTypeMismatches?.length || 0), 0),
    };

    const report = {
      timestamp,
      appSchema: APP_SCHEMA,
      erpSchema: ERP_SCHEMA,
      status: summary.block > 0 || summary.appOnlyTablesBlock > 0
        ? 'BLOCK'
        : summary.review > 0 || summary.appOnlyTablesReview > 0
          ? 'REVIEW'
          : 'OK',
      pairs,
      productionTables,
      appOnlyTables,
      summary,
    };

    const jsonPath = path.join(OUTPUT_DIR, `javier-dsedac-alignment-${stamp}.json`);
    const mdPath = path.join(OUTPUT_DIR, `javier-dsedac-alignment-${stamp}.md`);
    const sqlPath = path.join(OUTPUT_DIR, `javier-dsedac-alignment-plan-${stamp}.sql`);
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    await fs.writeFile(mdPath, renderMarkdown(report), 'utf8');
    await fs.writeFile(sqlPath, renderSqlPlan(report), 'utf8');

    console.log(`[javier-dsedac-alignment] status=${report.status}`);
    console.log(`[javier-dsedac-alignment] pairs ok/review/block=${summary.ok}/${summary.review}/${summary.block}`);
    console.log(`[javier-dsedac-alignment] app-only ok/review/block=${summary.appOnlyTablesOk}/${summary.appOnlyTablesReview}/${summary.appOnlyTablesBlock}`);
    console.log(`[javier-dsedac-alignment] wrote ${jsonPath}`);
    console.log(`[javier-dsedac-alignment] wrote ${mdPath}`);
    console.log(`[javier-dsedac-alignment] wrote ${sqlPath}`);

    if (report.status === 'BLOCK') process.exitCode = 2;
  } finally {
    await connection.close();
  }
}

main().catch(async error => {
  const { jsonPath, mdPath, sqlPath } = await writeFailedReport(error);
  console.error(`[javier-dsedac-alignment] BLOCK: ${error.message}`);
  if (error.odbcErrors) console.error(JSON.stringify(error.odbcErrors, null, 2));
  console.error(`[javier-dsedac-alignment] wrote ${jsonPath}`);
  console.error(`[javier-dsedac-alignment] wrote ${mdPath}`);
  console.error(`[javier-dsedac-alignment] wrote ${sqlPath}`);
  process.exit(1);
});
