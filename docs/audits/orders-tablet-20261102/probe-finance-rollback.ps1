[CmdletBinding()]
param([ValidateSet('DryRun','ReadOnly','Run')][string]$Mode = 'DryRun')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$commit = '4a099e89f29378a502598e4698e0c651cccd46d2'
$fingerprint = '8b29b38741087910608fdfc71f28527a9b240ab7fd7ef9fc0180143d03c73a69'
$paths = @(
  'src/modules/cobros/infrastructure/db2-cobros-repository.js',
  'src/modules/cobros/domain/cobros-repository.js',
  'src/modules/cobros/domain/commercial-payment-contract.js',
  'src/core/domain/repository.js','utils/db2-identifiers.js','utils/db2-schemas.js',
  'utils/common.js','utils/db2-app-buffer-capability.js','utils/comercial-erp-tables.js',
  'utils/erp-document-label.js','config/reparto-runtime.js','config/g4-dsedac-erp-mapping.js',
  'config/load-env.js','config/app-profile.js','services/debt-view-contract.js',
  'services/comercial-devoluciones-service.js','services/dsedac-exports.service.js',
  'adapters/pedidos-local-order-state-guard.js'
)
$sources = [ordered]@{}
foreach ($path in $paths) {
  $sources[$path] = (& git -C $root show ($commit + ':backend/' + $path)) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw ('SEALED_SOURCE_UNAVAILABLE: ' + $path) }
}
$runtimePath = Join-Path $PSScriptRoot 'probe-finance-rollback-runtime.js'
$runtime = Get-Content -LiteralPath $runtimePath -Raw
$runtimeHash = (Get-FileHash -LiteralPath $runtimePath -Algorithm SHA256).Hash.ToLowerInvariant()
$wrapperHash = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
$hasher = [Security.Cryptography.SHA256]::Create()
try {
  [string[]]$keys = $sources.Keys
  [Array]::Sort($keys, [StringComparer]::Ordinal)
  $lines = foreach ($key in $keys) {
    $hash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($sources[$key]))).Replace('-', '').ToLowerInvariant()
    $key + ':' + $hash
  }
  $manifest = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($commit + "`n" + ($lines -join "`n")))).Replace('-', '').ToLowerInvariant()
} finally { $hasher.Dispose() }
if ($Mode -eq 'DryRun') {
  [ordered]@{mode='DryRun';connected=$false;sourceCommit=$commit;sourceCount=$sources.Count;manifestSha256=$manifest;runtimeSha256=$runtimeHash;wrapperSha256=$wrapperHash;candidateFingerprint=$fingerprint;profile='demo/isolated_test';writeTargets=@('JAVIER.TEST_COBROS','JAVIER.TEST_LIQUIDACION_COMERCIAL');physicalCommitPath=$false;runEnabled=$false} | ConvertTo-Json -Depth 4
  exit 0
}
if ($Mode -eq 'Run') { throw 'RUN_ROLLBACK_UOW_NOT_REVIEWED' }
$bundle = [ordered]@{commit=$commit;mode=$Mode;sources=$sources;manifestSha256=$manifest;candidateFingerprint=$fingerprint}
$bundle64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($bundle | ConvertTo-Json -Depth 6 -Compress)))
$runtime64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($runtime))
$job = "global.__FINANCE_ROLLBACK_BUNDLE__=JSON.parse(Buffer.from('$bundle64','base64').toString('utf8'));`nrequire('vm').runInThisContext(Buffer.from('$runtime64','base64').toString('utf8'),{filename:'finance-rollback-runtime.js'});"
$job | & 'C:\Program Files\Git\usr\bin\ssh.exe' -o BatchMode=yes -o ConnectTimeout=10 gmp@192.168.1.230 'cd /opt/gmp-api/backend && timeout 100s node -'
exit $LASTEXITCODE
