#!/bin/bash
# GMP App Mobilidad v4.0.0 - Setup & Deploy Script
# Usage: ./scripts/deploy.sh
# 
# 3 commands to get production running:
#   1. cp backend/.env.example backend/.env  &&  # Edit with real values
#   2. make setup
#   3. make start

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  GMP App Mobilidad v4.0.0 — Production Setup            ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"

# ─── Step 1: Check .env ─────────────────────────────────────────
if [ ! -f backend/.env ]; then
    echo -e "${YELLOW}⚠️  backend/.env not found. Creating from example...${NC}"
    cp backend/.env.example backend/.env
    echo -e "${RED}❗ Edit backend/.env with your real values before continuing${NC}"
    echo -e "${RED}   Especially: JWT_SECRET, JWT_REFRESH_SECRET, ODBC_DSN${NC}"
    exit 1
fi

# ─── Step 2: Validate .env (critical vars) ─────────────────────
echo -e "${GREEN}✅ Validating configuration...${NC}"

JWT_SECRET=$(grep '^JWT_SECRET=' backend/.env | cut -d'=' -f2)
JWT_REFRESH_SECRET=$(grep '^JWT_REFRESH_SECRET=' backend/.env | cut -d'=' -f2)

if [ ${#JWT_SECRET} -lt 32 ]; then
    echo -e "${RED}❌ JWT_SECRET must be at least 32 characters${NC}"
    exit 1
fi

if [ ${#JWT_REFRESH_SECRET} -lt 32 ]; then
    echo -e "${RED}❌ JWT_REFRESH_SECRET must be at least 32 characters${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Configuration valid${NC}"

# ─── Step 3: Backend ────────────────────────────────────────────
echo -e "${GREEN}📦 Installing backend dependencies...${NC}"
cd backend
npm ci --production
npm run build
cd ..

# ─── Step 4: Flutter ────────────────────────────────────────────
echo -e "${GREEN}📦 Installing Flutter dependencies...${NC}"
flutter pub get
dart run build_runner build --delete-conflicting-outputs

# ─── Step 5: Docker ─────────────────────────────────────────────
echo -e "${GREEN}🐳 Starting Docker containers...${NC}"
docker compose up -d

# ─── Step 6: Health Check ───────────────────────────────────────
echo -e "${GREEN}⏳ Waiting for services to be ready...${NC}"
sleep 10

HEALTH=$(curl -s http://localhost:3334/api/health || echo '{"status":"error"}')
STATUS=$(echo "$HEALTH" | grep -o '"status":"[^"]*"' | head -1)

if echo "$STATUS" | grep -q "healthy\|ok"; then
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  ✅ GMP App Mobilidad v4.0.0 is RUNNING                  ║${NC}"
    echo -e "${GREEN}║  Backend: http://localhost:3334                          ║${NC}"
    echo -e "${GREEN}║  Health:  http://localhost:3334/api/health               ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
else
    echo -e "${RED}❌ Health check failed. Check logs: docker compose logs backend${NC}"
    exit 1
fi
