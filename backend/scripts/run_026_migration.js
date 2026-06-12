'use strict';

/**
 * Runner para la migracion 026_align_javier_immediate_fixes.sql
 * Ejecuta cada statement individualmente y tolera errores de "objeto ya existe"
 * (SQLSTATE 42710 / SQL CODE -601). El resto de errores aborta.
 *
 * USO: node backend/scripts/run_026_migration.js
 */
const fs = require('fs');
const path = require('path');
const odbc = require('odbc');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function requireEnv(name) {
  const value = process['env'][name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Missing required environment variable ' + name);
  }
  return value;
}

const SQL_FILE = path.resolve(__dirname, 'sql', '026_align_javier_immediate_fixes.sql');

function connectionString() {
  const dsn = process.env.ODBC_DSN || 'GMP';
  const uid = requireEnv('ODBC_UID');
  const pwd = requireEnv('ODBC_PWD');
  return [
    `DSN=${dsn}`, `UID=${uid}`, `PWD=${pwd}`,
    'NAM=1', 'CCSID=1208', 'CMPTDM=1',
    `CPTOUT=${process.env.ODBC_TIMEOUT || 60}`,
    `COMMTIMEOUT=${process.env.ODBC_COMM_TIMEOUT || 90}`,
    `DBQ=${dsn}`,
  ].join(';');
}

// Errores tolerables: objeto/columna ya existe
const TOLERABLE_PATTERNS = [
  /SQLSTATE\s*=?\s*42710/i,      // duplicate object
  /SQLSTATE\s*=?\s*42711/i,      // duplicate column
  /SQLSTATE\s*=?\s*42704/i,      // undefined object (e.g. dropping non-existent)
  /already exists/i,
  /SQLCODE\s*=?\s*-601/i,
  /SQLCODE\s*=?\s*-204/i,
];
function isTolerable(err) {
  const msg = String(err.message || '');
  return TOLERABLE_PATTERNS.some(rx => rx.test(msg));
}

function splitStatements(sql) {
  // Quita comentarios de linea y bloques, divide por ; al final de linea
  const stripped = sql
    .replace(/--[^\n]*\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  return stripped
    .split(/;\s*(?:\r?\n|$)/)
    .map(s => s.trim())
    .filter(Boolean);
}

(async () => {
  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  const statements = splitStatements(sql);
  console.log(`[026] ${statements.length} sentencias detectadas`);

  const conn = await odbc.connect(connectionString());

  let ok = 0, skipped = 0, failed = 0;
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.slice(0, 70).replace(/\s+/g, ' ');
    try {
      await conn.query(stmt);
      ok++;
      console.log(`  [${i + 1}/${statements.length}] OK   ${preview}...`);
    } catch (err) {
      if (isTolerable(err)) {
        skipped++;
        console.log(`  [${i + 1}/${statements.length}] SKIP ${preview}... (${err.message.split('\n')[0]})`);
      } else {
        failed++;
        console.error(`  [${i + 1}/${statements.length}] FAIL ${preview}...`);
        console.error(`    -> ${err.message}`);
      }
    }
  }

  await conn.close();
  console.log(`\nResumen: ${ok} OK, ${skipped} SKIPPED, ${failed} FAILED`);
  if (failed > 0) {
    console.error('\nHubo errores no tolerables. Revisa el log.');
    process.exit(1);
  }
})().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
