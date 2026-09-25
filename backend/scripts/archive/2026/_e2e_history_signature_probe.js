// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-e2e | _-scratch gitignored; e2e puntual firma historico | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Live probe: history signature, receipt, F-9836, liquidacion, email contracts.
 * Read-only except invalid-payload POSTs that must 4xx without writing.
 */
const http = require('http');

const HOST = process.env.E2E_HOST || '127.0.0.1';
const PORT = Number(process.env.E2E_PORT || 3335);
const UA = 'GMP-App/1.0 Dart/3.0 (e2e-history-signature)';

function request(method, path, { token, body } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: HOST,
      port: PORT,
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
        resolve({
          status: res.statusCode,
          json,
          raw: data.slice(0, 240),
          pdfLen: json?.pdfBase64 ? String(json.pdfBase64).length : 0,
        });
      });
    });
    req.setTimeout(45000, () => req.destroy(new Error(`timeout ${method} ${path}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function log(row) {
  console.log(JSON.stringify(row));
  return row.pass;
}

async function main() {
  const results = [];
  const login = await request('POST', '/api/auth/login', {
    body: { username: 'diego', password: '9322' },
  });
  const token0 = login.json?.token || login.json?.data?.token;
  const switched = await request('POST', '/api/auth/switch-role', {
    token: token0,
    body: { userId: '98', newRole: 'REPARTIDOR' },
  });
  const token = switched.json?.token || switched.json?.data?.token || token0;
  results.push(log({
    label: 'auth',
    pass: login.status === 200 && switched.status === 200,
    role: switched.json?.user?.role || switched.json?.role,
    mode: switched.json?.user?.activeMode || switched.json?.activeMode,
  }));

  const as08 = await request('GET', '/api/repartidor/history/clients/08', { token });
  const clients = as08.json?.data || as08.json?.clients || [];
  results.push(log({
    label: 'history.clients.08',
    pass: as08.status === 200,
    count: Array.isArray(clients) ? clients.length : null,
  }));

  const clientId = Array.isArray(clients) && clients[0]
    ? (clients[0].id || clients[0].codigoCliente || clients[0].clienteId)
    : null;
  let docs = [];
  if (clientId) {
    const docsRes = await request(
      'GET',
      `/api/repartidor/history/documents/${encodeURIComponent(clientId)}?repartidorId=08&limit=50`,
      { token },
    );
    docs = docsRes.json?.documents || docsRes.json?.data || [];
    const withNote = docs.filter((d) => d.confirmationId);
    const withSig = docs.filter((d) => d.hasSignature || d.signaturePath || d.hasLegacySignature);
    results.push(log({
      label: 'history.documents',
      pass: docsRes.status === 200,
      count: docs.length,
      withConfirmationId: withNote.length,
      withSignature: withSig.length,
      sample: docs[0] ? {
        type: docs[0].type,
        number: docs[0].number,
        facturaNumber: docs[0].facturaNumber,
        status: docs[0].status,
        confirmationId: docs[0].confirmationId || null,
        hasSignature: Boolean(docs[0].hasSignature),
      } : null,
    }));

    const signed = docs.find((d) => d.hasSignature || d.confirmationId) || docs[0];
    if (signed) {
      const sig = await request(
        'GET',
        `/api/repartidor/history/signature?ejercicio=${signed.ejercicio}&serie=${encodeURIComponent(signed.serie || 'A')}&terminal=${signed.terminal || 0}&numero=${signed.albaranNumber || signed.number}`,
        { token },
      );
      results.push(log({
        label: 'history.signature',
        pass: sig.status === 200,
        hasSignature: Boolean(sig.json?.hasSignature),
        hasBase64: Boolean(sig.json?.signature?.base64 || sig.json?.base64),
        source: sig.json?.signature?.source || sig.json?.source || null,
      }));
    }

    const noted = docs.find((d) => d.confirmationId);
    if (noted) {
      const receipt = await request(
        'GET',
        `/api/repartidor-finanzas/rutero/confirmations/${encodeURIComponent(noted.confirmationId)}/receipt`,
        { token },
      );
      results.push(log({
        label: 'history.receiptPdf',
        pass: receipt.status === 200 && receipt.pdfLen > 20,
        status: receipt.status,
        code: receipt.json?.code || null,
        pdfLen: receipt.pdfLen,
        confirmationId: noted.confirmationId,
      }));
      const badEmail = await request(
        'POST',
        `/api/repartidor-finanzas/rutero/confirmations/${encodeURIComponent(noted.confirmationId)}/receipt/email`,
        { token, body: { destinatario: 'not-an-email' } },
      );
      results.push(log({
        label: 'history.receiptEmail.invalid',
        pass: badEmail.status === 422 || badEmail.status === 400 || badEmail.status === 404,
        status: badEmail.status,
        code: badEmail.json?.code || null,
      }));
    } else {
      results.push(log({ label: 'history.receiptPdf', pass: true, skipped: 'no_confirmationId_in_sample' }));
      results.push(log({ label: 'history.receiptEmail.invalid', pass: true, skipped: 'no_confirmationId_in_sample' }));
    }
  }

  const pendientes = await request(
    'GET',
    '/api/entregas/pendientes/08?date=2026-08-17&limit=50&offset=0',
    { token },
  );
  const pendingList = pendientes.json?.data || pendientes.json?.albaranes || [];
  const f9836 = (Array.isArray(pendingList) ? pendingList : []).find((row) => {
    const factura = String(row.numeroFactura || row.NUMEROFACTURA || row.factura || '');
    const alb = String(row.numeroAlbaran || row.numero || '');
    const name = String(row.nombreCliente || row.clienteNombre || row.nombre || '').toUpperCase();
    return factura.includes('9836') || alb.includes('9836') || name.includes('WOK') || name.includes('SUSHI LORCA');
  });
  results.push(log({
    label: 'rutero.F-9836',
    pass: pendientes.status === 200,
    pendingCount: Array.isArray(pendingList) ? pendingList.length : null,
    found: Boolean(f9836),
    sample: f9836 ? {
      id: f9836.id,
      estado: f9836.estado || f9836.status,
      factura: f9836.numeroFactura || f9836.NUMEROFACTURA,
      nombre: f9836.nombreCliente || f9836.clienteNombre,
    } : null,
  }));

  if (f9836) {
    const numero = f9836.numeroAlbaran || f9836.numero;
    const ejercicio = f9836.ejercicio;
    const serie = f9836.serie || 'A';
    const terminal = f9836.terminal ?? 1;
    const cliente = f9836.codigoCliente || f9836.cliente;
    const detail = await request(
      'GET',
      `/api/entregas/albaran/${numero}/${ejercicio}?serie=${encodeURIComponent(serie)}&terminal=${encodeURIComponent(terminal)}&cliente=${encodeURIComponent(cliente)}`,
      { token },
    );
    const items = detail.json?.albaran?.items || [];
    const overlayed = items.filter((item) => item.confirmationState === 'CONFIRMED' || item.cantidadEntregada != null);
    results.push(log({
      label: 'rutero.F-9836.detail',
      pass: detail.status === 200,
      lines: items.length,
      overlayedLines: overlayed.length,
      confirmationAvailability: detail.json?.albaran?.confirmationAvailability || null,
      estado: detail.json?.albaran?.estado || null,
    }));
  }

  const daily = await request('GET', '/api/repartidor-finanzas/daily-summary/08?date=2026-08-17', { token });
  const desglose = await request('GET', '/api/repartidor-finanzas/liquidaciones/08/desglose?date=2026-08-17', { token });
  const closeGate = await request('POST', '/api/repartidor-finanzas/liquidaciones', {
    token,
    body: { repartidorId: '08' },
  });
  results.push(log({
    label: 'liquidacion.daily',
    pass: daily.status === 200,
    entregado: daily.json?.entregado ?? daily.json?.data?.entregado ?? null,
  }));
  results.push(log({
    label: 'liquidacion.desglose',
    pass: desglose.status === 200,
  }));
  results.push(log({
    label: 'liquidacion.close.gate',
    pass: closeGate.status >= 400 && closeGate.status < 500,
    status: closeGate.status,
    code: closeGate.json?.code || null,
  }));

  const emailDoc = await request('POST', '/api/facturas/send-email', {
    token,
    body: { serie: 'F', numero: 9836, ejercicio: 2026, destinatario: 'bad' },
  });
  results.push(log({
    label: 'facturas.sendEmail.invalid',
    pass: emailDoc.status === 400 || emailDoc.status === 422,
    status: emailDoc.status,
  }));

  const allPass = results.every(Boolean);
  log({ step: 'summary', pass: allPass, allPass });
  process.exit(allPass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
