[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$SourceCommit,
    [ValidateSet('DryRun', 'ReadOnly', 'Run')][string]$Mode = 'DryRun',
    [string]$RunAuthorizationArtifact
)

$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$sourceCommit = $SourceCommit.ToLowerInvariant()

& git -C $taskRoot cat-file -e "$sourceCommit^{commit}"
if ($LASTEXITCODE -ne 0) { throw 'SOURCE_COMMIT_UNAVAILABLE' }

# A closed source bundle keeps the exercised service exactly at the reviewed
# commit.  It purposely excludes config/db and operational stubs: the runtime
# supplies read-only DB access plus a guarded dedicated transaction connector.
$bundler = @'
import sys, subprocess, posixpath, re, json
root, commit = sys.argv[1:]
def git(*args):
    p = subprocess.run(['git','-C',root,*args], capture_output=True)
    if p.returncode: raise RuntimeError('SOURCE_BUNDLE_UNAVAILABLE')
    return p.stdout.decode('utf-8')
tree = set(git('ls-tree','-r','--name-only',commit,'--','backend').splitlines())
stubs = {'config/db.js','middleware/logger.js','services/redis-cache.js','services/query-optimizer.js'}
files, externals = {}, set()
pending = ['services/pedidos/index.js','services/bolsa-comercial.service.js','config/app-profile.js','config/load-env.js']
def resolve(name):
    for candidate in (name, name+'.js', name+'.json', name+'/index.js'):
        if 'backend/'+candidate in tree: return candidate
    raise RuntimeError('LOCAL_DEPENDENCY_UNRESOLVED:'+name)
while pending:
    name = resolve(pending.pop())
    if name in files or name in stubs: continue
    if name.startswith('../') or re.search(r'(^|/)(?:\.env[^/]*|tokens[^/]*\.json|CREDENCIALES\.md)$', name, re.I):
        raise RuntimeError('SENSITIVE_DEPENDENCY_REJECTED')
    source = git('show',commit+':backend/'+name)
    files[name] = source
    if name.endswith('.json'): continue
    for request in re.findall(r"require\(\s*['\"]([^'\"]+)['\"]\s*\)", source):
        if request.startswith('.'):
            dependency = posixpath.normpath(posixpath.join(posixpath.dirname(name), request))
            if dependency.startswith('../'): raise RuntimeError('DEPENDENCY_OUTSIDE_BACKEND')
            pending.append(dependency)
        else:
            externals.add(request)
print(json.dumps({'files':files,'externals':sorted(externals)}, ensure_ascii=True, separators=(',',':')))
'@

$bundleJson = $bundler | python - $taskRoot $sourceCommit
if ($LASTEXITCODE -ne 0) { throw 'SOURCE_BUNDLE_FAILED' }
$bundle = $bundleJson | ConvertFrom-Json
$runtimePath = Join-Path $PSScriptRoot 'probe-order-bolsa-demo-runtime.js'
if (-not (Test-Path -LiteralPath $runtimePath)) { throw 'RUNTIME_MISSING' }
$runtimeHash = (Get-FileHash -LiteralPath $runtimePath -Algorithm SHA256).Hash.ToLowerInvariant()
$wrapperHash = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
$sourceManifestHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($bundleJson))).ToLowerInvariant()
$candidateFingerprint = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes('1009|35|4300032160|4.6480|4.1240|14'))).ToLowerInvariant()

if ($Mode -eq 'DryRun') {
    [ordered]@{
        mode = 'DRY_RUN'
        connected = $false
        sourceCommit = $sourceCommit
        sourceFiles = @($bundle.files.PSObject.Properties).Count
        runtimeSha256 = $runtimeHash
        wrapperSha256 = $wrapperHash
        sourceManifestSha256 = $sourceManifestHash
        candidateFingerprint = $candidateFingerprint
        candidate = @{ article = '1009'; tariff1 = 4.648; tariff2 = 4.124; expectedBolsaId = 14 }
        lifecycle = 'create,replay,local-confirm,replay,cancel,replay'
        fixture = 'one owned order, physical rollback at end, no persistent fixture'
        writeSchemas = @('JAVIER.TEST_* only')
        ddl = $false
        exports = $false
        notifications = $false
    } | ConvertTo-Json -Depth 5
    exit 0
}

$authorizationJson = '{}'
if ($Mode -eq 'Run') {
    if (-not $RunAuthorizationArtifact -or -not (Test-Path -LiteralPath $RunAuthorizationArtifact -PathType Leaf)) { throw 'RUN_AUTHORIZATION_ARTIFACT_REQUIRED' }
    try { $authorization = Get-Content -LiteralPath $RunAuthorizationArtifact -Raw | ConvertFrom-Json -ErrorAction Stop } catch { throw 'RUN_AUTHORIZATION_ARTIFACT_INVALID' }
    $required = [ordered]@{ mode = 'Run'; approvedDate = (Get-Date).ToString('yyyy-MM-dd'); sourceCommit = $sourceCommit; wrapperSha256 = $wrapperHash; runtimeSha256 = $runtimeHash; sourceManifestSha256 = $sourceManifestHash; candidateFingerprint = $candidateFingerprint }
    foreach ($item in $required.GetEnumerator()) { if ([string]$authorization.($item.Key) -cne [string]$item.Value) { throw "RUN_AUTHORIZATION_MISMATCH_$($item.Key.ToUpperInvariant())" } }
    $authorizationJson = $authorization | ConvertTo-Json -Compress -Depth 5
}

$bundle64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($bundleJson))
$authorization64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($authorizationJson))
$runtime = [IO.File]::ReadAllText($runtimePath)
$runtime = $runtime.Replace('SOURCE_BUNDLE', $bundle64).Replace('SOURCE_COMMIT', $sourceCommit).Replace('RUNTIME_SHA256', $runtimeHash).Replace('SOURCE_MANIFEST_SHA256', $sourceManifestHash).Replace('RUN_MODE', $Mode).Replace('RUN_AUTHORIZATION', $authorization64)

# Running is a separately authorized action. The remote receives only the
# reviewed bundle and this guarded harness; credentials remain environment-held.
$runtime | & 'C:\Program Files\Git\usr\bin\ssh.exe' -o BatchMode=yes -o ConnectTimeout=8 gmp@192.168.1.230 'cd /opt/gmp-api/backend && node -'
exit $LASTEXITCODE
