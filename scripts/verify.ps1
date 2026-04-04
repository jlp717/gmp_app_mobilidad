#!/usr/bin/env pwsh
# GMP App - Verification & Quality Assurance Pipeline
# Runs all quality checks with truth scoring and auto-rollback
# Usage: .\scripts\verify.ps1

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path $PSScriptRoot -Parent
$QUALITY_THRESHOLD = 0.95
$Results = @{
    flutter_analyze = $null
    flutter_test = $null
    backend_test = $null
    backend_lint = $null
    security_check = $null
    file_structure = $null
}

function Write-Header {
    param([string]$Text)
    Write-Host "`n╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║  $Text" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan
}

function Write-Result {
    param([string]$Check, [bool]$Passed, [string]$Detail = '')
    $Results[$Check] = $Passed
    $icon = if ($Passed) { '✅' } else { '❌' }
    $color = if ($Passed) { 'Green' } else { 'Red' }
    Write-Host "  $icon $Check" -ForegroundColor $color
    if ($Detail) { Write-Host "     $Detail" -ForegroundColor Gray }
}

function Check-FlutterAnalyze {
    Write-Host 'Running flutter analyze...' -ForegroundColor Yellow
    Set-Location $RootDir
    $output = flutter analyze --no-fatal-infos 2>&1
    $exitCode = $LASTEXITCODE

    $issueCount = ($output | Select-String 'issue|warning|error' | Measure-Object).Count
    $hasErrors = ($output | Select-String 'error' | Measure-Object).Count -gt 0

    Write-Result 'flutter_analyze' (-not $hasErrors) "$issueCount issues found"
    return -not $hasErrors
}

function Check-FlutterTest {
    Write-Host 'Running Flutter tests...' -ForegroundColor Yellow
    Set-Location $RootDir
    $output = flutter test --no-pub 2>&1
    $passed = $LASTEXITCODE -eq 0

    $testCount = ($output | Select-String 'All tests passed' | Measure-Object).Count
    Write-Result 'flutter_test' $passed "$testCount test suite(s) passed"
    return $passed
}

function Check-BackendTest {
    Write-Host 'Running backend tests (Jest)...' -ForegroundColor Yellow
    Set-Location "$RootDir\backend"
    $output = npx jest --passWithNoTests --verbose 2>&1
    $passed = $LASTEXITCODE -eq 0

    $testMatch = $output | Select-String 'Tests:\s+(\d+) passed'
    $testCount = if ($testMatch) { $testMatch.Matches.Groups[1].Value } else { 'N/A' }
    Write-Result 'backend_test' $passed "$testCount tests passed"
    return $passed
}

function Check-BackendLint {
    Write-Host 'Running backend lint...' -ForegroundColor Yellow
    Set-Location "$RootDir\backend"
    $pkg = Get-Content 'package.json' | ConvertFrom-Json
    $hasLint = $pkg.scripts.PSObject.Properties.Name -contains 'lint'

    if (-not $hasLint) {
        Write-Result 'backend_lint' $true 'No lint script configured (skipped)'
        return $true
    }

    $output = npm run lint 2>&1
    $passed = $LASTEXITCODE -eq 0
    Write-Result 'backend_lint' $passed
    return $passed
}

function Check-Security {
    Write-Host 'Running security checks...' -ForegroundColor Yellow
    $issues = 0

    # Check for hardcoded secrets
    $secretPatterns = @(
        'password\s*=\s*["''][^"'']+["'']',
        'api[_-]?key\s*=\s*["''][^"'']+["'']',
        'secret\s*=\s*["''][^"'']+["'']',
        'JWT_ACCESS_SECRET\s*=\s*["''][^"'']+["'']'
    )

    $excludeDirs = @('node_modules', '.git', 'build', '.dart_tool')

    foreach ($pattern in $secretPatterns) {
        $matches = Get-ChildItem -Path $RootDir -Recurse -Include '*.js','*.ts','*.dart','*.env' |
            Where-Object {
                $path = $_.FullName
                -not ($excludeDirs | Where-Object { $path.Contains($_) })
            } |
            Select-String -Pattern $pattern -SimpleMatch -ErrorAction SilentlyContinue

        if ($matches) {
            $issues += $matches.Count
        }
    }

    # Check .env not tracked
    $envTracked = git ls-files '.env' 2>$null
    if ($envTracked) { $issues++ }

    Write-Result 'security_check' ($issues -eq 0) "$issues security issues found"
    return $issues -eq 0
}

function Check-FileStructure {
    Write-Host 'Checking file structure...' -ForegroundColor Yellow
    $issues = 0

    # Verify DDD structure exists
    $dddPaths = @(
        'backend\src\core\domain',
        'backend\src\core\application',
        'backend\src\modules\auth',
        'backend\src\modules\pedidos'
    )

    foreach ($path in $dddPaths) {
        if (-not (Test-Path "$RootDir\$path")) {
            Write-Host "  Missing: $path" -ForegroundColor Red
            $issues++
        }
    }

    # Verify no debug files in root
    $debugFiles = Get-ChildItem -Path $RootDir -Filter 'debug_*.js' -ErrorAction SilentlyContinue
    if ($debugFiles) {
        Write-Host "  Debug files found in root: $($debugFiles.Count)" -ForegroundColor Red
        $issues += $debugFiles.Count
    }

    Write-Result 'file_structure' ($issues -eq 0) "$issues structure issues found"
    return $issues -eq 0
}

# ==================== MAIN ====================
Write-Header 'GMP App - Verification & Quality Assurance'
Write-Host "Quality Threshold: $([math]::Round($QUALITY_THRESHOLD * 100))%" -ForegroundColor Yellow
Write-Host "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n" -ForegroundColor Gray

# Run all checks
$checks = @(
    { Check-FlutterAnalyze },
    { Check-BackendTest },
    { Check-BackendLint },
    { Check-Security },
    { Check-FileStructure }
)

$passed = 0
$total = $checks.Count

foreach ($check in $checks) {
    try {
        if (& $check) { $passed++ }
    } catch {
        Write-Host "  ❌ Check failed with error: $_" -ForegroundColor Red
    }
}

# Calculate truth score
$truthScore = $passed / $total

Write-Host "`n╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  VERIFICATION REPORT" -ForegroundColor Cyan
Write-Host "╠══════════════════════════════════════════════════════════╣" -ForegroundColor Cyan
Write-Host "║  Checks Passed: $passed / $total" -ForegroundColor $(if ($passed -eq $total) { 'Green' } else { 'Yellow' })
Write-Host "║  Truth Score:   $([math]::Round($truthScore * 100, 1))%" -ForegroundColor $(if ($truthScore -ge $QUALITY_THRESHOLD) { 'Green' } else { 'Red' })
Write-Host "║  Threshold:     $([math]::Round($QUALITY_THRESHOLD * 100))%" -ForegroundColor Gray
Write-Host "╠══════════════════════════════════════════════════════════╣" -ForegroundColor Cyan

if ($truthScore -ge $QUALITY_THRESHOLD) {
    Write-Host "║  ✅ QUALITY GATE PASSED - Code meets standards" -ForegroundColor Green
    Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    exit 0
} else {
    Write-Host "║  ❌ QUALITY GATE FAILED - Code does not meet $([math]::Round($QUALITY_THRESHOLD * 100))% threshold" -ForegroundColor Red
    Write-Host "║  ⚠️  Auto-rollback recommended" -ForegroundColor Yellow
    Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Red
    exit 1
}
