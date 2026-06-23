'use strict';

/**
 * Pedido schema alignment SQL generator
 * =====================================
 *
 * Read-only DB2 metadata audit for the commercial order tables. It compares
 * JAVIER pedido tables against the production DSEDAC tables and writes one SQL
 * review file with the commands needed to make JAVIER match production.
 *
 * This script does not execute DDL/DML.
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
    label: 'Cabecera de pedidos comerciales',
    test: `${APP_SCHEMA}.PEDIDOS_CAB`,
    production: `${ERP_SCHEMA}.CPC`,
  },
  {
    label: 'Lineas de pedidos comerciales',
    test: `${APP_SCHEMA}.PEDIDOS_LIN`,
    production: `${ERP_SCHEMA}.LPC`,
  },
];

function getArgValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return null;
}

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

function isNullable(column) {
  return ['YES', 'Y'].includes(normalizeName(column.nullable || column.IS_NULLABLE || column.NULLS));
}

function typeSignature(column) {
  return `${column.type}(${column.length},${column.scale})`;
}

function nullabilitySignature(column) {
  return isNullable(column) ? 'NULL' : 'NOT NULL';
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

function columnDefinition(column) {
  const nullable = isNullable(column) ? '' : ' NOT NULL WITH DEFAULT';
  return `${column.name} ${sqlTypeFor(column)}${nullable}`;
}

function ddlCommented(sql, reason) {
  return [
    `-- REVIEW: ${reason}`,
    `-- ${sql}`,
  ];
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

function compareColumns(testColumns, productionColumns) {
  const testByName = new Map(testColumns.map(column => [column.name, column]));
  const productionByName = new Map(productionColumns.map(column => [column.name, column]));

  const missingInJavier = productionColumns.filter(column => !testByName.has(column.name));
  const extraInJavier = testColumns.filter(column => !productionByName.has(column.name));

  const mismatches = [];
  for (const productionColumn of productionColumns) {
    const testColumn = testByName.get(productionColumn.name);
    if (!testColumn) continue;

    const typeMismatch = typeSignature(testColumn) !== typeSignature(productionColumn);
    const nullabilityMismatch = nullabilitySignature(testColumn) !== nullabilitySignature(productionColumn);
    if (typeMismatch || nullabilityMismatch) {
      mismatches.push({
        column: productionColumn.name,
        test: {
          type: typeSignature(testColumn),
          nullable: nullabilitySignature(testColumn),
        },
        production: {
          type: typeSignature(productionColumn),
          nullable: nullabilitySignature(productionColumn),
        },
        targetType: sqlTypeFor(productionColumn),
      });
    }
  }

  return {
    testColumnCount: testColumns.length,
    productionColumnCount: productionColumns.length,
    sharedColumnCount: productionColumns.length - missingInJavier.length,
    missingInJavier,
    extraInJavier,
    mismatches,
  };
}

async function auditPair(connection, pair) {
  const testName = splitQualifiedName(pair.test);
  const productionName = splitQualifiedName(pair.production);

  const [testTable, productionTable] = await Promise.all([
    getTableInfo(connection, testName.schema, testName.table),
    getTableInfo(connection, productionName.schema, productionName.table),
  ]);

  const result = {
    ...pair,
    tableStatus: { test: testTable, production: productionTable },
    diff: null,
    status: 'OK',
  };

  if (!testTable.exists || !productionTable.exists) {
    result.status = 'BLOCK';
    return result;
  }

  const [testColumns, productionColumns] = await Promise.all([
    getColumns(connection, testName.schema, testName.table),
    getColumns(connection, productionName.schema, productionName.table),
  ]);

  result.diff = compareColumns(testColumns, productionColumns);
  result.status = result.diff.missingInJavier.length || result.diff.mismatches.length
    ? 'BLOCK'
    : result.diff.extraInJavier.length
      ? 'REVIEW'
      : 'OK';

  if (testTable.type !== productionTable.type) {
    result.tableTypeMismatch = {
      test: testTable.type,
      production: productionTable.type,
    };
    result.status = 'BLOCK';
  }

  return result;
}

function renderSql(report) {
  const lines = [
    '-- Pedido schema alignment: JAVIER -> DSEDAC',
    `-- Generated: ${report.timestamp}`,
    `-- App schema: ${report.appSchema}`,
    `-- Production schema: ${report.erpSchema}`,
    '-- Source of truth: production table structure and data types.',
    '-- This file was generated from DB2 catalog metadata and was NOT executed.',
    '-- Execute DDL only after staging verification, QA/AppSec/SRE gates, and explicit production approval.',
    '',
  ];

  if (report.error) {
    lines.push(`-- BLOCK: ${report.error}`, '');
    return `${lines.join('\n')}\n`;
  }

  for (const pair of report.pairs) {
    lines.push(
      `-- ${pair.label}`,
      `-- JAVIER: ${pair.test}`,
      `-- DSEDAC: ${pair.production}`,
      `-- Status: ${pair.status}`,
      `-- Table type: JAVIER=${pair.tableStatus.test.type || 'missing'} DSEDAC=${pair.tableStatus.production.type || 'missing'}`,
      '',
    );

    if (!pair.diff) {
      lines.push('-- No column comparison available because one side is missing.', '');
      continue;
    }

    lines.push(
      `-- Columns: JAVIER=${pair.diff.testColumnCount} DSEDAC=${pair.diff.productionColumnCount} shared=${pair.diff.sharedColumnCount}`,
      `-- Missing in JAVIER: ${pair.diff.missingInJavier.length}`,
      `-- Extra in JAVIER: ${pair.diff.extraInJavier.length}`,
      `-- Type/nullability mismatches: ${pair.diff.mismatches.length}`,
      '',
    );

    if (!pair.diff.missingInJavier.length && !pair.diff.extraInJavier.length && !pair.diff.mismatches.length) {
      lines.push('-- No DDL needed: JAVIER already matches DSEDAC for this pedido table.', '');
      continue;
    }

    for (const column of pair.diff.missingInJavier) {
      lines.push(`ALTER TABLE ${pair.test} ADD COLUMN ${columnDefinition(column)};`);
    }

    for (const mismatch of pair.diff.mismatches) {
      const alterType = `ALTER TABLE ${pair.test} ALTER COLUMN ${mismatch.column} SET DATA TYPE ${mismatch.targetType};`;
      lines.push(...ddlCommented(
        alterType,
        `${mismatch.column} differs: JAVIER=${mismatch.test.type} ${mismatch.test.nullable}, DSEDAC=${mismatch.production.type} ${mismatch.production.nullable}`,
      ));

      if (mismatch.test.nullable !== mismatch.production.nullable) {
        const nullabilityDdl = mismatch.production.nullable === 'NOT NULL'
          ? `ALTER TABLE ${pair.test} ALTER COLUMN ${mismatch.column} SET NOT NULL;`
          : `ALTER TABLE ${pair.test} ALTER COLUMN ${mismatch.column} DROP NOT NULL;`;
        lines.push(...ddlCommented(
          nullabilityDdl,
          `${mismatch.column} nullability must match production before cutover`,
        ));
      }
    }

    if (pair.diff.extraInJavier.length) {
      lines.push(
        '-- Exact alignment requires removing the following JAVIER-only columns.',
        '-- They are commented because DROP COLUMN is destructive and can break app code.',
      );
      for (const column of pair.diff.extraInJavier) {
        lines.push(...ddlCommented(
          `ALTER TABLE ${pair.test} DROP COLUMN ${column.name};`,
          `${column.name} exists only in JAVIER; review application usage before dropping`,
        ));
      }
    }

    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function normalizeSourceColumn(column) {
  return {
    name: normalizeName(column.name || column.COLUMN_NAME),
    type: normalizeName(column.type || column.DATA_TYPE),
    length: Number(column.length || column.LENGTH || 0),
    scale: Number(column.scale || column.NUMERIC_SCALE || 0),
    nullable: normalizeName(column.nullable || column.IS_NULLABLE || column.NULLS),
    defaulted: normalizeName(column.defaulted || column.HAS_DEFAULT || ''),
    text: String(column.text || column.COLUMN_TEXT || '').trim(),
    ordinal: Number(column.ordinal || column.ORDINAL_POSITION || 0),
  };
}

function pairFromSource(sourcePair) {
  const matchingDefinition = TABLE_PAIRS.find(pair =>
    normalizeName(pair.test) === normalizeName(sourcePair.test) &&
    normalizeName(pair.production) === normalizeName(sourcePair.production));

  const missingInJavier = (sourcePair.diff?.missingInTest || [])
    .map(normalizeSourceColumn);
  const extraInJavier = (sourcePair.diff?.appOnly || sourcePair.diff?.extraInJavier || [])
    .map(normalizeSourceColumn);
  const mismatches = (sourcePair.diff?.typeMismatches || []).map(mismatch => ({
    column: normalizeName(mismatch.column),
    test: {
      type: String(typeof mismatch.test === 'object' ? mismatch.test?.type || '' : mismatch.test || ''),
      nullable: String(mismatch.test?.nullable || 'UNKNOWN'),
    },
    production: {
      type: String(typeof mismatch.production === 'object' ? mismatch.production?.type || '' : mismatch.production || ''),
      nullable: String(mismatch.production?.nullable || 'UNKNOWN'),
    },
    targetType: String(mismatch.targetType || (typeof mismatch.production === 'string' ? mismatch.production : '') || 'REVIEW_TARGET_TYPE'),
  }));

  return {
    label: matchingDefinition?.label || sourcePair.feature || 'Pedidos',
    test: sourcePair.test,
    production: sourcePair.production,
    tableStatus: sourcePair.tableStatus || { test: {}, production: {} },
    tableTypeMismatch: sourcePair.tableTypeMismatch || null,
    diff: {
      testColumnCount: Number(sourcePair.diff?.testColumnCount || 0),
      productionColumnCount: Number(sourcePair.diff?.productionColumnCount || 0),
      sharedColumnCount: Number(sourcePair.diff?.shared?.length || 0),
      missingInJavier,
      extraInJavier,
      mismatches,
    },
    status: sourcePair.tableTypeMismatch || missingInJavier.length || mismatches.length
      ? 'BLOCK'
      : extraInJavier.length
        ? 'REVIEW'
        : 'OK',
  };
}

async function reportFromSourceFile(sourceReportPath) {
  const absolutePath = path.resolve(sourceReportPath);
  const raw = await fs.readFile(absolutePath, 'utf8');
  const source = JSON.parse(raw);
  const pairs = (source.pairs || [])
    .filter(pair => TABLE_PAIRS.some(definition =>
      normalizeName(definition.test) === normalizeName(pair.test) &&
      normalizeName(definition.production) === normalizeName(pair.production)))
    .map(pairFromSource);

  const summary = {
    ok: pairs.filter(pair => pair.status === 'OK').length,
    review: pairs.filter(pair => pair.status === 'REVIEW').length,
    block: pairs.filter(pair => pair.status === 'BLOCK').length,
    missingInJavier: pairs.reduce((total, pair) => total + (pair.diff?.missingInJavier.length || 0), 0),
    extraInJavier: pairs.reduce((total, pair) => total + (pair.diff?.extraInJavier.length || 0), 0),
    mismatches: pairs.reduce((total, pair) => total + (pair.diff?.mismatches.length || 0), 0),
    sourceReportPath: absolutePath,
  };

  return {
    timestamp: new Date().toISOString(),
    appSchema: normalizeName(source.appSchema || APP_SCHEMA),
    erpSchema: normalizeName(source.erpSchema || ERP_SCHEMA),
    status: summary.block > 0 ? 'BLOCK' : summary.review > 0 ? 'REVIEW' : 'OK',
    sourceReportPath: absolutePath,
    pairs,
    summary,
  };
}

async function writeOutputs(report, stamp) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const jsonPath = path.join(OUTPUT_DIR, `pedidos-javier-dsedac-align-${stamp}.json`);
  const sqlPath = path.join(OUTPUT_DIR, `pedidos-javier-dsedac-align-${stamp}.sql`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await fs.writeFile(sqlPath, renderSql(report), 'utf8');
  return { jsonPath, sqlPath };
}

async function writeFailedReport(error) {
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
    summary: {
      ok: 0,
      review: 0,
      block: TABLE_PAIRS.length,
      missingInJavier: 0,
      extraInJavier: 0,
      mismatches: 0,
    },
  };
  const paths = await writeOutputs(report, stamp);
  return { report, ...paths };
}

async function main() {
  const timestamp = new Date().toISOString();
  const stamp = timestamp.replace(/[:.]/g, '-');
  const sourceReportPath = getArgValue('--source-report') || process.env.PEDIDOS_SCHEMA_SOURCE_REPORT;

  if (sourceReportPath) {
    const report = await reportFromSourceFile(sourceReportPath);
    const sourceStamp = report.timestamp.replace(/[:.]/g, '-');
    const { jsonPath, sqlPath } = await writeOutputs(report, sourceStamp);

    console.log(`[pedidos-schema-align] status=${report.status}`);
    console.log(`[pedidos-schema-align] source=${report.sourceReportPath}`);
    console.log(`[pedidos-schema-align] pairs ok/review/block=${report.summary.ok}/${report.summary.review}/${report.summary.block}`);
    console.log(`[pedidos-schema-align] missing/extra/mismatch=${report.summary.missingInJavier}/${report.summary.extraInJavier}/${report.summary.mismatches}`);
    console.log(`[pedidos-schema-align] wrote ${jsonPath}`);
    console.log(`[pedidos-schema-align] wrote ${sqlPath}`);
    return;
  }

  const connection = await odbc.connect(db2ConnectionString());

  try {
    const pairs = [];
    for (const pair of TABLE_PAIRS) {
      pairs.push(await auditPair(connection, pair));
    }

    const summary = {
      ok: pairs.filter(pair => pair.status === 'OK').length,
      review: pairs.filter(pair => pair.status === 'REVIEW').length,
      block: pairs.filter(pair => pair.status === 'BLOCK').length,
      missingInJavier: pairs.reduce((total, pair) => total + (pair.diff?.missingInJavier.length || 0), 0),
      extraInJavier: pairs.reduce((total, pair) => total + (pair.diff?.extraInJavier.length || 0), 0),
      mismatches: pairs.reduce((total, pair) => total + (pair.diff?.mismatches.length || 0), 0),
    };

    const report = {
      timestamp,
      appSchema: APP_SCHEMA,
      erpSchema: ERP_SCHEMA,
      status: summary.block > 0 ? 'BLOCK' : summary.review > 0 ? 'REVIEW' : 'OK',
      pairs,
      summary,
    };

    const { jsonPath, sqlPath } = await writeOutputs(report, stamp);

    console.log(`[pedidos-schema-align] status=${report.status}`);
    console.log(`[pedidos-schema-align] pairs ok/review/block=${summary.ok}/${summary.review}/${summary.block}`);
    console.log(`[pedidos-schema-align] missing/extra/mismatch=${summary.missingInJavier}/${summary.extraInJavier}/${summary.mismatches}`);
    console.log(`[pedidos-schema-align] wrote ${jsonPath}`);
    console.log(`[pedidos-schema-align] wrote ${sqlPath}`);

    if (report.status === 'BLOCK') process.exitCode = 2;
  } finally {
    await connection.close();
  }
}

main().catch(async error => {
  const { jsonPath, sqlPath } = await writeFailedReport(error);
  console.error(`[pedidos-schema-align] BLOCK: ${error.message}`);
  if (error.odbcErrors) console.error(JSON.stringify(error.odbcErrors, null, 2));
  console.error(`[pedidos-schema-align] wrote ${jsonPath}`);
  console.error(`[pedidos-schema-align] wrote ${sqlPath}`);
  process.exit(1);
});
