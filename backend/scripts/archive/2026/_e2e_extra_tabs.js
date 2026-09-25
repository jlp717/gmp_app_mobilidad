// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-e2e | _-scratch gitignored; e2e puntual tabs extra | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

const http = require('http');

const UA = 'GMP-App/1.0 Dart/3.0 (e2e-extra-tabs)';
const ID = '08';
const YEAR = new Date().getFullYear();
const TODAY = new Date().toISOString().slice(0, 10);

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
        resolve({ status: res.statusCode, json, raw: data.slice(0, 400) });
      });
    });
    req.setTimeout(25000, () => req.destroy(new Error(`timeout ${method} ${path}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function row(label, res, extra = {}) {
  const pass = res.status >= 200 && res.status < 300 && res.json?.success !== false && res.status !== 500;
  console.log(JSON.stringify({
    label,
    status: res.status,
    pass,
    error: res.json?.error || null,
    code: res.json?.code || null,
    ...extra,
  }));
  return pass;
}

async function main() {
  const login = await request('POST', '/api/auth/login', {
    body: { username: 'diego', password: '9322' },
  });
  let token = login.json?.token || login.json?.data?.token;
  const sw = await request('POST', '/api/auth/switch-role', {
    token,
    body: { userId: '98', newRole: 'REPARTIDOR' },
  });
  token = sw.json?.token || sw.json?.data?.token || token;
  console.log(JSON.stringify({
    step: 'auth',
    login: login.status,
    switch: sw.status,
    activeMode: sw.json?.user?.activeMode || sw.json?.activeMode,
  }));

  const results = [];
  const get = async (label, path, extract) => {
    const res = await request('GET', path, { token });
    const extra = typeof extract === 'function' ? (extract(res.json) || {}) : {};
    results.push(row(label, res, extra));
    return res;
  };

  await get('cuentas', `/api/repartidor-finanzas/cuentas/${ID}`, (j) => ({
    saldo: j?.cuenta?.saldoActual ?? j?.saldoActual ?? null,
  }));
  await get('desglose', `/api/repartidor-finanzas/liquidaciones/${ID}/desglose?date=${TODAY}`, (j) => {
    const keys = j && typeof j === 'object' ? Object.keys(j) : [];
    const gastos = j?.gastos || j?.desglose?.gastos || j?.data?.gastos || [];
    const ingresos = j?.ingresos || j?.bankDeposits || j?.desglose?.ingresos || [];
    return {
      keys: keys.slice(0, 12),
      gastos: Array.isArray(gastos) ? gastos.length : null,
      ingresos: Array.isArray(ingresos) ? ingresos.length : null,
    };
  });
  await get('stopsGeo', `/api/repartidor/rutero/stops-geo/${ID}?date=${TODAY}`, (j) => ({
    stops: Array.isArray(j?.stops) ? j.stops.length : (Array.isArray(j?.data) ? j.data.length : null),
  }));
  await get('order', `/api/repartidor/rutero/order/${ID}?date=${TODAY}`, (j) => ({
    orden: Array.isArray(j?.orden) ? j.orden.length : null,
  }));
  await get('paymentConditions', '/api/entregas/payment-conditions');
  await get('collectionsSummary', `/api/repartidor/collections/summary/${ID}`);
  await get('collectionsDaily', `/api/repartidor/collections/daily/${ID}?date=${TODAY}`);
  await get('objectives', `/api/repartidor/history/objectives/${ID}`);

  for (let month = 1; month <= 12; month += 1) {
    const from = `${YEAR}-${String(month).padStart(2, '0')}-01`;
    const last = new Date(YEAR, month, 0).getDate();
    const to = `${YEAR}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    await get(
      `commissions.month.${month}`,
      `/api/repartidor-finanzas/commissions/summary/${ID}?from=${from}&to=${to}`,
      (j) => {
        const s = j?.summary || j || {};
        return {
          delivered: s.deliveredAmount ?? s.entregado ?? s.importeEntregado ?? null,
          commission: s.commission ?? s.comision ?? s.importeComision ?? null,
        };
      },
    );
  }

  const health = await request('GET', '/api/chatbot/health', { token });
  results.push(row('asistente.health', health, { statusOk: health.json?.status || null }));
  const chat = await request('POST', '/api/chatbot/message', {
    token,
    body: { message: 'cuantas entregas tengo hoy' },
  });
  results.push(row('asistente.message', chat, {
    hasReply: Boolean(chat.json?.reply || chat.json?.message || chat.json?.data),
  }));

  const clients = await request('GET', `/api/repartidor/history/clients/${ID}`, { token });
  const firstClient = (clients.json?.data || clients.json?.clients || [])[0];
  const clientId = firstClient?.clienteId || firstClient?.codigoCliente || firstClient?.code || firstClient?.id;
  if (clientId) {
    const docsRes = await get(
      'historico.documents',
      `/api/repartidor/history/documents/${encodeURIComponent(clientId)}?repartidorId=${ID}`,
    );
    const docs = docsRes.json?.data || docsRes.json?.documents || [];
    const alb = Array.isArray(docs) ? docs[0] : null;
    if (alb) {
      const numero = alb.numero || alb.number || alb.numeroAlbaran;
      const ejercicio = alb.ejercicio || alb.year || alb.ejercicioAlbaran;
      const serie = alb.serie || alb.serieAlbaran || 'A';
      const terminal = alb.terminal ?? alb.terminalAlbaran ?? 1;
      await get(
        'historico.signature',
        `/api/repartidor/history/signature?ejercicio=${encodeURIComponent(ejercicio)}&serie=${encodeURIComponent(serie)}&terminal=${encodeURIComponent(terminal)}&numero=${encodeURIComponent(numero)}`,
        (j) => ({
          hasSignature: j?.hasSignature === true,
          firmante: j?.signature?.firmante || j?.signature?.nombre || null,
        }),
      );
    }
  }

  const venc = await request('GET', `/api/repartidor-finanzas/vencimientos/${ID}?from=${YEAR}-01-01&to=${TODAY}&limit=5`, { token });
  const firstVenc = (venc.json?.vencimientos || [])[0];
  const k = firstVenc?.keys || {};
  if (k.tipoDocumento && k.numeroDocumento != null) {
    const docId = [
      k.tipoDocumento,
      k.ejercicioDocumento,
      k.serieDocumento || 'A',
      k.terminalDocumento ?? 0,
      k.numeroDocumento,
      k.xdeDocumento ?? 1,
    ].join('-');
    await get(
      'vencimientos.detalle',
      `/api/repartidor-finanzas/vencimientos/${ID}/${encodeURIComponent(docId)}/detalle`,
      (j) => ({ hasDetalle: Boolean(j?.detalle) }),
    );
  } else {
    results.push(row('vencimientos.detalle', venc, { skipped: 'no_keys', count: (venc.json?.vencimientos || []).length }));
  }

  const noEntrega = await request('POST', '/api/repartidor-finanzas/rutero/confirm-delivery-cobro', {
    token,
    headers: { 'Idempotency-Key': `e2e-dry-noent-${Date.now()}` },
    body: {
      delivery: {
        itemId: 'E2E-DRY-NOENTREGA',
        status: 'NO_ENTREGADO',
        occurredAt: new Date().toISOString(),
        lineas: [],
        motivo: 'e2e-dry',
      },
    },
  });
  const noEntregaPass = noEntrega.status !== 401 && noEntrega.status !== 500
    && !String(noEntrega.json?.code || '').includes('REPARTO_CONFIRMATION_ROLE');
  console.log(JSON.stringify({
    label: 'confirm.noEntregaGate',
    status: noEntrega.status,
    code: noEntrega.json?.code || null,
    pass: noEntregaPass,
  }));
  results.push(noEntregaPass);

  const pass = results.every(Boolean);
  console.log(JSON.stringify({ step: 'summary', pass, failed: results.filter((x) => !x).length }));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(JSON.stringify({ step: 'fatal', error: String(err && err.message || err) }));
  process.exit(3);
});
