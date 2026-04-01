#!/usr/bin/env pwsh
# GMP App - Development CLI (PowerShell)
# Usage: .\scripts\dev.ps1 [command]

param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'analyze', 'test', 'build', 'backend', 'health', 'clean', 'help')]
    [string]$Command = 'help'
)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path $PSScriptRoot -Parent

function Write-Header {
    param([string]$Text)
    Write-Host "`n╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║  $Text" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan
}

function Start-Frontend {
    Write-Header 'GMP App - Frontend (Flutter)'
    Write-Host '[1/3] Running flutter pub get...' -ForegroundColor Yellow
    Set-Location $RootDir
    flutter pub get
    if ($LASTEXITCODE -ne 0) { exit 1 }

    Write-Host '[2/3] Running flutter analyze...' -ForegroundColor Yellow
    flutter analyze
    if ($LASTEXITCODE -ne 0) {
        Write-Host '⚠️  Analysis warnings found. Continue anyway? (y/n)' -ForegroundColor Yellow
        $response = Read-Host
        if ($response -ne 'y') { exit 1 }
    }

    Write-Host '[3/3] Starting Flutter app...' -ForegroundColor Green
    flutter run
}

function Start-Backend {
    Write-Header 'GMP App - Backend (Node.js)'
    Set-Location "$RootDir\backend"

    Write-Host 'Installing dependencies...' -ForegroundColor Yellow
    npm install --production

    Write-Host 'Starting backend server...' -ForegroundColor Green
    node server.js
}

function Run-Tests {
    Write-Header 'GMP App - Test Suite'

    Write-Host '[1/2] Running backend tests (Jest)...' -ForegroundColor Yellow
    Set-Location "$RootDir\backend"
    npx jest --passWithNoTests
    $backendOk = $LASTEXITCODE -eq 0

    Write-Host '[2/2] Running Flutter tests...' -ForegroundColor Yellow
    Set-Location $RootDir
    flutter test --no-pub
    $flutterOk = $LASTEXITCODE -eq 0

    Write-Host "`n╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    if ($backendOk -and $flutterOk) {
        Write-Host '║  ✅ ALL TESTS PASSED                                      ║' -ForegroundColor Green
    } else {
        Write-Host '║  ❌ SOME TESTS FAILED                                     ║' -ForegroundColor Red
        if (-not $backendOk) { Write-Host '║     - Backend tests failed                                ║' -ForegroundColor Red }
        if (-not $flutterOk) { Write-Host '║     - Flutter tests failed                                ║' -ForegroundColor Red }
    }
    Write-Host '╚══════════════════════════════════════════════════════════╝' -ForegroundColor Cyan
}

function Run-Analyze {
    Write-Header 'GMP App - Static Analysis'

    Write-Host '[1/2] Flutter analyze...' -ForegroundColor Yellow
    Set-Location $RootDir
    flutter analyze
    $flutterOk = $LASTEXITCODE -eq 0

    Write-Host '[2/2] Backend lint...' -ForegroundColor Yellow
    Set-Location "$RootDir\backend"
    if (Test-Path 'package.json') {
        $pkg = Get-Content 'package.json' | ConvertFrom-Json
        if ($pkg.scripts.PSObject.Properties.Name -contains 'lint') {
            npm run lint
        } else {
            Write-Host '  No lint script found, skipping.' -ForegroundColor Gray
        }
    }

    if ($flutterOk) {
        Write-Host "`n✅ Analysis complete" -ForegroundColor Green
    } else {
        Write-Host "`n❌ Analysis found issues" -ForegroundColor Red
        exit 1
    }
}

function Build-Release {
    Write-Header 'GMP App - Build Release APK'
    Set-Location $RootDir

    Write-Host 'Running flutter pub get...' -ForegroundColor Yellow
    flutter pub get

    Write-Host 'Building release APK...' -ForegroundColor Green
    flutter build apk --release

    if ($LASTEXITCODE -eq 0) {
        $apkPath = "$RootDir\build\app\outputs\flutter-apk\app-release.apk"
        Write-Host "`n✅ APK built: $apkPath" -ForegroundColor Green
        if (Test-Path $apkPath) {
            $size = [math]::Round((Get-Item $apkPath).Length / 1MB, 2)
            Write-Host "   Size: ${size} MB" -ForegroundColor Gray
        }
    }
}

function Check-Health {
    Write-Header 'GMP App - Health Check'

    Write-Host 'Checking backend API...' -ForegroundColor Yellow
    try {
        $response = Invoke-WebRequest -Uri 'http://localhost:3334/api/health' -TimeoutSec 5 -UseBasicParsing
        $body = $response.Content | ConvertFrom-Json
        Write-Host "  Backend: ✅ $($body.status)" -ForegroundColor Green
        Write-Host "  Database: $($body.database)" -ForegroundColor Gray
        Write-Host "  Timestamp: $($body.timestamp)" -ForegroundColor Gray
    } catch {
        Write-Host "  Backend: ❌ Not reachable (port 3334)" -ForegroundColor Red
    }
}

function Clean-Project {
    Write-Header 'GMP App - Clean Build Artifacts'
    Set-Location $RootDir

    Write-Host 'Cleaning Flutter build...' -ForegroundColor Yellow
    flutter clean

    Write-Host 'Cleaning backend node_modules...' -ForegroundColor Yellow
    if (Test-Path "$RootDir\backend\node_modules") {
        Remove-Item "$RootDir\backend\node_modules" -Recurse -Force
    }

    Write-Host "✅ Clean complete" -ForegroundColor Green
}

function Show-Help {
    Write-Header 'GMP App - Development CLI'
    Write-Host 'Usage: .\scripts\dev.ps1 <command>'
    Write-Host ''
    Write-Host 'Commands:' -ForegroundColor Cyan
    Write-Host '  start     - Start Flutter app (pub get + analyze + run)'
    Write-Host '  backend   - Start backend server (npm install + node server.js)'
    Write-Host '  test      - Run all tests (Jest + Flutter)'
    Write-Host '  analyze   - Run static analysis (flutter analyze + backend lint)'
    Write-Host '  build     - Build release APK'
    Write-Host '  health    - Check backend health endpoint'
    Write-Host '  clean     - Clean build artifacts and node_modules'
    Write-Host '  help      - Show this help message'
    Write-Host ''
}

switch ($Command) {
    'start'   { Start-Frontend }
    'backend' { Start-Backend }
    'test'    { Run-Tests }
    'analyze' { Run-Analyze }
    'build'   { Build-Release }
    'health'  { Check-Health }
    'clean'   { Clean-Project }
    'help'    { Show-Help }
    default   { Show-Help }
}
