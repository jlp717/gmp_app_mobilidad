'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { splitSql } = require('./reparto-isolated-ddl-runner.js');

const CONFIRM = 'JAVIER_PROD_DDL';
const ENV_OK = 'production';
const FORBIDDEN = /\b(?:DSEDAC|DELETE|DROP|TRUNCATE)\b/i;
const TABLES_036 = [
  'REPARTO_CONFIRMACIONES',
  'REPARTO_LINEAS',
  'REPARTO_EVIDENCIAS',
  'REPARTO_CONFIRM_EVIDENCIAS',
];
const FILES = {
  '036': '036_reparto_confirmation_production_tables.sql',
  '037': '037_repartidor_liquidacion_production_additive.sql',
};

class RunnerError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'RunnerError';
    this.code = code;
    this.details = details;
  }
}

function emit(event) {
  const allowed = ['label', 'ordinal', 'sqlState', 'native', 'elapsedMs', 'status', 'migration', 'sha256', 'statementCount'];
  process.stdout.write(`${JSON.stringify(Object.fromEntries(
    allowed.filter((k) => event[k] !== undefined).map((k) => [k, event[k]]),
  ))}\n`);
}

function sha256(source) {
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex').toUpperCase();
}

function parseArgs(argv) {
  const parsed = { execute: false };
  const seen = new Set();
  for (const arg of argv) {
    let key;
    let value;
    if (arg === '--execute') {
      key = 'execute';
      value = true;
    } else {
      const match = /^--(migration|environment|confirm)=(.+)$/.exec(arg);
      if (!match) throw new RunnerError('INVALID_ARGUMENT');
      [, key, value] = match;
    }
    if (seen.has(key)) throw new RunnerError('DUPLICATE_ARGUMENT');
    seen.add(key);
    parsed[key] = value;
  }
  if (!FILES[parsed.migration]) throw new RunnerError('MIGRATION_NOT_ALLOWLISTED');
  if (parsed.environment !== ENV_OK) throw new RunnerError('ENVIRONMENT_NOT_ALLOWLISTED');
  if (parsed.confirm !== CONFIRM) throw new RunnerError('CONFIRMATION_MISMATCH');
  if (parsed.execute && (parsed.environment !== ENV_OK || parsed.confirm !== CONFIRM)) {
    throw new RunnerError('EXECUTION_GUARD_INCOMPLETE');
  }
  return parsed;
}

function loadSql(migration) {
  const sqlDirectory = fs.realpathSync.native
    ? fs.realpathSync.native(path.join(__dirname, 'sql'))
    : fs.realpathSync(path.join(__dirname, 'sql'));
  const nominalPath = path.join(sqlDirectory, FILES[migration]);
  const stat = fs.lstatSync(nominalPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new RunnerError('SQL_PATH_NOT_REGULAR_FILE');
  const realPath = fs.realpathSync.native
    ? fs.realpathSync.native(nominalPath)
    : fs.realpathSync(nominalPath);
  if (path.dirname(realPath) !== sqlDirectory || realPath !== nominalPath) {
    throw new RunnerError('SQL_PATH_ESCAPE');
  }
  const source = fs.readFileSync(realPath, 'utf8');
  return { source, hash: sha256(source), realPath };
}

function split036(sql) {
  const statements = [];
  let buffer = '';
  for (const line of sql.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;
    buffer += `${line}\n`;
    if (trimmed.endsWith(';')) {
      const stmt = buffer.trim().replace(/;+\s*$/, '').trim();
      if (stmt) statements.push(stmt);
      buffer = '';
    }
  }
  if (buffer.trim()) throw new RunnerError('UNTERMINATED_SQL_STATEMENT');
  return statements;
}

function labelFor(migration, statement, index) {
  if (migration === '036') return `create_${index + 1}`;
  const kw = /^([A-Z]+)/i.exec(statement.trim());
  return kw ? `${kw[1].toLowerCase()}_${index + 1}` : `stmt_${index + 1}`;
}

function odbcBrace(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new RunnerError(`MISSING_${name}`);
  if (/[\0\r\n]/.test(value)) throw new RunnerError(`INVALID_${name}`);
  return `{${value.replace(/}/g, '}}')}}`;
}

function connectionString(env) {
  return `DSN=GMP;UID=${odbcBrace(env.ODBC_UID, 'ODBC_UID')};PWD=${odbcBrace(env.ODBC_PWD, 'ODBC_PWD')};DBQ=JAVIER;NAM=1;CCSID=1208;CMPTDM=1`;
}

function dbErrorFields(error) {
  const first = Array.isArray(error && error.odbcErrors) ? error.odbcErrors[0] : null;
  return {
    sqlState: (first && (first.state || first.sqlstate || first.SQLSTATE)) || undefined,
    native: first && (first.code ?? first.native ?? first.nativeError) != null
      ? String(first.code ?? first.native ?? first.nativeError)
      : undefined,
  };
}

async function closeResource(resource) {
  if (resource && typeof resource.close === 'function') await resource.close();
}

async function catalog036(connection) {
  const placeholders = TABLES_036.map(() => '?').join(',');
  const rows = await connection.query(
    `SELECT TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME IN (${placeholders})`,
    TABLES_036,
  );
  const present = new Set((rows || []).map((r) => String(r.TABLE_NAME || r.table_name || '').toUpperCase()));
  const count = TABLES_036.filter((t) => present.has(t)).length;
  if (count === 0) return 'ABSENT';
  if (count === TABLES_036.length) return 'ALL_PRESENT';
  return 'PARTIAL';
}

async function executeStatements(connection, migration, statements) {
  for (let i = 0; i < statements.length; i += 1) {
    const label = labelFor(migration, statements[i], i);
    const started = Date.now();
    try {
      await connection.query(statements[i]);
      emit({ label, ordinal: i + 1, elapsedMs: Date.now() - started, status: 'OK' });
    } catch (error) {
      emit({
        label,
        ordinal: i + 1,
        elapsedMs: Date.now() - started,
        status: 'PARTIAL_UNKNOWN_STATE',
        ...dbErrorFields(error),
      });
      throw new RunnerError('PARTIAL_UNKNOWN_STATE', dbErrorFields(error));
    }
  }
}

async function run(argv) {
  const args = parseArgs(argv);
  const loaded = loadSql(args.migration);
  const statements = args.migration === '036'
    ? split036(loaded.source)
    : splitSql(loaded.source);
  for (const stmt of statements) {
    if (FORBIDDEN.test(stmt)) throw new RunnerError('FORBIDDEN_SQL');
  }
  emit({
    label: `migration_${args.migration}`,
    ordinal: 0,
    status: args.execute ? 'PREPARE' : 'DRY_RUN',
    migration: args.migration,
    sha256: loaded.hash,
    statementCount: statements.length,
  });
  if (!args.execute) return { status: 'DRY_RUN' };

  const odbc = require('odbc');
  if (!odbc || typeof odbc.pool !== 'function') throw new RunnerError('ODBC_POOL_UNAVAILABLE');

  let pool;
  let connection;
  let primaryError;
  try {
    pool = await odbc.pool(connectionString(process.env));
    connection = await pool.connect();

    if (args.migration === '036') {
      const catalog = await catalog036(connection);
      if (catalog === 'ALL_PRESENT') {
        emit({ label: 'migration_036', ordinal: 0, status: 'ALREADY_PRESENT' });
        return { status: 'ALREADY_PRESENT' };
      }
      if (catalog === 'PARTIAL') throw new RunnerError('CATALOG_PARTIAL');
    }

    await executeStatements(connection, args.migration, statements);
    emit({ label: `migration_${args.migration}`, ordinal: 0, status: 'EXECUTED' });
    return { status: 'EXECUTED' };
  } catch (error) {
    primaryError = error instanceof RunnerError ? error : new RunnerError('RUNNER_FAILED', dbErrorFields(error));
    throw primaryError;
  } finally {
    try {
      await closeResource(connection);
    } catch (error) {
      if (!primaryError) throw new RunnerError('CONNECTION_CLOSE_FAILED', dbErrorFields(error));
    } finally {
      try {
        await closeResource(pool);
      } catch (error) {
        if (!primaryError) throw new RunnerError('POOL_CLOSE_FAILED', dbErrorFields(error));
      }
    }
  }
}

async function main() {
  try {
    await run(process.argv.slice(2));
    process.exitCode = 0;
  } catch (error) {
    emit({
      label: 'runner',
      ordinal: 0,
      status: error.code || 'RUNNER_FAILED',
      ...(error.details || {}),
    });
    process.exitCode = 1;
  }
}

if (require.main === module) main();
