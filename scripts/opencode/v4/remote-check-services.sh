#!/bin/bash
set -euo pipefail

echo "== services =="
for unit in chromadb gmp-elevenlabs-bridge gmp-daily-digest.timer gmp-rag-indexer.timer docker redis-server; do
  state="$(systemctl is-active "$unit" 2>/dev/null || true)"
  echo "$unit:$state"
done
user_bridge_state="$(systemctl --user is-active gmp-elevenlabs-bridge.service 2>/dev/null || true)"
echo "gmp-elevenlabs-bridge.user:${user_bridge_state}"

echo "== endpoints =="
python3 -c 'import chromadb; chromadb.HttpClient(host="localhost", port=8000).list_collections()' >/dev/null && echo "chromadb:ok" || echo "chromadb:fail"
curl -sf http://localhost:8765/health || true
curl -sf -A GMP-SRE-HealthCheck/1.0 http://localhost:3335/api/health >/dev/null && echo "gmp-api:ok" || echo "gmp-api:fail"
redis-cli ping 2>/dev/null || true

echo "== docker =="
docker version --format 'server={{.Server.Version}}' 2>/dev/null || true
docker ps --filter label=gmp-staging --format '{{.Names}}' 2>/dev/null || true

echo "== env presence =="
python3 - <<'PY'
from pathlib import Path

env = {}
for line in Path("/opt/gmp-tools/.env").read_text(errors="ignore").splitlines():
    if not line or line.lstrip().startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    env[key.strip()] = value.strip().strip('"').strip("'")

for key in [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "GITHUB_TOKEN",
    "CHROMADB_URL",
    "REDIS_HOST",
    "GITHUB_OWNER",
    "GMP_REPO",
    "GRANJA_REPO",
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_VOICE_ID",
    "GMP_PRODUCTION_PORT",
    "GMP_HEALTH_URL",
    "GMP_HEALTH_USER_AGENT",
]:
    print(f"{key}:{'OK' if env.get(key) else 'MISSING'}")
PY
