'use strict';

/**
 * PILAR 2 additive default alignment (2026-06-11)
 * ===============================================
 * Aligns column DEFAULTs in JAVIER write-tables with their DSEDAC production
 * equivalents where BOTH sides are already NOT NULL and only the default
 * differs (verified against QSYS2.SYSCOLUMNS on 2026-06-11):
 *
 *   JAVIER.PEDIDOS_CAB.NUMEROPEDIDO    NOT NULL sin default -> DEFAULT 0   (DSEDAC.CPC = 0)
 *   JAVIER.PEDIDOS_CAB.CODIGOVENDEDOR  NOT NULL sin default -> DEFAULT ' ' (DSEDAC.CPC = ' ')
 *   JAVIER.PEDIDOS_LIN.CODIGOARTICULO  NOT NULL sin default -> DEFAULT ' ' (DSEDAC.LPC = ' ')
 *
 * SET DEFAULT is purely additive: no data is touched, existing INSERTs that
 * always provide these columns keep identical behavior.
 *
 * Follows the align-javier-dsedac-additive.js convention: writes the .sql and
 * .json evidence files into scripts/sql/migrations/. Apply with --apply.
 * Writes ONLY against JAVIER.
 */

const fs = require('fs/promises');
const path = require('path');
const odbc = require('odbc');

const APPLY = process.argv.includes('--apply');
const OUTPUT_DIR = path.resolve(__dirname, 'sql', 'migrations');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function requireDb2Secret() {
  const value = process.env.ODBC_PWD ?? process.env.ODBC_PASSWORD;
  if (!value) throw new Error('Missing required environment variable ODBC_PWD or ODBC_PASSWORD');
  return value;
}

function connectionString() {
  const dsn = requireEnv('ODBC_DSN');
  const uid = requireEnv('ODBC_UID');
  const pwd = requireDb2Secret();
  return [
    `DSN=${dsn}`, `UID=${uid}`, `PWD=${pwd}`,
    'NAM=1', 'CCSID=1208', 'CMPTDM=1',
    `CPTOUT=${process.env.ODBC_TIMEOUT || 60}`,
    `COMMTIMEOUT=${process.env.ODBC_COMM_TIMEOUT || 90}`,
    `DBQ=${dsn}`,
  ].join(';');
}

const CHANGES = [
  { table: 'JAVIER.PEDIDOS_CAB', column: 'NUMEROPEDIDO', defaultSql: '0', prodRef: 'DSEDAC.CPC' },
  { table: 'JAVIER.PEDIDOS_CAB', column: 'CODIGOVENDEDOR', defaultSql: "' '", prodRef: 'DSEDAC.CPC' },
  { table: 'JAVIER.PEDIDOS_LIN', column: 'CODIGOARTICULO', defaultSql: "' '", prodRef: 'DSEDAC.LPC' },
];

function statements() {
  return CHANGES.map(change =>
    `ALTER TABLE ${change.table} ALTER COLUMN ${change.column} SET DEFAULT ${change.defaultSql}`);
}

async function verify(conn) {
  const rows = [];
  for (const change of CHANGES) {
    const [schema, table] = change.table.split('.');
    if (schema !== 'JAVIER') throw new Error(`GUARDRAIL: target ${change.table} is not JAVIER`);
    const result = await conn.query(
      `SELECT COLUMN_NAME, IS_NULLABLE, HAS_DEFAULT, COLUMN_DEFAULT
         FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [schema, table, change.column]);
    rows.push({ table: change.table, ...result[0] });
  }
  return rows;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const conn = await odbc.connect(connectionString());
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sqlPath = path.join(OUTPUT_DIR, `${stamp}_align_javier_defaults_additive.sql`);
    const jsonPath = path.join(OUTPUT_DIR, `${stamp}_align_javier_defaults_additive.json`);
    const ddl = statements();

    const before = await verify(conn);
    const applied = [];
    if (APPLY) {
      for (const statement of ddl) {
        if (!/^ALTER TABLE JAVIER\./.test(statement)) {
          throw new Error(`GUARDRAIL: refused non-JAVIER statement: ${statement}`);
        }
        try {
          await conn.query(statement);
          applied.push({ statement, status: 'OK' });
        } catch (error) {
          applied.push({ statement, status: 'ERROR', error: error.message });
          throw error;
        }
      }
    }
    const after = APPLY ? await verify(conn) : null;

    const sqlLines = [
      '-- PILAR 2 pre-prod audit: additive DEFAULT alignment JAVIER -> DSEDAC',
      `-- Generated: ${new Date().toISOString()}`,
      '-- Both sides NOT NULL; only the default differed (catalog-verified).',
      '-- SET DEFAULT touches no data. JAVIER only.',
      '',
      ...ddl.map(statement => `${statement};`),
      '',
    ];
    await fs.writeFile(sqlPath, sqlLines.join('\n'), 'utf8');
    await fs.writeFile(jsonPath, JSON.stringify({
      ts: new Date().toISOString(),
      apply: APPLY,
      changes: CHANGES,
      statements: ddl,
      before,
      applied,
      after,
    }, null, 2), 'utf8');

    console.log(`[pilar2-defaults] apply=${APPLY} statements=${ddl.length}`);
    console.log(`[pilar2-defaults] wrote ${sqlPath}`);
    console.log(`[pilar2-defaults] wrote ${jsonPath}`);
    if (after) console.log('[pilar2-defaults] AFTER:', JSON.stringify(after));
  } finally {
    await conn.close();
  }
}

main().catch(error => {
  console.error(`[pilar2-defaults] FAIL: ${error.message}`);
  if (error.odbcErrors) console.error(JSON.stringify(error.odbcErrors));
  process.exit(1);
});
