[CmdletBinding()]
param([switch]$Run,[switch]$SelfTest)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$sourceCommit = (& git -C $taskRoot rev-parse 562eb49).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Reviewed source unavailable.' }
$bundler = @'
import sys,subprocess,pathlib,posixpath,re,json
root,commit=sys.argv[1:]
def git(*args):
 p=subprocess.run(['git','-C',root,*args],capture_output=True)
 if p.returncode:raise RuntimeError('FIXED_SOURCE_UNAVAILABLE')
 return p.stdout.decode('utf-8')
tree=set(git('ls-tree','-r','--name-only',commit,'--','backend').splitlines())
stubs={'config/db.js','middleware/logger.js','services/redis-cache.js','services/query-optimizer.js'}
files={};external=set();pending=['services/pedidos/index.js','services/bolsa-comercial.service.js','config/app-profile.js']
def resolve(name):
 for x in [name,name+'.js',name+'.json',name+'/index.js']:
  if 'backend/'+x in tree:return x
 raise RuntimeError('LOCAL_DEPENDENCY_UNRESOLVED:'+name)
while pending:
 name=resolve(pending.pop())
 if name in files or name in stubs:continue
 if name.startswith('../') or re.search(r'(^|/)(?:\.env[^/]*|tokens[^/]*\.json|CREDENCIALES\.md)$',name,re.I):raise RuntimeError('SENSITIVE_DEPENDENCY_REJECTED')
 source=git('show',commit+':backend/'+name);files[name]=source
 if name.endswith('.json'):continue
 for req in re.findall(r"require\(\s*['\"]([^'\"]+)['\"]\s*\)",source):
  if req.startswith('.'):
   dep=posixpath.normpath(posixpath.join(posixpath.dirname(name),req))
   if dep.startswith('../'):raise RuntimeError('DEPENDENCY_OUTSIDE_BACKEND')
   pending.append(dep)
  else:external.add(req)
print(json.dumps({'files':files,'externals':sorted(external),'stubs':sorted(stubs)},ensure_ascii=True))
'@
$bundleJson = $bundler | python - $taskRoot $sourceCommit
if ($LASTEXITCODE -ne 0) { throw 'Closed dependency bundle failed before connection.' }
$bundleObject = $bundleJson | ConvertFrom-Json
$runtimePath = Join-Path $PSScriptRoot 'probe-order-lifecycle-runtime.js'
$runtimeHash = (Get-FileHash -LiteralPath $runtimePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($Run -and $SelfTest) { throw 'Choose Run or SelfTest.' }
if (-not $Run -and -not $SelfTest) {
    [ordered]@{ mode='DRY_RUN'; connected=$false; sourceCommit=$sourceCommit; sourceFiles=@($bundleObject.files.PSObject.Properties).Count; externalPackages=$bundleObject.externals; runtimeSha256=$runtimeHash; target='JAVIER.TEST_*'; fixtures='two real-price orders retained CANCELADO and explicitly recorded canonical monthly bag initialization if missing'; ddl=$false; productionWrites=$false } | ConvertTo-Json -Depth 5
    exit 0
}
$bundle64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($bundleJson))
$job = [IO.File]::ReadAllText($runtimePath)
$job = $job.Replace('SOURCE_BUNDLE',$bundle64).Replace('SOURCE_COMMIT',$sourceCommit).Replace('RUNTIME_SHA256',$runtimeHash)
if ($SelfTest) {
    $env:ORDERS_LIFECYCLE_SELFTEST='1'
    Push-Location (Join-Path $taskRoot 'backend')
    try { $job | node - } finally { Pop-Location; Remove-Item Env:ORDERS_LIFECYCLE_SELFTEST }
    exit $LASTEXITCODE
}
$job | & 'C:\Program Files\Git\usr\bin\ssh.exe' -o BatchMode=yes -o ConnectTimeout=8 gmp@192.168.1.230 'cd /opt/gmp-api/backend && node -'
exit $LASTEXITCODE
