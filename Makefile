# ============================================================================
# GMP App Mobilidad - Makefile
# Universal CLI alternative for Linux/macOS
# Usage: make [target]
# ============================================================================

.PHONY: start backend test analyze build clean lint fix docker-up docker-down migrate seed verify help

# Colors
BLUE := \033[0;34m
CYAN := \033[0;36m
GREEN := \033[0;32m
YELLOW := \033[1;33m
RED := \033[0;31m
NC := \033[0m

# Script paths
DEV_SCRIPT := ./scripts/dev.sh
VERIFY_SCRIPT := ./scripts/verify.ps1

# Default target
.DEFAULT_GOAL := help

# ============================================================================
# Core Commands
# ============================================================================

## Start Flutter app (pub get + analyze + run)
start:
	@printf "$(CYAN)╔══════════════════════════════════════════════════════════╗$(NC)\n"
	@printf "$(CYAN)║  $(BLUE)GMP App - Start Frontend$(NC)$(CYAN)                            ║$(NC)\n"
	@printf "$(CYAN)╚══════════════════════════════════════════════════════════╝$(NC)\n\n"
	@$(DEV_SCRIPT) start

## Start backend server (Node.js)
backend:
	@printf "$(CYAN)╔══════════════════════════════════════════════════════════╗$(NC)\n"
	@printf "$(CYAN)║  $(BLUE)GMP App - Start Backend$(NC)$(CYAN)                             ║$(NC)\n"
	@printf "$(CYAN)╚══════════════════════════════════════════════════════════╝$(NC)\n\n"
	@$(DEV_SCRIPT) backend

## Run all tests (Jest + Flutter)
test:
	@printf "$(CYAN)╔══════════════════════════════════════════════════════════╗$(NC)\n"
	@printf "$(CYAN)║  $(BLUE)GMP App - Run Tests$(NC)$(CYAN)                                 ║$(NC)\n"
	@printf "$(CYAN)╚══════════════════════════════════════════════════════════╝$(NC)\n\n"
	@$(DEV_SCRIPT) test

## Run static analysis (flutter analyze + backend lint)
analyze:
	@printf "$(CYAN)╔══════════════════════════════════════════════════════════╗$(NC)\n"
	@printf "$(CYAN)║  $(BLUE)GMP App - Static Analysis$(NC)$(CYAN)                           ║$(NC)\n"
	@printf "$(CYAN)╚══════════════════════════════════════════════════════════╝$(NC)\n\n"
	@$(DEV_SCRIPT) analyze

## Build release APK
build:
	@printf "$(CYAN)╔══════════════════════════════════════════════════════════╗$(NC)\n"
	@printf "$(CYAN)║  $(BLUE)GMP App - Build Release APK$(NC)$(CYAN)                         ║$(NC)\n"
	@printf "$(CYAN)╚══════════════════════════════════════════════════════════╝$(NC)\n\n"
	@$(DEV_SCRIPT) build

# ============================================================================
# New Commands
# ============================================================================

## Run lint only (flutter analyze + backend lint, no tests)
lint:
	@printf "$(CYAN)╔══════════════════════════════════════════════════════════╗$(NC)\n"
	@printf "$(CYAN)║  $(BLUE)GMP App - Lint$(NC)$(CYAN)                                      ║$(NC)\n"
	@printf "$(CYAN)╚══════════════════════════════════════════════════════════╝$(NC)\n\n"
	@$(DEV_SCRIPT) lint

## Auto-fix common Dart issues (dart fix + pub get)
fix:
	@printf "$(CYAN)╔══════════════════════════════════════════════════════════╗$(NC)\n"
	@printf "$(CYAN)║  $(BLUE)GMP App - Auto-Fix Dart$(NC)$(CYAN)                             ║$(NC)\n"
	@printf "$(CYAN)╚══════════════════════════════════════════════════════════╝$(NC)\n\n"
	@$(DEV_SCRIPT) fix

## Start Docker development environment
docker-up:
	@printf "$(CYAN)╔══════════════════════════════════════════════════════════╗$(NC)\n"
	@printf "$(CYAN)║  $(BLUE)GMP App - Docker Up$(NC)$(CYAN)                                 ║$(NC)\n"
	@printf "$(CYAN)╚══════════════════════════════════════════════════════════╝$(NC)\n\n"
	@docker compose up -d
	@printf "\n$(GREEN)✅ Docker services started$(NC)\n"
	@printf "$(YELLOW)  Backend: http://localhost:3334$(NC)\n"
	@printf "$(YELLOW)  Redis:   localhost:6379$(NC)\n"
	@printf "$(YELLOW)  Note: DB2 requires external connection$(NC)\n"

## Stop Docker development environment
docker-down:
	@printf "$(CYAN)╔══════════════════════════════════════════════════════════╗$(NC)\n"
	@printf "$(CYAN)║  $(BLUE)GMP App - Docker Down$(NC)$(CYAN)                               ║$(NC)\n"
	@printf "$(CYAN)╚══════════════════════════════════════════════════════════╝$(NC)\n\n"
	@docker compose down
	@printf "\n$(GREEN)✅ Docker services stopped$(NC)\n"

## Run database migrations
migrate:
	@printf "$(CYAN)╔══════════════════════════════════════════════════════════╗$(NC)\n"
	@printf "$(CYAN)║  $(BLUE)GMP App - Database Migration$(NC)$(CYAN)                        ║$(NC)\n"
	@printf "$(CYAN)╚══════════════════════════════════════════════════════════╝$(NC)\n\n"
	@$(DEV_SCRIPT) migrate

## Seed database with test data
seed:
	@printf "$(CYAN)╔══════════════════════════════════════════════════════════╗$(NC)\n"
	@printf "$(CYAN)║  $(BLUE)GMP App - Database Seed$(NC)$(CYAN)                             ║$(NC)\n"
	@printf "$(CYAN)╚══════════════════════════════════════════════════════════╝$(NC)\n\n"
	@$(DEV_SCRIPT) seed

# ============================================================================
# Maintenance
# ============================================================================

## Clean build artifacts and node_modules
clean:
	@printf "$(CYAN)╔══════════════════════════════════════════════════════════╗$(NC)\n"
	@printf "$(CYAN)║  $(BLUE)GMP App - Clean$(NC)$(CYAN)                                     ║$(NC)\n"
	@printf "$(CYAN)╚══════════════════════════════════════════════════════════╝$(NC)\n\n"
	@$(DEV_SCRIPT) clean

## Run quality gate verification
verify:
	@printf "$(CYAN)╔══════════════════════════════════════════════════════════╗$(NC)\n"
	@printf "$(CYAN)║  $(BLUE)GMP App - Quality Verification$(NC)$(CYAN)                      ║$(NC)\n"
	@printf "$(CYAN)╚══════════════════════════════════════════════════════════╝$(NC)\n\n"
	@pwsh -File $(VERIFY_SCRIPT)

# ============================================================================
# Help
# ============================================================================

## Show this help message
help:
	@printf "\n"
	@printf "$(CYAN)╔══════════════════════════════════════════════════════════╗$(NC)\n"
	@printf "$(CYAN)║  $(BLUE)GMP App Mobilidad - Makefile$(NC)$(CYAN)                        ║$(NC)\n"
	@printf "$(CYAN)╚══════════════════════════════════════════════════════════╝$(NC)\n"
	@printf "\n"
	@printf "$(GREEN)Usage:$(NC) make [target]\n\n"
	@printf "$(GREEN)Core Commands:$(NC)\n"
	@printf "  $(YELLOW)start$(NC)        Start Flutter app (pub get + analyze + run)\n"
	@printf "  $(YELLOW)backend$(NC)      Start backend server (Node.js)\n"
	@printf "  $(YELLOW)test$(NC)         Run all tests (Jest + Flutter)\n"
	@printf "  $(YELLOW)analyze$(NC)      Run static analysis (flutter analyze + backend lint)\n"
	@printf "  $(YELLOW)build$(NC)        Build release APK\n"
	@printf "\n"
	@printf "$(GREEN)New Commands:$(NC)\n"
	@printf "  $(YELLOW)lint$(NC)         Run lint only (no tests)\n"
	@printf "  $(YELLOW)fix$(NC)          Auto-fix common Dart issues\n"
	@printf "  $(YELLOW)docker-up$(NC)    Start Docker development environment\n"
	@printf "  $(YELLOW)docker-down$(NC)  Stop Docker development environment\n"
	@printf "  $(YELLOW)migrate$(NC)      Run database migrations\n"
	@printf "  $(YELLOW)seed$(NC)         Seed database with test data\n"
	@printf "\n"
	@printf "$(GREEN)Maintenance:$(NC)\n"
	@printf "  $(YELLOW)clean$(NC)        Clean build artifacts and node_modules\n"
	@printf "  $(YELLOW)verify$(NC)       Run quality gate verification\n"
	@printf "  $(YELLOW)help$(NC)         Show this help message\n"
	@printf "\n"
