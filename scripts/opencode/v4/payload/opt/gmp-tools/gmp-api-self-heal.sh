#!/bin/bash
set -euo pipefail

APP_NAME="${GMP_API_PM2_APP:-gmp-api}"
BACKEND_DIR="${GMP_API_BACKEND_DIR:-/opt/gmp-api/backend}"
PORT="${GMP_API_PORT:-3335}"
READY_URL="${GMP_API_READY_URL:-http://localhost:${PORT}/api/ready}"
USER_AGENT="${GMP_API_HEALTH_UA:-GMP-SRE-HealthCheck/1.0}"
LOG_DIR="${GMP_SELF_HEAL_LOG_DIR:-/opt/gmp-tools/logs}"
LOCK_FILE="${GMP_SELF_HEAL_LOCK_FILE:-/tmp/gmp-api-self-heal.lock}"
READY_ATTEMPTS="${GMP_SELF_HEAL_READY_ATTEMPTS:-30}"
READY_SLEEP_SECONDS="${GMP_SELF_HEAL_READY_SLEEP_SECONDS:-5}"
RELOAD_ATTEMPTS="${GMP_SELF_HEAL_RELOAD_ATTEMPTS:-12}"

mkdir -p "$LOG_DIR" 2>/dev/null || LOG_DIR="/tmp"
LOG_FILE="${LOG_DIR}/gmp-api-self-heal-$(date +%Y%m%d).log"
IDEMPOTENCY_KEY="gmp-api-self-heal-$(date -u +%Y%m%dT%H%M%SZ)"

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*" | tee -a "$LOG_FILE"
}

ready() {
  curl -sf -A "$USER_AGENT" "$READY_URL" >/dev/null 2>&1
}

pm2_count() {
  python3 - "$APP_NAME" <<'PY' 2>/dev/null || printf '0 0 0'
import json, subprocess, sys
name = sys.argv[1]
try:
    data = json.loads(subprocess.check_output(["pm2", "jlist"], text=True))
except Exception:
    print("0 0 0")
    raise SystemExit(0)
apps = [p for p in data if p.get("name") == name]
live = [
    p for p in apps
    if p.get("pm2_env", {}).get("status") == "online" and int(p.get("pid") or 0) > 0
]
ghost = [p for p in apps if int(p.get("pid") or 0) <= 0]
print(len(apps), len(live), len(ghost))
PY
}

wait_ready() {
  local attempts="${1:-$READY_ATTEMPTS}"
  local sleep_seconds="${2:-$READY_SLEEP_SECONDS}"
  local i
  for i in $(seq 1 "$attempts"); do
    if ready; then
      log "ready=true after_seconds=$((i * sleep_seconds))"
      return 0
    fi
    sleep "$sleep_seconds"
  done
  return 1
}

start_clean() {
  log "action=start_clean app=${APP_NAME}"
  cd "$BACKEND_DIR"
  unset PM2_CRON_RESTART
  PM2_INSTANCES="${PM2_INSTANCES:-8}" \
  PM2_EXEC_MODE="${PM2_EXEC_MODE:-cluster}" \
    pm2 start ecosystem.config.js --only "$APP_NAME" --env production --update-env
}

reload_existing() {
  log "action=reload_existing app=${APP_NAME}"
  cd "$BACKEND_DIR"
  unset PM2_CRON_RESTART
  pm2 reload "$APP_NAME" --update-env
}

save_if_ready() {
  if ready; then
    pm2 save
    log "pm2_saved=true"
    return 0
  fi
  log "pm2_saved=false reason=readiness_failed"
  return 1
}

recover() {
  local total live ghost
  read -r total live ghost <<<"$(pm2_count)"

  log "idempotency_key=${IDEMPOTENCY_KEY} ready=false total=${total} live=${live} ghost=${ghost}"
  pm2 status "$APP_NAME" --no-color 2>&1 | tee -a "$LOG_FILE" || true

  if [ "$live" -gt 0 ]; then
    if reload_existing && wait_ready "$RELOAD_ATTEMPTS" "$READY_SLEEP_SECONDS"; then
      save_if_ready
      return 0
    fi
    log "reload_recovery_failed=true escalating=start_clean"
  fi

  pm2 delete "$APP_NAME" 2>&1 | tee -a "$LOG_FILE" || true
  start_clean 2>&1 | tee -a "$LOG_FILE"

  if wait_ready "$READY_ATTEMPTS" "$READY_SLEEP_SECONDS"; then
    save_if_ready
    pm2 status "$APP_NAME" --no-color 2>&1 | tee -a "$LOG_FILE" || true
    return 0
  fi

  log "recovery_failed=true showing_recent_logs"
  pm2 logs "$APP_NAME" --lines 120 --nostream 2>&1 | tee -a "$LOG_FILE" || true
  return 1
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "skip=lock_held"
  exit 0
fi

if ready; then
  read -r total live ghost <<<"$(pm2_count)"
  if [ "$live" -gt 0 ]; then
    log "ready=true total=${total} live=${live} ghost=${ghost}"
    exit 0
  fi
  log "ready=true_but_pm2_not_live total=${total} live=${live} ghost=${ghost}"
fi

recover
