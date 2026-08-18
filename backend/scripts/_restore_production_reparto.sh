#!/usr/bin/env bash
set -eu
cd /opt/gmp-api/backend
python3 - <<'PY'
from pathlib import Path
p = Path('.env')
text = p.read_text(encoding='utf-8', errors='replace')
lines = text.splitlines()
keys = {
  'NODE_ENV': 'production',
  'REPARTO_ENVIRONMENT': 'production',
  'REPARTO_TABLE_SET': 'production',
  'REPARTIDOR_FINANCE_READ_SCHEMA': 'DSEDAC',
  'REPARTIDOR_FINANCE_APP_SCHEMA': 'JAVIER',
  'REPARTIDOR_FINANCE_ERP_SCHEMA': 'JAVIER',
  'REPARTO_WRITES_ENABLED': 'true',
  'REPARTO_PRODUCTION_WRITES_APPROVED': 'true',
  'REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED': 'true',
  'REPARTO_PRODUCTION_CONFIRMATION_APPROVED': 'true',
  'REPARTO_FINANCE_DB2_CAPABILITY_APPROVED': 'true',
  'REPARTO_PRODUCTION_ERP_WRITES_APPROVED': 'false',
  'REPARTO_EVIDENCE_PENDING_TTL_HOURS': '24',
}
out, seen = [], set()
for line in lines:
  raw = line.strip()
  if not raw or raw.startswith('#') or '=' not in line:
    out.append(line); continue
  k = line.split('=', 1)[0].strip()
  if k in keys:
    out.append(f'{k}={keys[k]}'); seen.add(k)
  else:
    out.append(line)
for k, v in keys.items():
  if k not in seen:
    out.append(f'{k}={v}')
p.write_text('\n'.join(out) + '\n', encoding='utf-8')
print('production_env_written')
PY
set -a
. ./.env
set +a
node scripts/_validate_reparto_runtime.js
pm2 restart gmp-api --update-env
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H 'User-Agent: GMP-SRE-HealthCheck/1.0' http://127.0.0.1:3335/api/ready || true)
  echo "ready_try_$i=$code"
  if [ "$code" = "200" ]; then break; fi
  sleep 3
done
