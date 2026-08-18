#!/bin/bash
set -euo pipefail
ssh -o BatchMode=yes gmp@192.168.1.230 'grep -c IsolatedTest /opt/gmp-api/backend/routes/repartidor.js; curl -sS -o /tmp/col.json -w col:%{http_code} http://127.0.0.1:3335/api/repartidor/collections/summary/08; echo; curl -sS -o /tmp/em.json -w email:%{http_code} -X POST -H Content-Type:application/json --data {"destinatario":"a@b.c"} http://127.0.0.1:3335/api/repartidor/document/send-email; echo; head -c 200 /tmp/col.json; echo; head -c 200 /tmp/em.json; echo'
