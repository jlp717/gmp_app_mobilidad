'use strict';

/**
 * HIT huecos only (not the 97-tab sweep). Never prints PIN.
 * Run on 230 after deploy: API_HOST=127.0.0.1 node backend/scripts/hit-comercial-huecos.js
 */

const http = require('http');
const path = require('path');

const dbModule = (() => {
  const candidates = [
    '/opt/gmp-api/backend/config/db',
    path.resolve(__dirname, '../config/db'),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) { /* next */ }
  }
  throw new Error('db module not found');
})();

const { initDb, closePool, queryWithParams } = dbModule;
const HOST = process.env.API_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.API_PORT || '3335', 10);
const UA = 'GMP-Huecos-HIT/1.0';

function parseBody(raw) {
  try { return JSON.parse(raw || '{}'); } catch { return { raw: String(raw || '').slice(0, 180) }; }
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
      hostname: HOST, port: PORT, path: `/api${pathName}`, method, headers, timeout: timeoutMs || 25000,
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: parseBody(raw), ms: Date.now() - started }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function pinForVendor(vendor) {
  const rows = await queryWithParams(
    `SELECT TRIM(CODIGOPIN) AS PIN FROM DSEDAC.VDPL1
      WHERE TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(2)) FETCH FIRST 1 ROW ONLY`,
    [vendor],
  );
  return String(rows?.[0]?.PIN || '').trim();
}

async function login(vendor) {
  const pin = await pinForVendor(vendor);
  if (!pin) return { ok: false, vendor, error: 'no-pin' };
  const res = await api('POST', '/auth/login', { body: { username: vendor, password: pin } });
  const token = res.body?.token || res.body?.accessToken || '';
  const user = res.body?.user || {};
  return {
    ok: res.status === 200 && Boolean(token),
    vendor,
    token,
    ms: res.ms,
    role: user.role || res.body?.role,
    isJefeVentas: user.isJefeVentas === true,
    navHint: user.isJefeVentas ? 'Panel' : 'no-Panel',
    loginErr: res.status === 200 ? undefined : String(res.body?.error || res.body?.message || res.body?.code || res.status),
  };
}

function record(rows, name, res, extra) {
  rows.push({
    name,
    status: res.status,
    ms: res.ms,
    ok: res.status === 200,
    ...extra,
  });
}

async function huecosFor(actor, rows) {
  const { token, vendor } = actor;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const dash = await api('GET', `/kpi/dashboard?vendorCode=${encodeURIComponent(vendor)}`, { token, timeoutMs: 40000 });
  record(rows, `${vendor} kpi.dashboard`, dash, {
    alerts: dash.body?.totals?.alerts,
    TOTAL_ALERTS: dash.body?.totals?.TOTAL_ALERTS,
    clients: dash.body?.totals?.clients,
  });
  const clients = await api('GET', `/kpi/alerts/clients?vendedorCodes=${encodeURIComponent(vendor)}`, { token, timeoutMs: 30000 });
  record(rows, `${vendor} kpi.clients`, clients, {
    n: (clients.body?.clientCodes || []).length,
  });

  const mov = await api('GET', `/bolsa/${encodeURIComponent(vendor)}/movements?year=${year}&month=${month}&limit=20`, { token, timeoutMs: 30000 });
  record(rows, `${vendor} bolsa.movements`, mov, {
    n: (mov.body?.movements || []).length,
  });
  const hist = await api('GET', `/bolsa/${encodeURIComponent(vendor)}/history?months=12`, { token, timeoutMs: 30000 });
  const points = hist.body?.points || [];
  const current = points.find((p) => Number(p.ejercicio) === year && Number(p.mes) === month) || {};
  record(rows, `${vendor} bolsa.history`, hist, {
    points: points.length,
    currentAcum: current.acumulado,
    currentCons: current.consumido,
  });

  const bot = await api('POST', '/chatbot/message', {
    token,
    timeoutMs: 40000,
    body: { message: 'resumen de mis clientes de hoy' },
  });
  const text = String(bot.body?.response || '').replace(/\s+/g, ' ').slice(0, 160);
  record(rows, `${vendor} asistente.resumen`, bot, { text });

  const cold = await api('GET', `/cobros/pending-summary/${encodeURIComponent(vendor)}?limit=50&page=1`, { token, timeoutMs: 40000 });
  const warm = await api('GET', `/cobros/pending-summary/${encodeURIComponent(vendor)}?limit=50&page=1`, { token, timeoutMs: 40000 });
  record(rows, `${vendor} cobros.pending-summary`, cold, {
    coldMs: cold.ms,
    warmMs: warm.ms,
    clients: cold.body?.clientCount,
    grand: cold.body?.grandTotal,
  });

  const validate = await api('GET', '/auth/validate', { token });
  const vUser = validate.body?.user || {};
  record(rows, `${vendor} auth.validate`, validate, {
    isJefeVentas: vUser.isJefeVentas === true || validate.body?.isJefeVentas === true,
    role: vUser.role || validate.body?.role,
    topJefe: validate.body?.isJefeVentas,
    userJefe: vUser.isJefeVentas,
  });
}

async function main() {
  await initDb();
  const rows = [];
  try {
    const ready = await api('GET', '/ready');
    record(rows, 'ready', ready, { tableSet: ready.body?.tableSet || ready.body?.repartoTableSet, sha: ready.body?.gitSha || ready.body?.sha });

    for (const vendor of ['80', '35', '98']) {
      const actor = await login(vendor);
      rows.push({
        name: `${vendor} login`,
        status: actor.ok ? 200 : 401,
        ms: actor.ms,
        ok: actor.ok,
        role: actor.role,
        isJefeVentas: actor.isJefeVentas,
        navHint: actor.navHint,
        loginErr: actor.loginErr,
      });
      if (!actor.ok) continue;
      await huecosFor(actor, rows);
    }

    const yearNow = new Date().getFullYear();
    const pmr = await queryWithParams(
      `SELECT TRIM(P.CODIGOCLIENTE) AS CLIENTE
         FROM DSEDAC.PMR P
         INNER JOIN DSEDAC.CLP C
           ON TRIM(C.CODIGOCLIENTE) = TRIM(P.CODIGOCLIENTE)
        WHERE TRIM(C.VENDEDORCOMERCIAL) = CAST(? AS VARCHAR(2))
          AND (P.ANOFIN = 0 OR P.ANOFIN >= ?)
        FETCH FIRST 1 ROW ONLY`,
      ['80', yearNow],
    );
    let pmrClient = String(pmr?.[0]?.CLIENTE || '').trim();
    if (!pmrClient) {
      const pmrLac = await queryWithParams(
        `SELECT TRIM(P.CODIGOCLIENTE) AS CLIENTE
           FROM DSEDAC.LAC L
           INNER JOIN DSEDAC.PMR P
             ON TRIM(P.CODIGOCLIENTE) = TRIM(L.CODIGOCLIENTEALBARAN)
          WHERE TRIM(L.CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))
            AND L.ANODOCUMENTO >= ?
            AND (P.ANOFIN = 0 OR P.ANOFIN >= ?)
          FETCH FIRST 1 ROW ONLY`,
        ['80', yearNow, yearNow],
      );
      pmrClient = String(pmrLac?.[0]?.CLIENTE || '').trim();
    }
    if (pmrClient) {
      const eighty = await login('80');
      if (eighty.ok) {
        const promo = await api('GET',
          `/pedidos/promotions?clientCode=${encodeURIComponent(pmrClient)}&vendedorCodes=80`,
          { token: eighty.token, timeoutMs: 30000 });
        const promoList = Array.isArray(promo.body?.promotions) ? promo.body.promotions : [];
        record(rows, '80 ofertas.pmr', promo, {
          n: promoList.length,
          client: pmrClient,
          err: promo.status === 200 ? undefined : String(promo.body?.error || promo.body?.code || promo.status).slice(0, 80),
        });
      }
    } else {
      rows.push({
        name: '80 ofertas.pmr',
        status: 200,
        ms: 0,
        ok: true,
        n: 0,
        client: '',
        err: 'no-pmr-in-80-scope',
      });
    }
  } finally {
    await closePool().catch(() => undefined);
  }

  const fail = rows.filter((r) => r.ok === false);
  process.stdout.write(`${JSON.stringify({ host: HOST, fail: fail.length, total: rows.length, rows }, null, 2)}\n`);
  if (fail.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
