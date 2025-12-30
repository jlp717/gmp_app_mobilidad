# =============================================================================
# SCRIPT DE BUILD AUTOMATIZADO - GMP APP MOVILIDAD (Windows PowerShell)
# =============================================================================
#
# USO:
#   .\scripts\build.ps1 -Platform [android|ios|all] -Mode [debug|release]
#
# EJEMPLOS:
#   .\scripts\build.ps1 -Platform android -Mode release
#   .\scripts\build.ps1 -Platform all -Mode debug

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet('android', 'ios', 'all')]
    [string]$Platform = 'android',

    [Parameter(Mandatory=$false)]
    [ValidateSet('debug', 'release')]
    [string]$Mode = 'release'
)

# Funciones helper
function Print-Header {
    param([string]$Text)
    Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Blue
    Write-Host "  $Text" -ForegroundColor Blue
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Blue
}

function Print-Success {
    param([string]$Text)
    Write-Host "✅ $Text" -ForegroundColor Green
}

function Print-Error {
    param([string]$Text)
    Write-Host "❌ $Text" -ForegroundColor Red
}

function Print-Warning {
    param([string]$Text)
    Write-Host "⚠️  $Text" -ForegroundColor Yellow
}

function Print-Info {
    param([string]$Text)
    Write-Host "ℹ️  $Text" -ForegroundColor Cyan
}

# =============================================================================
# INICIO
# =============================================================================

Print-Header "GMP APP MOVILIDAD - BUILD SCRIPT"
Print-Info "Plataforma: $Platform"
Print-Info "Modo: $Mode"

# =============================================================================
# PRE-BUILD CHECKS
# =============================================================================

Print-Header "1. Verificaciones Pre-Build"

# Verificar Flutter
if (!(Get-Command flutter -ErrorAction SilentlyContinue)) {
    Print-Error "Flutter no está instalado o no está en PATH"
    exit 1
}

$flutterVersion = flutter --version | Select-Object -First 1
Print-Success "Flutter instalado: $flutterVersion"

# Dependencias
Print-Info "Obteniendo dependencias..."
flutter pub get
if ($LASTEXITCODE -ne 0) {
    Print-Error "Error al obtener dependencias"
    exit 1
}
Print-Success "Dependencias actualizadas"

# =============================================================================
# CODE QUALITY
# =============================================================================

Print-Header "2. Verificaciones de Calidad"

# Análisis estático
Print-Info "Ejecutando análisis estático..."
flutter analyze
if ($LASTEXITCODE -ne 0) {
    Print-Error "Análisis estático falló"
    exit 1
}
Print-Success "Análisis estático: OK"

# Formato
Print-Info "Verificando formato de código..."
dart format --set-exit-if-changed lib test
if ($LASTEXITCODE -ne 0) {
    Print-Warning "Aplicando formato..."
    dart format lib test
}

# =============================================================================
# TESTS
# =============================================================================

Print-Header "3. Ejecutando Tests"

Print-Info "Ejecutando tests unitarios..."
flutter test
if ($LASTEXITCODE -ne 0) {
    Print-Error "Tests fallaron"
    exit 1
}
Print-Success "Tests: PASSED"

# =============================================================================
# BUILD GENERATION
# =============================================================================

Print-Header "4. Generando Build Runners"

Print-Info "Generando código..."
flutter pub run build_runner build --delete-conflicting-outputs
Print-Success "Código generado"

# =============================================================================
# BUILD
# =============================================================================

Print-Header "5. Compilando Aplicación"

function Build-Android {
    Print-Info "Compilando para Android ($Mode)..."

    if ($Mode -eq 'release') {
        # APK
        Print-Info "Generando APK..."
        flutter build apk --release --split-per-abi
        if ($LASTEXITCODE -ne 0) {
            Print-Error "Error al generar APK"
            exit 1
        }
        Print-Success "APK generado en: build\app\outputs\flutter-apk\"

        # AAB
        Print-Info "Generando AAB..."
        flutter build appbundle --release
        if ($LASTEXITCODE -ne 0) {
            Print-Error "Error al generar AAB"
            exit 1
        }
        Print-Success "AAB generado en: build\app\outputs\bundle\release\"
    }
    else {
        flutter build apk --debug
        Print-Success "APK debug generado"
    }
}

function Build-iOS {
    Print-Warning "Build para iOS requiere macOS con Xcode"
    Print-Info "Compilando para iOS ($Mode)..."

    if ($Mode -eq 'release') {
        flutter build ios --release --no-codesign
    }
    else {
        flutter build ios --debug --no-codesign
    }

    if ($LASTEXITCODE -ne 0) {
        Print-Error "Error al compilar iOS"
        exit 1
    }
    Print-Success "Build iOS generado"
}

switch ($Platform) {
    'android' { Build-Android }
    'ios' { Build-iOS }
    'all' {
        Build-Android
        Build-iOS
    }
}

# =============================================================================
# POST-BUILD
# =============================================================================

Print-Header "6. Post-Build"

if ($Platform -eq 'android' -or $Platform -eq 'all') {
    Print-Info "APKs generados:"
    Get-ChildItem -Path "build\app\outputs\flutter-apk\*.apk" -ErrorAction SilentlyContinue |
        ForEach-Object {
            $size = [math]::Round($_.Length / 1MB, 2)
            Write-Host "  $($_.Name): $size MB"
        }
}

Print-Success "Build completado exitosamente!"
Write-Host "`nPara instalar en dispositivo:"
Write-Host "  flutter install" -ForegroundColor Cyan
