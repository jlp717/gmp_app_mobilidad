#!/usr/bin/env bash
# GMP APT certification deploy — run on 192.168.1.230 as gmp user
set -euo pipefail

API_ROOT="${API_ROOT:-/opt/gmp-api}"
BRANCH="${BRANCH:-main}"

echo "==> Deploy cert APT to ${API_ROOT}"
cd "${API_ROOT}"
git fetch origin
git checkout "${BRANCH}"
git pull --rebase origin "${BRANCH}"

cd backend
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Enable DSEDAC export (idempotent)
ENV_FILE="${API_ROOT}/backend/.env"
touch "${ENV_FILE}"
for kv in \
  "PEDIDOS_EXPORT_TO_SYSTEM=true" \
  "PEDIDOS_DSEDAC_EXPORT_APPROVED=true" \
  "PEDIDOS_DSEDAC_STORAGE_APPROVED=true"; do
  key="${kv%%=*}"
  if grep -q "^${key}=" "${ENV_FILE}" 2>/dev/null; then
    sed -i "s/^${key}=.*/${kv}/" "${ENV_FILE}"
  else
    echo "${kv}" >> "${ENV_FILE}"
  fi
done

echo "==> Schema alignment (JAVIER <- DSEDAC)"
node scripts/execute-javier-dsedac-alignment.js || true

echo "==> PM2 restart"
cd "${API_ROOT}"
pm2 restart gmp-api --update-env || pm2 restart all --update-env
sleep 5

echo "==> Jest (cobros + pedidos idempotency)"
cd backend && npx jest __tests__/cobros-commercial.test.js __tests__/pedidos_idempotency.test.js --forceExit 2>&1 | tail -30

echo "==> Certification matrix"
node scripts/cert-matrix-audit.js
echo "==> Done"
