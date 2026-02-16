#!/bin/bash
# =============================================================================
# GMP APP - ROLLBACK SCRIPT
# Reverts from TypeScript routes to legacy JavaScript routes
# 
# Usage: ./scripts/rollback.sh [--force]
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

cd "$BACKEND_DIR"

echo "╔══════════════════════════════════════════════╗"
echo "║    GMP APP - ROLLBACK to Legacy JS           ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Check if already on legacy
CURRENT_MODE="${USE_TS_ROUTES:-false}"
echo "Current mode: USE_TS_ROUTES=$CURRENT_MODE"

if [ "$CURRENT_MODE" = "false" ] && [ "$1" != "--force" ]; then
    echo "✅ Already running legacy JS routes. Nothing to rollback."
    echo "   Use --force to restart PM2 anyway."
    exit 0
fi

echo ""
echo "⚠️  Rolling back to legacy JavaScript routes..."
echo ""

# 1. Set env var to disable TS routes
export USE_TS_ROUTES=false

# 2. Update .env if it exists
if [ -f ".env" ]; then
    if grep -q "USE_TS_ROUTES" .env; then
        sed -i 's/USE_TS_ROUTES=true/USE_TS_ROUTES=false/' .env
        echo "✅ Updated .env: USE_TS_ROUTES=false"
    else
        echo "USE_TS_ROUTES=false" >> .env
        echo "✅ Added USE_TS_ROUTES=false to .env"
    fi
fi

# 3. Check if PM2 is running
if command -v pm2 &> /dev/null; then
    PM2_STATUS=$(pm2 list 2>/dev/null | grep "gmp-api" || echo "")
    
    if [ -n "$PM2_STATUS" ]; then
        echo "🔄 Restarting PM2 with legacy routes..."
        pm2 restart gmp-api --update-env
        echo "✅ PM2 restarted with USE_TS_ROUTES=false"
        
        # Wait and check health
        sleep 3
        HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3334/api/health 2>/dev/null || echo "000")
        
        if [ "$HEALTH" = "200" ]; then
            echo "✅ Server is healthy after rollback!"
        else
            echo "⚠️  Server returned HTTP $HEALTH - check logs"
            echo "   pm2 logs gmp-api --lines 20"
        fi
    else
        echo "ℹ️  PM2 not running gmp-api. Starting with legacy routes..."
        USE_TS_ROUTES=false pm2 start ecosystem.config.js
    fi
else
    echo "ℹ️  PM2 not installed. To start manually:"
    echo "   USE_TS_ROUTES=false node server.js"
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║    ROLLBACK COMPLETE                         ║"
echo "║    Mode: Legacy JavaScript Routes            ║"
echo "╚══════════════════════════════════════════════╝"
