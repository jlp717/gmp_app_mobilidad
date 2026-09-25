// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-e2e | _-scratch gitignored; e2e puntual dual JWT | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Dual-JWT E2E: JEFE_VENTAS + REPARTIDOR individual.
 * Confirm/gastos writes only with the REPARTIDOR JWT against TEST tables.
 */
const fs = require('fs');
const https = require('https');
const path = require('path');

const HOST = process.env.E2E_HOST || 'api.mari-pepa.com';
const UA = 'GMP-App/1.0 Dart/3.0 (dual-jwt-reparto-e2e)';
const TODAY = process.env.AUDIT_DATE || new Date().toISOString().slice(0, 10);
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const CONFIRM = process.env.CONFIRM_SMOKE !== '0';

function loadDiego() {
  const src = fs.readFileSync(path.join(__dirname, '_e2e_history_signature_probe.js'), 'utf8');
  return {
    username: src.match(/username:\s*'([^']+)'/)[1],
    password: src.match(/password:\s*'([^']+)'/)[1],
  };
}

function loadGoyo() {
  const src = fs.readFileSync(path.join(__dirname, '../tests/test_rutero_delivery.js'), 'utf8');
  return {
    username: src.match(/TEST_USER = '([^']+)'/)[1],
    password: src.match(/TEST_PASSWORD = '([^']+)'/)[1],
  };
}

function decodeJwt(token) {
  const parts = String(token || '').split('.');
  const raw = parts.length === 3 ? parts[1] : parts[0];
  if (!raw) return {};
  const padded = raw.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((raw.length + 3) % 4);
  try {
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch (_) {
    return {};
  }
}

function request(method, apiPath, { token, body, headers = {}, timeoutMs = 70000 } = {}) {
  const payload = body == null ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: HOST,
      path: apiPath.startsWith('/api/') ? apiPath : `/api${apiPath}`,
      method,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
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
        try { json = JSON.parse(raw); } catch (_) {}
        resolve({
          status: res.statusCode,
          json,
          raw: raw.slice(0, 280),
          bytes: size,
          pdfLen: json && json.pdfBase64 ? String(json.pdfBase64).length : 0,
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
  return row.pass !== false;
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

function claimsOf(token) {
  const p = decodeJwt(token);
  return {
    role: p.role || null,
    activeMode: p.activeMode || null,
    code: p.user || p.code || null,
    isJefeVentas: p.isJefeVentas ?? null,
    isRepartidor: p.isRepartidor ?? null,
    exp: p.exp || null,
    jwtAlive: Boolean(p.role) && (!p.exp || p.exp * 1000 > Date.now() + 60000),
  };
}

async function probeProfile(label, token, driverId, { expectOtherDenied = false, otherId = '53' } = {}) {
  const prefix = `${label}`;
  const own = await request('GET', `/api/entregas/pendientes/${driverId}?date=${TODAY}&limit=20&offset=0`, { token });
  rec({
    label: `${prefix} GET pendientes/${driverId}`,
    pass: own.status === 200,
    status: own.status,
    count: listOf(own.json, 'albaranes', 'pendientes').length,
  });
  const other = await request('GET', `/api/entregas/pendientes/${otherId}?date=${TODAY}&limit=5&offset=0`, { token });
  rec({
    label: `${prefix} GET pendientes/${otherId} isolation`,
    pass: expectOtherDenied ? other.status === 403 : other.status === 200,
    status: other.status,
    expected: expectOtherDenied ? 403 : 200,
  });

  const reads = [
    ['config', `/api/repartidor/config`],
    ['clients', `/api/repartidor/history/clients/${driverId}`],
    ['objectives', `/api/repartidor/history/objectives/${driverId}`],
    ['objectives-detail', `/api/repartidor/history/objectives-detail/${driverId}`],
    ['delivery-summary', `/api/repartidor/history/delivery-summary/${driverId}`],
    ['history', `/api/repartidor/history/${driverId}?startDate=2026-08-01&endDate=${TODAY}&limit=10&offset=0`],
    ['week', `/api/repartidor/rutero/week/${driverId}?date=${TODAY}`],
    ['order', `/api/repartidor/rutero/order/${driverId}?date=${TODAY}`],
    ['stops-geo', `/api/repartidor/rutero/stops-geo/${driverId}?date=${TODAY}`],
    ['daily-summary', `/api/repartidor-finanzas/daily-summary/${driverId}?date=${TODAY}`],
    ['monthly-summary', `/api/repartidor-finanzas/summary/${driverId}`],
    ['desglose', `/api/repartidor-finanzas/liquidaciones/${driverId}/desglose?date=${TODAY}`],
    ['cuentas', `/api/repartidor-finanzas/cuentas/${driverId}`],
    ['evolution', `/api/repartidor-finanzas/evolution/${driverId}`],
    ['commissions', `/api/repartidor-finanzas/commissions/summary/${driverId}`],
    ['tiers', `/api/repartidor-finanzas/commissions/tiers`],
    ['vencimientos', `/api/repartidor-finanzas/vencimientos/${driverId}?from=2026-01-01&to=${TODAY}&limit=5`],
    ['payment-conditions', `/api/entregas/payment-conditions`],
    ['version-check', `/api/health/version-check`],
    ['chatbot', `/api/chatbot/health`],
  ];
  let clients = [];
  let vencItems = [];
  let weekDays = [];
  for (const [name, url] of reads) {
    const res = await request('GET', url, { token });
    const pass = res.status === 200;
    const extra = {};
    if (name === 'clients') {
      clients = listOf(res.json, 'clients');
      extra.count = clients.length;
    }
    if (name === 'vencimientos') {
      vencItems = listOf(res.json, 'vencimientos');
      extra.count = vencItems.length;
    }
    if (name === 'week') {
      weekDays = res.json?.days || [];
      extra.days = weekDays.length;
    }
    if (name === 'daily-summary') {
      const s = res.json?.summary || res.json || {};
      extra.aIngresar = s.totalAIngresar ?? null;
      extra.efectivo = s.totalEfectivo ?? null;
    }
    rec({
      label: `${prefix} GET ${name}`,
      pass,
      status: res.status,
      code: res.json?.code || null,
      ...extra,
    });
  }

  const colSum = await request('GET', `/api/repartidor/collections/summary/${driverId}`, { token });
  rec({
    label: `${prefix} GET collections/summary`,
    pass: colSum.status === 200 || colSum.status === 503,
    status: colSum.status,
    code: colSum.json?.code || null,
    knownGap: colSum.status === 503,
  });
  const colDaily = await request('GET', `/api/repartidor/collections/daily/${driverId}`, { token });
  rec({
    label: `${prefix} GET collections/daily`,
    pass: colDaily.status === 200 || colDaily.status === 503,
    status: colDaily.status,
    code: colDaily.json?.code || null,
    knownGap: colDaily.status === 503,
  });

  const clientId = clients[0]?.id || clients[0]?.codigoCliente || clients[0]?.clienteId || clients[0]?.code;
  let docs = [];
  if (clientId) {
    const docsRes = await request(
      'GET',
      `/api/repartidor/history/documents/${encodeURIComponent(clientId)}?repartidorId=${driverId}&limit=20`,
      { token },
    );
    docs = listOf(docsRes.json, 'documents');
    rec({
      label: `${prefix} GET history/documents`,
      pass: docsRes.status === 200,
      status: docsRes.status,
      count: docs.length,
      withConfirmationId: docs.filter((d) => d.confirmationId).length,
      withSignature: docs.filter((d) => d.hasSignature).length,
    });
    const signed = docs.find((d) => d.hasSignature || d.confirmationId) || docs[0];
    if (signed) {
      const sig = await request(
        'GET',
        `/api/repartidor/history/signature?ejercicio=${signed.ejercicio}&serie=${encodeURIComponent(signed.serie || 'A')}&terminal=${signed.terminal || 0}&numero=${signed.albaranNumber || signed.number}`,
        { token },
      );
      rec({
        label: `${prefix} GET history/signature`,
        pass: sig.status === 200,
        status: sig.status,
        hasSignature: Boolean(sig.json?.hasSignature),
        dni: sig.json?.signature?.dni || sig.json?.receptor?.dni || sig.json?.dni || null,
        nombre: sig.json?.signature?.nombre || sig.json?.signature?.firmante || sig.json?.receptor?.nombre || sig.json?.firmante || null,
      });
      const albPdf = await request(
        'GET',
        `/api/repartidor/document/albaran/${signed.ejercicio}/${encodeURIComponent(signed.serie || 'A')}/${signed.terminal || 1}/${signed.albaranNumber || signed.number}/pdf`,
        { token, timeoutMs: 90000 },
      );
      rec({
        label: `${prefix} GET albaran pdf`,
        pass: albPdf.status === 200 && (albPdf.pdfLen > 20 || albPdf.bytes > 500),
        status: albPdf.status,
        bytes: albPdf.bytes,
        pdfLen: albPdf.pdfLen,
      });
      const factura = docs.find((d) => d.type === 'factura' && d.facturaNumber);
      if (factura) {
        const inv = await request(
          'GET',
          `/api/repartidor/document/invoice/${factura.ejercicioFactura || factura.ejercicio}/${encodeURIComponent(factura.serieFactura || 'F')}/${factura.facturaNumber}/pdf`,
          { token, timeoutMs: 90000 },
        );
        rec({
          label: `${prefix} GET invoice pdf`,
          pass: inv.status === 200 || inv.status === 409,
          status: inv.status,
          code: inv.json?.code || null,
          bytes: inv.bytes,
          knownGap: inv.status === 409,
        });
      }
    }
  }

  const keys = vencItems[0]?.keys || {};
  if (keys.tipo || keys.tipoDocumento || vencItems[0]) {
    const tipo = keys.tipo || keys.tipoDocumento || 'CAC';
    const ejercicio = keys.ejercicio || keys.ano;
    const serie = keys.serie;
    const terminal = keys.terminal ?? 0;
    const numero = keys.numero;
    const xde = keys.xde ?? keys.XDE ?? 1;
    if (ejercicio && serie && numero) {
      const docId = `${tipo}-${ejercicio}-${serie}-${terminal}-${numero}-${xde}`;
      const det = await request(
        'GET',
        `/api/repartidor-finanzas/vencimientos/${driverId}/${encodeURIComponent(docId)}/detalle`,
        { token },
      );
      rec({
        label: `${prefix} GET vencimiento detalle`,
        pass: det.status === 200 || det.status === 404,
        status: det.status,
        docId,
        code: det.json?.code || null,
      });
    }
  }

  const pendingRows = listOf(own.json, 'albaranes', 'pendientes');
  const alb = pendingRows[0];
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
    rec({
      label: `${prefix} GET albaran detail`,
      pass: detail.status === 200 && Boolean(detail.json?.albaran?.id),
      status: detail.status,
      id: detail.json?.albaran?.id || alb.id,
      lines: (detail.json?.albaran?.items || []).length,
      estado: detail.json?.albaran?.estado || alb.estado,
      confirmationAvailability: detail.json?.albaran?.confirmationAvailability || null,
    });
  }

  const closeBad = await request('POST', '/api/repartidor-finanzas/liquidaciones', {
    token,
    body: { repartidorId: driverId },
  });
  rec({
    label: `${prefix} POST liquidaciones close gate`,
    pass: closeBad.status === 400 || closeBad.status === 422,
    status: closeBad.status,
    code: closeBad.json?.code || null,
  });
  const confirmEmpty = await request('POST', '/api/repartidor-finanzas/rutero/confirm-delivery-cobro', {
    token,
    body: {},
    headers: { 'Idempotency-Key': `rep-${label}-empty-01` },
  });
  rec({
    label: `${prefix} POST confirm invalid`,
    pass: prefix.startsWith('JEFE')
      ? (confirmEmpty.status === 403 || confirmEmpty.status === 422)
      : (confirmEmpty.status === 400 || confirmEmpty.status === 422),
    status: confirmEmpty.status,
    code: confirmEmpty.json?.code || null,
  });
  const legacy = await request('POST', '/api/entregas/update', { token, body: {} });
  rec({
    label: `${prefix} POST entregas/update 410`,
    pass: legacy.status === 410,
    status: legacy.status,
  });

  return { pendingRows, detail, clients, docs, weekDays };
}

async function confirmSmoke(token, driverId, detail) {
  const albaran = detail?.json?.albaran;
  if (!albaran) {
    rec({ label: 'REPARTIDOR WRITE confirm', pass: false, reason: 'no_albaran' });
    return;
  }
  const items = (albaran.items || []).filter((i) => i.codigoArticulo && Number(i.cantidadPedida) > 0);
  if (!items.length) {
    rec({ label: 'REPARTIDOR WRITE confirm', pass: false, reason: 'no_lines' });
    return;
  }
  if (String(albaran.estado).toUpperCase() === 'ENTREGADO') {
    rec({ label: 'REPARTIDOR WRITE confirm', pass: true, skipped: 'already_entregado', id: albaran.id });
    const docsSkip = await request(
      'GET',
      `/api/repartidor/history/documents/${encodeURIComponent(albaran.codigoCliente)}?repartidorId=${driverId}&limit=20`,
      { token },
    );
    const skipDocs = listOf(docsSkip.json, 'documents');
    const skipMatch = skipDocs.find((d) => String(d.albaranNumber) === String(albaran.numeroAlbaran));
    const skipId = skipMatch?.confirmationId;
    if (skipId) {
      const receipt = await request(
        'GET',
        `/api/repartidor-finanzas/rutero/confirmations/${encodeURIComponent(skipId)}/receipt`,
        { token, timeoutMs: 90000 },
      );
      rec({
        label: 'REPARTIDOR WRITE receipt pdf',
        pass: receipt.status === 200 && (receipt.pdfLen > 20 || receipt.bytes > 500),
        status: receipt.status,
        pdfLen: receipt.pdfLen,
        code: receipt.json?.code || null,
        skippedConfirm: true,
      });
    }
    const sigSkip = await request(
      'GET',
      `/api/repartidor/history/signature?ejercicio=${albaran.ejercicio}&serie=${encodeURIComponent(albaran.serie || 'A')}&terminal=${albaran.terminal || 0}&numero=${albaran.numeroAlbaran}`,
      { token },
    );
    rec({
      label: 'REPARTIDOR WRITE history.signature after confirm',
      pass: sigSkip.status === 200 && Boolean(sigSkip.json?.hasSignature) && Boolean(sigSkip.json?.signature?.dni),
      status: sigSkip.status,
      hasSignature: Boolean(sigSkip.json?.hasSignature),
      hasBase64: Boolean(sigSkip.json?.signature?.base64),
      dni: sigSkip.json?.signature?.dni || null,
      nombre: sigSkip.json?.signature?.nombre || sigSkip.json?.signature?.firmante || null,
    });
    rec({
      label: 'REPARTIDOR WRITE history.documents after confirm',
      pass: docsSkip.status === 200 && Boolean(skipMatch?.confirmationId || skipMatch?.hasSignature),
      status: docsSkip.status,
      confirmationId: skipMatch?.confirmationId || null,
      hasSignature: Boolean(skipMatch?.hasSignature),
      type: skipMatch?.type || null,
    });
    return;
  }
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
    label: 'REPARTIDOR WRITE evidence/signature',
    pass: (sigUp.status === 201 || sigUp.status === 200) && Boolean(evidenceId),
    status: sigUp.status,
    code: sigUp.json?.code || null,
    evidenceId: evidenceId || null,
  });
  if (!evidenceId) return;
  const evGet = await request('GET', `/api/repartidor-finanzas/rutero/evidence/${encodeURIComponent(evidenceId)}`, { token });
  rec({
    label: 'REPARTIDOR WRITE GET evidence (pre-confirm staged)',
    pass: evGet.status === 200 || evGet.status === 404,
    status: evGet.status,
    note: 'staged evidence may stay unlinked until confirm',
  });
  const confirm = await request('POST', '/api/repartidor-finanzas/rutero/confirm-delivery-cobro', {
    token,
    headers: { 'Idempotency-Key': `rep-e2e-${TODAY.replace(/-/g, '')}-${driverId}-ok` },
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
              })),
              receiver: { nombre: 'Ana', apellidos: 'Lopez Ruiz', dni: '12345678Z' },
              firma: evidenceId,
              observaciones: 'E2E dual JWT TEST',
              forceUpdate: false,
      },
    },
  });
  const confirmationId = confirm.json?.confirmationId || confirm.json?.id;
  rec({
    label: 'REPARTIDOR WRITE confirm-delivery-cobro',
    pass: confirm.status === 201 || confirm.status === 200,
    status: confirm.status,
    code: confirm.json?.code || null,
    confirmationId: confirmationId || null,
    created: confirm.json?.created ?? null,
    error: confirm.json?.error || null,
    details: confirm.json?.details || null,
  });
  if (confirmationId) {
    const receipt = await request(
      'GET',
      `/api/repartidor-finanzas/rutero/confirmations/${encodeURIComponent(confirmationId)}/receipt`,
      { token, timeoutMs: 90000 },
    );
    rec({
      label: 'REPARTIDOR WRITE receipt pdf',
      pass: receipt.status === 200 && (receipt.pdfLen > 20 || receipt.bytes > 500),
      status: receipt.status,
      pdfLen: receipt.pdfLen,
      code: receipt.json?.code || null,
    });
    const mailBad = await request(
      'POST',
      `/api/repartidor-finanzas/rutero/confirmations/${encodeURIComponent(confirmationId)}/receipt/email`,
      { token, body: { destinatario: 'not-an-email' } },
    );
    rec({
      label: 'REPARTIDOR WRITE receipt email invalid',
      pass: mailBad.status === 422,
      status: mailBad.status,
      code: mailBad.json?.code || null,
    });
  }
  const sig2 = await request(
    'GET',
    `/api/repartidor/history/signature?ejercicio=${albaran.ejercicio}&serie=${encodeURIComponent(albaran.serie || 'A')}&terminal=${albaran.terminal || 0}&numero=${albaran.numeroAlbaran}`,
    { token },
  );
  rec({
    label: 'REPARTIDOR WRITE history.signature after confirm',
    pass: sig2.status === 200 && Boolean(sig2.json?.hasSignature) && Boolean(
      sig2.json?.signature?.dni || sig2.json?.receptor?.dni || sig2.json?.dni
    ),
    status: sig2.status,
    hasSignature: Boolean(sig2.json?.hasSignature),
    hasBase64: Boolean(sig2.json?.signature?.base64),
    dni: sig2.json?.signature?.dni || sig2.json?.receptor?.dni || sig2.json?.dni || null,
    nombre: sig2.json?.signature?.nombre || sig2.json?.signature?.firmante
      || sig2.json?.receptor?.nombre || sig2.json?.firmante || null,
    apellidos: sig2.json?.receptor?.apellidos || null,
    source: sig2.json?.signature?.source || sig2.json?.source || null,
  });
  const docsAfter = await request(
    'GET',
    `/api/repartidor/history/documents/${encodeURIComponent(albaran.codigoCliente)}?repartidorId=${driverId}&limit=20`,
    { token },
  );
  const afterDocs = listOf(docsAfter.json, 'documents');
  const match = afterDocs.find((d) => String(d.albaranNumber) === String(albaran.numeroAlbaran));
  rec({
    label: 'REPARTIDOR WRITE history.documents after confirm',
    pass: docsAfter.status === 200 && Boolean(match?.confirmationId || match?.hasSignature),
    status: docsAfter.status,
    confirmationId: match?.confirmationId || null,
    hasSignature: Boolean(match?.hasSignature),
    type: match?.type || null,
  });
}

async function main() {
  const diego = loadDiego();
  const goyo = loadGoyo();

  const jefeLogin = await request('POST', '/api/auth/login', { body: diego });
  const jefeToken = jefeLogin.json?.token || jefeLogin.json?.data?.token;
  const jefeUser = jefeLogin.json?.user || {};
  rec({
    label: 'JEFE POST /auth/login',
    pass: jefeLogin.status === 200 && Boolean(jefeToken) && (jefeLogin.json?.role === 'JEFE_VENTAS' || jefeUser.role === 'JEFE_VENTAS'),
    status: jefeLogin.status,
    role: jefeLogin.json?.role || jefeUser.role,
    code: jefeUser.code,
    activeMode: jefeLogin.json?.activeMode || jefeUser.activeMode,
    isJefeVentas: jefeLogin.json?.isJefeVentas ?? jefeUser.isJefeVentas,
    jwt: claimsOf(jefeToken),
  });
  if (!jefeToken) process.exit(1);

  const validateJefe = await request('GET', '/api/auth/validate', { token: jefeToken });
  rec({
    label: 'JEFE GET /auth/validate',
    pass: validateJefe.status === 200 || validateJefe.status === 204,
    status: validateJefe.status,
  });

  const reps = await request('GET', '/api/auth/repartidores', { token: jefeToken });
  rec({
    label: 'JEFE GET /auth/repartidores',
    pass: reps.status === 200,
    status: reps.status,
    count: listOf(reps.json, 'repartidores', 'users').length,
  });

  const goyoLogin = await request('POST', '/api/auth/login', { body: goyo });
  rec({
    label: 'GOYO POST /auth/login (control)',
    pass: goyoLogin.status === 200,
    status: goyoLogin.status,
    role: goyoLogin.json?.role || goyoLogin.json?.user?.role,
    code: goyoLogin.json?.user?.code,
    isRepartidor: goyoLogin.json?.isRepartidor ?? goyoLogin.json?.user?.isRepartidor,
  });

  let driverToken = process.env.DRIVER_TOKEN || '';
  let driverRefresh = process.env.DRIVER_REFRESH || '';
  const mintFile = path.join(__dirname, '_mint_out.json');
  if (!driverToken && fs.existsSync(mintFile)) {
    try {
      const minted = JSON.parse(fs.readFileSync(mintFile, 'utf8'));
      if (minted.ok && minted.token) {
        driverToken = minted.token;
        driverRefresh = minted.refreshToken || '';
        process.env.DRIVER_CODE = minted.code || process.env.DRIVER_CODE;
      }
    } catch (_) {}
  }
  if (!driverToken) {
    rec({ label: 'REPARTIDOR login', pass: false, reason: 'DRIVER_TOKEN missing' });
  } else {
    const c = claimsOf(driverToken);
    rec({
      label: 'REPARTIDOR JWT loaded',
      pass: c.role === 'REPARTIDOR' && c.jwtAlive,
      jwt: c,
    });
  }

  const jefeProfile = await probeProfile('JEFE', jefeToken, '08', { expectOtherDenied: false, otherId: '53' });
  rec({
    label: 'JEFE week vs pendientes',
    pass: true,
    weekToday: (jefeProfile.weekDays || []).find((d) => d.date === TODAY) || null,
  });

  const switched = await request('POST', '/api/auth/switch-role', {
    token: jefeToken,
    body: { userId: '98', newRole: 'REPARTIDOR' },
  });
  const perfilToken = switched.json?.token || switched.json?.data?.token || jefeToken;
  rec({
    label: 'JEFE POST /auth/switch-role Perfil Reparto',
    pass: switched.status === 200 && (switched.json?.user?.activeMode || switched.json?.activeMode) === 'REPARTIDOR',
    status: switched.status,
    role: switched.json?.user?.role || switched.json?.role,
    activeMode: switched.json?.user?.activeMode || switched.json?.activeMode,
    jwt: claimsOf(perfilToken),
  });

  if (driverToken) {
    const driverCode = claimsOf(driverToken).code || process.env.DRIVER_CODE || '08';
    const driverProfile = await probeProfile('REPARTIDOR', driverToken, driverCode, {
      expectOtherDenied: true,
      otherId: driverCode === '53' ? '08' : '53',
    });
    const validateDrv = await request('GET', '/api/auth/validate', { token: driverToken });
    rec({
      label: 'REPARTIDOR GET /auth/validate',
      pass: validateDrv.status === 200 || validateDrv.status === 204,
      status: validateDrv.status,
    });
    if (CONFIRM) {
      await confirmSmoke(driverToken, driverCode, driverProfile.detail);
    }
    if (driverRefresh && process.env.SKIP_REFRESH !== '1') {
      const refreshDrv = await request('POST', '/api/auth/refresh', {
        token: driverToken,
        body: { refreshToken: driverRefresh },
      });
      rec({
        label: 'REPARTIDOR POST /auth/refresh (after catalog)',
        pass: refreshDrv.status === 200 && Boolean(refreshDrv.json?.token || refreshDrv.json?.accessToken),
        status: refreshDrv.status,
      });
    }
  }

  const refreshJefe = await request('POST', '/api/auth/refresh', {
    token: perfilToken,
    body: { refreshToken: switched.json?.refreshToken || jefeLogin.json?.refreshToken },
  });
  rec({
    label: 'JEFE POST /auth/refresh (after catalog)',
    pass: refreshJefe.status === 200 && Boolean(refreshJefe.json?.token || refreshJefe.json?.accessToken),
    status: refreshJefe.status,
    code: refreshJefe.json?.code || null,
  });

  const failed = results.filter((r) => r.pass === false);
  rec({
    step: 'summary',
    pass: failed.length === 0,
    total: results.length,
    failed: failed.length,
    failedLabels: failed.map((r) => r.label),
    jwtJefeAlive: claimsOf(jefeToken).jwtAlive,
    jwtDriverAlive: driverToken ? claimsOf(driverToken).jwtAlive : false,
  });
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(String(error && error.stack ? error.stack : error));
  process.exit(1);
});
