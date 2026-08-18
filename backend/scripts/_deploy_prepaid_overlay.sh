#!/bin/bash
set -euo pipefail
ROOT="/c/Users/Javier/Desktop/Repositorios/gmp_app_mobilidad/backend"
HOST="gmp@192.168.1.230"
BASE="/opt/gmp-api/backend"
/usr/bin/ssh -o BatchMode=yes "$HOST" "cp -f $BASE/routes/repartidor.js /tmp/repartidor.js.bak && cp -f $BASE/repositories/repartidor-route-db2-repository.js /tmp/repartidor-route-db2-repository.js.bak && cp -f $BASE/repositories/reparto-planned-delivery-db2-port.js /tmp/reparto-planned-delivery-db2-port.js.bak && cp -f $BASE/services/reparto-confirmation-contract.js /tmp/reparto-confirmation-contract.js.bak && cp -f $BASE/services/reparto-confirmation-service.js /tmp/reparto-confirmation-service.js.bak"
/usr/bin/scp -o BatchMode=yes "$ROOT/routes/repartidor.js" "$HOST:$BASE/routes/repartidor.js"
/usr/bin/scp -o BatchMode=yes "$ROOT/repositories/repartidor-route-db2-repository.js" "$HOST:$BASE/repositories/repartidor-route-db2-repository.js"
/usr/bin/scp -o BatchMode=yes "$ROOT/repositories/reparto-planned-delivery-db2-port.js" "$HOST:$BASE/repositories/reparto-planned-delivery-db2-port.js"
/usr/bin/scp -o BatchMode=yes "$ROOT/services/reparto-confirmation-contract.js" "$HOST:$BASE/services/reparto-confirmation-contract.js"
/usr/bin/scp -o BatchMode=yes "$ROOT/services/reparto-confirmation-service.js" "$HOST:$BASE/services/reparto-confirmation-service.js"
/usr/bin/ssh -o BatchMode=yes "$HOST" 'pm2 reload gmp-api --update-env && sleep 4 && curl -sS -o /dev/null -w "%{http_code}" -A "GMP-SRE-HealthCheck/1.0" http://127.0.0.1:3335/api/ready'
echo
