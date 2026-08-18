#!/bin/bash
set -euo pipefail
SRC="/c/Users/Javier/Desktop/Repositorios/gmp_app_mobilidad/backend/repositories/reparto-receipt-db2-repository.js"
DST="gmp@192.168.1.230:/opt/gmp-api/backend/repositories/reparto-receipt-db2-repository.js"
/usr/bin/ssh -o BatchMode=yes gmp@192.168.1.230 'cp -f /opt/gmp-api/backend/repositories/reparto-receipt-db2-repository.js /tmp/reparto-receipt-db2-repository.js.bak'
/usr/bin/scp -o BatchMode=yes "$SRC" "$DST"
/usr/bin/ssh -o BatchMode=yes gmp@192.168.1.230 'pm2 reload gmp-api --update-env && sleep 3 && curl -sS -o /dev/null -w "%{http_code}" -A "GMP-SRE-HealthCheck/1.0" http://127.0.0.1:3335/api/ready'
