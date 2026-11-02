[CmdletBinding()]
param(
  [ValidateSet('DryRun','ReadOnly','Run')][string]$Mode = 'DryRun',
  [string]$ReviewedRuntimeSha256 = '',
  [string]$ReviewedWrapperSha256 = ''
)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$commit = 'f4b025a11335599bbb4dcd99d382f778bac6e2a0'
$paths = @(
  'src/modules/cobros/infrastructure/db2-cobros-repository.js',
  'src/modules/cobros/domain/cobros-repository.js',
  'src/modules/cobros/domain/commercial-payment-contract.js',
  'src/core/domain/repository.js',
  'utils/db2-identifiers.js','utils/db2-schemas.js','utils/common.js',
  'utils/comercial-erp-tables.js','utils/erp-document-label.js',
  'config/reparto-runtime.js','config/g4-dsedac-erp-mapping.js',
  'config/load-env.js','config/app-profile.js',
  'services/debt-view-contract.js','services/comercial-devoluciones-service.js',
  'services/dsedac-exports.service.js','adapters/pedidos-local-order-state-guard.js'
)
$sources = [ordered]@{}
foreach ($path in $paths) {
  $source = (& git -C $taskRoot show ($commit + ':backend/' + $path)) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw ('SEALED_SOURCE_UNAVAILABLE: ' + $path) }
  $sources[$path] = $source
}
$runtimePath = Join-Path $PSScriptRoot 'probe-finance-closed-code-runtime.js'
$runtime = Get-Content -LiteralPath $runtimePath -Raw
$runtimeHash = (Get-FileHash -LiteralPath $runtimePath -Algorithm SHA256).Hash
$wrapperHash = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash
if ($Mode -eq 'Run' -and ($ReviewedRuntimeSha256 -cne $runtimeHash -or $ReviewedWrapperSha256 -cne $wrapperHash)) { throw 'INDEPENDENT_REVIEW_OF_BOTH_SCRIPTS_REQUIRED' }
$hasher = [Security.Cryptography.SHA256]::Create()
try {
  [string[]]$keys = $sources.Keys
  [Array]::Sort($keys, [StringComparer]::Ordinal)
  $manifestLines = foreach ($key in $keys) {
    $sourceHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($sources[$key]))).Replace('-', '').ToLowerInvariant()
    $key + ':' + $sourceHash
  }
  $manifestHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($commit + "`n" + ($manifestLines -join "`n")))).Replace('-', '').ToLowerInvariant()
} finally { $hasher.Dispose() }
if ($Mode -eq 'DryRun') {
  [ordered]@{mode=$Mode;connected=$false;sourceCommit=$commit;sourceCount=$sources.Count;manifestSha256=$manifestHash;wrapperSha256=$wrapperHash;runtimeSha256=$runtimeHash;writeTargets=@('JAVIER.TEST_COBROS','JAVIER.TEST_LIQUIDACION_COMERCIAL');productionWrites=$false;email=$false;export=$false;automaticCleanup=$false;period='2026-11-03'} | ConvertTo-Json -Depth 5
  exit 0
}
$bundle = [ordered]@{commit=$commit;mode=$Mode;sources=$sources;manifestSha256=$manifestHash}
$bundle64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($bundle | ConvertTo-Json -Depth 5 -Compress)))
$runtime64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($runtime))
$job = "global.__FINANCE_PROBE_BUNDLE__=JSON.parse(Buffer.from('$bundle64','base64').toString('utf8'));`n" + "require('vm').runInThisContext(Buffer.from('$runtime64','base64').toString('utf8'),{filename:'finance-closed-code-runtime.js'});"
$job | & 'C:\Program Files\Git\usr\bin\ssh.exe' -o BatchMode=yes -o ConnectTimeout=10 gmp@192.168.1.230 'cd /opt/gmp-api/backend && node -'
exit $LASTEXITCODE
