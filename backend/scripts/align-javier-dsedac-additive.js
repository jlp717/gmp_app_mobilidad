'use strict';

/**
 * Additive JAVIER -> DSEDAC alignment helper
 * ==========================================
 *
 * Generates idempotent, additive DB2 DDL so the JAVIER test tables can carry
 * the ERP-compatible columns needed by the commercial Pedidos/Cobros flows.
 *
 * Default mode writes a migration SQL file only. Use --apply explicitly to run
 * the generated ALTER TABLE statements against JAVIER.
 */

const fs = require('fs/promises');
const path = require('path');
const odbc = require('odbc');
const db2ConnectionString = require('./db2-connection');

const APP_SCHEMA = String(process.env.PEDIDOS_CONFIRMATION_SCHEMA || 'JAVIER')
  .trim()
  .toUpperCase();
const ERP_SCHEMA = String(process.env.ERP_SCHEMA || 'DSEDAC')
  .trim()
  .toUpperCase();
const APPLY = process.argv.includes('--apply');
const OUTPUT_DIR = path.resolve(__dirname, 'sql', 'migrations');

const ALIGNMENT_PAIRS = [
  {
    feature: 'PEDIDOS_COMERCIAL_CAB',
    source: `${ERP_SCHEMA}.CPC`,
    target: `${APP_SCHEMA}.PEDIDOS_CAB`,
    skipColumns: new Set([]),
  },
  {
    feature: 'PEDIDOS_COMERCIAL_LIN',
    source: `${ERP_SCHEMA}.LPC`,
    target: `${APP_SCHEMA}.PEDIDOS_LIN`,
    skipColumns: new Set([]),
  },
  {
    feature: 'COBROS_COMERCIAL',
    source: `${ERP_SCHEMA}.CRC`,
    target: `${APP_SCHEMA}.COBROS`,
    // JAVIER.COBROS.ID is an idempotency UUID. DSEDAC.CRC.ID is numeric.
    // Do not mutate or shadow the primary key automatically.
    skipColumns: new Set(['ID']),
  },
  {
    feature: 'COBROS_REPARTIDOR',
    source: `${ERP_SCHEMA}.CRCA`,
    target: `${APP_SCHEMA}.REPARTIDOR_COBROS`,
    skipColumns: new Set([]),
  },
  {
    feature: 'RUTERO_DELIVERY_STATUS',
    source: `${ERP_SCHEMA}.CPC`,
    target: `${APP_SCHEMA}.DELIVERY_STATUS`,
    skipColumns: new Set([]),
  },
];

function splitQualifiedName(qualifiedName) {
  const [schema, table] = String(qualifiedName || '').split('.');
  if (!schema || !table) throw new Error(`Invalid qualified name: ${qualifiedName}`);
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
    ordinal: Number(row.ORDINAL_POSITION || 0),
  };
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

async function tableExists(connection, schema, table) {
  const rows = await connection.query(
    `SELECT 1
       FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
      FETCH FIRST 1 ROW ONLY`,
    [schema, table],
  );
  return rows.length > 0;
}

async function getColumns(connection, schema, table) {
  const rows = await connection.query(
    `SELECT COLUMN_NAME,
            DATA_TYPE,
            LENGTH,
            NUMERIC_SCALE,
            IS_NULLABLE,
            HAS_DEFAULT,
            ORDINAL_POSITION
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
  return rows.map(normalizeColumn);
}

function addColumnStatement(target, column) {
  const targetName = `${target.schema}.${target.table}`;
  const notNull = column.nullable === 'NO' ? ' NOT NULL WITH DEFAULT' : '';
  return `ALTER TABLE ${targetName} ADD COLUMN ${column.name} ${sqlTypeFor(column)}${notNull}`;
}

function alterColumnTypeStatement(target, column) {
  const targetName = `${target.schema}.${target.table}`;
  return `ALTER TABLE ${targetName} ALTER COLUMN ${column.name} SET DATA TYPE ${sqlTypeFor(column)}`;
}

function isStringType(type) {
  return ['CHAR', 'CHARACTER', 'VARCHAR', 'GRAPHIC', 'VARGRAPHIC'].includes(type);
}

function isSafeWidening(sourceColumn, targetColumn) {
  if (!sourceColumn || !targetColumn) return false;
  if (sourceColumn.name !== targetColumn.name) return false;
  if (!isStringType(sourceColumn.type) || !isStringType(targetColumn.type)) return false;
  if (sourceColumn.type !== targetColumn.type) return false;
  return sourceColumn.length > targetColumn.length;
}

function renderSql(statements, notes) {
  const lines = [
    '-- JAVIER vs DSEDAC additive alignment',
    `-- Generated: ${new Date().toISOString()}`,
    `-- App schema: ${APP_SCHEMA}`,
    `-- ERP schema: ${ERP_SCHEMA}`,
    '--',
    '-- Review before running. This migration only adds missing columns',
    '-- and widens compatible CHAR/VARCHAR columns when DSEDAC is longer.',
    '-- It does not drop, rename, recreate, shorten, or narrow columns.',
    '',
  ];

  if (notes.length) {
    lines.push('-- Notes');
    for (const note of notes) lines.push(`-- - ${note}`);
    lines.push('');
  }

  if (!statements.length) {
    lines.push('-- No additive columns were missing.');
  } else {
    for (const statement of statements) {
      lines.push(`${statement};`);
    }
  }

  return `${lines.join('\n')}\n`;
}

async function buildPlan(connection) {
  const statements = [];
  const notes = [];
  const details = [];

  for (const pair of ALIGNMENT_PAIRS) {
    const source = splitQualifiedName(pair.source);
    const target = splitQualifiedName(pair.target);
    const sourceExists = await tableExists(connection, source.schema, source.table);
    const targetExists = await tableExists(connection, target.schema, target.table);

    if (!sourceExists || !targetExists) {
      notes.push(`${pair.feature}: skipped because sourceExists=${sourceExists} targetExists=${targetExists}`);
      details.push({ feature: pair.feature, source: pair.source, target: pair.target, sourceExists, targetExists, added: [], altered: [] });
      continue;
    }

    const sourceColumns = await getColumns(connection, source.schema, source.table);
    const targetColumns = await getColumns(connection, target.schema, target.table);
    const targetNames = new Set(targetColumns.map(column => column.name));
    const targetByName = new Map(targetColumns.map(column => [column.name, column]));
    const added = [];
    const altered = [];

    for (const column of sourceColumns) {
      if (pair.skipColumns.has(column.name)) {
        notes.push(`${pair.feature}: skipped ${column.name} by rule`);
        continue;
      }
      if (targetNames.has(column.name)) continue;

      const statement = addColumnStatement(target, column);
      statements.push(statement);
      added.push({ name: column.name, type: sqlTypeFor(column), nullable: column.nullable });
    }

    for (const sourceColumn of sourceColumns) {
      if (pair.skipColumns.has(sourceColumn.name)) continue;
      const targetColumn = targetByName.get(sourceColumn.name);
      if (!isSafeWidening(sourceColumn, targetColumn)) continue;

      const statement = alterColumnTypeStatement(target, sourceColumn);
      statements.push(statement);
      altered.push({
        name: sourceColumn.name,
        from: sqlTypeFor(targetColumn),
        to: sqlTypeFor(sourceColumn),
      });
    }

    details.push({ feature: pair.feature, source: pair.source, target: pair.target, sourceExists, targetExists, added, altered });
  }

  return { statements, notes, details };
}

async function applyStatements(connection, statements) {
  const applied = [];
  for (const statement of statements) {
    try {
      await connection.query(statement);
      applied.push({ statement, status: 'OK' });
    } catch (error) {
      const duplicateColumn = /SQL0197|duplicate|already exists/i.test(String(error.message || ''));
      applied.push({ statement, status: duplicateColumn ? 'SKIP_EXISTS' : 'ERROR', error: error.message });
      if (!duplicateColumn) throw error;
    }
  }
  return applied;
}

async function main() {
  if (APP_SCHEMA === ERP_SCHEMA) {
    throw new Error('APP_SCHEMA and ERP_SCHEMA must be different for alignment.');
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const connection = await odbc.connect(db2ConnectionString());
  try {
    const plan = await buildPlan(connection);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sqlPath = path.join(OUTPUT_DIR, `${stamp}_align_${APP_SCHEMA.toLowerCase()}_to_${ERP_SCHEMA.toLowerCase()}_additive.sql`);
    const jsonPath = path.join(OUTPUT_DIR, `${stamp}_align_${APP_SCHEMA.toLowerCase()}_to_${ERP_SCHEMA.toLowerCase()}_additive.json`);
    const report = {
      ts: new Date().toISOString(),
      appSchema: APP_SCHEMA,
      erpSchema: ERP_SCHEMA,
      apply: APPLY,
      statementsCount: plan.statements.length,
      details: plan.details,
      notes: plan.notes,
      applied: [],
    };

    await fs.writeFile(sqlPath, renderSql(plan.statements, plan.notes), 'utf8');

    if (APPLY && plan.statements.length) {
      report.applied = await applyStatements(connection, plan.statements);
    }

    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[align-javier-dsedac-additive] statements=${plan.statements.length} apply=${APPLY}`);
    console.log(`[align-javier-dsedac-additive] wrote ${sqlPath}`);
    console.log(`[align-javier-dsedac-additive] wrote ${jsonPath}`);
  } finally {
    await connection.close();
  }
}

main().catch(error => {
  console.error(`[align-javier-dsedac-additive] BLOCK: ${error.message}`);
  if (error.odbcErrors) console.error(JSON.stringify(error.odbcErrors, null, 2));
  process.exit(1);
});
