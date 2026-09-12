'use strict';

/**
 * HIT remaining COMERCIAL tabs (isolated_test). Never prints PIN.
 * Run on 230: API_HOST=127.0.0.1 node backend/scripts/hit-comercial-tabs-rest.js
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
const YEAR = String(process.env.HIT_YEAR || new Date().getFullYear());
const MONTH = String(process.env.HIT_MONTH || (new Date().getMonth() + 1));
const UA = 'GMP-Commercial-Tabs-HIT/1.0';

function parseBody(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return { raw: String(raw || '').slice(0, 180) };
  }
}

function api(method, pathName, { token, body, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const started = Date.now();
    const reqHeaders = { 'User-Agent': UA };
    if (token) reqHeaders.Authorization = `Bearer ${token}`;
    if (payload) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: `/api${pathName}`,
      method,
      headers: reqHeaders,
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        body: parseBody(raw),
        ms: Date.now() - started,
      }));
    });
    req.setTimeout(timeoutMs || 45000, () => {
      req.destroy(new Error(`timeout ${pathName}`));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function pinForVendor(vendor) {
  const rows = await queryWithParams(
    `SELECT TRIM(CODIGOPIN) AS PIN
       FROM DSEDAC.VDPL1
      WHERE TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))
      FETCH FIRST 1 ROW ONLY`,
    [vendor],
  );
  return String(rows?.[0]?.PIN || '').trim();
}

function pick(obj, keys) {
  const out = {};
  for (const key of keys) {
    if (obj && obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

function countOf(body, keys) {
  for (const key of keys) {
    const value = body?.[key];
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === 'object' && Array.isArray(value.data)) return value.data.length;
  }
  if (typeof body?.count === 'number') return body.count;
  if (typeof body?.total === 'number') return body.total;
  return null;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function yearlySales(body, year) {
  const key = String(year);
  const totals = body?.yearTotals || {};
  const months = body?.yearlyData?.[key] || body?.yearlyData?.[year] || [];
  const total = num(totals[key]?.totalSales || totals[year]?.totalSales);
  const fromMonths = Array.isArray(months)
    ? months.reduce((sum, row) => sum + num(row.sales || row.SALES), 0)
    : 0;
  return {
    months: Array.isArray(months) ? months.length : 0,
    sales: total || fromMonths,
  };
}

function firstClient(body) {
  const list = body?.clients || body?.data || [];
  const row = Array.isArray(list) ? list[0] : null;
  return String(row?.code || row?.codigo || row?.CODIGOCLIENTE || row?.clientCode || '').trim();
}

function tokenFrom(res, fallback) {
  return res.body?.token
    || res.body?.accessToken
    || res.body?.user?.token
    || fallback;
}

const rows = [];
let fails = 0;

function record(tab, action, role, res, extra = {}) {
  const expected = extra.expected ?? [200];
  const expectFail = extra.expectFail === true;
  const okStatus = expected.includes(res.status);
  const sampleOk = extra.sampleOk !== false;
  const pass = expectFail ? !okStatus || extra.forcedPass === true
    : okStatus && sampleOk && extra.forcedPass !== false;
  if (extra.forcedPass === true) {
    /* explicit override */
  }
  const sample = extra.sample || '';
  const line = {
    tab,
    action,
    role,
    status: res.status,
    ms: res.ms,
    sample: String(sample).slice(0, 180),
    pass: Boolean(pass),
  };
  rows.push(line);
  if (!line.pass) fails += 1;
  console.log(
    `[${line.pass ? 'PASS' : 'FAIL'}] ${tab} | ${action} | ${role} | status=${line.status} ms=${line.ms} ${sample}`,
  );
  return line;
}

async function loginVendor(vendor) {
  const pin = await pinForVendor(vendor);
  if (!pin) {
    return { vendor, ok: false, reason: 'sin PIN VDPL1' };
  }
  const login = await api('POST', '/auth/login', {
    body: { username: vendor, password: pin },
  });
  const token = login.body?.token || login.body?.accessToken;
  const user = login.body?.user || {};
  return {
    vendor,
    ok: login.status === 200 && Boolean(token),
    status: login.status,
    ms: login.ms,
    token,
    role: String(user.role || login.body?.role || '').toUpperCase(),
    activeMode: String(user.activeMode || login.body?.activeMode || '').toUpperCase(),
    isJefe: user.isJefeVentas === true || String(user.role || '').toUpperCase() === 'JEFE_VENTAS',
    showCommissions: user.showCommissions === true || login.body?.showCommissions === true,
    vendorCodes: user.vendorCodes || user.vendedorCodes || login.body?.vendedorCodes || [],
    availableRoles: user.availableRoles || login.body?.availableRoles || [],
    availableModes: user.availableModes || login.body?.availableModes || [],
    userCode: String(user.code || user.id || vendor),
  };
}

async function hitActor(actor, jefeActor) {
  const roleLabel = actor.isJefe ? `JEFE_${actor.vendor}` : `COMERCIAL_${actor.vendor}`;
  let token = actor.token;
  const vendor = actor.vendor;
  const year = YEAR;
  const month = MONTH;

  record('Auth', 'POST /auth/login', roleLabel, { status: actor.status, ms: actor.ms }, {
    sample: `role=${actor.role} mode=${actor.activeMode || '-'} codes=${(actor.vendorCodes || []).slice(0, 8).join(',') || vendor} showComm=${actor.showCommissions ? 1 : 0}`,
    sampleOk: actor.ok,
  });

  const validate = await api('GET', '/auth/validate', { token });
  record('Auth', 'GET /auth/validate', roleLabel, validate, {
    sample: `ok=${validate.body?.valid !== false} role=${String(validate.body?.user?.role || validate.body?.role || actor.role)}`,
  });

  if (actor.isJefe) {
    const metrics = await api('GET', `/dashboard/metrics?year=${year}&month=${month}`, { token, timeoutMs: 25000 });
    const sales = num(metrics.body?.totalSales || metrics.body?.ventas || metrics.body?.metrics?.totalSales || metrics.body?.kpis?.totalVentas);
    record('Panel', 'GET /dashboard/metrics', roleLabel, metrics, {
      sample: `sales=${sales} keys=${Object.keys(metrics.body || {}).slice(0, 8).join(',')}`,
      sampleOk: metrics.status === 200 && sales > 0,
    });

    const matrix = await api('GET', `/dashboard/matrix-data?year=${year}&groupBy=vendor&limit=20`, {
      token,
      timeoutMs: 50000,
    });
    const matrixCount = countOf(matrix.body, ['rows', 'data', 'matrix', 'nodes']) ?? 0;
    record('Panel', 'GET /dashboard/matrix-data', roleLabel, matrix, {
      sample: `count=${matrixCount} keys=${Object.keys(matrix.body || {}).slice(0, 8).join(',')}`,
      sampleOk: matrix.status === 200 && matrixCount > 0,
    });

    const recent = await api('GET', `/dashboard/recent-sales?year=${year}&month=${month}&limit=15`, { token });
    const recentCount = countOf(recent.body, ['sales', 'data']) ?? 0;
    record('Panel', 'GET /dashboard/recent-sales', roleLabel, recent, {
      sample: `count=${recentCount}`,
      sampleOk: recent.status === 200 && recentCount >= 0,
    });

    const evoDash = await api('GET', `/dashboard/sales-evolution?year=${year}&months=12`, { token, timeoutMs: 30000 });
    const evoCount = countOf(evoDash.body, ['evolution', 'data']) ?? 0;
    record('Panel', 'GET /dashboard/sales-evolution', roleLabel, evoDash, {
      sample: `count=${evoCount}`,
    });

    const yoy = await api('GET', `/analytics/yoy-comparison?year=${year}&month=${month}`, { token, timeoutMs: 30000 });
    record('Panel', 'GET /analytics/yoy-comparison', roleLabel, yoy, {
      sample: `keys=${Object.keys(yoy.body || {}).slice(0, 8).join(',')}`,
    });
  }

  const vendedores = await api('GET', '/rutero/vendedores', { token });
  const vendorList = vendedores.body?.vendedores || [];
  record('Ver como', 'GET /rutero/vendedores', roleLabel, vendedores, {
    sample: `count=${vendorList.length} sample=${vendorList.slice(0, 3).map((v) => v.code || v.codigo).join(',')}`,
    sampleOk: vendedores.status === 200 && vendorList.length > 0,
  });

  const clientsQuery = actor.isJefe
    ? '/clients?limit=20'
    : `/clients?vendedorCodes=${encodeURIComponent(vendor)}&limit=20`;
  const ownClients = await api('GET', clientsQuery, { token, timeoutMs: 30000 });
  const ownCount = countOf(ownClients.body, ['clients']) ?? 0;
  let clientCode = firstClient(ownClients.body);
  record('Clientes', 'GET /clients lista', roleLabel, ownClients, {
    sample: `count=${ownCount} first=${clientCode || '-'}`,
    sampleOk: ownClients.status === 200 && ownCount > 0,
  });

  let scopeVendor = vendor;
  if (actor.isJefe) {
    const as35 = await api('GET', '/clients?vendedorCodes=35&limit=10', { token, timeoutMs: 30000 });
    const as35Count = countOf(as35.body, ['clients']) ?? 0;
    const verComoClient = firstClient(as35.body);
    record('Ver como', 'GET /clients vendedor=35', roleLabel, as35, {
      sample: `count=${as35Count} first=${verComoClient || '-'}`,
      sampleOk: as35.status === 200 && as35Count > 0,
    });
    if (verComoClient) {
      clientCode = verComoClient;
      scopeVendor = '35';
    }
  } else if (vendor === '80') {
    const as72 = await api('GET', '/clients?vendedorCodes=72&limit=10', { token, timeoutMs: 30000 });
    const as72Count = countOf(as72.body, ['clients']) ?? 0;
    record('Ver como', 'GET /clients vendedor=72 (equipo)', roleLabel, as72, {
      sample: `count=${as72Count}`,
      sampleOk: as72.status === 200 && as72Count > 0,
    });
    const as01 = await api('GET', '/clients?vendedorCodes=01&limit=5', { token });
    record('Ver como', 'GET /clients vendedor=01 fuera equipo', roleLabel, as01, {
      expected: [403, 400],
      sample: `status=${as01.status}`,
      sampleOk: [403, 400].includes(as01.status) || (as01.status === 200 && (countOf(as01.body, ['clients']) || 0) === 0),
    });
  } else if (vendor === '35') {
    const as80 = await api('GET', '/clients?vendedorCodes=80&limit=5', { token });
    record('Ver como', 'GET /clients vendedor=80 denied', roleLabel, as80, {
      expected: [403, 400],
      sample: `status=${as80.status} count=${countOf(as80.body, ['clients'])}`,
      sampleOk: [403, 400].includes(as80.status) || (as80.status === 200 && (countOf(as80.body, ['clients']) || 0) === 0 && as80.body?.success === false),
    });
  }

  if (clientCode) {
    const detail = await api('GET', `/clients/${encodeURIComponent(clientCode)}?vendedorCodes=${encodeURIComponent(scopeVendor)}`, { token });
    record('Clientes', 'GET /clients/:code detalle', roleLabel, detail, {
      sample: `name=${detail.body?.client?.name || detail.body?.name || '-'}`,
    });
    const hist = await api('GET', `/clients/${encodeURIComponent(clientCode)}/sales-history?vendedorCodes=${encodeURIComponent(scopeVendor)}&limit=20`, { token, timeoutMs: 30000 });
    const histCount = countOf(hist.body, ['history', 'data']) ?? 0;
    record('Clientes', 'GET sales-history', roleLabel, hist, {
      sample: `count=${histCount} grouped=${hist.body?.grouped ? 1 : 0}`,
      sampleOk: hist.status === 200 && histCount > 0,
    });
  }

  const week = await api('GET', `/rutero/week?vendedorCodes=${encodeURIComponent(vendor)}&year=${year}&month=${month}`, { token, timeoutMs: 35000 });
  const weekMap = week.body?.week || {};
  const weekTotal = Object.values(weekMap).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const uniqueClients = Number(week.body?.totalUniqueClients || 0);
  record('Ruta', 'GET /rutero/week', roleLabel, week, {
    sample: `unique=${uniqueClients} sumDays=${weekTotal} cache=${week.body?.cacheStatus || '-'}`,
    sampleOk: week.status === 200 && (uniqueClients > 0 || weekTotal > 0),
  });

  const dayName = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
    .find((day) => Number(weekMap[day] || weekMap[day?.toUpperCase()] || 0) > 0) || 'martes';
  const day = await api('GET', `/rutero/day/${dayName}?vendedorCodes=${encodeURIComponent(vendor)}&year=${year}&month=${month}`, { token, timeoutMs: 40000 });
  const dayClients = day.body?.clients || day.body?.data || [];
  record('Ruta', `GET /rutero/day/${dayName}`, roleLabel, day, {
    sample: `count=${Array.isArray(dayClients) ? dayClients.length : 0}`,
    sampleOk: day.status === 200 && Array.isArray(dayClients) && dayClients.length > 0,
  });

  const objEvo = await api('GET', `/objectives/evolution?vendedorCodes=${encodeURIComponent(vendor)}&years=${year}`, { token, timeoutMs: 40000 });
  const objParsed = yearlySales(objEvo.body, year);
  record('Objetivos', 'GET /objectives/evolution', roleLabel, objEvo, {
    sample: `months=${objParsed.months} sales=${Math.round(objParsed.sales)} keys=${Object.keys(objEvo.body || {}).slice(0, 6).join(',')}`,
    sampleOk: objEvo.status === 200 && objParsed.months === 12 && objParsed.sales > 0,
  });

  const byClient = await api('GET', `/objectives/by-client?vendedorCodes=${encodeURIComponent(vendor)}&years=${year}&limit=30`, { token, timeoutMs: 45000 });
  const byClientRows = byClient.body?.clients || byClient.body?.data || [];
  record('Objetivos', 'GET /objectives/by-client', roleLabel, byClient, {
    sample: `count=${Array.isArray(byClientRows) ? byClientRows.length : 0}`,
    sampleOk: byClient.status === 200 && Array.isArray(byClientRows) && byClientRows.length > 0,
  });

  const pops = await api('GET', '/objectives/populations', { token });
  const popCount = Array.isArray(pops.body) ? pops.body.length : countOf(pops.body, ['populations', 'data']) ?? 0;
  record('Objetivos', 'GET /objectives/populations', roleLabel, pops, {
    sample: `count=${popCount}`,
    sampleOk: pops.status === 200 && popCount > 0,
  });

  if (vendor === '80') {
    const teamObj = await api('GET', `/objectives/evolution?vendedorCodes=ALL&years=${year}`, { token, timeoutMs: 40000 });
    const teamParsed = yearlySales(teamObj.body, year);
    const different = Math.abs(objParsed.sales - teamParsed.sales) > 1;
    record('Objetivos', '80 personal ≠ suma equipo ALL', roleLabel, teamObj, {
      sample: `personal=${Math.round(objParsed.sales)} teamALL=${Math.round(teamParsed.sales)} delta=${Math.round(objParsed.sales - teamParsed.sales)}`,
      sampleOk: teamObj.status === 200 && teamParsed.sales > 0 && different,
    });
  }

  const comm = await api('GET', `/commissions/summary?vendedorCode=${encodeURIComponent(vendor)}&year=${year}`, { token, timeoutMs: 50000 });
  const hidden = comm.body?.hiddenForCommercial80 === true;
  const commMonths = comm.body?.months || [];
  const commTotal = num(comm.body?.grandTotalCommission || comm.body?.totals?.commission);
  const teamEmbedded = comm.body?.teamCommission && typeof comm.body.teamCommission === 'object';
  record('Comisiones', 'GET /commissions/summary', roleLabel, comm, {
    sample: `hidden80=${hidden ? 1 : 0} months=${Array.isArray(commMonths) ? commMonths.length : 0} total=${Math.round(commTotal)} teamEmbed=${teamEmbedded ? 1 : 0} lead=${comm.body?.isTeamLead ? 1 : 0}`,
    sampleOk: comm.status === 200 && !hidden && Array.isArray(commMonths) && commMonths.length > 0,
  });

  if (vendor === '80') {
    const team = await api('GET', `/commissions/team/80?year=${year}`, { token, timeoutMs: 50000 });
    const teamHidden = team.body?.hiddenForCommercial80 === true;
    const teamMonths = team.body?.months || [];
    const leaderPersonal = num(team.body?.leaderPersonalCommission);
    const teamAgg = num(team.body?.annualTeamAggregateCommission || team.body?.annualTeamMembersCommission || team.body?.annualTotal);
    record('Comisiones', 'GET /commissions/team/80', roleLabel, team, {
      sample: `hidden=${teamHidden ? 1 : 0} months=${Array.isArray(teamMonths) ? teamMonths.length : 0} personal=${Math.round(leaderPersonal)} team=${Math.round(teamAgg)}`,
      sampleOk: team.status === 200 && !teamHidden && Array.isArray(teamMonths) && teamMonths.length > 0,
    });
  }

  const kpiDash = await api('GET', `/kpi/dashboard?vendorCode=${encodeURIComponent(vendor)}`, { token, timeoutMs: 40000 });
  const kpiAlerts = num(kpiDash.body?.totals?.TOTAL_ALERTS || kpiDash.body?.totalAlerts || kpiDash.body?.kpis?.totalVentas);
  record('Alertas', 'GET /kpi/dashboard', roleLabel, kpiDash, {
    sample: `success=${kpiDash.body?.success} alerts=${kpiAlerts} keys=${Object.keys(kpiDash.body || {}).slice(0, 8).join(',')}`,
    sampleOk: kpiDash.status === 200 && kpiDash.body?.success !== false,
  });
  const kpiSum = await api('GET', '/kpi/alerts/summary', { token });
  record('Alertas', 'GET /kpi/alerts/summary', roleLabel, kpiSum, {
    sample: `success=${kpiSum.body?.success} keys=${Object.keys(kpiSum.body || {}).slice(0, 8).join(',')}`,
  });
  const kpiClients = await api('GET', `/kpi/alerts/clients?vendedorCodes=${encodeURIComponent(vendor)}`, { token, timeoutMs: 30000 });
  const alertClientCount = (kpiClients.body?.clientCodes || []).length;
  record('Alertas', 'GET /kpi/alerts/clients', roleLabel, kpiClients, {
    sample: `clients=${alertClientCount}`,
  });
  const kpiHealth = await api('GET', '/kpi/health', { token });
  record('Alertas', 'GET /kpi/health', roleLabel, kpiHealth, {
    sample: `status=${kpiHealth.body?.status || kpiHealth.body?.ok || '-'}`,
  });

  const bolsaStatus = await api('GET', `/bolsa/${encodeURIComponent(vendor)}/status?year=${year}&month=${month}`, { token, timeoutMs: 30000 });
  record('Bolsa', 'GET /bolsa/:vd/status', roleLabel, bolsaStatus, {
    sample: `keys=${Object.keys(bolsaStatus.body?.bolsa || bolsaStatus.body || {}).slice(0, 8).join(',')} saldo=${bolsaStatus.body?.bolsa?.saldo ?? bolsaStatus.body?.saldo ?? '-'}`,
  });
  const bolsaMov = await api('GET', `/bolsa/${encodeURIComponent(vendor)}/movements?year=${year}&month=${month}&limit=20`, { token, timeoutMs: 30000 });
  const movCount = countOf(bolsaMov.body, ['movements']) ?? 0;
  record('Bolsa', 'GET /bolsa/:vd/movements', roleLabel, bolsaMov, {
    sample: `count=${movCount}`,
  });
  const bolsaHist = await api('GET', `/bolsa/${encodeURIComponent(vendor)}/history?months=12`, { token, timeoutMs: 30000 });
  const histPts = countOf(bolsaHist.body, ['points']) ?? 0;
  record('Bolsa', 'GET /bolsa/:vd/history', roleLabel, bolsaHist, {
    sample: `points=${histPts}`,
  });
  if (actor.isJefe) {
    const grouped = await api('GET', `/bolsa/grouped?year=${year}&month=${month}`, { token, timeoutMs: 35000 });
    const gCount = (grouped.body?.vendedores || grouped.body?.items || []).length;
    record('Bolsa', 'GET /bolsa/grouped', roleLabel, grouped, {
      sample: `vendors=${gCount}`,
      sampleOk: grouped.status === 200 && gCount > 0,
    });
  }

  if (clientCode) {
    const evo = await api('GET', `/pedidos/client-evolution/${encodeURIComponent(clientCode)}?vendedorCodes=${encodeURIComponent(scopeVendor)}`, { token, timeoutMs: 40000 });
    const monthly = evo.body?.data?.monthlySales || evo.body?.monthlySales || [];
    record('Evolución', 'GET /pedidos/client-evolution/:code', roleLabel, evo, {
      sample: `success=${evo.body?.success} months=${Array.isArray(monthly) ? monthly.length : 0}`,
      sampleOk: evo.status === 200 && evo.body?.success !== false && Array.isArray(monthly) && monthly.length > 0,
    });
    const evoMonth = await api('GET', `/evolution/monthly?vendedorCodes=${encodeURIComponent(scopeVendor)}&clientCode=${encodeURIComponent(clientCode)}&months=24`, { token, timeoutMs: 35000 });
    const evoM = evoMonth.body?.monthly || [];
    record('Evolución', 'GET /evolution/monthly', roleLabel, evoMonth, {
      sample: `months=${Array.isArray(evoM) ? evoM.length : 0}`,
    });
  }

  const botHealth = await api('GET', '/chatbot/health', { token });
  record('Asistente', 'GET /chatbot/health', roleLabel, botHealth, {
    sample: `status=${botHealth.body?.status || '-'} llm=${botHealth.body?.llm || '-'}`,
  });
  const botMsg = await api('POST', '/chatbot/message', {
    token,
    timeoutMs: 40000,
    body: { message: 'resumen de mis clientes de hoy' },
  });
  const reply = String(botMsg.body?.response || botMsg.body?.error || '').replace(/\s+/g, ' ').slice(0, 120);
  record('Asistente', 'POST /chatbot/message', roleLabel, botMsg, {
    sample: `len=${reply.length} text=${reply || '-'}`,
    sampleOk: botMsg.status === 200 && reply.length > 0,
  });

  if (clientCode) {
    const cold = await api('GET', `/cobros/${encodeURIComponent(clientCode)}/pendientes`, { token, timeoutMs: 20000 });
    const warm = await api('GET', `/cobros/${encodeURIComponent(clientCode)}/pendientes`, { token, timeoutMs: 20000 });
    record('Cobros p95', 'GET pendientes cold', roleLabel, cold, {
      sample: `count=${(cold.body?.cobros || cold.body?.pendientes || []).length} warmMs=${warm.ms}`,
    });
  }

  const pendingSum = await api('GET', `/cobros/pending-summary/${encodeURIComponent(vendor)}`, { token, timeoutMs: 40000 });
  const psCount = countOf(pendingSum.body, ['clients', 'data', 'items']) ?? 0;
  record('Cobros p95', 'GET pending-summary', roleLabel, pendingSum, {
    sample: `count=${psCount}`,
  });

  const stayRole = actor.isJefe ? 'JEFE_VENTAS' : 'COMERCIAL';
  const switchSelf = await api('POST', '/auth/switch-role', {
    token,
    body: { userId: actor.userCode, newRole: stayRole },
  });
  token = tokenFrom(switchSelf, token);
  record('switch-role', `POST stay ${stayRole}`, roleLabel, switchSelf, {
    sample: `success=${switchSelf.body?.success} role=${switchSelf.body?.user?.role || switchSelf.body?.role || '-'} mode=${switchSelf.body?.activeMode || switchSelf.body?.user?.activeMode || '-'}`,
    sampleOk: switchSelf.status === 200 && switchSelf.body?.success !== false,
  });

  if (actor.isJefe) {
    const back = await api('POST', '/auth/switch-role', {
      token,
      body: { userId: actor.userCode, newRole: 'JEFE_VENTAS' },
    });
    token = tokenFrom(back, token);
    record('switch-role', 'POST JEFE_VENTAS modo comercial', roleLabel, back, {
      sample: `success=${back.body?.success} role=${back.body?.user?.role || '-'} mode=${back.body?.activeMode || back.body?.user?.activeMode || '-'}`,
      sampleOk: back.status === 200 && back.body?.success !== false,
    });
    const after = await api('GET', `/dashboard/metrics?year=${year}&month=${month}`, { token, timeoutMs: 25000 });
    record('switch-role', 'GET metrics after switch', roleLabel, after, {
      sample: `status=${after.status}`,
    });
  } else {
    const denied = await api('POST', '/auth/switch-role', {
      token,
      body: { userId: actor.userCode, newRole: 'JEFE_VENTAS' },
    });
    record('switch-role', 'POST JEFE_VENTAS denied', roleLabel, denied, {
      expected: [403, 400, 422],
      sample: `status=${denied.status} code=${denied.body?.code || denied.body?.error || '-'}`,
      sampleOk: [403, 400, 422].includes(denied.status),
    });
    const still = await api('GET', '/auth/validate', { token });
    record('switch-role', 'sesión viva tras deny', roleLabel, still, {
      sample: `status=${still.status}`,
    });
  }
}

async function discoverJefe() {
  const preferred = ['98', '90', '99', '00'];
  for (const code of preferred) {
    const pin = await pinForVendor(code);
    if (!pin) continue;
    const actor = await loginVendor(code);
    if (actor.ok && actor.isJefe) return actor;
  }
  try {
    const rowsJefe = await queryWithParams(
      `SELECT TRIM(V.CODIGOVENDEDOR) AS VD
         FROM DSEDAC.VDDX X
         JOIN DSEDAC.VDD V ON TRIM(V.CODIGOVENDEDOR) = TRIM(X.CODIGOVENDEDOR)
        WHERE UPPER(TRIM(COALESCE(X.JEFEVENTASSN, ''))) = 'S'
        FETCH FIRST 8 ROWS ONLY`,
      [],
    );
    for (const row of rowsJefe || []) {
      const code = String(row.VD || '').trim();
      if (!code || ['80', '35'].includes(code)) continue;
      const actor = await loginVendor(code);
      if (actor.ok && actor.isJefe) return actor;
    }
  } catch (error) {
    console.log(`[WARN] discover JEFE: ${String(error.message || error).slice(0, 120)}`);
  }
  return null;
}

async function main() {
  await initDb();
  try {
    const ready = await api('GET', '/ready');
    record('Infra', 'GET /ready', 'SYS', ready, {
      sample: `status=${ready.body?.status || '-'} tableSet=${ready.body?.tableSet || ready.body?.reparto?.tableSet || '-'}`,
      sampleOk: ready.status === 200,
    });

    const actor80 = await loginVendor('80');
    const actor35 = await loginVendor('35');
    const actorJefe = await discoverJefe();

    if (!actor80.ok) {
      record('Auth', 'login 80', 'COMERCIAL_80', { status: actor80.status || 0, ms: 0 }, {
        sample: actor80.reason || 'login fail',
        sampleOk: false,
      });
    } else {
      await hitActor(actor80, actorJefe);
    }
    if (!actor35.ok) {
      record('Auth', 'login 35', 'COMERCIAL_35', { status: actor35.status || 0, ms: 0 }, {
        sample: actor35.reason || 'login fail',
        sampleOk: false,
      });
    } else {
      await hitActor(actor35, actorJefe);
    }
    if (!actorJefe) {
      record('Panel', 'login JEFE_VENTAS', 'JEFE', { status: 0, ms: 0 }, {
        sample: 'no JEFE_VENTAS con PIN VDPL1',
        sampleOk: false,
      });
    } else {
      console.log(`[INFO] JEFE vendor=${actorJefe.vendor} role=${actorJefe.role} mode=${actorJefe.activeMode}`);
      await hitActor(actorJefe, actorJefe);
    }

    const summary = {};
    for (const row of rows) {
      summary[row.tab] = summary[row.tab] || { pass: 0, fail: 0 };
      summary[row.tab][row.pass ? 'pass' : 'fail'] += 1;
    }
    console.log('--- SUMMARY ---');
    for (const [tab, counts] of Object.entries(summary)) {
      console.log(`${tab}: pass=${counts.pass} fail=${counts.fail}`);
    }
    console.log(`TOTAL fail=${fails} rows=${rows.length}`);
    process.exitCode = fails > 0 ? 1 : 0;
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(String(error && error.message ? error.message : error).slice(0, 300));
  process.exit(1);
});
