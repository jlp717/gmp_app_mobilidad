#!/usr/bin/env bash
set -euo pipefail
cd /opt/gmp-api/backend

echo '--- .env REPARTO ---'
grep -E '^REPARTO_|^REPARTIDOR_FINANCE_|^NODE_ENV=' .env || true

echo '--- ensure staging isolated_test ---'
python3 - <<'PY'
from pathlib import Path
p = Path('.env')
text = p.read_text(encoding='utf-8', errors='replace')
lines = text.splitlines()
keys = {
  'REPARTO_ENVIRONMENT': 'staging',
  'REPARTO_TABLE_SET': 'isolated_test',
  'REPARTIDOR_FINANCE_READ_SCHEMA': 'DSEDAC',
  'REPARTIDOR_FINANCE_APP_SCHEMA': 'JAVIER',
  'REPARTIDOR_FINANCE_ERP_SCHEMA': 'JAVIER',
  'REPARTO_WRITES_ENABLED': 'true',
  'REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED': 'true',
  'REPARTO_FINANCE_DB2_CAPABILITY_APPROVED': 'true',
  'REPARTO_EVIDENCE_PENDING_TTL_HOURS': '24',
}
drop = {
  'REPARTO_PRODUCTION_WRITES_APPROVED',
  'REPARTO_PRODUCTION_CONFIRMATION_APPROVED',
  'REPARTO_PRODUCTION_ERP_WRITES_APPROVED',
}
out, seen = [], set()
for line in lines:
  raw = line.strip()
  if not raw or raw.startswith('#') or '=' not in line:
    out.append(line); continue
  k = line.split('=', 1)[0].strip()
  if k in drop:
    continue
  if k in keys:
    out.append(f'{k}={keys[k]}'); seen.add(k)
  else:
    out.append(line)
for k, v in keys.items():
  if k not in seen:
    out.append(f'{k}={v}')
p.write_text('\n'.join(out) + '\n', encoding='utf-8')
print('env_written')
PY

set -a
# shellcheck disable=SC1091
. ./.env
set +a

node scripts/_validate_reparto_runtime.js

# Clear stale PM2 env overrides for REPARTO_* by restarting from sourced shell
pm2 restart gmp-api --update-env

for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H 'User-Agent: GMP-SRE-HealthCheck/1.0' http://127.0.0.1:3335/api/ready || true)
  echo "ready_try_$i=$code"
  if [ "$code" = "200" ]; then
    break
  fi
  sleep 3
done

# Confirm runtime from a live worker log line is hard; re-validate from env
node -e 'const http=require("http"); http.get({host:"127.0.0.1",port:3335,path:"/api/ready",headers:{"User-Agent":"GMP-SRE-HealthCheck/1.0"}},r=>{console.log("ready_final="+r.statusCode); process.exit(r.statusCode===200?0:1)}).on("error",e=>{console.error(e); process.exit(1)})'

node /tmp/_e2e_perfil_reparto_probe.js
echo EXIT:$?
