// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual orden rutero | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

const http = require('http');

function request(method, path, token, body) {
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 3335,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GMP-App/1.0',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, raw }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const login = await request('POST', '/api/auth/login', null, {
    username: 'diego',
    password: '9322',
  });
  const loginJson = JSON.parse(login.raw);
  let token = loginJson.token || loginJson.data?.token;
  const sw = await request('POST', '/api/auth/switch-role', token, {
    userId: '98',
    newRole: 'REPARTIDOR',
  });
  const swJson = JSON.parse(sw.raw);
  token = swJson.token || swJson.data?.token || token;

  const get = await request('GET', '/api/repartidor/rutero/order/08?date=2026-08-11', token);
  console.log(JSON.stringify({ step: 'GET', status: get.status, body: get.raw.slice(0, 300) }));

  const put = await request('PUT', '/api/repartidor/rutero/order/08', token, {
    date: '2026-08-11',
    orden: [
      { documentId: '2026-I-5-178-4300010503', cliente: '4300010503', posicion: 0 },
      { documentId: '2026-I-5-179-4300010504', cliente: '4300010504', posicion: 1 },
    ],
  });
  console.log(JSON.stringify({ step: 'PUT', status: put.status, body: put.raw.slice(0, 300) }));

  const get2 = await request('GET', '/api/repartidor/rutero/order/08?date=2026-08-11', token);
  console.log(JSON.stringify({ step: 'GET2', status: get2.status, body: get2.raw.slice(0, 300) }));
})().catch((error) => {
  console.error(JSON.stringify({ fatal: String(error && error.message || error) }));
  process.exit(1);
});
