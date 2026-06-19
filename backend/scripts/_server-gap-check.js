'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const http = require('http');
const odbc = require('odbc');
function req(method, path, body, token, extra = {}) {
  return new Promise((resolve, reject) => {
    const d = body ? JSON.stringify(body) : null;
    const h = { 'User-Agent': 'GMP-Gap-Check/1.0', 'Content-Type': 'application/json', ...extra };
    if (token) h.Authorization = 'Bearer ' + token;
    const r = http.request({ hostname: '127.0.0.1', port: 3335, path: '/api' + path, method, headers: h }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(b || '{}'); } catch (_) { parsed = { raw: b }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (d) r.write(d);
    r.end();
  });
}
function cs() {
  const pwd = process.env.ODBC_PWD || process.env.ODBC_PASSWORD;
  return `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${pwd};NAM=1;CCSID=1208;CMPTDM=1;CPTOUT=120;COMMTIMEOUT=180;DBQ=${process.env.ODBC_DSN || 'GMP'}`;
}
(async () => {
  const out = {};
  const login = await req('POST', '/auth/login', { username: 'diego', password: '9322' });
  out.login = { status: login.status, role: login.body?.user?.role, hasToken: !!login.body?.token };
  const token = login.body.token;
  if (!token) {
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }
  const scope = 'vendedorCodes=93';
  const pmrApi = await req('GET', `/pedidos/promotions?clientCode=4300001091&${scope}`, null, token);
  const conn = await odbc.connect(cs());
  const pmrDb = await conn.query(`SELECT COUNT(*) AS C FROM DSEDAC.PMR WHERE TRIM(CODIGOCLIENTE) = '4300001091'`);
  out.promo4300001091 = { apiStatus: pmrApi.status, apiCount: (pmrApi.body.promotions || []).length, dbCount: Number(pmrDb[0].C), match: (pmrApi.body.promotions || []).length === Number(pmrDb[0].C) };
  const pend = await req('GET', `/cobros/4300010359/pendientes?${scope}`, null, token);
  const docs = pend.body.cobros || [];
  const flagged = docs.filter((c) => c.cobradoPorRepartidor);
  out.cobradoPorRepartidor = { status: pend.status, totalDocs: docs.length, flaggedCount: flagged.length, sample: flagged[0] || docs[0] || null };
  const hist = await req('GET', `/cobros/4300010359/historico?limit=3&${scope}`, null, token);
  const h0 = (hist.body.historico || [])[0];
  out.historico = { status: hist.status, count: (hist.body.historico || []).length, hasCamelAndLegacy: h0 ? !!(h0.codigoCliente && h0.CODIGO_CLIENTE && h0.fecha) : null };
  const bolsa = await req('GET', '/bolsa/093/movements?limit=5', null, token);
  const m = (bolsa.body.movements || [])[0];
  const required = ['importe', 'tipo', 'fecha', 'lineId', 'precioVenta', 'precioMinimoCongelado', 'cantidad', 'idempotencyKey'];
  out.bolsaMovement = { status: bolsa.status, count: (bolsa.body.movements || []).length, fieldsOk: m ? required.every((k) => Object.prototype.hasOwnProperty.call(m, k)) : null, sample: m };
  const histBolsa = await req('GET', '/bolsa/093/history?months=3', null, token);
  out.bolsaHistory = { status: histBolsa.status, points: (histBolsa.body.points || []).length };
  const drafts = await req('GET', `/pedidos?${scope}&estado=BORRADOR&limit=5`, null, token);
  out.borradorListEstado = { status: drafts.status, count: (drafts.body.orders || []).length, allBorrador: (drafts.body.orders || []).every((o) => String(o.estado || '').toUpperCase() === 'BORRADOR') };
  const repRow = await conn.query(`SELECT TRIM(R.CODIGOCLIENTEALBARAN) AS CLIENTE, TRIM(R.SERIEDOCUMENTO) AS SERIE, R.NUMERODOCUMENTO AS NUM FROM JAVIER.REPARTIDOR_COBROS R JOIN DSEDAC.CLP CLP ON TRIM(CLP.CODIGOCLIENTE)=TRIM(R.CODIGOCLIENTEALBARAN) AND TRIM(CLP.VENDEDORCOMERCIAL)='93' FETCH FIRST 1 ROW ONLY`);
  if (repRow[0]) {
    const c = String(repRow[0].CLIENTE).trim();
    const p2 = await req('GET', `/cobros/${encodeURIComponent(c)}/pendientes?${scope}`, null, token);
    const f = (p2.body.cobros || []).filter((x) => x.cobradoPorRepartidor);
    out.repartidorClientCheck = { client: c, status: p2.status, flagged: f.length, sample: f[0] || null };
  }
  const confirmBody = await req('PUT', '/pedidos/119/confirm', { saleType: 'CC' }, token);
  out.saleTypeConfirmProbe = { status: confirmBody.status, code: confirmBody.body?.code, error: confirmBody.body?.error };
  const bad = await req('PUT', '/pedidos/119/confirm', { tipoventa: 'CC' }, token);
  out.tipoventaRejectProbe = { status: bad.status, error: bad.body?.error };
  await conn.close();
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
