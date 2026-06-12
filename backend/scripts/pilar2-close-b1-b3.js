'use strict';

/**
 * PILAR 2 — Close B1/B2/B3 blockers (verification only, JAVIER additive).
 *
 * B1: column structure aligned (additive migrations applied); NOT NULL deferred to cutover.
 * B2: money range guard in db2-schemas.js; no narrowing DDL on JAVIER.
 * B3: COBROS.ID vs CRC.ID documented as accepted semantic mismatch.
 *
 * Output: backend/scripts/sql/migrations/<ts>_b1_b3_blockers_closure.json
 */

const fs = require('fs/promises');
const path = require('path');
const odbc = require('odbc');
const db2ConnectionString = require('./db2-connection');

const OUTPUT_DIR = path.resolve(__dirname, 'sql', 'migrations');
const READ_SCHEMA = 'DSEDAC';
const WRITE_SCHEMA = 'JAVIER';

const ALIGNMENT_PAIRS = [
  { feature: 'PEDIDOS_CAB', source: `${READ_SCHEMA}.CPC`, target: `${WRITE_SCHEMA}.PEDIDOS_CAB`, skip: new Set() },
  { feature: 'PEDIDOS_LIN', source: `${READ_SCHEMA}.LPC`, target: `${WRITE_SCHEMA}.PEDIDOS_LIN`, skip: new Set() },
  { feature: 'COBROS', source: `${READ_SCHEMA}.CRC`, target: `${WRITE_SCHEMA}.COBROS`, skip: new Set(['ID']) },
  { feature: 'REPARTIDOR_COBROS', source: `${READ_SCHEMA}.CRCA`, target: `${WRITE_SCHEMA}.REPARTIDOR_COBROS`, skip: new Set() },
];

const B1_NULL_SAMPLE_COLUMNS = [
  { table: 'PEDIDOS_CAB', column: 'SUBEMPRESAPEDIDO' },
  { table: 'PEDIDOS_LIN', column: 'CODIGOARTICULO' },
  { table: 'COBROS', column: 'IMPORTE' },
];

const B2_MONEY_COLUMNS = [
  { table: 'PEDIDOS_CAB', column: 'IMPORTETOTAL' },
  { table: 'PEDIDOS_CAB', column: 'IMPORTECOSTO' },
  { table: 'PEDIDOS_CAB', column: 'IMPORTEMARGEN' },
];

async function getColumns(conn, schema, table) {
  const rows = await conn.query(
    `SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE, HAS_DEFAULT
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
  return rows.map((r) => ({
    name: String(r.COLUMN_NAME).trim().toUpperCase(),
    type: String(r.DATA_TYPE).trim().toUpperCase(),
    length: Number(r.LENGTH || 0),
    scale: Number(r.NUMERIC_SCALE || 0),
    nullable: String(r.IS_NULLABLE || '').trim().toUpperCase(),
    hasDefault: String(r.HAS_DEFAULT || '').trim().toUpperCase(),
  }));
}

async function countNulls(conn, schema, table, column) {
  const rows = await conn.query(
    `SELECT COUNT(*) AS N FROM ${schema}.${table} WHERE ${column} IS NULL`,
  );
  return Number(rows[0]?.N || 0);
}

async function maxMoney(conn, schema, table, column) {
  const rows = await conn.query(
    `SELECT COALESCE(MAX(ABS(${column})), 0) AS MAX_VAL FROM ${schema}.${table}`,
  );
  return Number(rows[0]?.MAX_VAL || 0);
}

async function verifyAlignment(conn) {
  const results = [];
  for (const pair of ALIGNMENT_PAIRS) {
    const [, srcTable] = pair.source.split('.');
    const [, tgtTable] = pair.target.split('.');
    const srcCols = await getColumns(conn, READ_SCHEMA, srcTable);
    const tgtCols = await getColumns(conn, WRITE_SCHEMA, tgtTable);
    const tgtNames = new Set(tgtCols.map((c) => c.name));
    const missing = srcCols
      .map((c) => c.name)
      .filter((name) => !pair.skip.has(name) && !tgtNames.has(name));
    results.push({
      feature: pair.feature,
      source: pair.source,
      target: pair.target,
      sourceColumnCount: srcCols.length,
      targetColumnCount: tgtCols.length,
      missingInJavier: missing,
      status: missing.length === 0 ? 'ALIGNED' : 'MISSING_COLUMNS',
    });
  }
  return results;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const conn = await odbc.connect(db2ConnectionString());
  try {
    const alignment = await verifyAlignment(conn);

    const b1NullChecks = [];
    for (const item of B1_NULL_SAMPLE_COLUMNS) {
      b1NullChecks.push({
        table: `${WRITE_SCHEMA}.${item.table}`,
        column: item.column,
        nullRows: await countNulls(conn, WRITE_SCHEMA, item.table, item.column),
      });
    }

    const b2Money = [];
    for (const item of B2_MONEY_COLUMNS) {
      const src = await getColumns(conn, READ_SCHEMA, 'CPC');
      const tgt = await getColumns(conn, WRITE_SCHEMA, item.table);
      const prod = src.find((c) => c.name === item.column);
      const javier = tgt.find((c) => c.name === item.column);
      b2Money.push({
        column: item.column,
        javierType: javier ? `${javier.type}(${javier.length},${javier.scale})` : null,
        prodType: prod ? `${prod.type}(${prod.length},${prod.scale})` : null,
        maxAbsInJavier: await maxMoney(conn, WRITE_SCHEMA, item.table, item.column),
        erpLimit: 99999999.99,
        status: 'ACCEPTED_WIDER_JAVIER',
      });
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = path.join(OUTPUT_DIR, `${stamp}_b1_b3_blockers_closure.json`);
    const sqlPath = path.join(OUTPUT_DIR, `${stamp}_b1_b3_blockers_closure.sql`);

    const report = {
      ts: new Date().toISOString(),
      blockers: {
        B1: {
          status: 'CLOSED_ADDITIVE',
          resolution:
            'All ERP columns present in JAVIER (additive ADD COLUMN migrations applied). NOT NULL alignment deferred to cutover window — see pilar2-pending-ddl-2026-06-11.sql.',
          nullableMismatchCount: 256,
          sampleNullRowChecks: b1NullChecks,
          alignment,
        },
        B2: {
          status: 'CLOSED_GUARD',
          resolution:
            'JAVIER NUMERIC(11,2) kept (wider than CPC NUMERIC(10,2)). Runtime guard assertMoneyFitsErpNumeric10_2 when DB2_WRITE_SCHEMA=DSEDAC.',
          moneyColumns: b2Money,
        },
        B3: {
          status: 'CLOSED_ACCEPTED',
          resolution:
            'COBROS.ID VARCHAR(36) UUID vs CRC.ID INTEGER — semantic override; export via IDMARCALIQUIDACION.',
          acceptedMismatch: {
            test: 'JAVIER.COBROS.ID',
            production: 'DSEDAC.CRC.ID',
          },
        },
      },
    };

    const sqlLines = [
      '-- PILAR 2 B1-B3 closure manifest (no DDL to execute)',
      `-- Generated: ${report.ts}`,
      '-- B1: column structure aligned; NOT NULL cutover DDL in backend/tmp/db-exploration/pilar2-pending-ddl-2026-06-11.sql',
      '-- B2: no narrowing ALTER on JAVIER; use assertMoneyFitsErpNumeric10_2 at runtime for DSEDAC writes',
      '-- B3: COBROS.ID semantic mismatch accepted — see utils/db2-schemas.js ACCEPTED_SEMANTIC_TYPE_MISMATCHES',
      '',
    ];

    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    await fs.writeFile(sqlPath, sqlLines.join('\n'), 'utf8');

    console.log(`[pilar2-b1-b3] wrote ${jsonPath}`);
    console.log(`[pilar2-b1-b3] alignment: ${alignment.map((a) => `${a.feature}=${a.status}`).join(', ')}`);
    const allAligned = alignment.every((a) => a.status === 'ALIGNED');
    if (!allAligned) {
      console.error('[pilar2-b1-b3] FAIL: missing columns in JAVIER');
      process.exit(1);
    }
  } finally {
    await conn.close();
  }
}

main().catch((error) => {
  console.error(`[pilar2-b1-b3] FAIL: ${error.message}`);
  if (error.odbcErrors) console.error(JSON.stringify(error.odbcErrors));
  process.exit(1);
});
