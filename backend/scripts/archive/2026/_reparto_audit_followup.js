// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-audit | _-scratch gitignored; seguimiento puntual auditoria reparto | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const HOST = 'api.mari-pepa.com';
const UA = 'GMP-App/1.0 Dart/3.0 (reparto-audit-followup)';
const TODAY = '2026-08-17';

function loadLogin() {
  const src = fs.readFileSync(path.join(__dirname, '_e2e_history_signature_probe.js'), 'utf8');
  return {
    username: src.match(/username:\s*'([^']+)'/)[1],
    password: src.match(/password:\s*'([^']+)'/)[1],
  };
}

function request(method, apiPath, { token, body } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: HOST,
      path: apiPath,
      method,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
          raw: raw.slice(0, 500),
          pdfLen: json && json.pdfBase64 ? String(json.pdfBase64).length : 0,
        });
      });
    });
    req.setTimeout(60000, () => req.destroy(new Error(`timeout ${method} ${apiPath}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function rec(row) {
  console.log(JSON.stringify(row));
  return row;
}

async function main() {
  const login = await request('POST', '/api/auth/login', { body: loadLogin() });
  const token0 = login.json?.token || login.json?.data?.token;
  const switched = await request('POST', '/api/auth/switch-role', {
    token: token0,
    body: { userId: '98', newRole: 'REPARTIDOR' },
  });
  const token = switched.json?.token || switched.json?.data?.token || token0;

  for (const pathName of [
    '/api/repartidor/collections/summary/08',
    '/api/repartidor/collections/daily/08',
  ]) {
    const res = await request('GET', pathName, { token });
    rec({
      label: pathName,
      status: res.status,
      code: res.json?.code || null,
      error: res.json?.error || null,
    });
  }

  const tiers = await request('PUT', '/api/repartidor-finanzas/commissions/tiers', {
    token,
    body: { tiers: [{ thresholdPct: 90, commissionPct: 1 }] },
  });
  rec({
    label: 'PUT tiers error',
    status: tiers.status,
    code: tiers.json?.code || null,
    error: String(tiers.json?.error || tiers.raw).slice(0, 240),
  });

  const venc = await request('GET', `/api/repartidor-finanzas/vencimientos/08?from=2026-01-01&to=${TODAY}&limit=3`, { token });
  const items = venc.json?.vencimientos || [];
  rec({
    label: 'vencimientos.keys',
    status: venc.status,
    sampleKeys: items[0] ? Object.keys(items[0]) : [],
    sample: items[0] ? {
      documento: items[0].documento,
      docId: items[0].docId,
      id: items[0].id,
      tipo: items[0].tipo,
      estado: items[0].estado,
      cliente: items[0].codigoCliente || items[0].cliente,
    } : null,
  });
  if (items[0]) {
    const docId = items[0].documento || items[0].docId || items[0].id;
    const det = await request('GET', `/api/repartidor-finanzas/vencimientos/08/${encodeURIComponent(docId)}/detalle`, { token });
    rec({
      label: 'vencimiento.detalle',
      status: det.status,
      code: det.json?.code || null,
      docId,
      hasDetalle: Boolean(det.json?.detalle),
    });
  }

  const clients = await request('GET', '/api/repartidor/history/clients/08', { token });
  const list = clients.json?.clients || clients.json?.data || [];
  let foundSigned = null;
  let scanned = 0;
  for (const client of list.slice(0, 12)) {
    const clientId = client.id || client.codigoCliente || client.clienteId || client.code;
    if (!clientId) continue;
    scanned += 1;
    const docsRes = await request(
      'GET',
      `/api/repartidor/history/documents/${encodeURIComponent(clientId)}?repartidorId=08&limit=30`,
      { token },
    );
    const docs = docsRes.json?.documents || docsRes.json?.data || [];
    const hit = docs.find((d) => d.confirmationId || d.hasSignature || d.hasLegacySignature);
    const factura = docs.find((d) => d.type === 'factura' && d.facturaNumber);
    if (hit && !foundSigned) {
      foundSigned = { clientId, doc: {
        type: hit.type,
        number: hit.number,
        albaranNumber: hit.albaranNumber,
        facturaNumber: hit.facturaNumber,
        confirmationId: hit.confirmationId || null,
        hasSignature: Boolean(hit.hasSignature),
        hasLegacySignature: Boolean(hit.hasLegacySignature),
        ejercicio: hit.ejercicio,
        serie: hit.serie,
        terminal: hit.terminal,
      } };
    }
    if (factura) {
      const inv = await request(
        'GET',
        `/api/repartidor/document/invoice/${factura.ejercicioFactura || factura.ejercicio}/${encodeURIComponent(factura.serieFactura || 'F')}/${factura.facturaNumber}/pdf`,
        { token },
      );
      rec({
        label: 'invoice.pdf',
        status: inv.status,
        pdfLen: inv.pdfLen,
        bytes: inv.raw ? inv.raw.length : 0,
        code: inv.json?.code || null,
        facturaNumber: factura.facturaNumber,
      });
      if (!foundSigned) {
        // keep scanning for signature even after invoice
      } else {
        break;
      }
    }
  }
  rec({ label: 'history.scan', scanned, foundSigned });

  if (foundSigned?.doc) {
    const d = foundSigned.doc;
    const sig = await request(
      'GET',
      `/api/repartidor/history/signature?ejercicio=${d.ejercicio}&serie=${encodeURIComponent(d.serie || 'A')}&terminal=${d.terminal || 0}&numero=${d.albaranNumber || d.number}`,
      { token },
    );
    rec({
      label: 'history.signature.signedSample',
      status: sig.status,
      hasSignature: Boolean(sig.json?.hasSignature),
      dni: sig.json?.receptor?.dni || sig.json?.dni || null,
      nombre: sig.json?.receptor?.nombre || sig.json?.firmante || null,
      apellidos: sig.json?.receptor?.apellidos || null,
      source: sig.json?.signature?.source || sig.json?.source || null,
      hasBase64: Boolean(sig.json?.signature?.base64 || sig.json?.base64),
    });
    if (d.confirmationId) {
      const receipt = await request(
        'GET',
        `/api/repartidor-finanzas/rutero/confirmations/${encodeURIComponent(d.confirmationId)}/receipt`,
        { token },
      );
      rec({
        label: 'receipt.signedSample',
        status: receipt.status,
        pdfLen: receipt.pdfLen,
        code: receipt.json?.code || null,
      });
    }
  }

  for (const id of ['53', '97', 'A4', '15']) {
    const daily = await request('GET', `/api/repartidor-finanzas/daily-summary/${id}?date=${TODAY}`, { token });
    const s = daily.json?.summary || daily.json || {};
    rec({
      label: `daily.${id}`,
      status: daily.status,
      efectivo: s.totalEfectivo ?? null,
      aIngresar: s.totalAIngresar ?? null,
      gastos: s.gastos ?? null,
      entregado: s.entregado ?? null,
      tarjeta: s.totalTarjeta ?? null,
    });
  }

  const ledger = await request('GET', `/api/repartidor-finanzas/liquidaciones/08/desglose?date=${TODAY}`, { token });
  rec({
    label: 'ledger.08.afterAjuste',
    status: ledger.status,
    adjustments: ledger.json?.ledger?.adjustments || ledger.json?.ledger?.ajustes || null,
    expenses: ledger.json?.ledger?.expenses || null,
  });

  const week = await request('GET', `/api/repartidor/rutero/week/08?date=${TODAY}`, { token });
  const pend = await request('GET', `/api/entregas/pendientes/08?date=${TODAY}&limit=20&offset=0`, { token });
  const rows = pend.json?.data || pend.json?.albaranes || [];
  rec({
    label: 'week.vs.pendientes.08',
    weekToday: (week.json?.days || []).find((d) => d.date === TODAY),
    pendientes: rows.length,
    estados: rows.map((r) => ({ id: r.id, estado: r.estado || r.status, factura: r.numeroFactura || null })),
  });
}

main().catch((error) => {
  console.error(String(error && error.stack ? error.stack : error));
  process.exit(1);
});
