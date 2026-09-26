#!/bin/bash
# tools/rollback.sh - rollback seguro rama test.
# Flujo permitido UNICAMENTE: volver al SHA anterior (git) + pm2 restart gmp-api.
# No edita ficheros de entorno. No usa otro comando pm2.
# Uso: bash backend/scripts/tools/rollback.sh [--yes]
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
ROOT_DIR="$(cd "$BACKEND_DIR/.." && pwd)"

AUTO_YES="false"
if [ "${1:-}" = "--yes" ]; then
    AUTO_YES="true"
fi

cd "$ROOT_DIR"

CURRENT_SHA="$(git rev-parse --short HEAD)"
PREVIOUS_SHA="$(git rev-parse --short HEAD~1)"

echo "==============================================================="
echo " GMP APP - ROLLBACK al SHA anterior"
echo "==============================================================="
echo ""
echo "Actual:   $CURRENT_SHA"
echo "Destino:  $PREVIOUS_SHA"
echo ""
git log --oneline -2
echo ""

BACKUP_BRANCH="backup/pre-rollback-$CURRENT_SHA"
if git show-ref --verify --quiet "refs/heads/$BACKUP_BRANCH"; then
    echo "Backup ya existe: $BACKUP_BRANCH"
else
    git branch "$BACKUP_BRANCH" "$CURRENT_SHA"
    echo "Backup creado: $BACKUP_BRANCH"
fi
echo ""

if [ "$AUTO_YES" != "true" ]; then
    printf "Volver a %s y reiniciar gmp-api? [y/N] " "$PREVIOUS_SHA"
    read -r response
    if [ "$response" != "y" ] && [ "$response" != "Y" ]; then
        echo "Rollback cancelado."
        exit 1
    fi
fi

echo ""
echo "Volviendo a $PREVIOUS_SHA..."
git reset --hard "$PREVIOUS_SHA"
echo "Actual: $(git rev-parse --short HEAD)"

echo ""
echo "Reiniciando gmp-api..."
pm2 restart gmp-api

sleep 3
HEALTH_PORT="${PORT:-3335}"
HEALTH=$(curl -s -A "GMP-SRE-HealthCheck/1.0" -o /dev/null -w "%{http_code}" "http://localhost:${HEALTH_PORT}/api/ready" 2>/dev/null || echo "000")

if [ "$HEALTH" = "200" ]; then
    echo "Server is healthy after rollback."
else
    echo "Server returned HTTP $HEALTH - check logs"
    echo "   pm2 logs gmp-api --lines 20"
fi

echo ""
echo "==============================================================="
echo " ROLLBACK COMPLETE"
echo " SHA: $PREVIOUS_SHA"
echo " Backup: $BACKUP_BRANCH"
echo "==============================================================="
