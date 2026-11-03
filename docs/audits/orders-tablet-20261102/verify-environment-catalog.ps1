[CmdletBinding()]
param([string]$ExpectedBundleSha256)

$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$sourcePaths = @(
    'config/app-profile.js'
    'config/load-env.js'
    'utils/db2-identifiers.js'
    'utils/db2-app-buffer-capability.js'
    'scripts/tools/verify-app-environment.js'
)
$bundle = [ordered]@{}
foreach ($sourcePath in $sourcePaths) {
    $sourceBytes = [IO.File]::ReadAllBytes((Join-Path $repository "backend/$sourcePath"))
    $bundle[$sourcePath] = [Convert]::ToBase64String($sourceBytes)
}
$bundleBytes = [Text.Encoding]::UTF8.GetBytes(($bundle | ConvertTo-Json -Compress))
$sha256 = [Security.Cryptography.SHA256]::Create()
try {
    $bundleHash = [BitConverter]::ToString($sha256.ComputeHash($bundleBytes)).Replace('-', '').ToLowerInvariant()
} finally {
    $sha256.Dispose()
}
if (!$ExpectedBundleSha256) {
    [ordered]@{ mode = 'dry-run'; bundleSha256 = $bundleHash; sourcePaths = $sourcePaths } | ConvertTo-Json -Compress
    exit 0
}
if ($ExpectedBundleSha256 -cne $bundleHash) { throw 'ENV_CATALOG_SOURCE_BUNDLE_MISMATCH' }

$taskSource = @'
'use strict';
const Module = require('module');
const path = require('path');
const crypto = require('crypto');
const bundleBytes = Buffer.from('__SOURCE_BUNDLE__', 'base64');
const bundle = JSON.parse(bundleBytes.toString('utf8'));
const compiled = new Map();
const builtin = new Set(['path', 'fs', 'cluster', 'dotenv']);
function load(name) {
  if (compiled.has(name)) return compiled.get(name).exports;
  if (!Object.hasOwn(bundle, name)) throw Object.assign(new Error('Unsealed module'), { code: 'UNSEALED_MODULE' });
  const filename = path.join(process.cwd(), name);
  const child = new Module(filename, module);
  child.filename = filename;
  child.require = (request) => {
    if (builtin.has(request)) return require(request);
    if (!request.startsWith('.')) throw Object.assign(new Error('Unsealed dependency'), { code: 'UNSEALED_DEPENDENCY' });
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), request));
    return load(target.endsWith('.js') ? target : target + '.js');
  };
  compiled.set(name, child);
  child._compile(Buffer.from(bundle[name], 'base64').toString('utf8'), filename);
  return child.exports;
}
const evidence = { readOnly: true, businessRowsRead: 0, mutations: 0, queries: 0, connections: 0, closed: 0,
  bundleSha256: crypto.createHash('sha256').update(bundleBytes).digest('hex'), profiles: [] };
const catalog = new Set(['SYSIBM.SYSDUMMY1', 'QSYS2.SYSTABLES', 'QSYS2.SYSCOLUMNS', 'QSYS2.SYSCST',
  'QSYS2.SYSKEYCST', 'QSYS2.SYSINDEXES', 'QSYS2.SYSKEYS', 'QSYS2.SYSCHKCST']);
async function connect() {
  const odbc = require('odbc');
  const connection = await odbc.connect({
    connectionString: `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;CCSID=1208;CMPTDM=1;`,
    connectionTimeout: 10,
    loginTimeout: 10,
  });
  evidence.connections++;
  return {
    async query(sql, parameters) {
      const refs = Array.from(sql.matchAll(/\b(?:FROM|JOIN)\s+([A-Z0-9_.]+)/gi), (entry) => entry[1].toUpperCase());
      if (!/^\s*SELECT\b/i.test(sql) || sql.includes(';') || refs.length === 0 || refs.some((ref) => !catalog.has(ref))) {
        throw Object.assign(new Error('Catalog SELECT required'), { code: 'CATALOG_SELECT_REQUIRED' });
      }
      evidence.queries++;
      return connection.query(sql, parameters, { timeout: 15 });
    },
    async close() {
      await connection.close();
      evidence.closed++;
    },
  };
}
(async () => {
  try {
    load('config/load-env.js').loadEnv(process.cwd());
    const { resolveAppProfile } = load('config/app-profile.js');
    const { verifyDatabaseReadOnly } = load('scripts/tools/verify-app-environment.js');
    for (const mode of ['test', 'demo', 'production']) {
      evidence.activeMode = mode;
      const { valid, publicProfile } = resolveAppProfile({ APP_ENV: mode });
      if (!valid) throw Object.assign(new Error('Profile invalid'), { code: 'PROFILE_INVALID' });
      const database = await verifyDatabaseReadOnly(publicProfile, { connect });
      evidence.profiles.push({ profile: publicProfile, database, cliExitCode: database.valid && database.selectOne ? 0 : 1 });
    }
    if (evidence.connections !== evidence.closed) throw Object.assign(new Error('Connection not closed'), { code: 'CONNECTION_NOT_CLOSED' });
    delete evidence.activeMode;
  } catch (error) {
    evidence.code = /^[A-Z][A-Z0-9_]{2,70}$/.test(error.code || '') ? error.code : 'ENV_CATALOG_VERIFY_FAILED';
    evidence.odbc = (error.odbcErrors || []).map((entry) => ({ code: Number(entry.code), state: /^[A-Z0-9]{5}$/.test(entry.state || '') ? entry.state : null }));
  }
  process.stdout.write(JSON.stringify(evidence, (_, value) => typeof value === 'bigint' ? value.toString() : value) + '\n');
  process.exitCode = evidence.code ? 1 : 0;
})();
'@
$taskSource = $taskSource.Replace('__SOURCE_BUNDLE__', [Convert]::ToBase64String($bundleBytes))
$taskSource | & 'C:\Program Files\Git\usr\bin\ssh.exe' -o BatchMode=yes -o ConnectTimeout=10 gmp@192.168.1.230 'cd /opt/gmp-api/backend && node -'
exit $LASTEXITCODE
