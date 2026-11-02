[CmdletBinding()]
param([switch]$Run)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$reviewedCommit = '0e135d1e897d9a5d708d97bf758ad374f224005e'
$requiredSeedHash = 'e2e36216104a6aca873b78c308c4fdbdc2604d7cf637a1298d064f1549368332'
$requiredProfileHash = '3341baffc9aa208457c2241fb2fd80bd998591789cc62ebecb1b376e86d773af'
$seedPath = Join-Path $taskRoot 'backend\scripts\seed-precio-competitivo-test.js'
$profilePath = Join-Path $taskRoot 'backend\config\app-profile.js'
if ((Get-FileHash -LiteralPath $seedPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $requiredSeedHash) { throw 'Reviewed seed bytes changed; no connection opened.' }
if ((Get-FileHash -LiteralPath $profilePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $requiredProfileHash) { throw 'Reviewed profile bytes changed; no connection opened.' }
& git -C $taskRoot diff --quiet $reviewedCommit -- backend/scripts/seed-precio-competitivo-test.js backend/config/app-profile.js
if ($LASTEXITCODE -ne 0) { throw 'Reviewed files differ from the fixed source commit; no connection opened.' }
if (-not $Run) {
    [ordered]@{ mode = 'DRY_RUN'; connected = $false; sourceCommit = $reviewedCommit; sourceWorktreeSha256 = $requiredSeedHash; target = 'JAVIER.TEST_PRECIO_COMPETITIVO'; retainedSeedRows = 2; commitGuard = 'exact approved delta checked before physical commit' } | ConvertTo-Json
    exit 0
}
$seed64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($seedPath))
$profile64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($profilePath))
$job = @'
'use strict';
require('./config/load-env').loadEnv(process.cwd());
const odbc = require('odbc'), Module = require('module'), crypto = require('crypto');
const seedBytes = Buffer.from('SEED_SOURCE', 'base64'), profileBytes = Buffer.from('PROFILE_SOURCE', 'base64');
const expectedSeedHash = 'e2e36216104a6aca873b78c308c4fdbdc2604d7cf637a1298d064f1549368332';
const expectedProfileHash = '3341baffc9aa208457c2241fb2fd80bd998591789cc62ebecb1b376e86d773af';
const localCodes = new Set();
function fail(code) { localCodes.add(code); throw Object.assign(new Error(code), { code }); }
function hash(value) { return crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex'); }
function diagnostic(e) { return { code: localCodes.has(e.code) ? e.code : 'SEED_NATIVE_OR_MODULE_FAILED', odbc: (e.odbcErrors || []).map((x) => ({ state: /^[A-Z0-9]{5}$/.test(x.state) ? x.state : null, code: Number.isFinite(Number(x.code)) ? Number(x.code) : null })) }; }
function compile(filename, bytes) {
  const m = new Module(filename, module); m.filename = filename;
  m.require = () => fail('MODULE_DEPENDENCY_REJECTED');
  m._compile(bytes.toString('utf8'), filename); return m.exports;
}
if (hash(seedBytes) !== expectedSeedHash || hash(profileBytes) !== expectedProfileHash) fail('REVIEWED_SOURCE_HASH_CHANGED');
const profileModule = compile(process.cwd() + '/config/app-profile.reviewed.js', profileBytes);
const operation = profileModule.resolveAppProfile({ APP_ENV: 'test' });
if (!operation.valid) fail('TEST_PROFILE_INVALID');
Object.assign(process.env, operation.assignments, { APP_ENV: 'test' });
const profile = profileModule.applyAppProfile(process.env);
if (!profile.verified || profile.profile !== 'test' || profile.writeSchema !== 'JAVIER' || profile.tableSet !== 'isolated_test' || profile.productionWritesEnabled || profile.erpExportEnabled) fail('TEST_PROFILE_NOT_CONFIRMED');
const cs = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;CCSID=1208;`;
const expected = [
  ['3075','4300032160',1,49.572,24.71,'2026-09-28',null,'pedido-106'],
  ['3519','4300032160',1,27.54,24.69,'2026-09-28',null,'pedido-106'],
];
const evidence = { sourceCommit: '0e135d1e897d9a5d708d97bf758ad374f224005e', sourceWorktreeSha256: expectedSeedHash, sourceBytes: 'Windows worktree CRLF; normalized Git diff matches fixed commit', profile: profileModule.sanitizeAppProfile(profile), daemonChanged: false, retainedSeedRows: true, target: 'JAVIER.TEST_PRECIO_COMPETITIVO', commits: [], scope: 'two authorised real-sale rows only; unrelated rows represented by count/hash; no order/bag/payment writes' };
const trim = (v) => String(v ?? '').trim();
const date = (v) => v === null || v === undefined ? null : String(v).slice(0,10);
const rowValues = (r) => [trim(r.CODIGOARTICULO),trim(r.CODIGOCLIENTE),Number(r.CODIGOTARIFA),Number(r.PRECIO_COMPETITIVO),Number(r.MARGEN_PCT),date(r.VALIDO_DESDE),date(r.VALIDO_HASTA),trim(r.USUARIO)];
const isTarget = (r) => expected.some((x) => trim(r.CODIGOARTICULO) === x[0] && trim(r.CODIGOCLIENTE) === x[1] && date(r.VALIDO_DESDE) === x[5]);
const targetRows = (rows) => rows.filter(isTarget).sort((a,b) => trim(a.CODIGOARTICULO).localeCompare(trim(b.CODIGOARTICULO)));
const otherRows = (rows) => rows.filter((r) => !isTarget(r));
const businessRows = (rows) => rows.map(({ UPDATED_AT, ...row }) => row);
const tableSql = 'SELECT * FROM JAVIER.TEST_PRECIO_COMPETITIVO ORDER BY ID';
const dbNow = async (c) => trim((await c.query('SELECT CURRENT_TIMESTAMP AS DB_NOW FROM SYSIBM.SYSDUMMY1'))[0].DB_NOW);
function assertDelta(before, after, start, end) {
  const targets = targetRows(after), prior = targetRows(before);
  if (targets.length !== 2 || targets.some((r,i) => JSON.stringify(rowValues(r)) !== JSON.stringify(expected[i]))) fail('TARGET_VALUES_NOT_REAL_SOURCE_EQUIVALENT');
  if (hash(otherRows(before)) !== hash(otherRows(after)) || after.length !== before.length + 2 - prior.length) fail('UNAUTHORISED_ROW_DELTA');
  for (const r of targets) {
    const previous = prior.find((x) => Number(x.ID) === Number(r.ID));
    if (previous && trim(previous.CREATED_AT) !== trim(r.CREATED_AT)) fail('IMMUTABLE_CREATED_AT_CHANGED');
    if (!previous && before.some((x) => Number(x.ID) === Number(r.ID))) fail('TARGET_ID_REUSED');
    if ((!previous && !(trim(r.CREATED_AT) >= start && trim(r.CREATED_AT) <= end)) || !(trim(r.UPDATED_AT) >= start && trim(r.UPDATED_AT) <= end)) fail('UNEXPECTED_SEED_TIMESTAMP');
  }
}
(async () => {
  const observer = await odbc.connect(cs);
  let seed;
  try {
    const cols = await observer.query('SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', ['JAVIER','TEST_PRECIO_COMPETITIVO']);
    const required = ['ID','CODIGOARTICULO','CODIGOCLIENTE','CODIGOTARIFA','PRECIO_COMPETITIVO','MARGEN_PCT','VALIDO_DESDE','VALIDO_HASTA','USUARIO','CREATED_AT','UPDATED_AT'];
    if (cols.length !== required.length || required.some((x) => !cols.some((c) => trim(c.COLUMN_NAME) === x))) fail('TARGET_SCHEMA_CHANGED');
    const physical = await observer.query('SELECT SYSTEM_TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', ['JAVIER','TEST_PRECIO_COMPETITIVO']);
    if (physical.length !== 1) fail('TARGET_TABLE_NOT_UNIQUE');
    evidence.journal = await observer.query("SELECT JOURNALED,JOURNAL_LIBRARY,JOURNAL_NAME,JOURNAL_IMAGES FROM TABLE(QSYS2.OBJECT_STATISTICS('JAVIER','*FILE')) X WHERE OBJNAME=?", [trim(physical[0].SYSTEM_TABLE_NAME)]);
    if (evidence.journal.length !== 1 || trim(evidence.journal[0].JOURNALED) !== 'YES' || trim(evidence.journal[0].JOURNAL_LIBRARY) !== 'JAVIER' || trim(evidence.journal[0].JOURNAL_NAME) !== 'QSQJRN' || trim(evidence.journal[0].JOURNAL_IMAGES) !== '*BOTH') fail('TARGET_JOURNAL_NOT_CONFIRMED');
    const before = await observer.query(tableSql);
    if (before.length !== 0) fail('REVIEWED_EMPTY_TARGET_CHANGED');
    evidence.before = { count: before.length, rows: [], unrelatedRowsHash: hash(otherRows(before)) };
    // Compile only after fresh catalog/journal preflight. Both modules are exact sealed sources.
    seed = compile(process.cwd() + '/scripts/seed-precio-competitivo-test.reviewed.js', seedBytes);
    if (typeof seed.seedPrecioCompetitivo !== 'function' || !/^LOCK TABLE JAVIER\.TEST_PRECIO_COMPETITIVO IN EXCLUSIVE MODE$/.test(seed.SEED_LOCK_SQL) || !/^MERGE INTO JAVIER\.TEST_PRECIO_COMPETITIVO T/.test(seed.UPSERT_SQL) || /\b(DROP|ALTER|CREATE|DELETE|DSEDAC|DSED)\b/.test(seed.UPSERT_SQL)) fail('SEALED_MODULE_CONTRACT_CHANGED');
    const reference = await observer.query(seed.SOURCE_ORDER_SQL, [106,'3519','3075']);
    const canonical = seed.canonicalSeedRows(reference).sort((a,b) => a[0].localeCompare(b[0]));
    if (JSON.stringify(canonical) !== JSON.stringify(expected)) fail('REAL_REFERENCE_CHANGED');
    evidence.reference = canonical;
    async function seedOnce(label) {
      const c = await odbc.connect(cs); let active = false, locked = false, baseline, started;
      const capability = {
        beginTransaction: async () => { if (active) fail('NESTED_TRANSACTION_REJECTED'); await c.beginTransaction(); active = true; started = await dbNow(c); },
        query: async (sql, params) => {
          if (!active) fail('QUERY_OUTSIDE_TRANSACTION');
          if (sql === 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED') return c.query(sql);
          if (sql === seed.SEED_LOCK_SQL) { const r = await c.query(sql); locked = true; baseline = await c.query(tableSql); return r; }
          if (!locked) fail('QUERY_BEFORE_LOCK_REJECTED');
          if (sql === seed.SOURCE_ORDER_SQL && JSON.stringify(params) === JSON.stringify([106,'3519','3075'])) return c.query(sql, params);
          if (sql === seed.UPSERT_SQL && expected.some((x) => JSON.stringify(x) === JSON.stringify(params))) return c.query(sql, params);
          fail('UNREVIEWED_SQL_OR_PARAMETERS');
        },
        commit: async () => {
          if (!active || !locked) fail('COMMIT_WITHOUT_LOCK_REJECTED');
          const after = await c.query(tableSql), ended = await dbNow(c);
          assertDelta(baseline, after, started, ended);
          await c.commit(); active = false;
          evidence.commits.push({ label, deltaVerifiedBeforeCommit: true, targetIds: targetRows(after).map((r) => r.ID), beforeCount: baseline.length, afterCount: after.length });
        },
        rollback: async () => { try { if (active) await c.rollback(); } finally { active = false; } },
      };
      try {
        const result = await seed.seedPrecioCompetitivo(Object.freeze(capability), process.env);
        if (result !== 2 || active) fail('SEED_RESULT_NOT_CONFIRMED');
      } finally { try { if (active) await c.rollback(); } finally { await c.close(); } }
    }
    await seedOnce('initial');
    const first = await observer.query(tableSql); evidence.afterFirst = targetRows(first);
    await seedOnce('replay');
    const second = await observer.query(tableSql);
    evidence.serialIdempotencyPassed = hash(businessRows(first)) === hash(businessRows(second));
    if (!evidence.serialIdempotencyPassed) fail('SERIAL_REPLAY_DRIFT');
    await Promise.all([seedOnce('workerA'),seedOnce('workerB')]);
    const final = await observer.query(tableSql); evidence.afterConcurrent = targetRows(final);
    evidence.concurrentIdempotencyPassed = hash(businessRows(second)) === hash(businessRows(final));
    evidence.unrelatedRowsUnchanged = hash(otherRows(before)) === hash(otherRows(final));
    if (!evidence.concurrentIdempotencyPassed || !evidence.unrelatedRowsUnchanged) fail('CONCURRENT_REPLAY_DRIFT');
    evidence.after = { count: final.length, targetCount: targetRows(final).length, unrelatedRowsHash: hash(otherRows(final)) };
    evidence.passed = true;
  } catch (e) {
    evidence.passed = false; evidence.error = diagnostic(e); process.exitCode = 1;
    const after = await observer.query(tableSql).catch(() => null);
    evidence.afterFailure = after ? { count: after.length, authorisedRows: targetRows(after), unrelatedRowsHash: hash(otherRows(after)) } : null;
  } finally {
    console.log('COMPETITIVE_SEED_PROBE=' + JSON.stringify(evidence)); await observer.close();
  }
})().catch((e) => { console.error(JSON.stringify({ success: false, error: diagnostic(e) })); process.exitCode = 1; });
'@
$job = $job.Replace('SEED_SOURCE', $seed64).Replace('PROFILE_SOURCE', $profile64)
$job | & 'C:\Program Files\Git\usr\bin\ssh.exe' -o BatchMode=yes -o ConnectTimeout=8 gmp@192.168.1.230 'cd /opt/gmp-api/backend && node -'
exit $LASTEXITCODE
