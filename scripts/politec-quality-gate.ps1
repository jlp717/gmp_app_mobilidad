#!/usr/bin/env pwsh
# GMP Politec quality gate.
# P: Purpose, O: Organization, L: Legibility, I: Integration, T: Tests,
# E: Efficiency/error handling, C: Compliance/security.

param(
  [switch]$Strict,
  [switch]$Json
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path $PSScriptRoot -Parent
$Failures = New-Object System.Collections.Generic.List[string]
$Warnings = New-Object System.Collections.Generic.List[string]

function Add-Failure([string]$Message) { [void]$Failures.Add($Message) }
function Add-Warning([string]$Message) { [void]$Warnings.Add($Message) }
function Join-RepoPath([string]$RelativePath) {
  $normalized = $RelativePath -replace '[\\/]', [System.IO.Path]::DirectorySeparatorChar
  return Join-Path $RootDir $normalized
}

function Test-PathRequired([string]$RelativePath, [string]$Reason) {
  if (-not (Test-Path -LiteralPath (Join-RepoPath $RelativePath))) {
    Add-Failure "Missing required path: $RelativePath ($Reason)"
  }
}

function Get-Text([string]$RelativePath) {
  $path = Join-RepoPath $RelativePath
  if (-not (Test-Path -LiteralPath $path)) { return "" }
  return Get-Content -LiteralPath $path -Raw
}

function Test-Contains([string]$RelativePath, [string]$Pattern, [string]$Failure) {
  $text = Get-Text $RelativePath
  if ($text -notmatch $Pattern) { Add-Failure $Failure }
}

function Test-NotContains([string]$RelativePath, [string]$Pattern, [string]$Failure) {
  $text = Get-Text $RelativePath
  if ($text -match $Pattern) { Add-Failure $Failure }
}

function Get-LineIndex([string[]]$Lines, [string]$Pattern) {
  for ($i = 0; $i -lt $Lines.Count; $i++) {
    if ($Lines[$i] -match $Pattern) { return $i }
  }
  return -1
}

# O - Organization: client-server and feature/module boundaries.
Test-PathRequired "lib\core" "shared Flutter infrastructure"
Test-PathRequired "lib\features" "Flutter feature modules"
Test-PathRequired "backend\routes" "HTTP route boundary"
Test-PathRequired "backend\services" "backend service boundary"
Test-PathRequired "backend\src\modules" "DDD/module migration boundary"
Test-PathRequired "backend\config" "runtime configuration"
Test-PathRequired "test" "regression tests"
Test-PathRequired ".github\workflows" "CI enforcement"

$featureDirs = @(Get-ChildItem -LiteralPath (Join-RepoPath "lib/features") -Directory -ErrorAction SilentlyContinue)
foreach ($feature in $featureDirs) {
  $knownLayerCount = @(
    "data",
    "domain",
    "providers",
    "presentation"
  ) | Where-Object {
    Test-Path -LiteralPath (Join-Path $feature.FullName $_)
  } | Measure-Object | Select-Object -ExpandProperty Count
  if ($knownLayerCount -eq 0) {
    Add-Warning "Feature has no standard layer folder: lib/features/$($feature.Name)"
  }
}

$featureRootDartFiles = @(Get-ChildItem -LiteralPath (Join-RepoPath "lib/features") -Directory -ErrorAction SilentlyContinue |
  ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -File -Filter "*.dart" -ErrorAction SilentlyContinue })
foreach ($file in $featureRootDartFiles) {
  $relative = $file.FullName.Substring($RootDir.Length + 1) -replace '\\', '/'
  Add-Failure "Feature Dart file must live under a standard layer folder: $relative"
}

$libArchiveArtifacts = @(Get-ChildItem -LiteralPath (Join-RepoPath "lib") -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { @(".txt", ".md", ".bak", ".old") -contains $_.Extension.ToLowerInvariant() })
foreach ($file in $libArchiveArtifacts) {
  $relative = $file.FullName.Substring($RootDir.Length + 1) -replace '\\', '/'
  Add-Failure "Archive/document artifact must not live under lib/: $relative"
}

# L - Legibility and clean workspace: no scratch files in repo root.
$rootScratchPatterns = @("debug_*.js", "tmp*.js", "*_tmp.js", "*.tmp", "scratch*")
foreach ($pattern in $rootScratchPatterns) {
  $matches = @(Get-ChildItem -LiteralPath $RootDir -File -Filter $pattern -ErrorAction SilentlyContinue)
  foreach ($match in $matches) {
    Add-Failure "Scratch file in repository root: $($match.Name)"
  }
}

$rootLogFiles = @(Get-ChildItem -LiteralPath $RootDir -File -Filter "*.log" -ErrorAction SilentlyContinue)
foreach ($file in $rootLogFiles) {
  $trackedLog = & git -C $RootDir ls-files -- $file.Name
  if ($trackedLog) {
    Add-Failure "Tracked log file must live under logs/: $($file.Name)"
  }
}

$allowedRootMarkdown = @("AGENTS.md", "CLAUDE.md", "README.md")
$rootMarkdownFiles = @(Get-ChildItem -LiteralPath $RootDir -File -Filter "*.md" -ErrorAction SilentlyContinue)
foreach ($file in $rootMarkdownFiles) {
  if ($allowedRootMarkdown -notcontains $file.Name) {
    Add-Failure "Historical/project documentation must live under docs/, not repository root: $($file.Name)"
  }
}

$backendScriptResults = Join-RepoPath "backend/scripts/results"
if (Test-Path -LiteralPath $backendScriptResults) {
  $resultArtifacts = @(Get-ChildItem -LiteralPath $backendScriptResults -File -ErrorAction SilentlyContinue)
  foreach ($artifact in $resultArtifacts) {
    Add-Failure "Historical backend script output must live under docs/archive/audits, not backend/scripts/results: $($artifact.Name)"
  }
}

if (Test-Path -LiteralPath (Join-RepoPath "lib/core/api/api_client_secure.dart")) {
  Add-Failure "Legacy duplicate API client still exists: lib/core/api/api_client_secure.dart"
}

$largeSourceRoots = @(
  "lib/features",
  "backend/routes",
  "backend/services",
  "backend/src/shared/routes"
)
foreach ($relativeRoot in $largeSourceRoots) {
  $sourceRoot = Join-RepoPath $relativeRoot
  if (-not (Test-Path -LiteralPath $sourceRoot)) { continue }
  $sourceFiles = @(Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Include "*.dart", "*.js" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.FullName -notmatch "[\\/]node_modules[\\/]" -and
      @(".dart", ".js") -contains $_.Extension.ToLowerInvariant()
    })
  foreach ($sourceFile in $sourceFiles) {
    $lineCount = (Get-Content -LiteralPath $sourceFile.FullName -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
    if ($lineCount -gt 1800) {
      $relative = $sourceFile.FullName.Substring($RootDir.Length + 1) -replace '\\', '/'
      Add-Warning "Large source file should be split by responsibility: $relative ($lineCount lines)"
    }
  }
}

# I - Integration: auth/session cluster safety and readiness before protected routes.
Test-Contains "backend\middleware\auth.js" "createAuthClaimsSessionStore" "Auth middleware must use the canonical sid/jti Redis session store."
Test-Contains "backend\middleware\auth.js" "canonicalSessionStore" "Auth middleware must keep a canonical session store for cluster-safe refresh."
Test-Contains "backend\src\modules\auth\application\auth-claims-session-store.js" "const selectedMode = production \? 'redis'" "Production auth sessions must force Redis mode."
Test-Contains "backend\src\modules\auth\application\auth-claims-session-store.js" "const requiresRedis = production \|\| selectedMode === 'redis'" "Auth session store must require Redis in production or redis mode."
Test-Contains "backend\middleware\auth.js" "canonicalSessionStore\.isActive" "Auth middleware must consult canonicalSessionStore.isActive on refresh."
Test-NotContains "backend\middleware\auth.js" "AUTH_ALLOW_STATELESS_REFRESH_FALLBACK" "Auth middleware must not keep a stateless refresh fallback."
Test-Contains "backend\config\env.js" "JWT_ACCESS_SECRET must be set" "Production config must fail fast when JWT_ACCESS_SECRET is missing."
Test-Contains "backend\config\env.js" "JWT_REFRESH_SECRET must be set" "Production config must fail fast when JWT_REFRESH_SECRET is missing."
Test-Contains "backend\server.js" "app\.get\('/api/ready', requireInternalMetricsAccess" "Readiness must be protected by internal access, not app bearer auth."

$serverLines = @(Get-Content -LiteralPath (Join-RepoPath "backend/server.js") -ErrorAction SilentlyContinue)
$readyLine = Get-LineIndex $serverLines "app\.get\('/api/ready'"
$protectedApiLine = Get-LineIndex $serverLines "app\.use\('/api', verifyToken\)"
if ($readyLine -lt 0 -or $protectedApiLine -lt 0 -or $readyLine -gt $protectedApiLine) {
  Add-Failure "Readiness route must be mounted before app-wide /api verifyToken middleware."
}

# T - Tests: critical auth/offline/security changes need regression coverage.
$testFiles = @(
  "backend\__tests__\metrics-health-security.test.js",
  "test\api\api_client_tls_policy_test.dart",
  "test\services\secure_storage_test.dart",
  "test\features\pedidos_order_api_test.dart",
  "test\features\pedidos\pedidos_business_logic_test.dart"
)
foreach ($testFile in $testFiles) {
  Test-PathRequired $testFile "critical regression coverage"
}

# E - Efficiency/error handling: detect known blocking anti-patterns where cheap and reliable.
$backendJsFiles = @(Get-ChildItem -LiteralPath (Join-RepoPath "backend") -Recurse -File -Include "*.js" -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch "[\\/]node_modules[\\/]" })
$backendBroadAsyncLoops = if ($backendJsFiles.Count -gt 0) {
  Select-String `
    -Path $backendJsFiles.FullName `
    -Pattern "for\s*\(.*\)\s*\{[\s\S]*await\s+(query|queryWithParams|fetch|axios|odbc)" `
    -ErrorAction SilentlyContinue
} else { @() }
if ($backendBroadAsyncLoops) {
  Add-Warning "Potential async DB/network work inside loops found; review for N+1 before delivery."
}

# C - Compliance/security.
$trackedEnv = & git -C $RootDir ls-files ".env" "backend/.env" ".env.production" "backend/.env.production" 2>$null
if ($trackedEnv) {
  Add-Failure "Environment secret file is tracked by git: $trackedEnv"
}

$secretScan = & git -C $RootDir grep -n -I -E "(JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|ODBC_PWD|SSH_GMP_PASSWORD)\s*=\s*['`"]?[A-Za-z0-9_./+=-]{12,}" -- . 2>$null
if ($LASTEXITCODE -eq 0 -and $secretScan) {
  $filtered = $secretScan | Where-Object {
    $_ -notmatch "\.env\.example" -and
    $_ -notmatch "security-setup" -and
    $_ -notmatch "validate_production_config" -and
    $_ -notmatch "politec-quality-gate" -and
    $_ -notmatch "[\\/]__tests__[\\/]" -and
    $_ -notmatch "[\\/]tests[\\/]"
  }
  if ($filtered) {
    Add-Failure "Possible hardcoded secret detected. Review: $($filtered[0])"
  }
}

if ($Strict -and $Warnings.Count -gt 0) {
  foreach ($warning in $Warnings) { Add-Failure "Strict warning promoted to failure: $warning" }
}

$result = [ordered]@{
  ok = $Failures.Count -eq 0
  failures = @($Failures)
  warnings = @($Warnings)
  checked_at = (Get-Date).ToString("o")
}

if ($Json) {
  $result | ConvertTo-Json -Depth 10
} else {
  Write-Host "Politec quality gate"
  foreach ($failure in $Failures) { Write-Host "FAIL: $failure" -ForegroundColor Red }
  foreach ($warning in $Warnings) { Write-Host "WARN: $warning" -ForegroundColor Yellow }
  if ($Failures.Count -eq 0) { Write-Host "PASS" -ForegroundColor Green }
}

if ($Failures.Count -gt 0) { exit 1 }
exit 0
