[CmdletBinding()]
param([switch]$Apply, [switch]$Probe)

$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$migrationPath = Join-Path $taskRoot 'backend\migrations\049_javier_test_pedido_state_events.sql'
$runnerPath = Join-Path $taskRoot 'backend\scripts\tools\ensure-pedido-state-events-test-ddl.js'
$profilePath = Join-Path $taskRoot 'backend\config\app-profile.js'
$requiredHash = 'b73a426bea730fab91b033bebaf9a582163d60cefb5b4ebe8ad1809879cec616'
$requiredRunnerHash = 'b05b1ec84086262679768af94662b87c5f4042e18b32a4ed894f26d9a740f964'
$requiredProfileHash = '3341baffc9aa208457c2241fb2fd80bd998591789cc62ebecb1b376e86d773af'
$observedHash = (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($observedHash -ne $requiredHash) { throw 'Reviewed migration hash changed; no connection was opened.' }
if ((Get-FileHash -LiteralPath $runnerPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $requiredRunnerHash) { throw 'Reviewed parser/contract hash changed; no connection was opened.' }
if ((Get-FileHash -LiteralPath $profilePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $requiredProfileHash) { throw 'Reviewed profile resolver hash changed; no connection was opened.' }
if ($Apply -and -not $Probe) { throw 'Every mutating invocation requires all rollback probes; no connection was opened.' }
if (-not $Apply) {
    [ordered]@{ mode = 'DRY_RUN'; connected = $false; target = 'JAVIER.TEST_PEDIDO_STATE_EVENTS'; migrationSha256 = $observedHash; runnerApply = 'BLOCKED_NOT_USED' } | ConvertTo-Json
    exit 0
}

# One-off reviewed operation. Never calls the blocked runner's apply/inspectTarget.
$migration64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($migrationPath))
$runner64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($runnerPath))
$profile64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($profilePath))
$nodeSource = @'
'use strict';
require('./config/load-env').loadEnv(process.cwd());
const odbc = require('odbc');
const crypto = require('crypto');
const Module = require('module');
const fs = require('fs');
const expectedHash = 'b73a426bea730fab91b033bebaf9a582163d60cefb5b4ebe8ad1809879cec616';
const migration = Buffer.from('MIGRATION_BASE64', 'base64').toString('utf8');
const migrationHash = crypto.createHash('sha256').update(migration).digest('hex');
function fail(code) { throw Object.assign(new Error(code), { code }); }
function compile(name, b64, overrides = {}) {
  const m = new Module(name, module); m.filename = name;
  m.paths = Module._nodeModulePaths(process.cwd());
  const native = m.require.bind(m);
  m.require = (id) => Object.hasOwn(overrides, id) ? overrides[id] : native(id);
  m._compile(Buffer.from(b64, 'base64').toString('utf8'), name);
  return m.exports;
}
const profileModule = compile(process.cwd() + '/config/app-profile.reviewed.js', 'PROFILE_BASE64');
// This is a separate, explicitly TEST-scoped operation, not gmp-api startup.
// Only this short-lived process receives the canonical TEST assignments.
// The daemon, its files and its environment are never changed.
const operation = profileModule.resolveAppProfile({ APP_ENV: 'test' });
if (!operation.valid) fail('TEST_OPERATION_PROFILE_INVALID');
Object.assign(process.env, operation.assignments, { APP_ENV: 'test', ALLOW_DB2_DDL: 'true' });
const safeFs = { ...fs, readFileSync(path, encoding) {
  if (String(path).endsWith('/migrations/049_javier_test_pedido_state_events.sql')) {
    return encoding ? migration : Buffer.from(migration, 'utf8');
  }
  fail('UNREVIEWED_FILE_READ');
} };
const contract = compile(process.cwd() + '/scripts/tools/ensure-pedido-state-events-test-ddl.reviewed.js', 'RUNNER_BASE64', {
  fs: safeFs, '../../config/app-profile': profileModule,
});
const profile = contract.assertApplyEnvironment(process.env);
if (migrationHash !== expectedHash || contract.MIGRATION_SHA256 !== expectedHash) fail('MIGRATION_HASH_CHANGED');
const statements = contract.DDL_STATEMENTS;
if (statements.length !== 2
    || !/^CREATE TABLE JAVIER\.TEST_PEDIDO_STATE_EVENTS\s*\(/.test(statements[0])
    || !/^CREATE INDEX JAVIER\.IX_TEST_PED_STATE_EVENT_ORDER/.test(statements[1])
    || statements.some((sql) => /\b(DROP|ALTER|INSERT|UPDATE|DELETE|DSEDAC|DSED)\b/i.test(sql))) fail('UNREVIEWED_DDL');
const connectionString = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;CCSID=1208;`;
const normal = (v) => String(v ?? '').trim().toUpperCase();
const expression = (v) => normal(v).replace(/"/g, '').replace(/[\s()]+/g, '');
const yesNo = (v) => { const s = normal(v); if (['Y', 'YES'].includes(s)) return true; if (['N', 'NO'].includes(s)) return false; fail('UNKNOWN_CATALOG_BOOLEAN'); };
async function inventory(c) {
  const columns = await c.query('SELECT COLUMN_NAME,DATA_TYPE,LENGTH,IS_NULLABLE,IS_IDENTITY,IDENTITY_GENERATION,COLUMN_DEFAULT FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', ['JAVIER', 'TEST_PEDIDO_STATE_EVENTS']);
  const keys = await c.query("SELECT C.CONSTRAINT_NAME,C.CONSTRAINT_TYPE,K.COLUMN_NAME,K.ORDINAL_POSITION FROM QSYS2.SYSCST C JOIN QSYS2.SYSKEYCST K ON K.CONSTRAINT_SCHEMA=C.CONSTRAINT_SCHEMA AND K.CONSTRAINT_NAME=C.CONSTRAINT_NAME AND K.TABLE_SCHEMA=C.TABLE_SCHEMA AND K.TABLE_NAME=C.TABLE_NAME WHERE C.TABLE_SCHEMA=? AND C.TABLE_NAME=? AND C.CONSTRAINT_TYPE IN ('PRIMARY KEY','UNIQUE') ORDER BY C.CONSTRAINT_NAME,K.ORDINAL_POSITION", ['JAVIER', 'TEST_PEDIDO_STATE_EVENTS']);
  const checks = await c.query("SELECT C.CONSTRAINT_NAME,H.CHECK_CLAUSE FROM QSYS2.SYSCST C JOIN QSYS2.SYSCHKCST H ON H.CONSTRAINT_SCHEMA=C.CONSTRAINT_SCHEMA AND H.CONSTRAINT_NAME=C.CONSTRAINT_NAME WHERE C.TABLE_SCHEMA=? AND C.TABLE_NAME=? AND C.CONSTRAINT_TYPE='CHECK'", ['JAVIER', 'TEST_PEDIDO_STATE_EVENTS']);
  const indexes = await c.query('SELECT INDEX_NAME,IS_UNIQUE FROM QSYS2.SYSINDEXES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_SCHEMA=?', ['JAVIER', 'TEST_PEDIDO_STATE_EVENTS', 'JAVIER']);
  const indexKeys = await c.query('SELECT K.INDEX_NAME,K.COLUMN_NAME,K.ORDINAL_POSITION FROM QSYS2.SYSKEYS K JOIN QSYS2.SYSINDEXES I ON I.INDEX_SCHEMA=K.INDEX_SCHEMA AND I.INDEX_NAME=K.INDEX_NAME WHERE I.TABLE_SCHEMA=? AND I.TABLE_NAME=? AND K.INDEX_SCHEMA=? ORDER BY K.INDEX_NAME,K.ORDINAL_POSITION', ['JAVIER', 'TEST_PEDIDO_STATE_EVENTS', 'JAVIER']);
  const result = { exists: columns.length > 0, columns: {}, keyConstraints: {}, checks: {}, indexNames: new Set(), indexKeys: {} };
  for (const r of columns) result.columns[normal(r.COLUMN_NAME)] = { type: normal(r.DATA_TYPE) === 'TIMESTMP' ? 'TIMESTAMP' : normal(r.DATA_TYPE), length: Number(r.LENGTH), nullable: yesNo(r.IS_NULLABLE), identity: yesNo(r.IS_IDENTITY), identityGeneration: normal(r.IDENTITY_GENERATION) || null, defaultValue: expression(r.COLUMN_DEFAULT) || null };
  for (const r of keys) { const k = normal(r.CONSTRAINT_NAME); result.keyConstraints[k] ||= { type: normal(r.CONSTRAINT_TYPE), columns: [] }; result.keyConstraints[k].columns.push(normal(r.COLUMN_NAME)); }
  for (const r of checks) result.checks[normal(r.CONSTRAINT_NAME)] = r.CHECK_CLAUSE;
  for (const r of indexes) result.indexNames.add(normal(r.INDEX_NAME));
  for (const r of indexKeys) (result.indexKeys[normal(r.INDEX_NAME)] ||= []).push(normal(r.COLUMN_NAME));
  contract.assertExistingTargetComplete(result);
  if (columns.length !== 13) fail('UNEXPECTED_COLUMN_COUNT');
  const auxiliary = indexes.find((r) => normal(r.INDEX_NAME) === 'IX_TEST_PED_STATE_EVENT_ORDER');
  if (!auxiliary || !['D', 'N', 'NO'].includes(normal(auxiliary.IS_UNIQUE))) fail('AUXILIARY_INDEX_UNIQUENESS_MISMATCH');
  return { columns, keys, checks, indexes, indexKeys };
}
(async () => {
  const c = await odbc.connect(connectionString);
  let created = false;
  let after;
  try {
    // Unqualified constraint names inherit this dedicated job's schema on IBM i.
    // Match the fixed table schema without changing any persistent configuration.
    await c.query('SET CURRENT SCHEMA = JAVIER', []);
    const schemaRows = await c.query('SELECT CURRENT SCHEMA AS SCHEMA_NAME FROM SYSIBM.SYSDUMMY1', []);
    if (schemaRows.length !== 1 || normal(schemaRows[0].SCHEMA_NAME) !== 'JAVIER') fail('SESSION_SCHEMA_NOT_CONFIRMED');
    const before = await c.query('SELECT TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', ['JAVIER', 'TEST_PEDIDO_STATE_EVENTS']);
    const index = await c.query('SELECT INDEX_NAME FROM QSYS2.SYSINDEXES WHERE INDEX_SCHEMA=? AND INDEX_NAME=?', ['JAVIER', 'IX_TEST_PED_STATE_EVENT_ORDER']);
    const constraintNames = [...Object.keys(contract.EXPECTED_KEY_CONSTRAINTS), ...Object.keys(contract.EXPECTED_CHECKS)];
    const collisions = await c.query(`SELECT CONSTRAINT_NAME FROM QSYS2.SYSCST WHERE CONSTRAINT_SCHEMA=? AND CONSTRAINT_NAME IN (${constraintNames.map(() => '?').join(',')})`, ['JAVIER', ...constraintNames]);
    console.log('STATE_SCHEMA_PREFLIGHT=' + JSON.stringify({ operationProfile: profile, daemonProfileChanged: false, sessionSchemaMatchesTarget: true, migrationHash, tableAbsent: before.length === 0, indexNameFree: index.length === 0, constraintNamesFree: collisions.length === 0, runnerApplyUsed: false }));
    if (before.length || index.length || collisions.length) fail('FRESH_PREFLIGHT_NOT_EMPTY');
    for (const statement of statements) { await c.query(statement, []); created = true; }
    after = await inventory(c);
    const sys = await c.query('SELECT SYSTEM_TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', ['JAVIER', 'TEST_PEDIDO_STATE_EVENTS']);
    if (sys.length !== 1) fail('SYSTEM_TABLE_NAME_NOT_CONFIRMED');
    const journal = await c.query("SELECT OBJNAME,OBJLONGNAME,JOURNALED,JOURNAL_NAME,JOURNAL_LIBRARY,JOURNAL_IMAGES FROM TABLE(QSYS2.OBJECT_STATISTICS('JAVIER','*FILE')) X WHERE OBJNAME=?", [String(sys[0].SYSTEM_TABLE_NAME).trim()]);
    if (journal.length !== 1 || normal(journal[0].JOURNALED) !== 'YES') fail('JOURNAL_NOT_CONFIRMED');
    console.log('STATE_SCHEMA_APPLIED=' + JSON.stringify({ target: 'JAVIER.TEST_PEDIDO_STATE_EVENTS', migrationHash, statementsExecuted: 2, verified: true, journal, inventory: after }));
  } catch (e) {
    console.log('STATE_SCHEMA_STOP=' + JSON.stringify({ created, code: contract.safeErrorCode(e), details: e.details || null, odbc: (e.odbcErrors || []).map((x) => ({ state: x.state, code: x.code })) }));
    throw e;
  } finally { await c.close(); }
  const observer = await odbc.connect(connectionString);
  const sentinelPrefix = 'QA_STATE_SCHEMA_20261102_' + Date.now();
  const cases = [
    { kind: 'valid_rollback', from: null, to: 'BORRADOR', reason: 'Prueba reversible de esquema', expected: null },
    { kind: 'sixth_state', from: 'BORRADOR', to: 'EXPIRADO', reason: 'Prueba negativa', expected: '23513' },
    { kind: 'null_from_noninitial', from: null, to: 'CONFIRMADO', reason: 'Prueba negativa', expected: '23513' },
    { kind: 'cancel_without_reason', from: 'BORRADOR', to: 'CANCELADO', reason: '', expected: '23513' },
    { kind: 'duplicate_key', from: null, to: 'BORRADOR', reason: 'Prueba de unicidad', expected: '23505' },
  ];
  try {
    const real = await observer.query('SELECT ID,ESTADO,IMPORTETOTAL FROM JAVIER.TEST_PEDIDOS_CAB WHERE ID=?', [106]);
    if (real.length !== 1) fail('REAL_REFERENCE_ORDER_NOT_FOUND');
    for (let i = 0; i < cases.length; i++) {
      const test = cases[i]; const key = sentinelPrefix + '_' + i;
      const probe = await odbc.connect(connectionString);
      let states = []; let seenInside = 0;
      const payload = JSON.stringify({ schemaProbe: true, realOrderReference: real[0] });
      const params = [106, test.from, test.to, '35', 'COMERCIAL', 'QA-schema-rollback', test.reason, key, payload, crypto.createHash('sha256').update(payload).digest('hex')];
      const sql = 'INSERT INTO JAVIER.TEST_PEDIDO_STATE_EVENTS (PEDIDO_ID,FROM_STATE,TO_STATE,ACTOR_ID,ACTOR_ROLE,DEVICE_ID,REASON,IDEMPOTENCY_KEY,PAYLOAD_JSON,PAYLOAD_HASH) VALUES (?,?,?,?,?,?,?,?,?,?)';
      try {
        await probe.beginTransaction();
        await probe.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
        try {
          await probe.query(sql, params);
          if (test.kind === 'duplicate_key') await probe.query(sql, params);
          seenInside = Number((await probe.query('SELECT COUNT(*) AS N FROM JAVIER.TEST_PEDIDO_STATE_EVENTS WHERE IDEMPOTENCY_KEY=?', [key]))[0].N);
        } catch (e) { states = (e.odbcErrors || []).map((x) => String(x.state)); }
        await probe.rollback();
      } finally { await probe.close(); }
      const remaining = Number((await observer.query('SELECT COUNT(*) AS N FROM JAVIER.TEST_PEDIDO_STATE_EVENTS WHERE IDEMPOTENCY_KEY=?', [key]))[0].N);
      const passed = remaining === 0 && (test.expected ? states.includes(test.expected) : states.length === 0 && seenInside === 1);
      console.log('STATE_SCHEMA_PROBE=' + JSON.stringify({ kind: test.kind, expectedState: test.expected, states, seenInside, rowsAfterRollback: remaining, passed }));
      if (!passed) fail('SCHEMA_CONSTRAINT_OR_ROLLBACK_PROBE_FAILED');
    }
  } finally { await observer.close(); }
  console.log('STATE_SCHEMA_COMPLETE=' + JSON.stringify({ verified: true, rollbackProbes: 5, productionWrites: 0, droppedObjects: 0, runnerStillBlocked: true }));
})().catch((e) => { console.error(JSON.stringify({ success: false, code: contract.safeErrorCode(e), odbc: (e.odbcErrors || []).map((x) => ({ state: x.state, code: x.code })) })); process.exitCode = 1; });
'@
$nodeSource = $nodeSource.Replace('MIGRATION_BASE64', $migration64).Replace('RUNNER_BASE64', $runner64).Replace('PROFILE_BASE64', $profile64)
$nodeSource | & 'C:\Program Files\Git\usr\bin\ssh.exe' -o BatchMode=yes -o ConnectTimeout=8 gmp@192.168.1.230 'cd /opt/gmp-api/backend && node -'
exit $LASTEXITCODE
