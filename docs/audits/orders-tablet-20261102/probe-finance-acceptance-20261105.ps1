[CmdletBinding()]
param(
  [ValidateSet('DryRun','ReadOnly','Rollback')][string]$Mode = 'DryRun',
  [string]$ReviewedRuntimeSha256 = '',
  [string]$ReviewedWrapperSha256 = '',
  [string]$AuthorizationArtifact = ''
)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$commit = 'ef793d74821f7a8fdaade9a2227f26973bc527f2'
$paths = @(
  'src/modules/cobros/infrastructure/db2-cobros-repository.js',
  'src/modules/cobros/domain/cobros-repository.js',
  'src/modules/cobros/domain/commercial-payment-contract.js',
  'src/core/domain/repository.js',
  'services/comercial-devoluciones-service.js',
  'services/debt-view-contract.js',
  'utils/common.js','utils/db2-identifiers.js','utils/db2-schemas.js',
  'utils/db2-app-buffer-capability.js','utils/comercial-erp-tables.js',
  'utils/erp-document-label.js','adapters/pedidos-transaction-connection.js',
  'config/app-profile.js','config/load-env.js','config/reparto-runtime.js',
  'config/g4-dsedac-erp-mapping.js'
)
$sources = [ordered]@{}
foreach ($path in $paths) {
  $source = (& git -C $taskRoot show ($commit + ':backend/' + $path)) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw ('SEALED_SOURCE_UNAVAILABLE: ' + $path) }
  $sources[$path] = $source
}
$runtimePath = Join-Path $PSScriptRoot 'probe-finance-acceptance-20261105-runtime.js'
$runtime = Get-Content -LiteralPath $runtimePath -Raw
$runtimeHash = (Get-FileHash -LiteralPath $runtimePath -Algorithm SHA256).Hash
$wrapperHash = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash
$hasher = [Security.Cryptography.SHA256]::Create()
try {
  [string[]]$keys = $sources.Keys
  [Array]::Sort($keys, [StringComparer]::Ordinal)
  $manifestLines = foreach ($key in $keys) {
    $sourceHash = [BitConverter]::ToString(
      $hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($sources[$key]))
    ).Replace('-', '').ToLowerInvariant()
    $key + ':' + $sourceHash
  }
  $manifestHash = [BitConverter]::ToString(
    $hasher.ComputeHash(
      [Text.Encoding]::UTF8.GetBytes($commit + "`n" + ($manifestLines -join "`n"))
    )
  ).Replace('-', '').ToLowerInvariant()
} finally {
  $hasher.Dispose()
}

if ($Mode -eq 'DryRun') {
  [ordered]@{
    mode = 'DryRun'
    connected = $false
    sourceCommit = $commit
    sourceCount = $sources.Count
    manifestSha256 = $manifestHash
    runtimeSha256 = $runtimeHash
    wrapperSha256 = $wrapperHash
    requiredProfile = 'demo/isolated_test'
    vendor = '35'
    methods = @('CONTADO','TJ','TR')
    writeTargets = @('JAVIER.TEST_COBROS','JAVIER.TEST_LIQUIDACION_COMERCIAL')
    physicalCommitPath = $false
    physicalRollbackRequired = $true
    readOnlyRequiresAuthorization = $false
    rollbackRequiresExactReviewAndAuthorization = $true
  } | ConvertTo-Json -Depth 5
  exit 0
}

$authorization = $null
if ($Mode -eq 'Rollback') {
  if ($ReviewedRuntimeSha256 -cne $runtimeHash -or
      $ReviewedWrapperSha256 -cne $wrapperHash) {
    throw 'INDEPENDENT_REVIEW_OF_BOTH_SCRIPTS_REQUIRED'
  }
  if (-not $AuthorizationArtifact -or
      -not (Test-Path -LiteralPath $AuthorizationArtifact -PathType Leaf)) {
    throw 'ROLLBACK_REQUIRES_SEPARATE_AUTHORIZATION_ARTIFACT'
  }
  $authorization = Get-Content -LiteralPath $AuthorizationArtifact -Raw |
    ConvertFrom-Json
  if ($authorization.action -cne 'FINANCE_ACCEPTANCE_ROLLBACK' -or
      $authorization.sourceCommit -cne $commit -or
      $authorization.runtimeSha256 -cne $runtimeHash -or
      $authorization.wrapperSha256 -cne $wrapperHash -or
      $authorization.approved -ne $true -or
      -not $authorization.businessDate -or
      -not $authorization.candidateSetSha256) {
    throw 'AUTHORIZATION_ARTIFACT_DOES_NOT_MATCH_REVIEWED_CODE'
  }
}

$bundle = [ordered]@{
  commit = $commit
  mode = $Mode
  sources = $sources
  manifestSha256 = $manifestHash
  authorization = $authorization
}
$bundle64 = [Convert]::ToBase64String(
  [Text.Encoding]::UTF8.GetBytes(($bundle | ConvertTo-Json -Depth 7 -Compress))
)
$runtime64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($runtime))
$job = "global.__FINANCE_ACCEPTANCE_BUNDLE__=JSON.parse(Buffer.from('$bundle64','base64').toString('utf8'));`n" +
  "require('vm').runInThisContext(Buffer.from('$runtime64','base64').toString('utf8'),{filename:'finance-acceptance-20261105-runtime.js'});"
$job | & 'C:\Program Files\Git\usr\bin\ssh.exe' -o BatchMode=yes -o ConnectTimeout=10 gmp@192.168.1.230 'cd /opt/gmp-api/backend && timeout 240s node -'
exit $LASTEXITCODE
