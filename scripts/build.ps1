# =============================================================================
# GMP APP MOVILIDAD - AUTOMATED BUILD SCRIPT (Windows PowerShell)
# =============================================================================
# Usage: .\scripts\build.ps1 -Platform android -Mode release

param(
    [ValidateSet('android', 'ios', 'all')]
    [string]$Platform = 'android',
    [ValidateSet('debug', 'release')]
    [string]$Mode = 'release'
)

function Print-Header { param([string]$Text); Write-Host "`n==== $Text ====" -ForegroundColor Blue }
function Print-Success { param([string]$Text); Write-Host "OK: $Text" -ForegroundColor Green }
function Print-Error { param([string]$Text); Write-Host "ERROR: $Text" -ForegroundColor Red }
function Print-Warning { param([string]$Text); Write-Host "WARN: $Text" -ForegroundColor Yellow }
function Print-Info { param([string]$Text); Write-Host "INFO: $Text" -ForegroundColor Cyan }

Print-Header 'GMP APP MOVILIDAD - BUILD'
Print-Info "Platform: $Platform"
Print-Info "Mode: $Mode"

Print-Header '1. Pre-build checks'
if (!(Get-Command flutter -ErrorAction SilentlyContinue)) {
    Print-Error 'Flutter is not installed or is not in PATH'
    exit 1
}
Print-Success "Flutter installed: $(flutter --version | Select-Object -First 1)"
flutter pub get
if ($LASTEXITCODE -ne 0) { Print-Error 'flutter pub get failed'; exit 1 }
Print-Success 'Dependencies ready'

Print-Header '2. Code quality'
flutter analyze --no-fatal-infos
if ($LASTEXITCODE -ne 0) { Print-Error 'Static analysis failed'; exit 1 }
if (Get-Command dart -ErrorAction SilentlyContinue) {
    dart format --set-exit-if-changed lib test
    if ($LASTEXITCODE -ne 0) { Print-Warning 'Formatting differences found; applying dart format'; dart format lib test }
}

Print-Header '3. Tests'
flutter test
if ($LASTEXITCODE -ne 0) { Print-Error 'Flutter tests failed'; exit 1 }
Print-Success 'Flutter tests passed'

Print-Header '4. Code generation'
flutter pub run build_runner build --delete-conflicting-outputs
if ($LASTEXITCODE -ne 0) { Print-Error 'Code generation failed'; exit 1 }
Print-Success 'Generated code ready'

Print-Header '5. Build'
$symbolsRoot = 'build\symbols'
New-Item -ItemType Directory -Force -Path $symbolsRoot | Out-Null
$versionMatch = Select-String -Path pubspec.yaml -Pattern '^version:\s*(.+)$' | Select-Object -First 1
if (-not $versionMatch) { Print-Error 'pubspec.yaml has no version'; exit 1 }
$appVersion = $versionMatch.Matches[0].Groups[1].Value.Trim()
$symbolDir = Join-Path $symbolsRoot "$(($appVersion -replace '[+:]', '_'))_$(Get-Date -Format yyyyMMdd_HHmmss)"
New-Item -ItemType Directory -Force -Path $symbolDir | Out-Null

function Build-Android {
    Print-Info "Building Android ($Mode)"
    if ($Mode -eq 'release') {
        flutter build apk --release --split-per-abi --obfuscate --split-debug-info="$symbolDir"
        if ($LASTEXITCODE -ne 0) { Print-Error 'Release APK build failed'; exit 1 }
        flutter build appbundle --release --obfuscate --split-debug-info="$symbolDir"
        if ($LASTEXITCODE -ne 0) { Print-Error 'Release AAB build failed'; exit 1 }
        Print-Success 'Android release artifacts generated'
    } else {
        flutter build apk --debug
        if ($LASTEXITCODE -ne 0) { Print-Error 'Debug APK build failed'; exit 1 }
        Print-Success 'Android debug APK generated'
    }
}

function Build-iOS {
    Print-Warning 'iOS builds require macOS and Xcode'
    if ($Mode -eq 'release') { flutter build ios --release --no-codesign --obfuscate --split-debug-info="$symbolDir" }
    else { flutter build ios --debug --no-codesign }
    if ($LASTEXITCODE -ne 0) { Print-Error 'iOS build failed'; exit 1 }
    Print-Success 'iOS artifact generated'
}

switch ($Platform) {
    'android' { Build-Android }
    'ios' { Build-iOS }
    'all' { Build-Android; Build-iOS }
}

Print-Header '6. Post-build'
Print-Info "Symbol maps: $symbolDir"
if ($Platform -eq 'android' -or $Platform -eq 'all') {
    Get-ChildItem -Path 'build\app\outputs\flutter-apk\*.apk' -ErrorAction SilentlyContinue |
        ForEach-Object { Write-Host "  $($_.Name): $([math]::Round($_.Length / 1MB, 2)) MB" }
    if (Test-Path 'build\app\outputs\bundle\release\app-release.aab') { Print-Success 'AAB: build\app\outputs\bundle\release\app-release.aab' }
}
Print-Success 'Build completed'