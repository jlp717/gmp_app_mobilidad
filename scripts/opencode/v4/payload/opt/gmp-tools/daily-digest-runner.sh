#!/bin/bash
set -euo pipefail

MANUAL="${1:-}"
if [ -f /opt/gmp-tools/.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /opt/gmp-tools/.env
  set +a
fi

LOG_DIR="${GMP_DIGEST_LOG_DIR:-/opt/gmp-tools/logs}"
mkdir -p "$LOG_DIR" 2>/dev/null || LOG_DIR="/tmp"
LOG_FILE="${LOG_DIR}/gmp-digest-$(date +%Y%m%d).log"
LATEST_FILE="${LOG_DIR}/gmp-digest-latest.txt"
PROM="${PROMETHEUS_URL:-http://localhost:9090/api/v1/query}"
API_PORT="${GMP_BACKEND_PORT:-3335}"

echo "[$(date -Is)] Iniciando Daily Digest ${MANUAL}" | tee -a "$LOG_FILE"

safe_value() {
  local value="${1:-}"
  local fallback="${2:-sin datos}"
  if [ -z "$value" ] || [ "$value" = "N/A" ] || [ "$value" = "null" ]; then
    printf "%s" "$fallback"
  else
    printf "%s" "$value"
  fi
}

query_prom() {
  local q="$1"
  local raw
  raw="$(curl -sf --get "$PROM" --data-urlencode "query=$q" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('data',{}).get('result',[]); print(r[0]['value'][1] if r else '')" 2>/dev/null || true)"
  safe_value "$raw" "sin datos Prometheus"
}

format_percent() {
  local raw="$1"
  python3 - "$raw" <<'PY' 2>/dev/null || printf "%s" "$raw"
import sys
v=sys.argv[1]
try:
    print(f"{float(v):.1f}%")
except Exception:
    print(v)
PY
}

format_rate() {
  local raw="$1"
  python3 - "$raw" <<'PY' 2>/dev/null || printf "%s" "$raw"
import sys
v=sys.argv[1]
try:
    print(f"{float(v):.2f}%")
except Exception:
    print(v)
PY
}

first_success() {
  for url in "$@"; do
    local body
    body="$(curl -sf -A GMP-DailyDigest/2.0 "$url" 2>/dev/null || true)"
    if [ -n "$body" ]; then
      printf "%s" "$body" | head -c 2000
      return 0
    fi
  done
  printf "sin respuesta HTTP"
}

format_health() {
  local raw="$1"
  python3 - "$raw" <<'PY' 2>/dev/null || printf "%s" "$raw"
import json, sys
raw = sys.argv[1]
try:
    d = json.loads(raw)
    db = d.get("database", {})
    redis = d.get("redis", {})
    mem = d.get("memory", {})
    parts = [
        f"status={d.get('status','sin datos')}",
        f"db={db.get('status','sin datos')}",
        f"db_ms={db.get('queryTime','sin datos')}",
        f"redis={redis.get('status','sin datos')}",
        f"hit_rate={redis.get('hitRate', d.get('cache',{}).get('hitRate','sin datos'))}",
        f"heap={mem.get('heapUsed','sin datos')}",
        f"response={d.get('responseTime','sin datos')}",
    ]
    print(", ".join(parts))
except Exception:
    print(raw[:500] if raw else "sin respuesta HTTP")
PY
}

GMP_UP_RAW="$(query_prom 'avg_over_time(up{job="gmp-api"}[24h])*100')"
ERROR_RATE_RAW="$(query_prom 'rate(http_requests_total{job="gmp-api",status=~"5.."}[24h])*100')"
GMP_UPTIME="$(format_percent "$GMP_UP_RAW")"
ERROR_RATE="$(format_rate "$ERROR_RATE_RAW")"

HEALTH_RAW="$(first_success "http://localhost:${API_PORT}/api/health" "http://localhost:${API_PORT}/health" "http://localhost:3335/api/health" "http://localhost:3335/health")"
HEALTH="$(format_health "$HEALTH_RAW")"

PM2_STATUS="$(pm2 jlist 2>/dev/null | python3 -c 'import sys,json; data=json.load(sys.stdin); order=["gmp-api","gmp-api-pre","mari-pepa-backend","mari-pepa-frontend","gmp-tunnel-pre","gmp-cache-cleanup","gmp-query-analyzer"]; by={p.get("name",""):p for p in data}; selected=[]; seen=set(); [selected.append(by[n]) or seen.add(n) for n in order if n in by]; [selected.append(p) or seen.add(p.get("name","")) for p in data if p.get("name","").startswith(("gmp","mari-pepa")) and p.get("name","") not in seen]; print("\n".join(["{}: {}, reinicios={}".format(p.get("name","sin_nombre"), p.get("pm2_env",{}).get("status","desconocido"), p.get("pm2_env",{}).get("restart_time",0)) for p in selected[:10]]))' 2>/dev/null || true)"
PM2_STATUS="$(safe_value "$PM2_STATUS" "sin datos PM2")"

if [ -n "${GITHUB_OWNER:-}" ] && [ -n "${GMP_REPO:-}" ] && [ -n "${GITHUB_TOKEN:-}" ]; then
  OPEN_PRS="$(curl -sf "https://api.github.com/repos/${GITHUB_OWNER}/${GMP_REPO}/pulls?state=open" -H "Authorization: Bearer ${GITHUB_TOKEN}" 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "sin datos GitHub")"
else
  OPEN_PRS="sin datos GitHub: falta GITHUB_OWNER, GMP_REPO o GITHUB_TOKEN"
fi

SECURITY_ALERTS="$(cd /opt/gmp-api 2>/dev/null && npm audit --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); v=d.get('metadata',{}).get('vulnerabilities',{}); print(v.get('high',0)+v.get('critical',0))" 2>/dev/null || echo "sin datos npm audit")"
GIT_STATE="$(cd /opt/gmp-api 2>/dev/null && git status --short 2>/dev/null | head -20 || true)"
GIT_STATE="$(safe_value "$GIT_STATE" "sin cambios locales o repo no disponible")"
PENDING_TASKS="$(cd /opt/gmp-api 2>/dev/null && bd ready 2>/dev/null | head -10 || true)"
PENDING_TASKS="$(safe_value "$PENDING_TASKS" "sin tareas ready en beads")"

RECENT_ERRORS="$(journalctl -u gmp-api -n 200 --no-pager 2>/dev/null | grep -Ei 'error|exception|failed|timeout' | tail -8 || true)"
if [ -z "$RECENT_ERRORS" ]; then
  RECENT_ERRORS="$(pm2 logs gmp-api --lines 80 --nostream 2>/dev/null | grep -Ei 'error|exception|failed|timeout' | tail -8 || true)"
fi
RECENT_ERRORS="$(safe_value "$RECENT_ERRORS" "sin errores recientes en journal/PM2")"

PRIORITY_TASK="$(grep -A1 '## Proxima tarea prioritaria' /opt/gmp-api/.opencode/memory/project-state.md 2>/dev/null | tail -1 || true)"
PRIORITY_TASK="$(safe_value "$PRIORITY_TASK" "sin tarea prioritaria definida")"
TECH_RADAR="$(/usr/bin/python3 /opt/gmp-tools/tech-radar-fetcher.py 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('hn',[]))+len(d.get('github',[]))+len(d.get('arxiv',[])))" 2>/dev/null || echo "sin datos tech radar")"

cat > "$LATEST_FILE" <<REPORT
GMP Daily Digest - $(date '+%d/%m/%Y %H:%M %Z')

Estado ejecutivo
- Uptime Prometheus 24h: ${GMP_UPTIME}
- Error rate 5xx 24h: ${ERROR_RATE}
- Health backend ${API_PORT}: ${HEALTH}
- PM2:
${PM2_STATUS}

Trabajo y cambios
- PRs abiertas: ${OPEN_PRS}
- Alertas seguridad high/critical: ${SECURITY_ALERTS}
- Tarea prioritaria: ${PRIORITY_TASK}
- Beads ready:
${PENDING_TASKS}
- Git local /opt/gmp-api:
${GIT_STATE}

Errores recientes
${RECENT_ERRORS}

Tech radar
- Novedades relevantes detectadas: ${TECH_RADAR}

Notas
- Este mensaje ya contiene el informe completo disponible para Telegram.
- Si necesitas una accion, abre OpenCode Web y pide una tarea concreta.
REPORT

cat "$LATEST_FILE" | tee -a "$LOG_FILE"

if [ "${NO_TELEGRAM:-}" != "1" ] && [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  python3 - "$LATEST_FILE" <<'PY'
import os, sys, urllib.parse, urllib.request
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    text = f.read()
chunks = [text[i:i+3600] for i in range(0, len(text), 3600)] or ["sin datos"]
for idx, chunk in enumerate(chunks, 1):
    prefix = "" if len(chunks) == 1 else f"[{idx}/{len(chunks)}]\n"
    data = urllib.parse.urlencode({"chat_id": os.environ["TELEGRAM_CHAT_ID"], "text": prefix + chunk}).encode()
    urllib.request.urlopen(f"https://api.telegram.org/bot{os.environ['TELEGRAM_BOT_TOKEN']}/sendMessage", data=data, timeout=20)
print("Digest completo enviado a Telegram")
PY
else
  if [ "${NO_TELEGRAM:-}" = "1" ]; then
    echo "Telegram omitido por NO_TELEGRAM=1; informe guardado en $LATEST_FILE"
  else
    echo "Telegram no configurado; informe guardado en $LATEST_FILE"
  fi
fi

echo "[$(date -Is)] Daily Digest completado" | tee -a "$LOG_FILE"
