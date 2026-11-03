#!/usr/bin/env node
'use strict';

const path = require('path');

const backendRoot = path.resolve(__dirname, '..', '..');
const {
  applyAppProfile,
  resolveAppProfile,
  sanitizeAppProfile,
} = require('../../config/app-profile');
const {
  inspectAppBufferCapability,
} = require('../../utils/db2-app-buffer-capability');

function expectedCatalogObjects(profile) {
  const isolated = profile.tableSet === 'isolated_test';
  const writePrefix = isolated ? 'TEST_' : '';
  return Object.freeze([
    Object.freeze({ schema: 'DSEDAC', table: 'ART', purpose: 'catalog-read' }),
    Object.freeze({ schema: 'DSEDAC', table: 'CLI', purpose: 'customer-read' }),
    Object.freeze({ schema: 'DSEDAC', table: 'CPC', purpose: 'orders-read' }),
    Object.freeze({ schema: 'DSED', table: 'LACLAE', purpose: 'sales-read' }),
    Object.freeze({ schema: 'JAVIER', table: `${writePrefix}PEDIDOS_CAB`, purpose: 'orders-write' }),
    Object.freeze({ schema: 'JAVIER', table: `${writePrefix}PEDIDOS_LIN`, purpose: 'order-lines-write' }),
    Object.freeze({ schema: 'JAVIER', table: `${writePrefix}BOLSA_COMERCIAL`, purpose: 'bag-write' }),
    Object.freeze({ schema: 'JAVIER', table: `${writePrefix}MOVIMIENTOS_BOLSA`, purpose: 'bag-ledger-write' }),
    Object.freeze({ schema: 'JAVIER', table: `${writePrefix}PEDIDO_STATE_EVENTS`, purpose: 'order-state-audit' }),
    Object.freeze({ schema: 'JAVIER', table: `${writePrefix}LIQUIDACION_COMERCIAL`, purpose: 'commercial-settlement-buffer' }),
    Object.freeze({ schema: 'JAVIER', table: `${writePrefix}DEVOLUCIONES_COMERCIAL`, purpose: 'commercial-returns-buffer' }),
  ]);
}

function buildCatalogCheck(objects) {
  const clauses = objects.map(() => '(TABLE_SCHEMA = ? AND TABLE_NAME = ?)');
  return Object.freeze({
    sql: `SELECT TABLE_SCHEMA, TABLE_NAME FROM QSYS2.SYSTABLES WHERE ${clauses.join(' OR ')}`,
    params: objects.flatMap((entry) => [entry.schema, entry.table]),
  });
}

function returnedObjectKey(row) {
  const schema = String(row.TABLE_SCHEMA || row.table_schema || '').trim().toUpperCase();
  const table = String(row.TABLE_NAME || row.table_name || '').trim().toUpperCase();
  return `${schema}.${table}`;
}

function invalidVerifierProfile() {
  const error = new Error('A coherent explicit APP_ENV profile is required.');
  error.code = 'APP_BUFFER_PROFILE_INVALID';
  return error;
}

function assertVerifiableProfile(profile) {
  const appEnv = String(profile?.profile || '').trim().toLowerCase();
  if (!appEnv || profile?.verified !== true) throw invalidVerifierProfile();
  const resolved = resolveAppProfile({
    APP_ENV: appEnv,
    REPARTO_TABLE_SET: profile.tableSet,
    DB2_READ_SCHEMA: profile.readSchema,
    DB2_WRITE_SCHEMA: profile.writeSchema,
  });
  if (!resolved.valid) throw invalidVerifierProfile();
  const canonical = sanitizeAppProfile(resolved);
  for (const key of ['profile', 'readSchema', 'writeSchema', 'tableSet']) {
    if (profile[key] !== canonical[key]) throw invalidVerifierProfile();
  }
  return canonical;
}

function createReadOnlyConnector(env = process.env) {
  return async function connectReadOnly() {
    const dsn = String(env.ODBC_DSN || '').trim();
    const uid = String(env.ODBC_UID || '').trim();
    const pwd = String(env.ODBC_PWD || '').trim();
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(dsn) || !uid || !pwd) {
      const error = new Error('DB2 verification configuration is unavailable');
      error.code = 'DB_CREDENTIALS_REQUIRED';
      throw error;
    }
    const odbc = require('odbc');
    // A dedicated connection avoids backend/config/db.js entirely: its normal
    // application setup performs QCMDEXC job/library CALLs. env:verify must be
    // observational, so the connection itself carries CCSID and runs SELECTs only.
    return odbc.connect(
      `DSN=${dsn};UID=${uid};PWD=${pwd};NAM=1;CCSID=1208;CMPTDM=1;`,
    );
  };
}

async function verifyDatabaseReadOnly(
  profile,
  { connect = createReadOnlyConnector() } = {},
) {
  const verifiedProfile = assertVerifiableProfile(profile);
  const expected = expectedCatalogObjects(verifiedProfile);
  const catalogCheck = buildCatalogCheck(expected);
  let connection = null;
  try {
    connection = await connect();
    const pingRows = await connection.query(
      'SELECT 1 AS OK FROM SYSIBM.SYSDUMMY1',
      [],
    );
    const catalogRows = await connection.query(
      catalogCheck.sql,
      catalogCheck.params,
    );
    const found = new Set(catalogRows.map(returnedObjectKey));
    const missing = expected
      .filter((entry) => !found.has(`${entry.schema}.${entry.table}`))
      .map((entry) => `${entry.schema}.${entry.table}`);
    const capabilityProfile = {
      APP_ENV: verifiedProfile.profile,
      REPARTO_TABLE_SET: verifiedProfile.tableSet,
      DB2_WRITE_SCHEMA: verifiedProfile.writeSchema,
    };
    const appBufferCapability = await inspectAppBufferCapability({
      family: 'profileBuffers',
      env: capabilityProfile,
      catalogQuery: (sql, params) => connection.query(sql, params),
      forceMetadata: true,
    });
    return Object.freeze({
      readOnly: true,
      selectOne: Number(pingRows?.[0]?.OK ?? pingRows?.[0]?.ok) === 1,
      catalogObjectsChecked: expected.length,
      catalogObjectsFound: found.size,
      missing: Object.freeze(missing),
      appBufferCapability,
      valid: missing.length === 0 && appBufferCapability.available,
    });
  } finally {
    if (connection) await connection.close().catch(() => {});
  }
}

async function main(argv = process.argv.slice(2)) {
  const unexpected = argv.filter((arg) => arg !== '--no-db');
  if (unexpected.length > 0) {
    const error = new Error(`Unknown argument: ${unexpected[0]}`);
    error.code = 'INVALID_ENV_VERIFY_ARGUMENT';
    throw error;
  }

  require('../../config/load-env').loadEnv(backendRoot);
  const profile = applyAppProfile(process.env);
  const safeProfile = sanitizeAppProfile(profile);
  const noDb = argv.includes('--no-db');
  const database = noDb
    ? Object.freeze({ readOnly: true, skipped: true, reason: '--no-db' })
    : await verifyDatabaseReadOnly(safeProfile);
  const output = Object.freeze({ profile: safeProfile, database });
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (database.valid === false || database.selectOne === false) process.exitCode = 1;
  return output;
}

if (require.main === module) {
  main().catch((error) => {
    // Never print error.message here: ODBC drivers may include connection
    // attributes. A stable code is enough to diagnose without leaking them.
    process.stderr.write(`${JSON.stringify({
      success: false,
      code: String(error?.code || 'ENV_VERIFY_FAILED'),
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertVerifiableProfile,
  buildCatalogCheck,
  createReadOnlyConnector,
  expectedCatalogObjects,
  main,
  verifyDatabaseReadOnly,
};
