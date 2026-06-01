#!/bin/bash
set -euo pipefail

ACTION="${1:-list}"
BASE_PORT="${STAGING_BASE_PORT:-4000}"

case "$ACTION" in
  list)
    docker ps --filter label=gmp-staging --format '{{.Names}} {{.Ports}}'
    ;;
  cleanup)
    redis-cli --scan --pattern 'staging:*' | while read -r key; do
      port="$(redis-cli GET "$key" || true)"
      if [ -z "$port" ]; then
        name="${key#staging:}"
        docker rm -f "gmp-staging-$name" >/dev/null 2>&1 || true
      fi
    done
    ;;
  ports)
    docker ps --filter label=gmp-staging --format '{{.Ports}}' | grep -Eo "${BASE_PORT}[0-9]{0,2}" || true
    ;;
  *)
    echo "Uso: staging-manager.sh list|cleanup|ports" >&2
    exit 2
    ;;
esac
