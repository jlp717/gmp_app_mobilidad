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
  'REPARTO_ENVIRONMENT': 'staging',
  'REPARTO_TABLE_SET': 'isolated_test',
  'REPARTIDOR_FINANCE_READ_SCHEMA': 'DSEDAC',
  'REPARTIDOR_FINANCE_APP_SCHEMA': 'JAVIER',
  'REPARTIDOR_FINANCE_ERP_SCHEMA': 'JAVIER',
  'DB2_READ_SCHEMA': 'DSEDAC',
  'DB2_WRITE_SCHEMA': 'JAVIER',
  'PEDIDOS_CONFIRMATION_SCHEMA': 'JAVIER',
  'PEDIDOS_DSEDAC_STORAGE_APPROVED': 'false',
  'PEDIDOS_EXPORT_TO_SYSTEM': 'false',
  'PEDIDOS_DSEDAC_EXPORT_APPROVED': 'false',
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
print('staging_write_env_ok')
PY

set -a
. ./.env
set +a

node scripts/_validate_reparto_runtime.js

# Ensure SEQ exists for liquidacion
node - <<'NODE'
const odbc = require('odbc');
(async () => {
  const cs = `DSN=${process.env.ODBC_DSN};UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD}`;
  const conn = await odbc.connect({ connectionString: cs });
  try {
    const rows = await conn.query(
      "SELECT 1 AS OK FROM QSYS2.SYSSEQUENCES WHERE SEQUENCE_SCHEMA='JAVIER' AND SEQUENCE_NAME='TEST_REPARTIDOR_LIQUIDACION_SEQ'",
    );
    if (!rows.length) {
      await conn.query(
        "CREATE SEQUENCE JAVIER.TEST_REPARTIDOR_LIQUIDACION_SEQ AS BIGINT START WITH 1 INCREMENT BY 1 MINVALUE 1 NO CYCLE CACHE 20",
      );
      console.log(JSON.stringify({ seq: 'created' }));
    } else {
      console.log(JSON.stringify({ seq: 'exists' }));
    }
  } finally {
    await conn.close();
  }
})().catch((e) => { console.error(String(e)); process.exit(1); });
NODE

pm2 restart gmp-api --update-env
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H 'User-Agent: GMP-SRE-HealthCheck/1.0' http://127.0.0.1:3335/api/ready || true)
  echo "ready_try_$i=$code"
  if [ "$code" = "200" ]; then break; fi
  sleep 3
done
