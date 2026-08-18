#!/usr/bin/env bash
set -euo pipefail
cp -f /tmp/repartidor-finanzas.js /opt/gmp-api/backend/routes/repartidor-finanzas.js
cp -f /tmp/repartidor-finance-service.js /opt/gmp-api/backend/services/repartidor-finance-service.js
cd /opt/gmp-api/backend
set -a
# shellcheck disable=SC1091
. ./.env
set +a
pm2 restart gmp-api --update-env
sleep 10
curl -sS -m 8 -H 'User-Agent: GMP-SRE-HealthCheck/1.0' http://127.0.0.1:3335/api/ready | head -c 220
echo
# Compat probe: old APK shape (limit only, no from/to)
node <<'NODE'
const http = require('http');
function request(method, path, token, body) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: 3335, path, method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GMP-Probe-Compat/1.0',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, json, raw: data.slice(0, 400) });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
(async () => {
  const login = await request('POST', '/api/auth/login', null, { username: 'diego', password: '9322' });
  let token = login.json?.token || login.json?.accessToken;
  const sw = await request('POST', '/api/auth/switch-role', token, { userId: '98', newRole: 'REPARTIDOR' });
  token = sw.json?.token || sw.json?.accessToken || token;
  const onlyLimit = await request('GET', '/api/repartidor-finanzas/vencimientos/08?limit=200', token);
  const daily = await request('GET', `/api/repartidor-finanzas/daily-summary/08?date=${new Date().toISOString().slice(0,10)}`, token);
  console.log(JSON.stringify({
    vencOnlyLimit: { status: onlyLimit.status, count: onlyLimit.json?.vencimientos?.length, code: onlyLimit.json?.code, error: onlyLimit.json?.error },
    daily: {
      status: daily.status,
      entregado: daily.json?.summary?.entregado,
      TOTAL_REPARTIDO: daily.json?.summary?.TOTAL_REPARTIDO,
      deuda: daily.json?.summary?.deudaPendiente,
      efectivo: daily.json?.summary?.totalEfectivo,
    },
  }));
})().catch((e) => { console.error(String(e)); process.exit(1); });
NODE
