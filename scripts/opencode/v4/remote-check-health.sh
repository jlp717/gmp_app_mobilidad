#!/bin/bash
set -euo pipefail

echo "== pm2 =="
pm2 list

echo "== listening ports =="
ss -ltnp 2>/dev/null | sed -n '1,120p'

echo "== health probes =="
for host in 127.0.0.1 localhost 192.168.1.230; do
  for port in 3197 3335 3000 3001 3002 8080; do
    for path in /health /api/health /metrics /; do
      : >/tmp/gmp-health-body
      code="$(curl -sS -m 3 -o /tmp/gmp-health-body -w '%{http_code}' "http://${host}:${port}${path}" 2>/dev/null || true)"
      bytes="$(wc -c </tmp/gmp-health-body 2>/dev/null || echo 0)"
      echo "${host}:${port}${path}:${code}:bytes=${bytes}"
    done
  done
done

echo "== filtered pm2 env =="
pm2 env 24 | awk -F: '/^(PORT|HOST|NODE_ENV|API_PORT|BACKEND_PORT)/ {print $1 ":" $2}'

echo "== backend listeners in source =="
grep -RIn --exclude-dir=node_modules --exclude='*.log' -E 'listen|PORT|3197|3000|3001|8080|/health|api/health' \
  /opt/gmp-api/backend/server.js \
  /opt/gmp-api/backend/app.js \
  /opt/gmp-api/backend/src \
  /opt/gmp-api/backend/routes \
  /opt/gmp-api/backend/config 2>/dev/null | sed -n '1,120p'

echo "== recent backend errors =="
for log in /opt/gmp-api/backend/logs/*.log /home/gmp/.pm2/logs/*gmp*error*.log /home/gmp/.pm2/logs/*gmp*out*.log; do
  [ -f "$log" ] || continue
  echo "-- $log --"
  tail -n 40 "$log"
done
