#!/bin/bash
# GMP App - Development CLI (Bash/Linux/macOS)
# Usage: ./scripts/dev.sh [command]

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

header() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  $1${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

start_frontend() {
    header "GMP App - Frontend (Flutter)"
    cd "$ROOT_DIR"

    echo -e "${YELLOW}[1/3] Running flutter pub get...${NC}"
    flutter pub get

    echo -e "${YELLOW}[2/3] Running flutter analyze...${NC}"
    flutter analyze || {
        echo -e "${YELLOW}⚠️  Analysis warnings found. Continue anyway? (y/n)${NC}"
        read -r response
        if [[ "$response" != "y" ]]; then exit 1; fi
    }

    echo -e "${GREEN}[3/3] Starting Flutter app...${NC}"
    flutter run
}

start_backend() {
    header "GMP App - Backend (Node.js)"
    cd "$ROOT_DIR/backend"

    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install --production

    echo -e "${GREEN}Starting backend server...${NC}"
    node server.js
}

run_tests() {
    header "GMP App - Test Suite"
    cd "$ROOT_DIR/backend"

    echo -e "${YELLOW}[1/2] Running backend tests (Jest)...${NC}"
    npx jest --passWithNoTests
    backend_ok=$?

    cd "$ROOT_DIR"
    echo -e "${YELLOW}[2/2] Running Flutter tests...${NC}"
    flutter test --no-pub
    flutter_ok=$?

    echo ""
    if [[ $backend_ok -eq 0 && $flutter_ok -eq 0 ]]; then
        echo -e "${GREEN}✅ ALL TESTS PASSED${NC}"
    else
        echo -e "${RED}❌ SOME TESTS FAILED${NC}"
        [[ $backend_ok -ne 0 ]] && echo -e "${RED}   - Backend tests failed${NC}"
        [[ $flutter_ok -ne 0 ]] && echo -e "${RED}   - Flutter tests failed${NC}"
        exit 1
    fi
}

run_analyze() {
    header "GMP App - Static Analysis"
    cd "$ROOT_DIR"

    echo -e "${YELLOW}[1/2] Flutter analyze...${NC}"
    flutter analyze
    flutter_ok=$?

    cd "$ROOT_DIR/backend"
    echo -e "${YELLOW}[2/2] Backend lint...${NC}"
    if npm run lint 2>/dev/null; then
        :
    else
        echo -e "${GRAY}  No lint script found, skipping.${NC}"
    fi

    if [[ $flutter_ok -eq 0 ]]; then
        echo -e "\n${GREEN}✅ Analysis complete${NC}"
    else
        echo -e "\n${RED}❌ Analysis found issues${NC}"
        exit 1
    fi
}

build_release() {
    header "GMP App - Build Release APK"
    cd "$ROOT_DIR"

    echo -e "${YELLOW}Running flutter pub get...${NC}"
    flutter pub get

    echo -e "${GREEN}Building release APK...${NC}"
    flutter build apk --release

    if [[ $? -eq 0 ]]; then
        APK_PATH="$ROOT_DIR/build/app/outputs/flutter-apk/app-release.apk"
        echo -e "\n${GREEN}✅ APK built: $APK_PATH${NC}"
        if [[ -f "$APK_PATH" ]]; then
            SIZE=$(du -h "$APK_PATH" | cut -f1)
            echo -e "   Size: $SIZE"
        fi
    fi
}

check_health() {
    header "GMP App - Health Check"

    echo -e "${YELLOW}Checking backend API...${NC}"
    if response=$(curl -s --max-time 5 http://localhost:3334/api/health 2>/dev/null); then
        status=$(echo "$response" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
        echo -e "  Backend: ${GREEN}✅ $status${NC}"
    else
        echo -e "  Backend: ${RED}❌ Not reachable (port 3334)${NC}"
    fi
}

clean_project() {
    header "GMP App - Clean Build Artifacts"
    cd "$ROOT_DIR"

    echo -e "${YELLOW}Cleaning Flutter build...${NC}"
    flutter clean

    echo -e "${YELLOW}Cleaning backend node_modules...${NC}"
    rm -rf "$ROOT_DIR/backend/node_modules"

    echo -e "${GREEN}✅ Clean complete${NC}"
}

show_help() {
    header "GMP App - Development CLI"
    echo "Usage: ./scripts/dev.sh <command>"
    echo ""
    echo -e "${CYAN}Commands:${NC}"
    echo "  start     - Start Flutter app (pub get + analyze + run)"
    echo "  backend   - Start backend server (npm install + node server.js)"
    echo "  test      - Run all tests (Jest + Flutter)"
    echo "  analyze   - Run static analysis (flutter analyze + backend lint)"
    echo "  build     - Build release APK"
    echo "  health    - Check backend health endpoint"
    echo "  clean     - Clean build artifacts and node_modules"
    echo "  help      - Show this help message"
    echo ""
}

case "${1:-help}" in
    start)   start_frontend ;;
    backend) start_backend ;;
    test)    run_tests ;;
    analyze) run_analyze ;;
    build)   build_release ;;
    health)  check_health ;;
    clean)   clean_project ;;
    help)    show_help ;;
    *)       show_help ;;
esac
