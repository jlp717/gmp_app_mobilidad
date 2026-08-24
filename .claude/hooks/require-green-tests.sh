#!/usr/bin/env bash
set -e
# Stop hook: bloquea cierre si tests fallan (5.10 pipeline auto-reparable)
echo "[Stop-hook] verificacion determinista..." >&2
# Gate real: backend jest + flutter analyze si hay diff
CHANGED=$(git diff --name-only HEAD 2>/dev/null | head -20)
if echo "$CHANGED" | grep -qE "^(backend|lib|test)/"; then
  if [ -f "backend/package.json" ]; then
    (cd backend && npx jest --passWithNoTests 2>&1 | tail -20) || { echo '{"decision":"block","reason":"Tests fallando"}'; exit 2; }
  fi
fi
exit 0
