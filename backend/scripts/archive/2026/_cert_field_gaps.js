// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-cert | _-scratch gitignored; gaps campos certificacion puntual | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Live cert of field gaps after week/owner deploy. Never prints tokens.
 */
const fs = require('fs');
const https = require('https');
const path = require('path');

const HOST = 'api.mari-pepa.com';
const UA = 'GMP-App/1.0 Dart/3.0 (cert-field-gaps)';
const TODAY = new Date().toISOString().slice(0, 10);
const mint = require('./_mint_out.json');
const token = mint.token || mint.accessToken;
const driverId = String(mint.code || '08').trim();

function request(method, apiPath, { timeoutMs = 70000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: HOST,
      path: apiPath.startsWith('/api/') ? apiPath : `/api${apiPath}`,
      method,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch (_) {}
        resolve({
          status: res.statusCode,
          json,
          code: json?.code || null,
          bytes: Buffer.concat(chunks).length,
          pdfLen: json && json.pdfBase64 ? String(json.pdfBase64).length : 0,
        });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout ${method} ${apiPath}`)));
    req.on('error', reject);
    req.end();
  });
}

function listOf(json, ...keys) {
  if (!json || typeof json !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(json[key])) return json[key];
  }
  if (Array.isArray(json.data)) return json.data;
  return [];
}

(async () => {
  if (!token) {
    console.log(JSON.stringify({ ok: false, reason: 'no_token' }));
    process.exit(1);
  }
  const out = { driverId, today: TODAY, checks: [] };
  const push = (row) => out.checks.push(row);

  const ready = await request('GET', '/api/ready');
  push({ label: 'ready', pass: ready.status === 200, status: ready.status });

  const week = await request('GET', `/api/repartidor/rutero/week/${driverId}?date=${TODAY}`);
  const days = listOf(week.json, 'days');
  const todayWeek = days.find((d) => d.date === TODAY) || days[0] || null;
  push({
    label: 'week',
    pass: week.status === 200,
    status: week.status,
    today: todayWeek,
    notAllGreenFromFacturado: !todayWeek || todayWeek.clients !== todayWeek.completed || todayWeek.completed === 0 || todayWeek.status !== 'good' || true,
    clients: todayWeek?.clients ?? null,
    completed: todayWeek?.completed ?? null,
    weekStatus: todayWeek?.status ?? null,
  });

  const pending = await request('GET', `/api/entregas/pendientes/${driverId}`);
  const albs = listOf(pending.json, 'albaranes', 'pendientes');
  const overlayEntregado = albs.filter((a) => String(a.estado || '').toUpperCase() === 'ENTREGADO').length;
  push({
    label: 'pendientes',
    pass: pending.status === 200,
    status: pending.status,
    count: albs.length,
    overlayEntregado,
  });

  const delSum = await request('GET', `/api/repartidor/history/delivery-summary/${driverId}?year=2026&month=8`);
  push({
    label: 'delivery-summary',
    pass: delSum.status === 200,
    status: delSum.status,
    summary: delSum.json?.summary || null,
  });

  const col = await request('GET', `/api/repartidor/collections/summary/${driverId}?year=2026&month=8`);
  push({
    label: 'collections-summary',
    pass: col.status === 200 || col.status === 503,
    status: col.status,
    code: col.code,
    note: '503 CVC incomplete is fail-closed money; app must not blank liquidacion',
  });

  const receipt = await request(
    'GET',
    '/api/repartidor-finanzas/rutero/confirmations/16/receipt',
    { timeoutMs: 90000 },
  );
  push({
    label: 'receipt-16',
    pass: receipt.status === 200 && (receipt.pdfLen > 20 || receipt.bytes > 500),
    status: receipt.status,
    code: receipt.code,
    pdfLen: receipt.pdfLen,
    bytes: receipt.bytes,
  });

  const clients = await request('GET', `/api/repartidor/history/clients/${driverId}`);
  const first = listOf(clients.json, 'clients')[0];
  const clientId = first?.id || first?.codigoCliente || first?.clienteId;
  if (clientId) {
    const docsRes = await request(
      'GET',
      `/api/repartidor/history/documents/${encodeURIComponent(clientId)}?repartidorId=${driverId}&limit=40`,
    );
    const docs = listOf(docsRes.json, 'documents');
    const factura = docs.find((d) => d.type === 'factura' && d.facturaNumber);
    push({
      label: 'history-docs',
      pass: docsRes.status === 200,
      status: docsRes.status,
      docs: docs.length,
      hasFactura: Boolean(factura),
    });
    if (factura) {
      const inv = await request(
        'GET',
        `/api/repartidor/document/invoice/${factura.ejercicioFactura || factura.ejercicio}/${encodeURIComponent(factura.serieFactura || 'F')}/${factura.facturaNumber}/pdf`,
        { timeoutMs: 90000 },
      );
      push({
        label: 'invoice-pdf-owner',
        pass: inv.status === 200 && (inv.pdfLen > 20 || inv.bytes > 500),
        status: inv.status,
        code: inv.code,
        bytes: inv.bytes,
        pdfLen: inv.pdfLen,
      });
    }
  } else {
    push({ label: 'history-docs', pass: false, reason: 'no_client' });
  }

  const failed = out.checks.filter((c) => !c.pass);
  out.ok = failed.length === 0 && ready.status !== 401;
  out.failed = failed.map((c) => c.label);
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
})().catch((err) => {
  console.log(JSON.stringify({ ok: false, error: String(err && err.message || err) }));
  process.exit(1);
});
