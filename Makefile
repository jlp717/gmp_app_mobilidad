# GMP App Mobilidad v4.0.0 — Makefile
# 
# Quick commands for development and production

.PHONY: help setup start stop restart logs test build clean flutter-pub build-runner

# ─── Help ────────────────────────────────────────────────────────
help:
	@echo "╔══════════════════════════════════════════════════════╗"
	@echo "║  GMP App Mobilidad v4.0.0 — Make Commands           ║"
	@echo "╠══════════════════════════════════════════════════════╣"
	@echo "║  make setup       - Install deps + build everything  ║"
	@echo "║  make start       - Start Docker containers          ║"
	@echo "║  make stop        - Stop Docker containers           ║"
	@echo "║  make restart     - Restart Docker containers        ║"
	@echo "║  make logs        - View backend logs                ║"
	@echo "║  make test        - Run all tests                    ║"
	@echo "║  make build       - Build backend + Flutter           ║"
	@echo "║  make clean       - Clean build artifacts            ║"
	@echo "║  make flutter-pub - flutter pub get                  ║"
	@echo "║  make build-runner- Run build_runner                  ║"
	@echo "║  make health      - Check backend health             ║"
	@echo "╚══════════════════════════════════════════════════════╝"

# ─── Setup (first time) ─────────────────────────────────────────
setup:
	@echo "📦 Installing backend dependencies..."
	cd backend && npm ci
	@echo "📦 Installing Flutter dependencies..."
	flutter pub get
	@echo "🔨 Running build_runner..."
	dart run build_runner build --delete-conflicting-outputs
	@echo "✅ Setup complete"

# ─── Start ──────────────────────────────────────────────────────
start:
	@echo "🐳 Starting Docker containers..."
	docker compose up -d
	@echo "⏳ Waiting for services..."
	@sleep 5
	@curl -s http://localhost:3334/api/health | jq . || echo "Health check pending..."

# ─── Stop ───────────────────────────────────────────────────────
stop:
	@echo "🛑 Stopping Docker containers..."
	docker compose down

# ─── Restart ────────────────────────────────────────────────────
restart: stop start

# ─── Logs ───────────────────────────────────────────────────────
logs:
	docker compose logs -f backend

# ─── Logs Redis ─────────────────────────────────────────────────
logs-redis:
	docker compose logs -f redis

# ─── Health Check ───────────────────────────────────────────────
health:
	@curl -s http://localhost:3334/api/health | jq .

# ─── Test ───────────────────────────────────────────────────────
test:
	@echo "🧪 Running backend tests..."
	cd backend && npm test
	@echo "🧪 Running Flutter tests..."
	flutter test

# ─── Build ──────────────────────────────────────────────────────
build:
	@echo "🔨 Building backend..."
	cd backend && npm run build
	@echo "🔨 Building Flutter APK..."
	flutter build apk --release

# ─── Clean ──────────────────────────────────────────────────────
clean:
	@echo "🧹 Cleaning build artifacts..."
	cd backend && rm -rf dist
	rm -rf build/
	flutter clean
	docker compose down -v

# ─── Flutter pub get ────────────────────────────────────────────
flutter-pub:
	flutter pub get

# ─── Build runner (code generation) ─────────────────────────────
build-runner:
	dart run build_runner build --delete-conflicting-outputs

# ─── Docker rebuild ─────────────────────────────────────────────
docker-rebuild:
	docker compose down
	docker compose build --no-cache
	docker compose up -d

# ─── Pre-commit check ───────────────────────────────────────────
pre-commit:
	@echo "🔍 Running pre-commit checks..."
	cd backend && npx tsc --noEmit
	flutter analyze
	flutter test
