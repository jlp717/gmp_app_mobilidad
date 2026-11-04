[CmdletBinding()]
param(
  [ValidateSet('DryRun','ReadOnly','Run')][string]$Mode = 'DryRun',
  [string]$ReviewedRuntimeSha256 = '',
  [string]$ReviewedWrapperSha256 = '',
  [string]$AuthorizationArtifact = ''
)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$commit = 'fa101be810db9427381f034b388f8bc66e8416c4'
$paths = @(
  'src/modules/cobros/infrastructure/db2-cobros-repository.js',
  'src/modules/cobros/domain/cobros-repository.js',
  'src/modules/cobros/domain/commercial-payment-contract.js',
  'src/core/domain/repository.js',
  'utils/db2-identifiers.js','utils/db2-schemas.js','utils/common.js','utils/db2-app-buffer-capability.js',
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
if ($Mode -eq 'Run') {
  if (-not $AuthorizationArtifact -or -not (Test-Path -LiteralPath $AuthorizationArtifact -PathType Leaf)) { throw 'RUN_REQUIRES_SEPARATE_AUTHORIZATION_ARTIFACT' }
  $authorization = Get-Content -LiteralPath $AuthorizationArtifact -Raw | ConvertFrom-Json
  if ($authorization.action -cne 'FINANCE_CLOSED_CODE_RUN' -or $authorization.sourceCommit -cne $commit -or $authorization.runtimeSha256 -cne $runtimeHash -or $authorization.wrapperSha256 -cne $wrapperHash -or -not $authorization.date -or -not $authorization.candidateIdentitySha256 -or $authorization.approved -ne $true) { throw 'AUTHORIZATION_ARTIFACT_DOES_NOT_MATCH_EXACT_REVIEWED_CODE' }
}
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
  [ordered]@{mode=$Mode;connected=$false;sourceCommit=$commit;sourceCount=$sources.Count;manifestSha256=$manifestHash;wrapperSha256=$wrapperHash;runtimeSha256=$runtimeHash;requiredProfile='demo';writeTargets=@('JAVIER.TEST_COBROS','JAVIER.TEST_LIQUIDACION_COMERCIAL');productionWrites=$false;email=$false;export=$false;automaticCleanup=$false;runRequiresSeparateAuthorizationArtifact=$true;period='server-current-date'} | ConvertTo-Json -Depth 5
  exit 0
}
$bundle = [ordered]@{commit=$commit;mode=$Mode;sources=$sources;manifestSha256=$manifestHash;authorization=if ($Mode -eq 'Run') { $authorization } else { $null }}
$bundle64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($bundle | ConvertTo-Json -Depth 5 -Compress)))
$runtime64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($runtime))
$job = "global.__FINANCE_PROBE_BUNDLE__=JSON.parse(Buffer.from('$bundle64','base64').toString('utf8'));`n" + "require('vm').runInThisContext(Buffer.from('$runtime64','base64').toString('utf8'),{filename:'finance-closed-code-runtime.js'});"
$job | & 'C:\Program Files\Git\usr\bin\ssh.exe' -o BatchMode=yes -o ConnectTimeout=10 gmp@192.168.1.230 'cd /opt/gmp-api/backend && node -'
exit $LASTEXITCODE
