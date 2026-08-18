#!/usr/bin/env bash
set -euo pipefail
cd /opt/gmp-api/backend
echo "== route markers =="
grep -n "CLIENT_REQUIRED" routes/entregas.js | head -5
grep -nE "limit\.clamp|180|defaultFrom" routes/repartidor-finanzas.js | head -10
echo "== runtime via dotenv =="
node <<'NODE'
require('dotenv').config({ path: '/opt/gmp-api/backend/.env' });
const { resolveRepartoRuntime } = require('/opt/gmp-api/backend/config/reparto-runtime');
const r = resolveRepartoRuntime(process.env);
const conf = r.tables && r.tables.confirmation ? r.tables.confirmation.confirmations : null;
const cobros = r.tables && r.tables.finance ? r.tables.finance.cobros : null;
console.log(JSON.stringify({
  valid: r.valid,
  env: r.environment,
  tableSet: r.tableSet,
  conf,
  cobros,
  writes: r.writesEnabled,
  errors: r.errors,
}));
NODE
echo "== ready =="
curl -s -o /dev/null -w "ready=%{http_code}\n" -H 'User-Agent: GMP-SRE-HealthCheck/1.0' http://127.0.0.1:3335/api/ready
