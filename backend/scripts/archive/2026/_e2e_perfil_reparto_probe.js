// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-e2e | _-scratch gitignored; e2e puntual perfil reparto | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Exhaustive Perfil Reparto API probe (JEFE ALL + Ver como single).
 * Expects HTTP 200/201 and success!=false. Writes only dry-run contract checks
 * unless CONFIRM_SMOKE=1 and a pending delivery is available (TEST tables).
 */

const http = require('http');

const UA = 'GMP-App/1.0 Dart/3.0 (e2e-perfil-reparto)';
const HOST = process.env.E2E_HOST || '127.0.0.1';
const PORT = Number(process.env.E2E_PORT || 3335);
const TODAY = new Date().toISOString().slice(0, 10);
const YEAR = new Date().getFullYear();
const MONTH = new Date().getMonth() + 1;

function request(method, path, { token, body, headers = {} } = {}) {
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
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) { /* raw */ }
        resolve({ status: res.statusCode, json, raw: data.slice(0, 500) });
      });
    });
    req.setTimeout(45000, () => {
      req.destroy(new Error(`timeout ${method} ${path}`));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function pickToken(j) {
  return j?.token || j?.data?.token || j?.accessToken || null;
}

function okStatus(status) {
  return status >= 200 && status < 300;
}

function assertSuccess(label, res, extra = {}) {
  const successFlag = res.json?.success;
  const pass = okStatus(res.status)
    && successFlag !== false
    && res.status !== 500
    && !String(res.json?.error || '').toLowerCase().includes('sql');
  const row = {
    label,
    status: res.status,
    pass,
    code: res.json?.code || null,
    error: res.json?.error || null,
    ...extra,
  };
  console.log(JSON.stringify(row));
  return pass;
}

async function loginAndSwitch() {
  const login = await request('POST', '/api/auth/login', {
    body: { username: 'diego', password: '9322' },
  });
  let token = pickToken(login.json);
  if (!token) throw new Error(`login failed: ${login.raw}`);
  const sw = await request('POST', '/api/auth/switch-role', {
    token,
    body: { userId: '98', newRole: 'REPARTIDOR' },
  });
  token = pickToken(sw.json) || token;
  const user = sw.json?.user || {};
  console.log(JSON.stringify({
    step: 'auth',
    login: login.status,
    switch: sw.status,
    role: user.role || sw.json?.role,
    activeMode: user.activeMode || sw.json?.activeMode,
  }));
  if ((user.activeMode || sw.json?.activeMode) !== 'REPARTIDOR') {
    throw new Error('switch to Perfil Reparto failed');
  }
  return token;
}

async function dumpRuntime() {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const { resolveRepartoRuntime } = require('/opt/gmp-api/backend/config/reparto-runtime');
    const r = resolveRepartoRuntime(process.env);
    console.log(JSON.stringify({
      step: 'runtime',
      valid: r.valid,
      env: r.environment,
      tableSet: r.tableSet,
      conf: r.tables?.confirmation?.confirmations,
      cobros: r.tables?.finance?.cobros,
      readSchema: process.env.REPARTIDOR_FINANCE_READ_SCHEMA,
      writesEnabled: r.writesEnabled,
      errors: r.errors,
    }));
    return r;
  } catch (err) {
    console.log(JSON.stringify({ step: 'runtime', error: String(err.message || err) }));
    return null;
  }
}

async function probeScope(token, id, scopeLabel) {
  const results = [];
  const get = async (label, path, extract) => {
    let res;
    try {
      res = await request('GET', path, { token });
    } catch (error) {
      const timedOut = String(error && error.message || error).startsWith('timeout');
      console.log(JSON.stringify({
        label: `${scopeLabel}.${label}`,
        status: 0,
        pass: false,
        error: String(error && error.message || error),
        timedOut,
      }));
      results.push(false);
      return { status: 0, json: null, raw: String(error && error.message || error) };
    }
    const extra = typeof extract === 'function' ? extract(res.json) || {} : {};
    results.push(assertSuccess(`${scopeLabel}.${label}`, res, extra));
    return res;
  };

  const isMulti = String(id).includes(',');

  await get('panel.deliverySummary', `/api/repartidor/history/delivery-summary/${id}`);
  if (isMulti) {
    console.log(JSON.stringify({
      label: `${scopeLabel}.tabs`,
      pass: true,
      skipped: 'ALL_smoke_only_perfil_reparto_uses_ver_como',
    }));
    results.push(true);
    return { pass: results.every(Boolean), pendingCount: 0, pendingSample: null };
  }
  await get('panel.monthlySummary', `/api/repartidor-finanzas/summary/${id}?year=${YEAR}&month=${MONTH}`);
  await get('clientes', `/api/repartidor/history/clients/${id}`, (j) => ({
    count: Array.isArray(j?.data) ? j.data.length : (Array.isArray(j?.clients) ? j.clients.length : null),
  }));

  const pendientes = await get(
    'rutero.pendientes',
    `/api/entregas/pendientes/${id}?date=${TODAY}&limit=50&offset=0`,
    (j) => {
      const list = j?.data || j?.albaranes || j?.items || [];
      const arr = Array.isArray(list) ? list : [];
      const ids = arr.map((a) => a.id || a.albaranId || a.numeroAlbaran).filter(Boolean);
      const dup = ids.length - new Set(ids.map(String)).size;
      return { count: arr.length, duplicates: dup };
    },
  );
  await get('rutero.week', `/api/repartidor/rutero/week/${id}?date=${TODAY}`, (j) => ({
    days: Array.isArray(j?.days) ? j.days.length : (Array.isArray(j?.data) ? j.data.length : null),
  }));

  // Detalle albarán — regression for CLIENT_REQUIRED / queryParameters path
  const pendingList = pendientes.json?.data || pendientes.json?.albaranes || [];
  const sampleAlb = Array.isArray(pendingList) ? pendingList[0] : null;
  if (sampleAlb) {
    const numero = sampleAlb.numeroAlbaran || sampleAlb.numero || sampleAlb.NUMEROALBARAN;
    const ejercicio = sampleAlb.ejercicio || sampleAlb.EJERCICIOALBARAN;
    const serie = sampleAlb.serie || sampleAlb.SERIEALBARAN || 'A';
    const terminal = sampleAlb.terminal ?? sampleAlb.TERMINALALBARAN ?? 1;
    const cliente = sampleAlb.codigoCliente || sampleAlb.cliente || sampleAlb.CLIENTE
      || (typeof sampleAlb.id === 'string' ? String(sampleAlb.id).split('-').pop() : null);
    if (numero != null && ejercicio != null && cliente) {
      await get(
        'rutero.albaranDetail',
        `/api/entregas/albaran/${numero}/${ejercicio}?serie=${encodeURIComponent(serie)}&terminal=${encodeURIComponent(terminal)}&cliente=${encodeURIComponent(cliente)}`,
        (j) => ({
          lines: Array.isArray(j?.albaran?.lineas)
            ? j.albaran.lineas.length
            : (Array.isArray(j?.albaran?.items) ? j.albaran.items.length : null),
          hasAlbaran: Boolean(j?.albaran),
          fractionalQty: (j?.albaran?.lineas || j?.albaran?.items || []).some((ln) => {
            const q = Number(ln.cantidad ?? ln.cantidadPedida ?? ln.qty ?? 0);
            return Math.abs(q - Math.round(q)) > 0.0001;
          }),
        }),
      );
    } else {
      console.log(JSON.stringify({
        label: `${scopeLabel}.rutero.albaranDetail`,
        pass: true,
        skipped: 'incomplete_identity',
      }));
      results.push(true);
    }
  } else {
    console.log(JSON.stringify({
      label: `${scopeLabel}.rutero.albaranDetail`,
      pass: true,
      skipped: 'no_pending',
    }));
    results.push(true);
  }

  if (isMulti) {
    console.log(JSON.stringify({ label: `${scopeLabel}.liquidacion.daily`, pass: true, skipped: 'ALL_requires_single' }));
    results.push(true);
    console.log(JSON.stringify({ label: `${scopeLabel}.liquidacion.desglose`, pass: true, skipped: 'ALL_requires_single' }));
    results.push(true);
    console.log(JSON.stringify({ label: `${scopeLabel}.liquidacion.desgloseClosed`, pass: true, skipped: 'ALL_requires_single' }));
    results.push(true);
    console.log(JSON.stringify({ label: `${scopeLabel}.vencimientos`, pass: true, skipped: 'ALL_requires_single' }));
    results.push(true);
    console.log(JSON.stringify({ label: `${scopeLabel}.vencimientos.legacyLimitOnly`, pass: true, skipped: 'ALL_requires_single' }));
    results.push(true);
  } else {
    await get('liquidacion.daily', `/api/repartidor-finanzas/daily-summary/${id}?date=${TODAY}`, (j) => {
      const s = j?.summary || j?.totals || j?.data || {};
      return {
        entregado: s.entregado ?? s.totalEntregado ?? s.ENTREGADO ?? null,
        cobrado: s.cobrado ?? s.totalCobrado ?? s.COBRADO ?? null,
        deuda: s.deudaPendiente ?? s.deuda ?? s.DEUDA ?? null,
      };
    });
    await get('liquidacion.desglose', `/api/repartidor-finanzas/liquidaciones/${id}/desglose?date=${TODAY}`, (j) => {
      const d = j?.desglose || j?.data || j || {};
      const gastos = d.gastos || d.expenses || [];
      const ingresos = d.ingresos || d.bankDeposits || d.ingresosBancarios || [];
      return {
        gastos: Array.isArray(gastos) ? gastos.length : null,
        ingresos: Array.isArray(ingresos) ? ingresos.length : null,
        ledgerStatus: d.status || j?.status || null,
      };
    });
    await get(
      'liquidacion.desgloseClosed',
      `/api/repartidor-finanzas/liquidaciones/${id}/desglose?date=2026-08-12`,
      (j) => {
        const d = j?.desglose || j?.data || j || {};
        const ingresos = d.ingresos || d.bankDeposits || d.ingresosBancarios || [];
        return {
          ingresos: Array.isArray(ingresos) ? ingresos.length : null,
          ledgerStatus: d.status || j?.status || null,
        };
      },
    );
    const venc = await get(
      'vencimientos',
      `/api/repartidor-finanzas/vencimientos/${id}?from=${YEAR}-01-01&to=${TODAY}&limit=50`,
      (j) => ({
        count: Array.isArray(j?.vencimientos)
          ? j.vencimientos.length
          : (Array.isArray(j?.data) ? j.data.length : null),
      }),
    );
    const vencItems = venc.json?.vencimientos || [];
    const firstVenc = Array.isArray(vencItems) ? vencItems[0] : null;
    const k = firstVenc?.keys || {};
    if (k.tipoDocumento && k.ejercicioDocumento != null && k.numeroDocumento != null) {
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
        `/api/repartidor-finanzas/vencimientos/${id}/${encodeURIComponent(docId)}/detalle`,
        (j) => ({ hasDetalle: Boolean(j?.detalle) }),
      );
    } else {
      console.log(JSON.stringify({
        label: `${scopeLabel}.vencimientos.detalle`,
        pass: true,
        skipped: 'no_vencimiento_keys',
      }));
      results.push(true);
    }
    // APK 4.1.2+52 path: limit without from/to must default ±180d (not Zod 400)
    await get(
      'vencimientos.legacyLimitOnly',
      `/api/repartidor-finanzas/vencimientos/${id}?limit=200`,
      (j) => ({
        count: Array.isArray(j?.vencimientos)
          ? j.vencimientos.length
          : (Array.isArray(j?.data) ? j.data.length : null),
      }),
    );
  }
  await get('evolution', `/api/repartidor-finanzas/evolution/${id}`);
  await get('cuentas', `/api/repartidor-finanzas/cuentas/${id}`);
  await get('commissions.tiers', '/api/repartidor-finanzas/commissions/tiers', (j) => ({
    tiers: Array.isArray(j?.tiers) ? j.tiers.length : (Array.isArray(j?.data) ? j.data.length : null),
  }));
  const yearFrom = `${YEAR}-01-01`;
  const yearTo = `${YEAR}-12-31`;
  await get(
    'commissions.summaryYear',
    `/api/repartidor-finanzas/commissions/summary/${id}?from=${yearFrom}&to=${yearTo}`,
  );
  if (isMulti) {
    console.log(JSON.stringify({
      label: `${scopeLabel}.commissions.months`,
      pass: true,
      skipped: 'ALL_uses_year_summary',
    }));
    results.push(true);
  } else {
    for (let month = 1; month <= 12; month += 1) {
      const from = `${YEAR}-${String(month).padStart(2, '0')}-01`;
      const last = new Date(YEAR, month, 0).getDate();
      const to = `${YEAR}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
      await get(
        `commissions.month.${month}`,
        `/api/repartidor-finanzas/commissions/summary/${id}?from=${from}&to=${to}`,
        (j) => {
          const s = j?.summary || j || {};
          return {
            delivered: s.deliveredAmount ?? s.entregado ?? null,
            commission: s.commission ?? s.comision ?? null,
          };
        },
      );
    }
  }

  await get(
    'rutero.stopsGeo',
    `/api/repartidor/rutero/stops-geo/${id}?date=${TODAY}`,
    (j) => ({
      stops: Array.isArray(j?.stops) ? j.stops.length : (Array.isArray(j?.data) ? j.data.length : null),
    }),
  );
  if (!isMulti) {
    await get(
      'rutero.order',
      `/api/repartidor/rutero/order/${id}?date=${TODAY}`,
      (j) => ({
        orden: Array.isArray(j?.orden) ? j.orden.length : null,
      }),
    );
  } else {
    console.log(JSON.stringify({ label: `${scopeLabel}.rutero.order`, pass: true, skipped: 'ALL_requires_single' }));
    results.push(true);
  }
  await get('rutero.paymentConditions', '/api/entregas/payment-conditions', (j) => ({
    count: Array.isArray(j?.data) ? j.data.length : (Array.isArray(j?.condiciones) ? j.condiciones.length : null),
  }));
  if (isMulti) {
    console.log(JSON.stringify({
      label: `${scopeLabel}.panel.collectionsSummary`,
      pass: true,
      skipped: 'ALL_requires_single',
    }));
    results.push(true);
    console.log(JSON.stringify({
      label: `${scopeLabel}.panel.collectionsDaily`,
      pass: true,
      skipped: 'ALL_requires_single',
    }));
    results.push(true);
  } else {
    const collectionsSummary = await request('GET', `/api/repartidor/collections/summary/${id}`, { token });
    const collectionsDaily = await request('GET', `/api/repartidor/collections/daily/${id}?date=${TODAY}`, { token });
    const collectionsOk = (res) => okStatus(res.status)
      || (res.status === 503 && res.json?.code === 'REPARTIDOR_COLLECTION_DATA_INCOMPLETE');
    console.log(JSON.stringify({
      label: `${scopeLabel}.panel.collectionsSummary`,
      status: collectionsSummary.status,
      pass: collectionsOk(collectionsSummary),
      code: collectionsSummary.json?.code || null,
      expectedFailClosed: collectionsSummary.json?.code === 'REPARTIDOR_COLLECTION_DATA_INCOMPLETE',
    }));
    console.log(JSON.stringify({
      label: `${scopeLabel}.panel.collectionsDaily`,
      status: collectionsDaily.status,
      pass: collectionsOk(collectionsDaily),
      code: collectionsDaily.json?.code || null,
      expectedFailClosed: collectionsDaily.json?.code === 'REPARTIDOR_COLLECTION_DATA_INCOMPLETE',
    }));
    results.push(collectionsOk(collectionsSummary));
    results.push(collectionsOk(collectionsDaily));
  }
  await get('panel.objectives', `/api/repartidor/history/objectives/${id}`);

  const chatbot = await request('GET', '/api/chatbot/health', { token });
  results.push(assertSuccess(`${scopeLabel}.asistente.health`, chatbot));
  const chatMsg = await request('POST', '/api/chatbot/message', {
    token,
    body: { message: 'cuantas entregas tengo hoy' },
  });
  results.push(assertSuccess(`${scopeLabel}.asistente.message`, chatMsg, {
    hasReply: Boolean(chatMsg.json?.reply || chatMsg.json?.message || chatMsg.json?.data),
  }));

  // Histórico: pick first client if any
  const clientsRes = await request('GET', `/api/repartidor/history/clients/${id}`, { token });
  const clients = clientsRes.json?.data || clientsRes.json?.clients || [];
  const firstClient = Array.isArray(clients) && clients[0]
    ? (clients[0].clienteId || clients[0].codigoCliente || clients[0].code || clients[0].id)
    : null;
  if (firstClient) {
    const docsRes = await get(
      'historico.documents',
      `/api/repartidor/history/documents/${encodeURIComponent(firstClient)}?repartidorId=${encodeURIComponent(id)}`,
      (j) => {
        const docs = j?.data || j?.documents || [];
        const arr = Array.isArray(docs) ? docs : [];
        const keys = arr.map((d) => `${d.tipo || d.type}|${d.numero || d.number || d.id}`).filter(Boolean);
        const statuses = arr.map((d) => String(d.status || d.estado || d.deliveryStatus || '').toLowerCase());
        return {
          count: arr.length,
          duplicates: keys.length - new Set(keys).size,
          noDelivered: statuses.filter((s) => s.includes('no_delivered') || s.includes('no entregado')).length,
          pending: statuses.filter((s) => s === 'pending' || s === 'pendiente').length,
        };
      },
    );
    const docs = docsRes.json?.data || docsRes.json?.documents || [];
    const alb = (Array.isArray(docs) ? docs : []).find((d) => {
      const tipo = String(d.tipo || d.type || '').toUpperCase();
      return (tipo.includes('ALB') || tipo.includes('CPC') || !tipo)
        && (d.numero || d.number || d.numeroAlbaran)
        && (d.ejercicio || d.year || d.ejercicioAlbaran);
    }) || (Array.isArray(docs) ? docs[0] : null);
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
    } else {
      console.log(JSON.stringify({
        label: `${scopeLabel}.historico.signature`,
        pass: true,
        skipped: 'no_document',
      }));
      results.push(true);
    }
  } else {
    console.log(JSON.stringify({ label: `${scopeLabel}.historico.documents`, pass: true, skipped: 'no_clients' }));
    results.push(true);
  }

  // Confirm contract gate (no write): must not be role 403
  const confirm = await request('POST', '/api/repartidor-finanzas/rutero/confirm-delivery-cobro', {
    token,
    headers: { 'Idempotency-Key': `e2e-dry-${id}-${Date.now()}` },
    body: { delivery: { itemId: 'E2E-DRY-NOWRITE', status: 'ENTREGADO', occurredAt: new Date().toISOString(), lineas: [] } },
  });
  const roleBlocked = confirm.status === 403
    && String(confirm.json?.code || '').includes('REPARTO_CONFIRMATION_ROLE');
  const confirmPass = !roleBlocked && confirm.status !== 401 && confirm.status !== 500;
  console.log(JSON.stringify({
    label: `${scopeLabel}.confirm.gate`,
    status: confirm.status,
    code: confirm.json?.code || null,
    pass: confirmPass,
    roleBlocked,
  }));
  results.push(confirmPass);

  const noEntrega = await request('POST', '/api/repartidor-finanzas/rutero/confirm-delivery-cobro', {
    token,
    headers: { 'Idempotency-Key': `e2e-dry-noent-${id}-${Date.now()}` },
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
  const noEntregaRoleBlocked = noEntrega.status === 403
    && String(noEntrega.json?.code || '').includes('REPARTO_CONFIRMATION_ROLE');
  const noEntregaPass = !noEntregaRoleBlocked && noEntrega.status !== 401 && noEntrega.status !== 500;
  console.log(JSON.stringify({
    label: `${scopeLabel}.confirm.noEntregaGate`,
    status: noEntrega.status,
    code: noEntrega.json?.code || null,
    pass: noEntregaPass,
    roleBlocked: noEntregaRoleBlocked,
  }));
  results.push(noEntregaPass);

  const list = pendientes.json?.data || pendientes.json?.albaranes || [];
  return {
    pass: results.every(Boolean),
    pendingCount: Array.isArray(list) ? list.length : 0,
    pendingSample: Array.isArray(list) && list[0]
      ? {
        id: list[0].id || list[0].albaranId,
        estado: list[0].estado || list[0].confirmationState,
        confirmationState: list[0].confirmationState,
      }
      : null,
  };
}

async function main() {
  await dumpRuntime();
  const token = await loginAndSwitch();

  const ready = await request('GET', '/api/ready', {
    headers: { 'User-Agent': 'GMP-SRE-HealthCheck/1.0' },
  });
  console.log(JSON.stringify({ label: 'ready', status: ready.status, pass: ready.status === 200 }));

  const list = await request('GET', '/api/auth/repartidores', { token });
  const drivers = (list.json?.data || list.json || [])
    .map((r) => String(r.code || r.id || '').trim())
    .filter(Boolean);
  console.log(JSON.stringify({
    label: 'auth.repartidores',
    status: list.status,
    pass: okStatus(list.status) && drivers.length > 0,
    count: drivers.length,
  }));

  const allId = drivers.join(',');
  const single = drivers.includes('08') ? '08' : (drivers[0] || '05');

  const allResult = await probeScope(token, allId, 'ALL');
  const singleResult = await probeScope(token, single, `VER_COMO_${single}`);

  const pass = allResult.pass && singleResult.pass && ready.status === 200;
  console.log(JSON.stringify({
    step: 'summary',
    pass,
    allPass: allResult.pass,
    singlePass: singleResult.pass,
    single,
    singlePending: singleResult.pendingCount,
    sample: singleResult.pendingSample,
  }));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(JSON.stringify({ step: 'fatal', error: String(err && err.message || err) }));
  process.exit(3);
});
