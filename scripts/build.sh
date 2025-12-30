#!/bin/bash

# =============================================================================
# SCRIPT DE BUILD AUTOMATIZADO - GMP APP MOVILIDAD
# =============================================================================
#
# USO:
#   ./scripts/build.sh [PLATAFORMA] [MODO]
#
# PLATAFORMAS:
#   android - Build para Android (APK + AAB)
#   ios - Build para iOS
#   all - Build para todas las plataformas
#
# MODOS:
#   debug - Build de desarrollo
#   release - Build de producción
#
# EJEMPLOS:
#   ./scripts/build.sh android release
#   ./scripts/build.sh ios debug
#   ./scripts/build.sh all release

set -e  # Exit on error

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Funciones helper
print_header() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Validar parámetros
PLATFORM=${1:-android}
MODE=${2:-release}

print_header "GMP APP MOVILIDAD - BUILD SCRIPT"
print_info "Plataforma: $PLATFORM"
print_info "Modo: $MODE"
echo ""

# =============================================================================
# PRE-BUILD CHECKS
# =============================================================================

print_header "1. Verificaciones Pre-Build"

# Verificar Flutter instalado
if ! command -v flutter &> /dev/null; then
    print_error "Flutter no está instalado"
    exit 1
fi
print_success "Flutter instalado: $(flutter --version | head -n 1)"

# Verificar dependencias
print_info "Obteniendo dependencias..."
flutter pub get
print_success "Dependencias actualizadas"

# =============================================================================
# CODE QUALITY CHECKS
# =============================================================================

print_header "2. Verificaciones de Calidad"

# Análisis estático
print_info "Ejecutando análisis estático..."
if flutter analyze; then
    print_success "Análisis estático: OK"
else
    print_error "Análisis estático falló"
    exit 1
fi

# Formateo de código
print_info "Verificando formato de código..."
if dart format --set-exit-if-changed lib test; then
    print_success "Formato de código: OK"
else
    print_warning "Algunos archivos necesitan formateo. Ejecutando dart format..."
    dart format lib test
fi

# =============================================================================
# TESTS
# =============================================================================

print_header "3. Ejecutando Tests"

print_info "Ejecutando tests unitarios..."
if flutter test; then
    print_success "Tests: PASSED"
else
    print_error "Tests fallaron"
    exit 1
fi

# =============================================================================
# BUILD GENERATION
# =============================================================================

print_header "4. Generando Build Runners"

print_info "Generando código con build_runner..."
flutter pub run build_runner build --delete-conflicting-outputs
print_success "Código generado"

# =============================================================================
# BUILD
# =============================================================================

print_header "5. Compilando Aplicación"

build_android() {
    print_info "Compilando para Android ($MODE)..."

    if [ "$MODE" = "release" ]; then
        # Build APK
        print_info "Generando APK..."
        flutter build apk --release --split-per-abi
        print_success "APK generado en: build/app/outputs/flutter-apk/"

        # Build AAB (para Google Play)
        print_info "Generando AAB..."
        flutter build appbundle --release
        print_success "AAB generado en: build/app/outputs/bundle/release/"
    else
        flutter build apk --debug
        print_success "APK debug generado"
    fi
}

build_ios() {
    print_info "Compilando para iOS ($MODE)..."

    if [ "$MODE" = "release" ]; then
        flutter build ios --release --no-codesign
        print_success "Build iOS generado"
    else
        flutter build ios --debug --no-codesign
        print_success "Build iOS debug generado"
    fi
}

case $PLATFORM in
    android)
        build_android
        ;;
    ios)
        build_ios
        ;;
    all)
        build_android
        build_ios
        ;;
    *)
        print_error "Plataforma desconocida: $PLATFORM"
        print_info "Usar: android, ios, o all"
        exit 1
        ;;
esac

# =============================================================================
# POST-BUILD
# =============================================================================

print_header "6. Post-Build"

# Tamaño de los binarios
if [ "$PLATFORM" = "android" ] || [ "$PLATFORM" = "all" ]; then
    print_info "Tamaños de APKs generados:"
    ls -lh build/app/outputs/flutter-apk/*.apk 2>/dev/null || true
fi

print_success "Build completado exitosamente!"
echo ""
print_info "Para instalar en dispositivo:"
if [ "$PLATFORM" = "android" ] || [ "$PLATFORM" = "all" ]; then
    echo "  Android: flutter install"
fi
if [ "$PLATFORM" = "ios" ] || [ "$PLATFORM" = "all" ]; then
    echo "  iOS: Abrir build/ios/Runner.xcworkspace en Xcode"
fi
