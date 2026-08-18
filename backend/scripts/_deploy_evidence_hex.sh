#!/bin/bash
set -euo pipefail
ROOT="/c/Users/Javier/Desktop/Repositorios/gmp_app_mobilidad/backend"
HOST="gmp@192.168.1.230"
BASE="/opt/gmp-api/backend"
/usr/bin/scp -o BatchMode=yes \
  "$ROOT/repositories/reparto-evidence-db2-repository.js" \
  "$ROOT/repositories/repartidor-route-db2-repository.js" \
  "$HOST:$BASE/repositories/"
/usr/bin/ssh -o BatchMode=yes "$HOST" 'pm2 reload gmp-api --update-env && sleep 4 && curl -sS -o /dev/null -w "%{http_code}" -A "GMP-SRE-HealthCheck/1.0" http://127.0.0.1:3335/api/ready'
