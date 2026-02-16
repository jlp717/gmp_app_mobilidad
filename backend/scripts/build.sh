#!/bin/bash
# =============================================================================
# GMP APP - BUILD SCRIPT
# Compiles TypeScript src/ → dist/ and prepares for deployment
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

cd "$BACKEND_DIR"

echo "╔══════════════════════════════════════════════╗"
echo "║    GMP APP - TypeScript Build                ║"
echo "╚══════════════════════════════════════════════╝"

# 1. Clean previous build
echo "🧹 Cleaning dist/ ..."
rm -rf dist

# 2. Run lint checks (optional, skip with --no-lint)
if [[ "$1" != "--no-lint" ]]; then
    echo "🔍 Running lint checks..."
    npx tsc --noEmit || {
        echo "❌ TypeScript errors found. Fix before building."
        exit 1
    }
    echo "✅ Lint passed"
fi

# 3. Compile TypeScript
echo "🔨 Compiling TypeScript..."
npx tsc

# 4. Copy non-TS assets if needed
if [ -d "src/templates" ]; then
    echo "📁 Copying templates..."
    cp -r src/templates dist/templates
fi

# 5. Verify output
if [ -f "dist/index.js" ]; then
    echo "✅ Build successful!"
    echo "   Output: dist/"
    echo "   Entry:  dist/index.js"
    FILE_COUNT=$(find dist -name '*.js' | wc -l)
    echo "   Files:  $FILE_COUNT JS files"
else
    echo "❌ Build failed - dist/index.js not found"
    exit 1
fi

echo ""
echo "To start with TS routes:"
echo "  USE_TS_ROUTES=true node server.js"
echo "  # or"
echo "  USE_TS_ROUTES=true pm2 start ecosystem.config.js --env production"
