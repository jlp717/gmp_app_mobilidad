// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual detalle albaran | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

const http = require('http');

const UA = 'GMP-Probe-AlbaranDetail/1.0';

function request(method, path, { token, body } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 3335,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) { /* raw */ }
        resolve({ status: res.statusCode, json, raw: data.slice(0, 1200) });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function pickToken(j) {
  return j?.token || j?.accessToken || j?.data?.token || null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loginWithRetry() {
  for (let i = 0; i < 6; i += 1) {
    const login = await request('POST', '/api/auth/login', {
      body: { username: 'diego', password: '9322' },
    });
    if (login.status === 429) {
      console.log(JSON.stringify({ wait: 'login-429', attempt: i + 1 }));
      await sleep(15000);
      continue;
    }
    return login;
  }
  return { status: 429, json: null, raw: 'rate-limited' };
}

async function main() {
  const login = await loginWithRetry();
  let token = pickToken(login.json);
  console.log(JSON.stringify({
    auth: login.status,
    hasToken: Boolean(token),
    code: login.json?.code || login.json?.error,
  }));
  if (!token) process.exit(2);

  const sw = await request('POST', '/api/auth/switch-role', {
    token,
    body: { userId: '98', newRole: 'REPARTIDOR' },
  });
  token = pickToken(sw.json) || token;
  console.log(JSON.stringify({
    switch: sw.status,
    activeMode: sw.json?.activeMode || sw.json?.user?.activeMode || sw.json?.role,
  }));

  const today = new Date().toISOString().slice(0, 10);
  const pendientes = await request(
    'GET',
    `/api/entregas/pendientes/08?date=${today}&limit=5&offset=0`,
    { token },
  );
  const list = pendientes.json?.albaranes || [];
  const sample = list[0]
    ? {
      id: list[0].id,
      numero: list[0].numero ?? list[0].numeroAlbaran,
      ejercicio: list[0].ejercicio,
      serie: list[0].serie,
      terminal: list[0].terminal,
      cliente: list[0].codigoCliente,
      itemsLen: Array.isArray(list[0].items) ? list[0].items.length : null,
    }
    : null;
  console.log(JSON.stringify({
    pendientes: pendientes.status,
    count: list.length,
    sample,
    err: pendientes.status >= 400 ? pendientes.raw : undefined,
  }));
  if (!sample) process.exit(2);

  const base = `/api/entregas/albaran/${sample.numero}/${sample.ejercicio}`;
  const withCliente = `${base}?serie=${encodeURIComponent(String(sample.serie || ''))}`
    + `&terminal=${encodeURIComponent(String(sample.terminal || ''))}`
    + `&cliente=${encodeURIComponent(String(sample.cliente || ''))}`;
  const withoutCliente = `${base}?serie=${encodeURIComponent(String(sample.serie || ''))}`
    + `&terminal=${encodeURIComponent(String(sample.terminal || ''))}`;
  const wrongName = `${base}?serie=${encodeURIComponent(String(sample.serie || ''))}`
    + `&terminal=${encodeURIComponent(String(sample.terminal || ''))}`
    + `&codigoCliente=${encodeURIComponent(String(sample.cliente || ''))}`;

  for (const [label, path] of [
    ['with_cliente', withCliente],
    ['without_cliente', withoutCliente],
    ['wrong_param_name', wrongName],
  ]) {
    const detail = await request('GET', path, { token });
    console.log(JSON.stringify({
      label,
      status: detail.status,
      success: detail.json?.success,
      code: detail.json?.code,
      error: detail.json?.error,
      items: detail.json?.albaran?.items?.length,
    }));
  }
}

main().catch((err) => {
  console.error(String(err && err.stack || err));
  process.exit(3);
});
