#!/usr/bin/env pwsh
# GMP App - Development CLI (PowerShell)
# Usage: .\scripts\dev.ps1 [command]

param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'analyze', 'test', 'build', 'backend', 'health', 'clean', 'lint', 'fix', 'docker', 'docs', 'migrate', 'seed', 'help')]
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
    Write-Host '  lint      - Run flutter analyze + backend lint (no tests)'
    Write-Host '  fix       - Auto-fix common Dart issues (dart fix + pub get)'
    Write-Host '  docker    - Start development environment with Docker Compose'
    Write-Host '  docs      - Generate or open API documentation'
    Write-Host '  migrate   - Run database migrations from backend/migrations/'
    Write-Host '  seed      - Seed the database with test data'
    Write-Host '  help      - Show this help message'
    Write-Host ''
}

function Run-Lint {
    Write-Header 'GMP App - Lint (Analysis Only)'

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
            $backendOk = $LASTEXITCODE -eq 0
        } else {
            Write-Host '  No lint script found, skipping.' -ForegroundColor Gray
            $backendOk = $true
        }
    } else {
        $backendOk = $true
    }

    if ($flutterOk -and $backendOk) {
        Write-Host "`n✅ Lint complete - no issues found" -ForegroundColor Green
    } else {
        Write-Host "`n❌ Lint found issues" -ForegroundColor Red
        if (-not $flutterOk) { Write-Host '   - Flutter analysis failed' -ForegroundColor Red }
        if (-not $backendOk) { Write-Host '   - Backend lint failed' -ForegroundColor Red }
        exit 1
    }
}

function Run-Fix {
    Write-Header 'GMP App - Auto-Fix Dart Issues'
    Set-Location $RootDir

    Write-Host '[1/2] Running dart fix --apply...' -ForegroundColor Yellow
    dart fix --apply
    if ($LASTEXITCODE -ne 0) {
        Write-Host '⚠️  dart fix encountered issues. Continuing...' -ForegroundColor Yellow
    }

    Write-Host '[2/2] Running flutter pub get...' -ForegroundColor Yellow
    flutter pub get
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n✅ Dart fix complete" -ForegroundColor Green
    } else {
        Write-Host "`n❌ flutter pub get failed" -ForegroundColor Red
        exit 1
    }
}

function Run-Docker {
    Write-Header 'GMP App - Docker Development Environment'
    Set-Location $RootDir

    if (-not (Test-Path 'docker-compose.yml')) {
        Write-Host '❌ docker-compose.yml not found at project root.' -ForegroundColor Red
        Write-Host '   Run the docker command after creating docker-compose.yml' -ForegroundColor Gray
        exit 1
    }

    Write-Host 'Checking Docker availability...' -ForegroundColor Yellow
    try {
        $null = docker --version 2>&1
    } catch {
        Write-Host '❌ Docker is not installed or not in PATH' -ForegroundColor Red
        exit 1
    }

    Write-Host 'Starting Docker Compose services...' -ForegroundColor Green
    docker compose up -d

    Write-Host "`n✅ Docker services started" -ForegroundColor Green
    Write-Host '  Backend: http://localhost:3334' -ForegroundColor Gray
    Write-Host '  Redis:   localhost:6379' -ForegroundColor Gray
    Write-Host "`n  Note: DB2 requires external connection (see docker-compose.yml)" -ForegroundColor Yellow
    Write-Host '  View logs: docker compose logs -f' -ForegroundColor Gray
    Write-Host '  Stop:      .\scripts\dev.ps1 docker-stop' -ForegroundColor Gray
}

function Run-Docs {
    Write-Header 'GMP App - API Documentation'
    Set-Location $RootDir

    # Check for swagger/OpenAPI setup in backend
    $hasSwagger = Test-Path "$RootDir\backend\src\swagger*"
    $hasSwaggerJsdoc = Test-Path "$RootDir\backend\node_modules\swagger-jsdoc"

    if ($hasSwagger -or $hasSwaggerJsdoc) {
        Write-Host 'Starting backend to serve Swagger docs...' -ForegroundColor Yellow
        Write-Host '  Docs will be available at: http://localhost:3334/api-docs' -ForegroundColor Green
        Write-Host '  Press Ctrl+C to stop.' -ForegroundColor Gray
        Set-Location "$RootDir\backend"
        node server.js
    } elseif (Test-Path "$RootDir\docs") {
        Write-Host 'Opening docs/ directory...' -ForegroundColor Green
        explorer "$RootDir\docs"
    } else {
        Write-Host '⚠️  No documentation tool found.' -ForegroundColor Yellow
        Write-Host '  Options:' -ForegroundColor Gray
        Write-Host '  - Add swagger-jsdoc to backend for auto-generated API docs' -ForegroundColor Gray
        Write-Host '  - Create a docs/ folder for manual documentation' -ForegroundColor Gray
        Write-Host '  - Backend already serves Swagger at /api-docs when running' -ForegroundColor Gray
    }
}

function Run-Migrate {
    Write-Header 'GMP App - Database Migration'
    Set-Location $RootDir

    $migrationDir = "$RootDir\backend\migrations"
    if (-not (Test-Path $migrationDir)) {
        Write-Host '❌ Migrations directory not found: backend/migrations/' -ForegroundColor Red
        exit 1
    }

    $migrations = Get-ChildItem -Path $migrationDir -Filter '*.sql' | Sort-Object Name
    if ($migrations.Count -eq 0) {
        Write-Host '⚠️  No SQL migration files found.' -ForegroundColor Yellow
        exit 0
    }

    Write-Host "Found $($migrations.Count) migration file(s):" -ForegroundColor Cyan
    foreach ($mig in $migrations) {
        Write-Host "  - $($mig.Name)" -ForegroundColor Gray
    }
    Write-Host ''

    # Check if backend has migration script
    Set-Location "$RootDir\backend"
    $pkg = Get-Content 'package.json' | ConvertFrom-Json
    if ($pkg.scripts.PSObject.Properties.Name -contains 'db:migrate') {
        Write-Host 'Running migrations via npm script...' -ForegroundColor Green
        npm run db:migrate
    } else {
        Write-Host 'Running SQL migrations manually...' -ForegroundColor Yellow
        Write-Host '⚠️  Ensure DB2 connection is configured in .env' -ForegroundColor Yellow
        foreach ($mig in $migrations) {
            Write-Host "  Applying: $($mig.Name)" -ForegroundColor Yellow
            Write-Host "    (Manual execution required for DB2 - see backend/migrations/DEPLOYMENT_GUIDE.md)" -ForegroundColor Gray
        }
        Write-Host "`n  See backend/migrations/DEPLOYMENT_GUIDE.md for instructions" -ForegroundColor Cyan
    }
}

function Run-Seed {
    Write-Header 'GMP App - Database Seed'
    Set-Location "$RootDir\backend"

    $pkg = Get-Content 'package.json' | ConvertFrom-Json
    if ($pkg.scripts.PSObject.Properties.Name -contains 'db:seed') {
        Write-Host 'Running database seed...' -ForegroundColor Green
        npm run db:seed
    } else {
        Write-Host '⚠️  No seed script configured in package.json' -ForegroundColor Yellow
        Write-Host '  Add a db:seed script or create seed files in backend/seeders/' -ForegroundColor Gray
        exit 1
    }
}

switch ($Command) {
    'start'   { Start-Frontend }
    'backend' { Start-Backend }
    'test'    { Run-Tests }
    'analyze' { Run-Analyze }
    'build'   { Build-Release }
    'health'  { Check-Health }
    'clean'   { Clean-Project }
    'lint'    { Run-Lint }
    'fix'     { Run-Fix }
    'docker'  { Run-Docker }
    'docs'    { Run-Docs }
    'migrate' { Run-Migrate }
    'seed'    { Run-Seed }
    'help'    { Show-Help }
    default   { Show-Help }
}
