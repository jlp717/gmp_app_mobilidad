[CmdletBinding()]
param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$profilePath = Join-Path $taskRoot 'backend\config\app-profile.js'
$requiredProfileHash = '3341baffc9aa208457c2241fb2fd80bd998591789cc62ebecb1b376e86d773af'
if ((Get-FileHash -LiteralPath $profilePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $requiredProfileHash) { throw 'Reviewed profile resolver changed; no connection opened.' }
if (-not $Apply) {
    [ordered]@{ mode = 'DRY_RUN'; connected = $false; index = 'JAVIER.UX_TEST_COBROS_TOKEN'; target = 'JAVIER.TEST_COBROS'; operation = 'CREATE UNIQUE WHERE NOT NULL INDEX'; rowMutation = 'rollback-only constraint probes'; productionWrites = $false } | ConvertTo-Json
    exit 0
}
$profile64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($profilePath))
$job = @'
'use strict';
require('./config/load-env').loadEnv(process.cwd());
const odbc = require('odbc'), crypto = require('crypto'), Module = require('module');
const profileSource = Buffer.from('PROFILE_SOURCE', 'base64');
const expectedProfileHash = '3341baffc9aa208457c2241fb2fd80bd998591789cc62ebecb1b376e86d773af';
const safeCodes = new Set();
function fail(code) { safeCodes.add(code); throw Object.assign(new Error(code), { code }); }
function diagnostic(e) { return { code: safeCodes.has(e.code) ? e.code : 'NATIVE_OPERATION_FAILED', odbc: (e.odbcErrors || []).map((x) => ({ state: /^[A-Z0-9]{5}$/.test(x.state) ? x.state : null, code: Number.isFinite(Number(x.code)) ? Number(x.code) : null })) }; }
if (crypto.createHash('sha256').update(profileSource).digest('hex') !== expectedProfileHash) fail('PROFILE_HASH_CHANGED');
const profileModule = new Module(process.cwd() + '/config/app-profile.reviewed.js', module);
profileModule.filename = process.cwd() + '/config/app-profile.reviewed.js'; profileModule._compile(profileSource.toString('utf8'), profileModule.filename);
const operation = profileModule.exports.resolveAppProfile({ APP_ENV: 'test' });
if (!operation.valid) fail('TEST_PROFILE_INVALID');
Object.assign(process.env, operation.assignments, { APP_ENV: 'test', ALLOW_DB2_DDL: 'true' });
const profile = profileModule.exports.applyAppProfile(process.env);
if (!profile.verified || profile.profile !== 'test' || profile.writeSchema !== 'JAVIER' || profile.tableSet !== 'isolated_test' || profile.productionWritesEnabled || profile.erpExportEnabled) fail('TEST_PROFILE_NOT_CONFIRMED');
const sql = 'CREATE UNIQUE WHERE NOT NULL INDEX JAVIER.UX_TEST_COBROS_TOKEN ON JAVIER.TEST_COBROS (IDEMPOTENCY_TOKEN)';
const cs = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;CCSID=1208;`;
const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
const token = 'QAindex20261102-' + crypto.randomUUID();
const evidence = { index: 'JAVIER.UX_TEST_COBROS_TOKEN', target: 'JAVIER.TEST_COBROS', profile: profileModule.exports.sanitizeAppProfile(profile), daemonChanged: false, sql, profileHash: expectedProfileHash, probes: [], created: false, rowsCommitted: false };
const hash = (rows) => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
(async () => {
  const c = await odbc.connect(cs);
  let columnNames, sourceId, before;
  try {
    await c.query('SET CURRENT SCHEMA = JAVIER');
    const schema = await c.query('SELECT CURRENT SCHEMA AS SCHEMA_NAME FROM SYSIBM.SYSDUMMY1');
    if (schema.length !== 1 || String(schema[0].SCHEMA_NAME).trim() !== 'JAVIER') fail('SESSION_SCHEMA_NOT_CONFIRMED');
    const columns = await c.query('SELECT COLUMN_NAME,DATA_TYPE,LENGTH,IS_NULLABLE FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', ['JAVIER','TEST_COBROS']);
    columnNames = columns.map((x) => String(x.COLUMN_NAME).trim());
    if (columnNames.some((x) => !/^[A-Z][A-Z0-9_]*$/.test(x)) || !columnNames.includes('ID') || !columnNames.includes('IDEMPOTENCY_TOKEN')) fail('TABLE_COLUMNS_NOT_VERIFIED');
    const tokenColumn = columns.find((x) => String(x.COLUMN_NAME).trim() === 'IDEMPOTENCY_TOKEN');
    if (String(tokenColumn.DATA_TYPE).trim() !== 'VARCHAR' || Number(tokenColumn.LENGTH) !== 128 || !['Y','YES'].includes(String(tokenColumn.IS_NULLABLE).trim())) fail('TOKEN_COLUMN_CONTRACT_CHANGED');
    const exists = await c.query('SELECT INDEX_NAME FROM QSYS2.SYSINDEXES WHERE INDEX_SCHEMA=? AND INDEX_NAME=?', ['JAVIER','UX_TEST_COBROS_TOKEN']);
    if (exists.length) fail('INDEX_ALREADY_EXISTS_STOP_NO_DDL');
    const duplicates = await c.query('SELECT IDEMPOTENCY_TOKEN,COUNT(*) AS N FROM JAVIER.TEST_COBROS WHERE IDEMPOTENCY_TOKEN IS NOT NULL GROUP BY IDEMPOTENCY_TOKEN HAVING COUNT(*)>1');
    if (duplicates.length) fail('EXISTING_DUPLICATE_TOKENS');
    evidence.tokenCoverage = await c.query('SELECT COUNT(*) AS N,COUNT(IDEMPOTENCY_TOKEN) AS WITH_TOKEN,COUNT(DISTINCT IDEMPOTENCY_TOKEN) AS DISTINCT_TOKENS FROM JAVIER.TEST_COBROS');
    if (evidence.tokenCoverage.length !== 1 || ['N','WITH_TOKEN','DISTINCT_TOKENS'].some((k) => Number(evidence.tokenCoverage[0][k]) !== 16)) fail('REVIEWED_TOKEN_COVERAGE_CHANGED');
    evidence.primaryKey = await c.query("SELECT C.CONSTRAINT_NAME,K.COLUMN_NAME,K.ORDINAL_POSITION FROM QSYS2.SYSCST C JOIN QSYS2.SYSKEYCST K ON K.CONSTRAINT_SCHEMA=C.CONSTRAINT_SCHEMA AND K.CONSTRAINT_NAME=C.CONSTRAINT_NAME AND K.TABLE_SCHEMA=C.TABLE_SCHEMA AND K.TABLE_NAME=C.TABLE_NAME WHERE C.TABLE_SCHEMA=? AND C.TABLE_NAME=? AND C.CONSTRAINT_TYPE='PRIMARY KEY' ORDER BY K.ORDINAL_POSITION", ['JAVIER','TEST_COBROS']);
    if (evidence.primaryKey.length !== 1 || String(evidence.primaryKey[0].CONSTRAINT_NAME).trim() !== 'PKT_TEST_COBROS_E14EFC7086' || String(evidence.primaryKey[0].COLUMN_NAME).trim() !== 'ID' || Number(evidence.primaryKey[0].ORDINAL_POSITION) !== 1) fail('REVIEWED_PRIMARY_KEY_CHANGED');
    const oldIndexes = await c.query('SELECT I.INDEX_NAME,I.IS_UNIQUE,K.COLUMN_NAME,K.ORDINAL_POSITION FROM QSYS2.SYSINDEXES I JOIN QSYS2.SYSKEYS K ON K.INDEX_SCHEMA=I.INDEX_SCHEMA AND K.INDEX_NAME=I.INDEX_NAME WHERE I.INDEX_SCHEMA=? AND I.TABLE_SCHEMA=? AND I.TABLE_NAME=? ORDER BY I.INDEX_NAME,K.ORDINAL_POSITION', ['JAVIER','JAVIER','TEST_COBROS']);
    const tokenIndexNames = [...new Set(oldIndexes.filter((x) => String(x.COLUMN_NAME).trim() === 'IDEMPOTENCY_TOKEN').map((x) => String(x.INDEX_NAME).trim()))];
    evidence.previousTokenIndex = oldIndexes.filter((x) => tokenIndexNames.includes(String(x.INDEX_NAME).trim()));
    if (evidence.previousTokenIndex.length !== 1 || String(evidence.previousTokenIndex[0].INDEX_NAME).trim() !== 'IXT_TEST_COBROS_BF49807A68' || String(evidence.previousTokenIndex[0].IS_UNIQUE).trim() !== 'D' || Number(evidence.previousTokenIndex[0].ORDINAL_POSITION) !== 1) fail('REVIEWED_TOKEN_INDEX_CHANGED');
    const physical = await c.query('SELECT SYSTEM_TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', ['JAVIER','TEST_COBROS']);
    if (physical.length !== 1 || String(physical[0].SYSTEM_TABLE_NAME).trim() !== 'TEST_00019') fail('REVIEWED_PHYSICAL_TABLE_CHANGED');
    evidence.journal = await c.query("SELECT JOURNALED,JOURNAL_LIBRARY,JOURNAL_NAME,JOURNAL_IMAGES FROM TABLE(QSYS2.OBJECT_STATISTICS('JAVIER','*FILE')) X WHERE OBJNAME=?", ['TEST_00019']);
    if (evidence.journal.length !== 1 || String(evidence.journal[0].JOURNALED).trim() !== 'YES' || String(evidence.journal[0].JOURNAL_LIBRARY).trim() !== 'JAVIER' || String(evidence.journal[0].JOURNAL_NAME).trim() !== 'QSQJRN' || String(evidence.journal[0].JOURNAL_IMAGES).trim() !== '*BOTH') fail('REVIEWED_JOURNAL_NOT_CONFIRMED');
    before = await c.query('SELECT * FROM JAVIER.TEST_COBROS ORDER BY ID');
    if (before.length !== 16 || before[0].ID === null || !String(before[0].ID).trim() || before.some((r) => ids.includes(String(r.ID)))) fail('SOURCE_ROW_OR_FIXTURE_PREFLIGHT_FAILED');
    sourceId = String(before[0].ID); evidence.before = { count: before.length, rowsHash: hash(before), duplicates: duplicates.length };
    await c.query(sql); evidence.created = true;
    evidence.indexCatalog = await c.query('SELECT I.INDEX_SCHEMA,I.INDEX_NAME,I.TABLE_SCHEMA,I.TABLE_NAME,I.IS_UNIQUE,K.COLUMN_NAME,K.ORDINAL_POSITION FROM QSYS2.SYSINDEXES I JOIN QSYS2.SYSKEYS K ON K.INDEX_SCHEMA=I.INDEX_SCHEMA AND K.INDEX_NAME=I.INDEX_NAME WHERE I.INDEX_SCHEMA=? AND I.INDEX_NAME=? AND I.TABLE_SCHEMA=? AND I.TABLE_NAME=? ORDER BY K.ORDINAL_POSITION', ['JAVIER','UX_TEST_COBROS_TOKEN','JAVIER','TEST_COBROS']);
    const index = evidence.indexCatalog[0];
    // IBM i SYSINDEXES: V is UNIQUE WHERE NOT NULL; U would reject repeated NULLs.
    if (evidence.indexCatalog.length !== 1 || String(index.INDEX_SCHEMA).trim() !== 'JAVIER' || String(index.INDEX_NAME).trim() !== 'UX_TEST_COBROS_TOKEN' || String(index.TABLE_SCHEMA).trim() !== 'JAVIER' || String(index.TABLE_NAME).trim() !== 'TEST_COBROS' || String(index.IS_UNIQUE).trim() !== 'V' || String(index.COLUMN_NAME).trim() !== 'IDEMPOTENCY_TOKEN' || Number(index.ORDINAL_POSITION) !== 1) fail('INDEX_KEY_NOT_CONFIRMED');
  } finally { await c.close(); }
  const observer = await odbc.connect(cs);
  try {
    const ownRows = () => observer.query('SELECT ID,IDEMPOTENCY_TOKEN FROM JAVIER.TEST_COBROS WHERE ID IN (?,?,?,?) ORDER BY ID', ids);
    if ((await ownRows()).length) fail('PROBE_IDS_NOT_FREE');
    const names = columnNames.map((x) => '"' + x + '"').join(',');
    const select = columnNames.map((x) => x === 'ID' ? 'CAST(? AS VARCHAR(36))' : x === 'IDEMPOTENCY_TOKEN' ? 'CAST(? AS VARCHAR(128))' : 'C."' + x + '"').join(',');
    const cloneSql = `INSERT INTO JAVIER.TEST_COBROS (${names}) SELECT ${select} FROM JAVIER.TEST_COBROS C WHERE C.ID=?`;
    const cloneParams = (id, replayToken) => columnNames.flatMap((x) => x === 'ID' ? [id] : x === 'IDEMPOTENCY_TOKEN' ? [replayToken] : []).concat(sourceId);
    for (const kind of ['duplicate_token','multiple_null_tokens']) {
      const tx = await odbc.connect(cs); let error = null, inside = [];
      try {
        await tx.beginTransaction();
        const pair = kind === 'duplicate_token' ? ids.slice(0,2) : ids.slice(2);
        await tx.query(cloneSql, cloneParams(pair[0], kind === 'duplicate_token' ? token : null));
        await tx.query(cloneSql, cloneParams(pair[1], kind === 'duplicate_token' ? token : null));
        inside = await tx.query('SELECT ID,IDEMPOTENCY_TOKEN FROM JAVIER.TEST_COBROS WHERE ID IN (?,?) ORDER BY ID', pair);
      } catch (e) { error = diagnostic(e); }
      finally { try { await tx.rollback(); } finally { await tx.close(); } }
      const after = await ownRows();
      const passed = !after.length && (kind === 'duplicate_token' ? error?.odbc.some((x) => x.code === -803) : !error && inside.length === 2 && inside.every((r) => r.IDEMPOTENCY_TOKEN === null));
      evidence.probes.push({ kind, insideCount: inside.length, diagnostics: error, afterRollbackRows: after, passed });
      if (!passed) fail('UNIQUE_NULLABLE_PROBE_FAILED');
    }
    const after = await observer.query('SELECT * FROM JAVIER.TEST_COBROS ORDER BY ID');
    evidence.after = { count: after.length, rowsHash: hash(after) };
    evidence.existingRowsUnchanged = hash(before) === hash(after);
    if (!evidence.existingRowsUnchanged) fail('EXISTING_COLLECTION_ROWS_CHANGED');
    evidence.passed = true;
  } finally { await observer.close(); }
  console.log('COLLECTION_TOKEN_INDEX=' + JSON.stringify(evidence));
})().catch((e) => { evidence.passed = false; evidence.error = diagnostic(e); console.error('COLLECTION_TOKEN_INDEX=' + JSON.stringify(evidence)); process.exitCode = 1; });
'@
$job = $job.Replace('PROFILE_SOURCE', $profile64)
$job | & 'C:\Program Files\Git\usr\bin\ssh.exe' -o BatchMode=yes -o ConnectTimeout=8 gmp@192.168.1.230 'cd /opt/gmp-api/backend && node -'
exit $LASTEXITCODE
