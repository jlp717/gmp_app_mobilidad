// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-tmp | _-scratch gitignored; tunel puntual 7flows | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * [túnel] 7 flujos HTTP via SSH local-forward. PIN via SSH, never printed.
 *   API_HOST=127.0.0.1 API_PORT=13335 node backend/scripts/_tmp-tunnel-7flows.js
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOST = process.env.API_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.API_PORT || '13335', 10);
const SSH = process.env.SSH_PATH || 'C:\\Program Files\\Git\\usr\\bin\\ssh.exe';
const SCP = process.env.SCP_PATH || 'C:\\Program Files\\Git\\usr\\bin\\scp.exe';
const VENDOR = String(process.env.HIT_COMERCIAL_VENDOR || '98').trim();
const YEAR = '2026';
const TODAY = new Date().toISOString().slice(0, 10);
const UA = 'GMP-Tunnel-7flows/1.0';

function fetchPin(vendor) {
  const remoteScript = '/tmp/hit-ssh-pin-file.js';
  const localScript = path.resolve(__dirname, 'hit-ssh-pin-file.js');
  execFileSync(SCP, [localScript, `gmp@192.168.1.230:${remoteScript}`], {
    encoding: 'utf8',
    timeout: 20000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = execFileSync(
    SSH,
    ['gmp@192.168.1.230', `cd /opt/gmp-api && HIT_COMERCIAL_VENDOR=${vendor} node ${remoteScript}`],
    { encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const localPin = path.join(os.tmpdir(), 'gmp-ui-pin');
  execFileSync(SCP, ['gmp@192.168.1.230:/tmp/.gmp-ui-pin', localPin], {
    encoding: 'utf8',
    timeout: 20000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  execFileSync(SSH, ['gmp@192.168.1.230', 'rm -f /tmp/.gmp-ui-pin /tmp/hit-ssh-pin-file.js'], {
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pin = fs.readFileSync(localPin, 'utf8').trim();
  fs.unlinkSync(localPin);
  if (!/^\d{3,8}$/.test(pin)) throw new Error('PIN remoto invalido');
  const chars = String(out).split(/\r?\n/).reverse().find((line) => line.includes('pin_chars=')) || `pin_chars=${pin.length}`;
  return { pin, chars };
}

function parseBody(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return { raw: String(raw || '').slice(0, 80) };
  }
}

function api(method, pathName, { token, body, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const started = Date.now();
    const headers = { 'User-Agent': UA };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: `/api${pathName}`,
      method,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          ms: Date.now() - started,
          bytes: buf.length,
          cacheHit: String(res.headers['x-cache-hit'] || ''),
          cacheSource: String(res.headers['x-cache-source'] || ''),
          retryAfter: String(res.headers['retry-after'] || ''),
          body: parseBody(buf.toString('utf8')),
        });
      });
    });
    req.setTimeout(timeoutMs || 90000, () => req.destroy(new Error(`timeout ${pathName}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function line(name, res) {
  const code = res.body?.user?.code || res.body?.user?.id || '';
  const extra = [
    res.cacheHit ? `hit=${res.cacheHit}` : '',
    res.cacheSource ? `src=${res.cacheSource}` : '',
    res.retryAfter ? `retry=${res.retryAfter}` : '',
    code ? `user=${code}` : '',
  ].filter(Boolean).join(' ');
  console.log(`[túnel] ${name} status=${res.status} ms=${res.ms} bytes=${res.bytes}${extra ? ` ${extra}` : ''}`);
}

async function main() {
  const { pin, chars } = fetchPin(VENDOR);
  console.log(`[túnel] pin ${chars} host=${HOST}:${PORT}`);

  const diego = await api('POST', '/auth/login', {
    body: { username: 'diego', password: pin },
    timeoutMs: 20000,
  });
  line('login diego', diego);

  const login98 = await api('POST', '/auth/login', {
    body: { username: '98', password: pin },
    timeoutMs: 20000,
  });
  line('login 98', login98);

  const token = diego.body?.token || diego.body?.accessToken || login98.body?.token;
  if (!token) {
    console.log('[túnel] BLOCKED no token');
    process.exit(1);
  }

  const flows = [
    ['dashboard', `/dashboard/metrics?vendedorCodes=ALL&year=${YEAR}`],
    ['objetivos evolution', `/objectives/evolution?vendedorCodes=ALL&years=${YEAR}`],
    ['objetivos by-client', `/objectives/by-client?vendedorCodes=ALL&year=${YEAR}`],
    ['facturas', `/facturas/summary?vendedorCodes=ALL&year=${YEAR}`],
    ['historial', '/pedidos/purchase-history-global?vendedorCode=ALL&from=2024-01-01&to=2026-12-31&limit=300'],
    ['rutero week', `/rutero/week?vendedorCodes=98&year=${YEAR}&month=9`],
    ['liquidación', `/comercial-liquidacion/resumen-diario?vendedor=98&fecha=${TODAY}`],
    ['commissions', `/commissions/summary?vendedorCode=ALL&year=${YEAR}`],
  ];

  for (const [name, pathName] of flows) {
    const res = await api('GET', pathName, { token, timeoutMs: name === 'historial' ? 90000 : 45000 });
    line(name, res);
    if (name === 'historial' && res.status === 200) {
      const warm = await api('GET', pathName, { token, timeoutMs: 20000 });
      line('historial warm', warm);
    }
  }
}

main().catch((error) => {
  console.error('[túnel] FATAL', error.message);
  process.exit(1);
});
