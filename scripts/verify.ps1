#!/usr/bin/env pwsh
# GMP App - Verification & Quality Assurance Pipeline
# Runs the local quality checks used before delivery.
# Usage: .\scripts\verify.ps1

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Path $PSScriptRoot -Parent
$QUALITY_THRESHOLD = 0.95

$Results = [ordered]@{
    flutter_analyze = $null
    flutter_test = $null
    backend_test = $null
    backend_lint = $null
    repartidor_finance_schema = $null
    security_check = $null
    file_structure = $null
    politec_quality_gate = $null
}
$script:FlutterToolUsable = $true

function Write-Header {
    param([string]$Text)

    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host $Text -ForegroundColor Cyan
    Write-Host '============================================================' -ForegroundColor Cyan
}

function Write-Result {
    param(
        [string]$Check,
        [bool]$Passed,
        [string]$Detail = ''
    )

    $Results[$Check] = $Passed
    $icon = if ($Passed) { '[PASS]' } else { '[FAIL]' }
    $color = if ($Passed) { 'Green' } else { 'Red' }

    Write-Host "  $icon $Check" -ForegroundColor $color
    if ($Detail) {
        Write-Host "     $Detail" -ForegroundColor Gray
    }
}

function Invoke-Tool {
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [string]$WorkingDirectory = $RootDir,
        [int]$TimeoutSeconds = 120
    )

    $outputFile = Join-Path ([System.IO.Path]::GetTempPath()) ('gmp_verify_out_' + [guid]::NewGuid().ToString('N') + '.log')
    $errorFile = Join-Path ([System.IO.Path]::GetTempPath()) ('gmp_verify_err_' + [guid]::NewGuid().ToString('N') + '.log')

    try {
        $command = Get-Command $FilePath -ErrorAction Stop
        $process = Start-Process `
            -FilePath $command.Source `
            -ArgumentList $ArgumentList `
            -WorkingDirectory $WorkingDirectory `
            -NoNewWindow `
            -PassThru `
            -RedirectStandardOutput $outputFile `
            -RedirectStandardError $errorFile

        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            try {
                $process.Kill()
            } catch {
                # Best effort: the gate must return instead of hanging forever.
            }

            $stdout = if (Test-Path -LiteralPath $outputFile) { Get-Content -LiteralPath $outputFile -ErrorAction SilentlyContinue } else { @() }
            $stderr = if (Test-Path -LiteralPath $errorFile) { Get-Content -LiteralPath $errorFile -ErrorAction SilentlyContinue } else { @() }
            return [pscustomobject]@{
                ExitCode = 124
                TimedOut = $true
                Output = @($stdout) + @($stderr)
            }
        }

        $stdout = if (Test-Path -LiteralPath $outputFile) { Get-Content -LiteralPath $outputFile -ErrorAction SilentlyContinue } else { @() }
        $stderr = if (Test-Path -LiteralPath $errorFile) { Get-Content -LiteralPath $errorFile -ErrorAction SilentlyContinue } else { @() }
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            TimedOut = $false
            Output = @($stdout) + @($stderr)
        }
    } catch {
        return [pscustomobject]@{
            ExitCode = 127
            TimedOut = $false
            Output = @($_.Exception.Message)
        }
    } finally {
        Remove-Item -LiteralPath $outputFile, $errorFile -Force -ErrorAction SilentlyContinue
    }
}

function Check-FlutterAnalyze {
    Write-Host 'Running flutter analyze...' -ForegroundColor Yellow
    Set-Location $RootDir

    $result = Invoke-Tool -FilePath 'flutter' -ArgumentList @('analyze', '--no-fatal-infos') -WorkingDirectory $RootDir -TimeoutSeconds 180
    if ($result.TimedOut) {
        $script:FlutterToolUsable = $false
        Write-Result 'flutter_analyze' $false 'Timed out after 180 seconds'
        return $false
    }
    if ($result.ExitCode -eq 127) {
        $script:FlutterToolUsable = $false
        Write-Result 'flutter_analyze' $false (($result.Output | Select-Object -First 1) -join ' ')
        return $false
    }

    $hasErrors = ($result.Output | Select-String 'error' | Measure-Object).Count -gt 0
    $issueCount = ($result.Output | Select-String 'issue|warning|error' | Measure-Object).Count
    $passed = ($result.ExitCode -eq 0) -and (-not $hasErrors)

    Write-Result 'flutter_analyze' $passed "$issueCount issue line(s) found"
    return $passed
}

function Check-FlutterTest {
    Write-Host 'Running Flutter tests...' -ForegroundColor Yellow
    Set-Location $RootDir

    if (-not $script:FlutterToolUsable) {
        Write-Result 'flutter_test' $false 'Skipped because the Flutter tool did not complete analyze'
        return $false
    }

    $result = Invoke-Tool -FilePath 'flutter' -ArgumentList @('test', '--no-pub') -WorkingDirectory $RootDir -TimeoutSeconds 240
    if ($result.TimedOut) {
        Write-Result 'flutter_test' $false 'Timed out after 240 seconds'
        return $false
    }

    $passed = $result.ExitCode -eq 0
    $testCount = ($result.Output | Select-String 'All tests passed' | Measure-Object).Count

    Write-Result 'flutter_test' $passed "$testCount passing summary line(s)"
    return $passed
}

function Check-BackendTest {
    Write-Host 'Running backend tests (Jest)...' -ForegroundColor Yellow
    Set-Location (Join-Path $RootDir 'backend')

    $result = Invoke-Tool -FilePath 'npx' -ArgumentList @('jest', '--passWithNoTests', '--verbose') -WorkingDirectory (Join-Path $RootDir 'backend') -TimeoutSeconds 180
    if ($result.TimedOut) {
        Write-Result 'backend_test' $false 'Timed out after 180 seconds'
        return $false
    }

    $passed = $result.ExitCode -eq 0
    $testMatch = $result.Output | Select-String 'Tests:\s+(\d+) passed'
    $testCount = if ($testMatch) { $testMatch.Matches.Groups[1].Value } else { 'N/A' }

    Write-Result 'backend_test' $passed "$testCount tests passed"
    return $passed
}

function Check-BackendLint {
    Write-Host 'Running backend lint...' -ForegroundColor Yellow
    Set-Location (Join-Path $RootDir 'backend')

    $pkg = Get-Content 'package.json' | ConvertFrom-Json
    $hasLint = $pkg.scripts -and ($pkg.scripts.PSObject.Properties.Name -contains 'lint')

    if (-not $hasLint) {
        Write-Result 'backend_lint' $true 'No lint script configured; skipped'
        return $true
    }

    $result = Invoke-Tool -FilePath 'npm' -ArgumentList @('run', 'lint') -WorkingDirectory (Join-Path $RootDir 'backend') -TimeoutSeconds 120
    if ($result.TimedOut) {
        Write-Result 'backend_lint' $false 'Timed out after 120 seconds'
        return $false
    }

    $passed = $result.ExitCode -eq 0

    Write-Result 'backend_lint' $passed
    return $passed
}

function Check-RepartidorFinanceSchema {
    Write-Host 'Verifying repartidor finance DB schema...' -ForegroundColor Yellow
    Set-Location (Join-Path $RootDir 'backend')

    $pkg = Get-Content 'package.json' | ConvertFrom-Json
    $hasScript = $pkg.scripts -and ($pkg.scripts.PSObject.Properties.Name -contains 'finance:verify-schema')

    if (-not $hasScript) {
        Write-Result 'repartidor_finance_schema' $true 'No finance schema script configured; skipped'
        return $true
    }

    $result = Invoke-Tool -FilePath 'npm' -ArgumentList @('run', 'finance:verify-schema') -WorkingDirectory (Join-Path $RootDir 'backend') -TimeoutSeconds 90
    if ($result.TimedOut) {
        Write-Result 'repartidor_finance_schema' $false 'Timed out after 90 seconds'
        return $false
    }

    $passed = $result.ExitCode -eq 0

    Write-Result 'repartidor_finance_schema' $passed
    return $passed
}

function Test-IsExcludedPath {
    param(
        [string]$Path,
        [string[]]$ExcludedDirs
    )

    $normalized = $Path.Replace('/', '\')
    foreach ($dir in $ExcludedDirs) {
        if ($normalized -like ('*\' + $dir + '\*')) {
            return $true
        }
    }
    return $false
}

function Check-Security {
    Write-Host 'Running security checks...' -ForegroundColor Yellow

    $issues = 0
    $secretPatterns = @(
        'password\s*=\s*["''][^"'']+["'']',
        'api[_-]?key\s*=\s*["''][^"'']+["'']',
        'secret\s*=\s*["''][^"'']+["'']',
        'JWT_ACCESS_SECRET\s*=\s*["''][^"'']+["'']'
    )
    $excludeDirs = @('node_modules', '.git', '.dart_tool', 'build', 'coverage', '.opencode')

    $sourceFiles = Get-ChildItem -Path $RootDir -Recurse -File -Include '*.js','*.ts','*.dart','*.json','*.yaml','*.yml' -ErrorAction SilentlyContinue |
        Where-Object { -not (Test-IsExcludedPath -Path $_.FullName -ExcludedDirs $excludeDirs) }

    foreach ($pattern in $secretPatterns) {
        $matches = $sourceFiles | Select-String -Pattern $pattern -ErrorAction SilentlyContinue
        if ($matches) {
            $issues += $matches.Count
        }
    }

    $trackedEnvFiles = & git -C $RootDir ls-files '*.env' '.env' 'backend/.env' 2>$null
    if ($trackedEnvFiles) {
        $issues += ($trackedEnvFiles | Measure-Object).Count
    }

    Write-Result 'security_check' ($issues -eq 0) "$issues security issue(s) found"
    return $issues -eq 0
}

function Check-FileStructure {
    Write-Host 'Checking file structure...' -ForegroundColor Yellow

    $issues = 0
    $requiredPaths = @(
        'backend\routes',
        'backend\services',
        'backend\src\modules',
        'backend\config',
        'lib\core',
        'lib\features',
        'test'
    )

    foreach ($path in $requiredPaths) {
        if (-not (Test-Path -LiteralPath (Join-Path $RootDir $path))) {
            Write-Host "  Missing: $path" -ForegroundColor Red
            $issues++
        }
    }

    $rootScratchFiles = Get-ChildItem -Path $RootDir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like 'debug_*.js' -or $_.Name -like 'tmp*.js' -or $_.Name -like '*.tmp' -or $_.Name -like 'scratch*' }
    if ($rootScratchFiles) {
        Write-Host "  Scratch files found in root: $($rootScratchFiles.Count)" -ForegroundColor Red
        $issues += $rootScratchFiles.Count
    }

    Write-Result 'file_structure' ($issues -eq 0) "$issues structure issue(s) found"
    return $issues -eq 0
}

function Check-PolitecQualityGate {
    Write-Host 'Running Politec quality gate...' -ForegroundColor Yellow
    Set-Location $RootDir

    $gate = Join-Path $RootDir 'scripts\politec-quality-gate.ps1'
    if (-not (Test-Path -LiteralPath $gate)) {
        Write-Result 'politec_quality_gate' $false 'Missing scripts\politec-quality-gate.ps1'
        return $false
    }

    $result = Invoke-Tool -FilePath 'powershell' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $gate) -WorkingDirectory $RootDir -TimeoutSeconds 60
    if ($result.TimedOut) {
        Write-Result 'politec_quality_gate' $false 'Timed out after 60 seconds'
        return $false
    }

    $passed = $result.ExitCode -eq 0
    $detail = (($result.Output | Select-Object -Last 3) -join ' ')

    Write-Result 'politec_quality_gate' $passed $detail
    return $passed
}

Write-Header 'GMP App - Verification & Quality Assurance'
Write-Host "Quality Threshold: $([math]::Round($QUALITY_THRESHOLD * 100))%" -ForegroundColor Yellow
Write-Host "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray

$checks = @(
    { Check-FlutterAnalyze },
    { Check-FlutterTest },
    { Check-BackendTest },
    { Check-BackendLint },
    { Check-RepartidorFinanceSchema },
    { Check-Security },
    { Check-FileStructure },
    { Check-PolitecQualityGate }
)

$passed = 0
$total = $checks.Count

foreach ($check in $checks) {
    try {
        if (& $check) {
            $passed++
        }
    } catch {
        Write-Host "  [FAIL] Check failed with error: $_" -ForegroundColor Red
    }
}

$truthScore = $passed / $total

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host 'VERIFICATION REPORT' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host "Checks Passed: $passed / $total" -ForegroundColor $(if ($passed -eq $total) { 'Green' } else { 'Yellow' })
Write-Host "Truth Score:   $([math]::Round($truthScore * 100, 1))%" -ForegroundColor $(if ($truthScore -ge $QUALITY_THRESHOLD) { 'Green' } else { 'Red' })
Write-Host "Threshold:     $([math]::Round($QUALITY_THRESHOLD * 100))%" -ForegroundColor Gray

if ($truthScore -ge $QUALITY_THRESHOLD) {
    Write-Host 'QUALITY GATE PASSED - Code meets standards' -ForegroundColor Green
    exit 0
}

Write-Host "QUALITY GATE FAILED - Code does not meet $([math]::Round($QUALITY_THRESHOLD * 100))% threshold" -ForegroundColor Red
exit 1
