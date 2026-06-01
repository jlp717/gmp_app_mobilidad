#!/bin/bash
set -euo pipefail

ERROR_HASH="${1:?error_hash requerido}"
OCCURRENCES="${2:-2}"
MEMORY_FILE="/opt/gmp-api/.opencode/memory/retrospectives.md"
mkdir -p "$(dirname "$MEMORY_FILE")"

{
  echo
  echo "## Retrospectiva retro-${ERROR_HASH}-$(date +%s) - $(date -Is)"
  echo "Error hash: ${ERROR_HASH}"
  echo "Ocurrencias: ${OCCURRENCES}"
  echo "Causa raiz: pendiente de analisis SRE."
  echo "Cambio de comportamiento: bloquear repeticion antes de repetir accion."
  echo "Verificacion: contador reseteado y nueva ejecucion con guardrail."
} >> "$MEMORY_FILE"

if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  curl -sf -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=Retrospectiva automatica completada para error ${ERROR_HASH}." >/dev/null
fi
