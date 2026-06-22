'use strict';

/**
 * Execute JAVIER schema alignment to DSEDAC export targets.
 * Adds missing DSEDAC columns to JAVIER tables (insert-compatible mirror).
 *
 * Usage (on server with ODBC):
 *   cd backend && node scripts/execute-javier-dsedac-alignment.js
 *   node scripts/execute-javier-dsedac-alignment.js --dry-run
 *
 * Output: backend/tmp/db-exploration/javier-dsedac-alignment-executed-<ts>.json
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs/promises');
const path = require('path');
const odbc = require('odbc');

const DRY_RUN = process.argv.includes('--dry-run');
const APP_SCHEMA = 'JAVIER';
const ERP_SCHEMA = 'DSEDAC';

const PAIRS = [
  { javier: 'PEDIDOS_CAB', dsedac: 'CPC' },
  { javier: 'PEDIDOS_LIN', dsedac: 'LPC' },
  { javier: 'COBROS', dsedac: 'CRC' },
  { javier: 'REPARTIDOR_COBROS', dsedac: 'CRCA' },
];

const APP_ONLY_TABLES = ['BOLSA_COMERCIAL', 'MOVIMIENTOS_BOLSA', 'PEDIDOS_SEQ', 'PEDIDOS_STOCK_RESERVE'];

/** Columns that share a name but differ by design (app UUID vs ERP integer). */
const SEMANTIC_TYPE_OVERRIDES = new Set([
  'JAVIER.COBROS:ID',
]);

function connectionString() {
  const pwd = process.env.ODBC_PWD || process.env.ODBC_PASSWORD;
  return [
    `DSN=${process.env.ODBC_DSN || 'GMP'}`,
    `UID=${process.env.ODBC_UID || 'JAVIER'}`,
    `PWD=${pwd}`,
    'NAM=1', 'CCSID=1208', 'CMPTDM=1', 'CPTOUT=120', 'COMMTIMEOUT=180',
  ].join(';');
}

function normalizeName(v) {
  return String(v || '').trim().toUpperCase();
}

function sqlType(col) {
  const t = normalizeName(col.DATA_TYPE);
  const len = Number(col.LENGTH || 0);
  const scale = Number(col.NUMERIC_SCALE || col.SCALE || 0);
  if (['DECIMAL', 'NUMERIC', 'PACKED', 'ZONED'].includes(t)) {
    return `${t}(${len || 10},${scale || 0})`;
  }
  if (['CHAR', 'CHARACTER', 'VARCHAR', 'GRAPHIC', 'VARGRAPHIC'].includes(t)) {
    return `${t}(${len || 1})`;
  }
  if (['BIGINT', 'INTEGER', 'SMALLINT', 'DATE', 'TIME', 'TIMESTAMP', 'REAL', 'DOUBLE', 'DECFLOAT'].includes(t)) {
    return t;
  }
  if (len > 0 && scale > 0) return `${t}(${len},${scale})`;
  if (len > 0) return `${t}(${len})`;
  return t;
}

function typesCompatible(jCol, dCol) {
  const jSig = `${normalizeName(jCol.DATA_TYPE)}(${jCol.LENGTH},${jCol.NUMERIC_SCALE || 0})`;
  const dSig = `${normalizeName(dCol.DATA_TYPE)}(${dCol.LENGTH},${dCol.NUMERIC_SCALE || 0})`;
  if (jSig === dSig) return true;
  const numeric = new Set(['BIGINT', 'DECIMAL', 'DECFLOAT', 'DOUBLE', 'FLOAT', 'INTEGER', 'NUMERIC', 'PACKED', 'REAL', 'SMALLINT', 'ZONED']);
  const strings = new Set(['CHAR', 'CHARACTER', 'VARCHAR', 'CLOB']);
  const jt = normalizeName(jCol.DATA_TYPE);
  const dt = normalizeName(dCol.DATA_TYPE);
  if (numeric.has(jt) && numeric.has(dt)) {
    return Number(jCol.LENGTH) >= Number(dCol.LENGTH) && Number(jCol.NUMERIC_SCALE || 0) >= Number(dCol.NUMERIC_SCALE || 0);
  }
  if (strings.has(jt) && strings.has(dt)) {
    return Number(jCol.LENGTH) >= Number(dCol.LENGTH);
  }
  return jt === dt;
}

async function getColumns(conn, schema, table) {
  return conn.query(
    `SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE, ORDINAL_POSITION
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
}

async function tableExists(conn, schema, table) {
  const rows = await conn.query(
    `SELECT 1 AS OK FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? FETCH FIRST 1 ROW ONLY`,
    [schema, table],
  );
  return rows.length > 0;
}

async function runDdl(conn, sql, log) {
  log.ddl.push(sql);
  if (DRY_RUN) {
    log.executed.push({ sql, status: 'dry-run' });
    return;
  }
  try {
    await conn.query(sql);
    log.executed.push({ sql, status: 'ok' });
  } catch (err) {
    log.executed.push({ sql, status: 'error', error: err.message });
    log.errors.push({ sql, error: err.message });
  }
}

async function alignPair(conn, pair, log) {
  const result = { pair: `${pair.javier}->${pair.dsedac}`, missing: [], typeMismatches: [], appOnly: [] };
  const jExists = await tableExists(conn, APP_SCHEMA, pair.javier);
  const dExists = await tableExists(conn, ERP_SCHEMA, pair.dsedac);
  if (!dExists) {
    result.error = `DSEDAC.${pair.dsedac} not found`;
    log.pairs.push(result);
    return;
  }
  if (!jExists) {
    result.error = `JAVIER.${pair.javier} not found — run generate_align_migration.js first`;
    log.pairs.push(result);
    return;
  }

  const [jCols, dCols] = await Promise.all([
    getColumns(conn, APP_SCHEMA, pair.javier),
    getColumns(conn, ERP_SCHEMA, pair.dsedac),
  ]);
  const jMap = new Map(jCols.map((c) => [normalizeName(c.COLUMN_NAME), c]));
  const dMap = new Map(dCols.map((c) => [normalizeName(c.COLUMN_NAME), c]));

  for (const dCol of dCols) {
    const name = normalizeName(dCol.COLUMN_NAME);
    const jCol = jMap.get(name);
    if (!jCol) {
      result.missing.push(name);
      const nullable = normalizeName(dCol.IS_NULLABLE) === 'N' ? ' NOT NULL WITH DEFAULT' : '';
      const ddl = `ALTER TABLE ${APP_SCHEMA}.${pair.javier} ADD COLUMN ${name} ${sqlType(dCol)}${nullable}`;
      await runDdl(conn, ddl, log);
      continue;
    }
    if (!typesCompatible(jCol, dCol)) {
      const overrideKey = `${APP_SCHEMA}.${pair.javier}:${name}`;
      if (SEMANTIC_TYPE_OVERRIDES.has(overrideKey)) {
        result.semanticOverrides = result.semanticOverrides || [];
        result.semanticOverrides.push({ column: name, javier: sqlType(jCol), dsedac: sqlType(dCol) });
        continue;
      }
      result.typeMismatches.push({
        column: name,
        javier: sqlType(jCol),
        dsedac: sqlType(dCol),
      });
      const ddl = `ALTER TABLE ${APP_SCHEMA}.${pair.javier} ALTER COLUMN ${name} SET DATA TYPE ${sqlType(dCol)}`;
      await runDdl(conn, ddl, log);
    }
  }

  for (const jCol of jCols) {
    const name = normalizeName(jCol.COLUMN_NAME);
    if (!dMap.has(name)) result.appOnly.push(name);
  }

  result.javierCols = jCols.length;
  result.dsedacCols = dCols.length;
  result.insertReady = result.missing.length === 0 && result.typeMismatches.length === 0;
  log.pairs.push(result);
}

async function main() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(__dirname, '..', 'tmp', 'db-exploration');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `javier-dsedac-alignment-executed-${ts}.json`);

  const log = {
    ts: new Date().toISOString(),
    dryRun: DRY_RUN,
    appSchema: APP_SCHEMA,
    erpSchema: ERP_SCHEMA,
    ddl: [],
    executed: [],
    errors: [],
    pairs: [],
    appOnly: [],
  };

  const conn = await odbc.connect(connectionString());
  try {
    for (const pair of PAIRS) {
      process.stdout.write(`[align] ${pair.javier} <- ${pair.dsedac}... `);
      await alignPair(conn, pair, log);
      console.log('done');
    }

    for (const table of APP_ONLY_TABLES) {
      const exists = await tableExists(conn, APP_SCHEMA, table);
      log.appOnly.push({ table, exists, note: 'ERP-only N/A — app buffer by design' });
    }

    log.summary = {
      ddlCount: log.ddl.length,
      errors: log.errors.length,
      pairsInsertReady: log.pairs.filter((p) => p.insertReady).length,
      pairsTotal: log.pairs.length,
    };
    log.verdict = log.errors.length === 0 && log.pairs.every((p) => p.insertReady || p.error)
      ? 'ALIGNED'
      : 'NEEDS_REVIEW';

    await fs.writeFile(outPath, JSON.stringify(log, null, 2), 'utf8');
    console.log(`[align] verdict=${log.verdict} ddl=${log.ddl.length} wrote ${outPath}`);
    if (log.errors.length) process.exitCode = 1;
  } finally {
    await conn.close();
  }
}

main().catch((e) => {
  console.error('[align] FATAL:', e.message);
  process.exit(1);
});
