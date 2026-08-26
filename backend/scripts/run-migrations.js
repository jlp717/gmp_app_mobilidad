'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { closePool, queryWithParams } = require('../config/db');

const migrationsDir = path.resolve(__dirname, '..', '..', 'db', 'migrations');
const apply = process.argv.slice(2).includes('--apply');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--apply');

function assertApplyIsTestOnly() {
  const environment = String(process.env.REPARTO_ENVIRONMENT || '').trim().toLowerCase();
  const tableSet = String(process.env.REPARTO_TABLE_SET || '').trim().toLowerCase();
  const approval = String(process.env.REPARTO_MIGRATION_APPROVAL || '').trim();
  if (environment !== 'staging' || tableSet !== 'isolated_test' || approval !== 'TEST_ONLY') {
    const error = new Error(
      'Migration apply requires REPARTO_ENVIRONMENT=staging, REPARTO_TABLE_SET=isolated_test and REPARTO_MIGRATION_APPROVAL=TEST_ONLY',
    );
    error.code = 'MIGRATION_TEST_GATE_REQUIRED';
    throw error;
  }
}

function migrationFiles() {
  return fs.readdirSync(migrationsDir)
    .filter((name) => /^\d{3}_.+\.sql$/i.test(name))
    .sort((left, right) => left.localeCompare(right));
}

function loadMigration(fileName) {
  const sql = fs.readFileSync(path.join(migrationsDir, fileName), 'utf8').trim();
  if (!sql) throw new Error('Empty migration: ' + fileName);
  const name = path.basename(fileName, '.sql');
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');
  const recordName = name + '__' + checksum.slice(0, 8);
  if (recordName.length > 255) throw new Error('Migration record exceeds KPI_MIGRATIONS.NAME: ' + fileName);
  return { fileName, name, recordName, sql };
}

async function run() {
  if (unknownArgs.length) throw new Error('Unknown arguments: ' + unknownArgs.join(', '));
  if (apply) assertApplyIsTestOnly();

  const rows = await queryWithParams(
    'SELECT NAME FROM JAVIER.KPI_MIGRATIONS ORDER BY APPLIED_AT, ID',
    [],
    false,
    true,
  );
  const appliedNames = new Set((rows || []).map((row) => String(row.NAME || row.name || '').trim()));
  const migrations = migrationFiles().map(loadMigration);
  const pending = [];

  for (const migration of migrations) {
    if (appliedNames.has(migration.recordName)) continue;
    const previousChecksum = [...appliedNames].find((name) => name.startsWith(migration.name + '__'));
    if (previousChecksum) {
      const error = new Error('Checksum mismatch for applied migration: ' + migration.fileName);
      error.code = 'MIGRATION_CHECKSUM_MISMATCH';
      throw error;
    }
    pending.push(migration);
  }

  process.stdout.write((apply ? 'APPLY' : 'DRY-RUN') + ': ' + pending.length + ' pending migration(s)\n');
  for (const migration of pending) {
    process.stdout.write((apply ? 'applying ' : 'pending ') + migration.recordName + '\n');
    if (!apply) continue;
    await queryWithParams(migration.sql, [], false, true);
    await queryWithParams(
      'INSERT INTO JAVIER.KPI_MIGRATIONS (NAME) VALUES (?)',
      [migration.recordName],
      false,
      true,
    );
  }
}

run()
  .catch((error) => {
    process.stderr.write((error.code ? error.code + ': ' : '') + error.message + '\n');
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));
