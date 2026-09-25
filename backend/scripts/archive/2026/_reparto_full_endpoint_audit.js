// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-audit | _-scratch gitignored; auditoria puntual endpoints reparto | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Exhaustive live audit of every REPARTIDOR-profile endpoint.
 * Reads production via HTTPS. Writes only when ALLOW_TEST_WRITES=1
 * (isolated TEST tables). Never closes a day. Never emails a real recipient.
 */
const fs = require('fs');
const https = require('https');
const path = require('path');

const HOST = process.env.E2E_HOST || 'api.mari-pepa.com';
const UA = 'GMP-App/1.0 Dart/3.0 (reparto-full-endpoint-audit)';
const TODAY = process.env.AUDIT_DATE || new Date().toISOString().slice(0, 10);
const ALLOW_WRITES = process.env.ALLOW_TEST_WRITES === '1';
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function loadLogin() {
  const probePath = path.join(__dirname, '_e2e_history_signature_probe.js');
  const src = fs.readFileSync(probePath, 'utf8');
  const username = src.match(/username:\s*'([^']+)'/)[1];
  const password = src.match(/password:\s*'([^']+)'/)[1];
  return { username, password };
}

function request(method, apiPath, { token, body, headers = {}, timeoutMs = 60000 } = {}) {
  const payload = body == null ? null : (Buffer.isBuffer(body) ? body : JSON.stringify(body));
  const isJsonBody = payload && !Buffer.isBuffer(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: HOST,
      path: apiPath.startsWith('/api/') ? apiPath : `/api${apiPath}`,
      method,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        ...(isJsonBody ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size <= 12 * 1024 * 1024) chunks.push(c);
      });
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch (_) { /* binary or html */ }
        const pdfLen = json && json.pdfBase64 ? String(json.pdfBase64).length : 0;
        resolve({
          status: res.statusCode,
          json,
          raw: raw.slice(0, 280),
          bytes: size,
          pdfLen,
          contentType: String(res.headers['content-type'] || ''),
        });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout ${method} ${apiPath}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const results = [];

function rec(row) {
  console.log(JSON.stringify(row));
  results.push(row);
  return row.pass;
}

function ok2xx(status) {
  return status >= 200 && status < 300;
}

function ok4xx(status) {
  return status >= 400 && status < 500;
}

function listOf(json, ...keys) {
  if (Array.isArray(json)) return json;
  for (const key of keys) {
    if (Array.isArray(json?.[key])) return json[key];
    if (Array.isArray(json?.data?.[key])) return json.data[key];
  }
  if (Array.isArray(json?.data)) return json.data;
  return [];
}

async function pickDriver(token) {
  const preferred = ['08', '53', '97', 'A4', '15'];
  const found = [];
  for (const id of preferred) {
    const res = await request('GET', `/api/entregas/pendientes/${id}?date=${TODAY}&limit=20&offset=0`, { token });
    const rows = listOf(res.json, 'albaranes', 'pendientes', 'entregas');
    found.push({ id, status: res.status, count: rows.length, rows });
    if (res.status === 200 && rows.length > 0) {
      return { driverId: id, pendientes: res, rows, scanned: found };
    }
  }
  return { driverId: '08', pendientes: found[0] ? null : null, rows: found[0]?.rows || [], scanned: found };
}

function pendingRow(rows) {
  return rows.find((row) => {
    const estado = String(row.estado || row.status || '').toUpperCase();
    return !['ENTREGADO', 'DELIVERED', 'CONFIRMED'].includes(estado);
  }) || rows[0];
}

async function main() {
  const loginBody = loadLogin();
  const login = await request('POST', '/api/auth/login', { body: loginBody });
  const token0 = login.json?.token || login.json?.data?.token;
  rec({
    label: 'POST /auth/login',
    pass: login.status === 200 && Boolean(token0),
    status: login.status,
  });
  if (!token0) {
    rec({ label: 'ABORT', pass: false, reason: 'no_token' });
    process.exit(1);
  }

  const switched = await request('POST', '/api/auth/switch-role', {
    token: token0,
    body: { userId: '98', newRole: 'REPARTIDOR' },
  });
  const token = switched.json?.token || switched.json?.data?.token || token0;
  const role = switched.json?.user?.role || switched.json?.role;
  const mode = switched.json?.user?.activeMode || switched.json?.activeMode;
  rec({
    label: 'POST /auth/switch-role REPARTIDOR',
    pass: switched.status === 200 && Boolean(token),
    status: switched.status,
    role,
    mode,
  });

  const reps = await request('GET', '/api/auth/repartidores', { token });
  const repList = listOf(reps.json, 'repartidores', 'users');
  rec({
    label: 'GET /auth/repartidores',
    pass: reps.status === 200,
    status: reps.status,
    count: repList.length,
  });

  const version = await request('GET', '/api/health/version-check', { token });
  rec({
    label: 'GET /health/version-check',
    pass: ok2xx(version.status),
    status: version.status,
  });

  const chatbot = await request('GET', '/api/chatbot/health', { token });
  rec({
    label: 'GET /chatbot/health',
    pass: ok2xx(chatbot.status),
    status: chatbot.status,
    raw: chatbot.raw.slice(0, 120),
  });

  const picked = await pickDriver(token);
  const driverId = picked.driverId;
  rec({
    label: 'driver.pick',
    pass: true,
    driverId,
    writes: ALLOW_WRITES,
    date: TODAY,
    scanned: picked.scanned.map((s) => ({ id: s.id, status: s.status, count: s.count })),
  });

  const cfg = await request('GET', '/api/repartidor/config', { token });
  rec({
    label: 'GET /repartidor/config',
    pass: cfg.status === 200 && Boolean(cfg.json?.config || cfg.json?.success),
    status: cfg.status,
  });

  const colSum = await request('GET', `/api/repartidor/collections/summary/${driverId}`, { token });
  rec({
    label: `GET /repartidor/collections/summary/${driverId}`,
    pass: colSum.status === 200,
    status: colSum.status,
    clientCount: colSum.json?.summary?.clientCount ?? colSum.json?.clientCount ?? null,
  });

  const colDaily = await request('GET', `/api/repartidor/collections/daily/${driverId}?date=${TODAY}`, { token });
  rec({
    label: `GET /repartidor/collections/daily/${driverId}`,
    pass: colDaily.status === 200,
    status: colDaily.status,
  });

  const histClients = await request('GET', `/api/repartidor/history/clients/${driverId}`, { token });
  const clients = listOf(histClients.json, 'clients');
  rec({
    label: `GET /repartidor/history/clients/${driverId}`,
    pass: histClients.status === 200,
    status: histClients.status,
    count: clients.length,
  });

  const clientId = clients[0]?.id || clients[0]?.codigoCliente || clients[0]?.clienteId || clients[0]?.code || null;
  let docs = [];
  let signedDoc = null;
  let notedDoc = null;
  if (clientId) {
    const docsRes = await request(
      'GET',
      `/api/repartidor/history/documents/${encodeURIComponent(clientId)}?repartidorId=${driverId}&limit=50`,
      { token },
    );
    docs = listOf(docsRes.json, 'documents');
    rec({
      label: 'GET /repartidor/history/documents/:clientId',
      pass: docsRes.status === 200,
      status: docsRes.status,
      clientId,
      count: docs.length,
      withConfirmationId: docs.filter((d) => d.confirmationId).length,
      withSignature: docs.filter((d) => d.hasSignature || d.signaturePath || d.hasLegacySignature).length,
      types: [...new Set(docs.map((d) => d.type).filter(Boolean))],
    });
    signedDoc = docs.find((d) => d.hasSignature || d.confirmationId) || docs[0];
    notedDoc = docs.find((d) => d.confirmationId);
  } else {
    rec({ label: 'GET /repartidor/history/documents/:clientId', pass: false, reason: 'no_client' });
  }

  const obj = await request('GET', `/api/repartidor/history/objectives/${driverId}`, { token });
  rec({
    label: `GET /repartidor/history/objectives/${driverId}`,
    pass: obj.status === 200,
    status: obj.status,
  });
  const objDet = await request('GET', `/api/repartidor/history/objectives-detail/${driverId}`, { token });
  rec({
    label: `GET /repartidor/history/objectives-detail/${driverId}`,
    pass: objDet.status === 200,
    status: objDet.status,
  });
  const delSum = await request('GET', `/api/repartidor/history/delivery-summary/${driverId}`, { token });
  rec({
    label: `GET /repartidor/history/delivery-summary/${driverId}`,
    pass: delSum.status === 200,
    status: delSum.status,
  });

  if (signedDoc) {
    const sig = await request(
      'GET',
      `/api/repartidor/history/signature?ejercicio=${signedDoc.ejercicio}&serie=${encodeURIComponent(signedDoc.serie || 'A')}&terminal=${signedDoc.terminal || 0}&numero=${signedDoc.albaranNumber || signedDoc.number}`,
      { token },
    );
    const receptor = sig.json?.receptor || sig.json?.signature || {};
    rec({
      label: 'GET /repartidor/history/signature',
      pass: sig.status === 200,
      status: sig.status,
      hasSignature: Boolean(sig.json?.hasSignature),
      hasBase64: Boolean(sig.json?.signature?.base64 || sig.json?.base64 || receptor.base64),
      source: sig.json?.signature?.source || sig.json?.source || null,
      dni: sig.json?.receptor?.dni || sig.json?.dni || receptor.dni || null,
      nombre: sig.json?.receptor?.nombre || sig.json?.firmante || receptor.nombre || null,
      apellidos: sig.json?.receptor?.apellidos || receptor.apellidos || null,
    });
  } else {
    rec({ label: 'GET /repartidor/history/signature', pass: true, skipped: 'no_document' });
  }

  const histRange = await request(
    'GET',
    `/api/repartidor/history/${driverId}?startDate=2026-08-01&endDate=${TODAY}&limit=20&offset=0`,
    { token },
  );
  rec({
    label: `GET /repartidor/history/${driverId}`,
    pass: histRange.status === 200,
    status: histRange.status,
    count: Array.isArray(histRange.json?.data) ? histRange.json.data.length : null,
  });

  if (signedDoc) {
    const albPdf = await request(
      'GET',
      `/api/repartidor/document/albaran/${signedDoc.ejercicio}/${encodeURIComponent(signedDoc.serie || 'A')}/${signedDoc.terminal || 1}/${signedDoc.albaranNumber || signedDoc.number}/pdf`,
      { token, timeoutMs: 90000 },
    );
    rec({
      label: 'GET /repartidor/document/albaran/.../pdf',
      pass: albPdf.status === 200 && (albPdf.pdfLen > 20 || albPdf.bytes > 500),
      status: albPdf.status,
      pdfLen: albPdf.pdfLen,
      bytes: albPdf.bytes,
      code: albPdf.json?.code || null,
    });
    const fYear = signedDoc.ejercicioFactura || signedDoc.ejercicio;
    const fSerie = signedDoc.serieFactura || 'F';
    const fNum = signedDoc.facturaNumber;
    if (fNum) {
      const invPdf = await request(
        'GET',
        `/api/repartidor/document/invoice/${fYear}/${encodeURIComponent(fSerie)}/${fNum}/pdf`,
        { token, timeoutMs: 90000 },
      );
      rec({
        label: 'GET /repartidor/document/invoice/.../pdf',
        pass: invPdf.status === 200 && (invPdf.pdfLen > 20 || invPdf.bytes > 500),
        status: invPdf.status,
        pdfLen: invPdf.pdfLen,
        bytes: invPdf.bytes,
        code: invPdf.json?.code || null,
      });
    } else {
      rec({ label: 'GET /repartidor/document/invoice/.../pdf', pass: true, skipped: 'no_facturaNumber' });
    }
  }

  const sendEmail = await request('POST', '/api/repartidor/document/send-email', {
    token,
    body: {
      ejercicio: signedDoc?.ejercicio || 2026,
      serie: signedDoc?.serie || 'A',
      numero: signedDoc?.albaranNumber || signedDoc?.number || 1,
      type: 'albaran',
      destinatario: 'not-an-email',
      terminal: signedDoc?.terminal || 1,
    },
  });
  rec({
    label: 'POST /repartidor/document/send-email',
    pass: sendEmail.status === 422 && sendEmail.json?.code === 'EMAIL_INVALID',
    status: sendEmail.status,
    code: sendEmail.json?.code || null,
    note: 'app maps 503 to unavailable; not a silent success',
  });

  const waBad = await request('POST', '/api/repartidor/document/share/whatsapp', {
    token,
    body: { telefono: 'abc' },
  });
  rec({
    label: 'POST /repartidor/document/share/whatsapp invalid',
    pass: waBad.status === 422,
    status: waBad.status,
    code: waBad.json?.code || null,
  });
  if (signedDoc) {
    const waOk = await request('POST', '/api/repartidor/document/share/whatsapp', {
      token,
      body: {
        telefono: '34600111222',
        ejercicio: signedDoc.ejercicio,
        serie: signedDoc.serie || 'A',
        numero: signedDoc.albaranNumber || signedDoc.number,
        terminal: signedDoc.terminal || 1,
        type: 'albaran',
      },
    });
    rec({
      label: 'POST /repartidor/document/share/whatsapp local',
      pass: waOk.status === 200 && waOk.json?.localShare === true && waOk.json?.sent === false,
      status: waOk.status,
      localShare: waOk.json?.localShare,
      sent: waOk.json?.sent,
    });
  }

  const orderGet = await request('GET', `/api/repartidor/rutero/order/${driverId}?date=${TODAY}`, { token });
  rec({
    label: `GET /repartidor/rutero/order/${driverId}`,
    pass: orderGet.status === 200 || orderGet.status === 503,
    status: orderGet.status,
    code: orderGet.json?.code || null,
    ordenLen: Array.isArray(orderGet.json?.orden) ? orderGet.json.orden.length : null,
  });
  const orderBad = await request('PUT', `/api/repartidor/rutero/order/${driverId}`, {
    token,
    body: { date: 'nope', orden: [] },
  });
  rec({
    label: 'PUT /repartidor/rutero/order invalid',
    pass: orderBad.status === 422,
    status: orderBad.status,
    code: orderBad.json?.code || null,
  });
  const optBad = await request('POST', `/api/repartidor/rutero/order/${driverId}/optimize`, {
    token,
    body: { date: TODAY },
  });
  rec({
    label: 'POST /repartidor/rutero/order/optimize invalid',
    pass: optBad.status === 422,
    status: optBad.status,
    code: optBad.json?.code || null,
  });

  const geo = await request('GET', `/api/repartidor/rutero/stops-geo/${driverId}?date=${TODAY}`, { token });
  rec({
    label: `GET /repartidor/rutero/stops-geo/${driverId}`,
    pass: geo.status === 200 || geo.status === 422 || geo.status === 503,
    status: geo.status,
    code: geo.json?.code || null,
    stops: Array.isArray(geo.json?.stops) ? geo.json.stops.length : (Array.isArray(geo.json?.data) ? geo.json.data.length : null),
  });
  const week = await request('GET', `/api/repartidor/rutero/week/${driverId}?date=${TODAY}`, { token });
  const weekDays = week.json?.days || [];
  rec({
    label: `GET /repartidor/rutero/week/${driverId}`,
    pass: week.status === 200 && Array.isArray(weekDays) && weekDays.length === 7,
    status: week.status,
    daysWithStops: weekDays.filter((d) => (d.clients || 0) > 0).map((d) => ({ date: d.date, clients: d.clients, status: d.status })),
  });

  const legacyEnt = await request('POST', '/api/repartidor/entregas', { token, body: {} });
  rec({
    label: 'POST /repartidor/entregas legacy 410',
    pass: legacyEnt.status === 410,
    status: legacyEnt.status,
    code: legacyEnt.json?.code || null,
  });
  const legacyCob = await request('POST', '/api/repartidor/cobros', { token, body: {} });
  rec({
    label: 'POST /repartidor/cobros legacy 410',
    pass: legacyCob.status === 410,
    status: legacyCob.status,
    code: legacyCob.json?.code || null,
  });

  let pendientes = picked.pendientes;
  let pendingRows = picked.rows;
  if (!pendientes) {
    pendientes = await request('GET', `/api/entregas/pendientes/${driverId}?date=${TODAY}&limit=50&offset=0`, { token });
    pendingRows = listOf(pendientes.json, 'albaranes', 'pendientes', 'entregas');
  }
  rec({
    label: `GET /entregas/pendientes/${driverId}`,
    pass: pendientes.status === 200,
    status: pendientes.status,
    count: pendingRows.length,
  });

  const payCond = await request('GET', '/api/entregas/payment-conditions', { token });
  rec({
    label: 'GET /entregas/payment-conditions',
    pass: payCond.status === 200,
    status: payCond.status,
    count: listOf(payCond.json, 'conditions', 'paymentConditions').length || Object.keys(payCond.json?.paymentConditions || payCond.json?.data || {}).length,
  });

  const alb = pendingRow(pendingRows);
  let detail = null;
  if (alb) {
    const numero = alb.numeroAlbaran || alb.numero;
    const ejercicio = alb.ejercicio;
    const serie = encodeURIComponent(alb.serie || 'A');
    const terminal = encodeURIComponent(alb.terminal ?? 1);
    const cliente = encodeURIComponent(alb.codigoCliente || alb.cliente);
    detail = await request(
      'GET',
      `/api/entregas/albaran/${numero}/${ejercicio}?serie=${serie}&terminal=${terminal}&cliente=${cliente}`,
      { token },
    );
    const items = detail.json?.albaran?.items || [];
    rec({
      label: 'GET /entregas/albaran/:numero/:ejercicio',
      pass: detail.status === 200 && Boolean(detail.json?.albaran?.id),
      status: detail.status,
      id: detail.json?.albaran?.id || alb.id,
      lines: items.length,
      estado: detail.json?.albaran?.estado || null,
      confirmationAvailability: detail.json?.albaran?.confirmationAvailability || null,
      documentoTipo: detail.json?.albaran?.documentoTipo || null,
    });

    const geoStops = listOf(geo.json, 'stops');
    const optStops = (items.length ? [{ documentId: detail.json.albaran.id, cliente: detail.json.albaran.codigoCliente }] : geoStops.slice(0, 3).map((s) => ({
      documentId: s.documentId || s.id,
      cliente: s.cliente || s.codigoCliente,
    }))).filter((s) => s.documentId && s.cliente);
    if (optStops.length) {
      const optOk = await request('POST', `/api/repartidor/rutero/order/${driverId}/optimize`, {
        token,
        body: { date: TODAY, stops: optStops },
      });
      rec({
        label: 'POST /repartidor/rutero/order/optimize',
        pass: optOk.status === 200 && Array.isArray(optOk.json?.orden),
        status: optOk.status,
        algorithm: optOk.json?.algorithm || null,
        ordenLen: Array.isArray(optOk.json?.orden) ? optOk.json.orden.length : null,
      });
    }
  } else {
    rec({ label: 'GET /entregas/albaran/:numero/:ejercicio', pass: true, skipped: 'no_pending' });
  }

  const upd410 = await request('POST', '/api/entregas/update', { token, body: {} });
  rec({
    label: 'POST /entregas/update legacy 410',
    pass: upd410.status === 410,
    status: upd410.status,
    code: upd410.json?.code || null,
  });
  const photo410 = await request('POST', '/api/entregas/uploads/photo', { token, body: {} });
  rec({
    label: 'POST /entregas/uploads/photo legacy 410',
    pass: photo410.status === 410,
    status: photo410.status,
    code: photo410.json?.code || null,
  });
  const sig410 = await request('POST', '/api/entregas/uploads/signature', { token, body: {} });
  rec({
    label: 'POST /entregas/uploads/signature legacy 410',
    pass: sig410.status === 410,
    status: sig410.status,
    code: sig410.json?.code || null,
  });

  const daily = await request('GET', `/api/repartidor-finanzas/daily-summary/${driverId}?date=${TODAY}`, { token });
  const summaryBody = daily.json?.summary || daily.json?.data || daily.json || {};
  rec({
    label: `GET /repartidor-finanzas/daily-summary/${driverId}`,
    pass: daily.status === 200,
    status: daily.status,
    totalEfectivo: summaryBody.totalEfectivo ?? summaryBody.efectivo ?? null,
    totalAIngresar: summaryBody.totalAIngresar ?? null,
    gastos: summaryBody.gastos ?? null,
    entregado: summaryBody.entregado ?? null,
  });
  const monthly = await request('GET', `/api/repartidor-finanzas/summary/${driverId}`, { token });
  rec({
    label: `GET /repartidor-finanzas/summary/${driverId}`,
    pass: monthly.status === 200,
    status: monthly.status,
  });
  const venc = await request('GET', `/api/repartidor-finanzas/vencimientos/${driverId}?from=2026-01-01&to=${TODAY}&limit=20`, { token });
  const vencItems = listOf(venc.json, 'vencimientos');
  rec({
    label: `GET /repartidor-finanzas/vencimientos/${driverId}`,
    pass: venc.status === 200,
    status: venc.status,
    count: vencItems.length,
    total: venc.json?.pagination?.total ?? null,
  });
  if (vencItems[0]?.id || vencItems[0]?.docId) {
    const docId = vencItems[0].id || vencItems[0].docId;
    const det = await request('GET', `/api/repartidor-finanzas/vencimientos/${driverId}/${encodeURIComponent(docId)}/detalle`, { token });
    rec({
      label: 'GET /repartidor-finanzas/vencimientos/:id/:docId/detalle',
      pass: det.status === 200 || det.status === 404,
      status: det.status,
      docId,
    });
  } else {
    rec({ label: 'GET /repartidor-finanzas/vencimientos/:id/:docId/detalle', pass: true, skipped: 'no_vencimiento' });
  }
  const cuentas = await request('GET', `/api/repartidor-finanzas/cuentas/${driverId}`, { token });
  rec({
    label: `GET /repartidor-finanzas/cuentas/${driverId}`,
    pass: cuentas.status === 200,
    status: cuentas.status,
    saldoActual: cuentas.json?.cuenta?.saldoActual ?? null,
  });
  const evo = await request('GET', `/api/repartidor-finanzas/evolution/${driverId}`, { token });
  rec({
    label: `GET /repartidor-finanzas/evolution/${driverId}`,
    pass: evo.status === 200,
    status: evo.status,
    months: Array.isArray(evo.json?.evolution) ? evo.json.evolution.length : null,
  });
  const tiers = await request('GET', '/api/repartidor-finanzas/commissions/tiers', { token });
  rec({
    label: 'GET /repartidor-finanzas/commissions/tiers',
    pass: tiers.status === 200,
    status: tiers.status,
  });
  const putTiers = await request('PUT', '/api/repartidor-finanzas/commissions/tiers', {
    token,
    body: { tiers: [{ thresholdPct: 90, commissionPct: 1 }] },
  });
  rec({
    label: 'PUT /repartidor-finanzas/commissions/tiers denied',
    pass: putTiers.status === 403,
    status: putTiers.status,
  });
  const comm = await request('GET', `/api/repartidor-finanzas/commissions/summary/${driverId}`, { token });
  rec({
    label: `GET /repartidor-finanzas/commissions/summary/${driverId}`,
    pass: comm.status === 200,
    status: comm.status,
  });
  const desglose = await request('GET', `/api/repartidor-finanzas/liquidaciones/${driverId}/desglose?date=${TODAY}`, { token });
  rec({
    label: `GET /repartidor-finanzas/liquidaciones/${driverId}/desglose`,
    pass: desglose.status === 200,
    status: desglose.status,
    expenses: Array.isArray(desglose.json?.ledger?.expenses) ? desglose.json.ledger.expenses.length : null,
  });

  const closeBad = await request('POST', '/api/repartidor-finanzas/liquidaciones', {
    token,
    body: { repartidorId: driverId },
  });
  rec({
    label: 'POST /repartidor-finanzas/liquidaciones close gate',
    pass: ok4xx(closeBad.status),
    status: closeBad.status,
    code: closeBad.json?.code || null,
  });
  const gastoBad = await request('POST', '/api/repartidor-finanzas/liquidaciones/gastos', {
    token,
    body: { repartidorId: driverId, date: TODAY, amount: -1, category: 'X', idempotencyToken: 'short' },
  });
  rec({
    label: 'POST /repartidor-finanzas/liquidaciones/gastos invalid',
    pass: gastoBad.status === 422,
    status: gastoBad.status,
    code: gastoBad.json?.code || null,
  });
  const ajBad = await request('POST', '/api/repartidor-finanzas/liquidaciones/ajustes', {
    token,
    body: { repartidorId: driverId, date: TODAY, amount: 1, reason: 'probe', idempotencyToken: 'AUDIT-AJUSTE-NOPE-01' },
  });
  rec({
    label: 'POST /repartidor-finanzas/liquidaciones/ajustes role',
    pass: ajBad.status === 403 || ajBad.status === 422,
    status: ajBad.status,
    code: ajBad.json?.code || null,
  });
  const ingBad = await request('POST', '/api/repartidor-finanzas/liquidaciones/ingresos-bancarios', {
    token,
    body: { repartidorId: driverId, date: TODAY, amount: 0, reference: 'x', idempotencyToken: 'short' },
  });
  rec({
    label: 'POST /repartidor-finanzas/liquidaciones/ingresos-bancarios invalid',
    pass: ingBad.status === 422,
    status: ingBad.status,
    code: ingBad.json?.code || null,
  });
  const reopen = await request('POST', '/api/repartidor-finanzas/liquidaciones/AUDITTOK/reopen', { token, body: {} });
  rec({
    label: 'POST /repartidor-finanzas/liquidaciones/:token/reopen',
    pass: reopen.status === 501 || reopen.status === 422,
    status: reopen.status,
    code: reopen.json?.code || null,
  });
  const resend = await request('POST', '/api/repartidor-finanzas/liquidaciones/AUDITTOK/resend-emails', { token, body: {} });
  rec({
    label: 'POST /repartidor-finanzas/liquidaciones/:token/resend-emails',
    pass: resend.status === 503 || resend.status === 422,
    status: resend.status,
    code: resend.json?.code || null,
  });

  const cobroBad = await request('POST', '/api/repartidor-finanzas/cobros', { token, body: {} });
  rec({
    label: 'POST /repartidor-finanzas/cobros invalid',
    pass: ok4xx(cobroBad.status),
    status: cobroBad.status,
    code: cobroBad.json?.code || null,
  });
  const revBad = await request('POST', '/api/repartidor-finanzas/cobros/reverse', { token, body: {} });
  rec({
    label: 'POST /repartidor-finanzas/cobros/reverse invalid',
    pass: ok4xx(revBad.status),
    status: revBad.status,
    code: revBad.json?.code || null,
  });

  const confirmEmpty = await request('POST', '/api/repartidor-finanzas/rutero/confirm-delivery-cobro', {
    token,
    body: {},
    headers: { 'Idempotency-Key': 'rep-audit-empty-01' },
  });
  rec({
    label: 'POST /repartidor-finanzas/rutero/confirm-delivery-cobro invalid',
    pass: confirmEmpty.status === 400 || confirmEmpty.status === 422,
    status: confirmEmpty.status,
    code: confirmEmpty.json?.code || null,
  });
  const sigEmpty = await request('POST', '/api/repartidor-finanzas/rutero/evidence/signature', {
    token,
    body: {},
  });
  rec({
    label: 'POST /repartidor-finanzas/rutero/evidence/signature invalid',
    pass: ok4xx(sigEmpty.status),
    status: sigEmpty.status,
    code: sigEmpty.json?.code || null,
  });
  const photoEmpty = await request('POST', '/api/repartidor-finanzas/rutero/evidence/photo', {
    token,
    body: {},
  });
  rec({
    label: 'POST /repartidor-finanzas/rutero/evidence/photo invalid',
    pass: ok4xx(photoEmpty.status),
    status: photoEmpty.status,
    code: photoEmpty.json?.code || null,
  });
  const evMissing = await request('GET', '/api/repartidor-finanzas/rutero/evidence/ev_missingmissingmissingmissingmissingmissingmissingxx', { token });
  rec({
    label: 'GET /repartidor-finanzas/rutero/evidence/:id missing',
    pass: evMissing.status === 404 || evMissing.status === 422 || evMissing.status === 400,
    status: evMissing.status,
    code: evMissing.json?.code || null,
  });
  const recBad = await request('GET', '/api/repartidor-finanzas/rutero/confirmations/receipt', { token });
  rec({
    label: 'GET /repartidor-finanzas/rutero/confirmations/receipt missing key',
    pass: recBad.status === 422,
    status: recBad.status,
    code: recBad.json?.code || null,
  });

  if (notedDoc?.confirmationId) {
    const receipt = await request(
      'GET',
      `/api/repartidor-finanzas/rutero/confirmations/${encodeURIComponent(notedDoc.confirmationId)}/receipt`,
      { token, timeoutMs: 90000 },
    );
    rec({
      label: 'GET /repartidor-finanzas/rutero/confirmations/:id/receipt',
      pass: receipt.status === 200 && receipt.pdfLen > 20,
      status: receipt.status,
      pdfLen: receipt.pdfLen,
      code: receipt.json?.code || null,
      confirmationId: notedDoc.confirmationId,
    });
    const mailBad = await request(
      'POST',
      `/api/repartidor-finanzas/rutero/confirmations/${encodeURIComponent(notedDoc.confirmationId)}/receipt/email`,
      { token, body: { destinatario: 'not-an-email' } },
    );
    rec({
      label: 'POST .../receipt/email invalid',
      pass: mailBad.status === 422,
      status: mailBad.status,
      code: mailBad.json?.code || null,
    });
  } else {
    rec({ label: 'GET /repartidor-finanzas/rutero/confirmations/:id/receipt', pass: true, skipped: 'no_confirmationId' });
    rec({ label: 'POST .../receipt/email invalid', pass: true, skipped: 'no_confirmationId' });
  }

  const cleanup = await request('DELETE', '/api/repartidor-finanzas/test-cleanup/AUDITTOK', { token });
  rec({
    label: 'DELETE /repartidor-finanzas/test-cleanup denied',
    pass: cleanup.status === 403 || cleanup.status === 422,
    status: cleanup.status,
  });

  if (alb) {
    const fakeId = alb.id || '2026-A-1-1-1';
    const recLegacy = await request('POST', `/api/entregas/receipt/${encodeURIComponent(fakeId)}`, { token, body: {} });
    rec({
      label: 'POST /entregas/receipt/:id',
      pass: recLegacy.status === 200 || recLegacy.status === 404 || recLegacy.status === 409 || recLegacy.status === 422 || recLegacy.status === 503,
      status: recLegacy.status,
      code: recLegacy.json?.code || null,
      pdfLen: recLegacy.pdfLen,
    });
  }

  if (ALLOW_WRITES && detail?.json?.albaran) {
    const albaran = detail.json.albaran;
    const items = (albaran.items || []).filter((i) => i.codigoArticulo);
    if (!items.length) {
      rec({ label: 'WRITE confirm', pass: false, reason: 'no_lines' });
    } else if (String(albaran.estado).toUpperCase() === 'ENTREGADO') {
      rec({ label: 'WRITE confirm', pass: true, skipped: 'already_entregado', id: albaran.id });
    } else {
      const sigUp = await request('POST', '/api/repartidor-finanzas/rutero/evidence/signature', {
        token,
        body: {
          documentId: albaran.id,
          signature: `data:image/png;base64,${PNG_1X1}`,
          repartidorId: driverId,
        },
      });
      const evidenceId = sigUp.json?.evidenceId || sigUp.json?.id;
      rec({
        label: 'WRITE POST evidence/signature',
        pass: (sigUp.status === 201 || sigUp.status === 200) && Boolean(evidenceId),
        status: sigUp.status,
        code: sigUp.json?.code || null,
        evidenceId: evidenceId || null,
      });
      if (evidenceId) {
        const evGet = await request('GET', `/api/repartidor-finanzas/rutero/evidence/${encodeURIComponent(evidenceId)}`, { token });
        rec({
          label: 'WRITE GET evidence/:id',
          pass: evGet.status === 200,
          status: evGet.status,
        });
        const confirm = await request('POST', '/api/repartidor-finanzas/rutero/confirm-delivery-cobro', {
          token,
          headers: { 'Idempotency-Key': `rep-audit-${TODAY.replace(/-/g, '')}-${driverId}-01` },
          body: {
            delivery: {
              itemId: albaran.id,
              status: 'ENTREGADO',
              occurredAt: new Date().toISOString(),
              repartidorId: driverId,
              lineas: items.map((line) => ({
                lineaId: String(line.itemId),
                codigoArticulo: line.codigoArticulo,
                cantidadPedida: Number(line.cantidadPedida) || 0,
                cantidadEntregada: Number(line.cantidadPedida) || 0,
                cantidadRechazada: 0,
                cantidadPendiente: 0,
                motivoDiferencia: null,
              })),
              receiver: { nombre: 'Ana', apellidos: 'Lopez Ruiz', dni: '12345678Z' },
              firma: evidenceId,
              evidencias: [evidenceId],
              observaciones: 'Auditoria endpoint TEST',
              forceUpdate: false,
            },
          },
        });
        rec({
          label: 'WRITE POST confirm-delivery-cobro',
          pass: confirm.status === 201 || confirm.status === 200,
          status: confirm.status,
          code: confirm.json?.code || null,
          confirmationId: confirm.json?.confirmationId || confirm.json?.id || null,
          created: confirm.json?.created ?? null,
          details: confirm.json?.details || confirm.json?.error || null,
        });
        const confirmationId = confirm.json?.confirmationId || confirm.json?.id;
        if (confirmationId) {
          const receipt2 = await request(
            'GET',
            `/api/repartidor-finanzas/rutero/confirmations/${encodeURIComponent(confirmationId)}/receipt`,
            { token, timeoutMs: 90000 },
          );
          rec({
            label: 'WRITE GET confirmation receipt',
            pass: receipt2.status === 200 && receipt2.pdfLen > 20,
            status: receipt2.status,
            pdfLen: receipt2.pdfLen,
            code: receipt2.json?.code || null,
          });
        }
        const sig2 = await request(
          'GET',
          `/api/repartidor/history/signature?ejercicio=${albaran.ejercicio}&serie=${encodeURIComponent(albaran.serie || 'A')}&terminal=${albaran.terminal || 0}&numero=${albaran.numeroAlbaran}`,
          { token },
        );
        rec({
          label: 'WRITE GET history.signature after confirm',
          pass: sig2.status === 200 && (Boolean(sig2.json?.hasSignature) || Boolean(sig2.json?.receptor?.dni || sig2.json?.dni)),
          status: sig2.status,
          hasSignature: Boolean(sig2.json?.hasSignature),
          dni: sig2.json?.receptor?.dni || sig2.json?.dni || null,
          nombre: sig2.json?.receptor?.nombre || sig2.json?.firmante || null,
          apellidos: sig2.json?.receptor?.apellidos || null,
          source: sig2.json?.signature?.source || sig2.json?.source || null,
        });
        const docsAfter = await request(
          'GET',
          `/api/repartidor/history/documents/${encodeURIComponent(albaran.codigoCliente)}?repartidorId=${driverId}&limit=20`,
          { token },
        );
        const afterDocs = listOf(docsAfter.json, 'documents');
        const match = afterDocs.find((d) => String(d.albaranNumber) === String(albaran.numeroAlbaran) || String(d.number) === String(albaran.numeroAlbaran));
        rec({
          label: 'WRITE history.documents after confirm',
          pass: docsAfter.status === 200 && Boolean(match?.confirmationId || match?.hasSignature),
          status: docsAfter.status,
          confirmationId: match?.confirmationId || null,
          hasSignature: Boolean(match?.hasSignature),
          type: match?.type || null,
        });
      }
    }

    const gastoTok = `AUDIT-GASTO-${TODAY.replace(/-/g, '')}-${driverId}`;
    const gasto = await request('POST', '/api/repartidor-finanzas/liquidaciones/gastos', {
      token,
      body: {
        repartidorId: driverId,
        date: TODAY,
        amount: 0.01,
        category: 'AUDIT',
        observation: 'probe endpoint',
        idempotencyToken: gastoTok,
      },
    });
    rec({
      label: 'WRITE POST liquidaciones/gastos 0.01',
      pass: gasto.status === 201 || gasto.status === 200,
      status: gasto.status,
      code: gasto.json?.code || null,
      created: gasto.json?.created ?? null,
    });
  } else {
    rec({ label: 'WRITE confirm/gastos', pass: true, skipped: ALLOW_WRITES ? 'no_albaran' : 'writes_disabled' });
  }

  const failed = results.filter((r) => r.pass === false);
  rec({
    step: 'summary',
    pass: failed.length === 0,
    total: results.length,
    failed: failed.length,
    failedLabels: failed.map((r) => r.label),
  });
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(String(error && error.stack ? error.stack : error));
  process.exit(1);
});
