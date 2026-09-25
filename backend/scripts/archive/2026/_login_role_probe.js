// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual rol login | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';
const fs = require('fs');
const https = require('https');
const path = require('path');

function load(file, userRe, passRe) {
  const src = fs.readFileSync(file, 'utf8');
  return { username: src.match(userRe)[1], password: src.match(passRe)[1] };
}

function post(body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: 'api.mari-pepa.com',
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GMP-App/1.0 Dart/3.0 (login-role-probe)',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        const user = json?.user || {};
        resolve({
          status: res.statusCode,
          role: json?.role || user.role,
          code: user.code,
          activeMode: json?.activeMode || user.activeMode,
          isJefeVentas: json?.isJefeVentas ?? user.isJefeVentas,
          isRepartidor: json?.isRepartidor ?? user.isRepartidor,
          codigoConductor: json?.codigoConductor || user.codigoConductor,
          availableRoles: json?.availableRoles || user.availableRoles,
          availableModes: json?.availableModes || user.availableModes,
          hasToken: Boolean(json?.token || json?.data?.token),
          token: json?.token || json?.data?.token || null,
          refreshToken: json?.refreshToken || null,
        });
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const diego = load(
    path.join(__dirname, '_e2e_history_signature_probe.js'),
    /username:\s*'([^']+)'/,
    /password:\s*'([^']+)'/,
  );
  const goyo = load(
    path.join(__dirname, '../tests/test_rutero_delivery.js'),
    /TEST_USER = '([^']+)'/,
    /TEST_PASSWORD = '([^']+)'/,
  );
  const a = await post(diego);
  const b = await post(goyo);
  const safe = (row, name) => ({
    who: name,
    status: row.status,
    role: row.role,
    code: row.code,
    activeMode: row.activeMode,
    isJefeVentas: row.isJefeVentas,
    isRepartidor: row.isRepartidor,
    codigoConductor: row.codigoConductor,
    availableRoles: row.availableRoles,
    availableModes: row.availableModes,
    hasToken: row.hasToken,
  });
  console.log(JSON.stringify({ diego: safe(a, 'diego'), goyo: safe(b, 'goyo') }));
  fs.writeFileSync(path.join(__dirname, '_dual_login_tokens.json'), JSON.stringify({
    jefe: { token: a.token, refreshToken: a.refreshToken, role: a.role, code: a.code },
    goyo: { token: b.token, refreshToken: b.refreshToken, role: b.role, code: b.code },
  }));
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
