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
PROM="http://localhost:9090/api/v1/query"

echo "[$(date -Is)] Iniciando Daily Digest ${MANUAL}" | tee -a "$LOG_FILE"

query_prom() {
  local q="$1"
  curl -sf --get "$PROM" --data-urlencode "query=$q" | python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('data',{}).get('result',[]); print(r[0]['value'][1] if r else 'N/A')" 2>/dev/null || echo "N/A"
}

GMP_UP_RAW="$(query_prom 'avg_over_time(up{job="gmp-api"}[24h])*100')"
ERROR_RATE_RAW="$(query_prom 'rate(http_requests_total{job="gmp-api",status=~"5.."}[24h])*100')"
GMP_UPTIME="$(python3 -c "v='$GMP_UP_RAW'; print('N/A' if v=='N/A' else f'{float(v):.1f}%')" 2>/dev/null || echo N/A)"
ERROR_RATE="$(python3 -c "v='$ERROR_RATE_RAW'; print('N/A' if v=='N/A' else f'{float(v):.2f}%')" 2>/dev/null || echo N/A)"

OPEN_PRS="$(curl -sf "https://api.github.com/repos/${GITHUB_OWNER:-}/${GMP_REPO:-}/pulls?state=open" -H "Authorization: Bearer ${GITHUB_TOKEN:-}" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)"
SECURITY_ALERTS="$(cd /opt/gmp-api 2>/dev/null && npm audit --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); v=d.get('metadata',{}).get('vulnerabilities',{}); print(v.get('high',0)+v.get('critical',0))" 2>/dev/null || echo 0)"
PRIORITY_TASK="$(grep -A1 '## Proxima tarea prioritaria' /opt/gmp-api/.opencode/memory/project-state.md 2>/dev/null | tail -1 || echo 'No definida')"
TECH_RADAR="$(/usr/bin/python3 /opt/gmp-tools/tech-radar-fetcher.py 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('hn',[]))+len(d.get('github',[]))+len(d.get('arxiv',[])))" 2>/dev/null || echo 0)"

DIGEST="Daily Digest - $(date '+%d/%m/%Y')

Sistema GMP: Uptime ${GMP_UPTIME} | Error rate ${ERROR_RATE}
PRs abiertas: ${OPEN_PRS}
Alertas seguridad: ${SECURITY_ALERTS} high/critical
Novedades tech relevantes: ${TECH_RADAR}
Tarea prioritaria: ${PRIORITY_TASK}

Di detalles del digest para el informe completo."

if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  python3 - <<PY
import os, urllib.parse, urllib.request
msg = """$DIGEST"""
data = urllib.parse.urlencode({"chat_id": os.environ["TELEGRAM_CHAT_ID"], "text": msg}).encode()
urllib.request.urlopen(f"https://api.telegram.org/bot{os.environ['TELEGRAM_BOT_TOKEN']}/sendMessage", data=data, timeout=20)
print("Digest enviado a Telegram")
PY
else
  echo "$DIGEST"
fi

echo "[$(date -Is)] Daily Digest completado" | tee -a "$LOG_FILE"
