require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const http = require('http');
const odbc = require('odbc');
function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const d = body ? JSON.stringify(body) : null;
    const h = { 'User-Agent': 'GMP-Gap-Check/1.0', 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    const r = http.request({ hostname: '127.0.0.1', port: 3335, path: '/api' + path, method, headers: h }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b || '{}') }));
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
  const login = await req('POST', '/auth/login', { username: 'diego', password: '9322' });
  const token = login.body.token;
  const conn = await odbc.connect(cs());
  const rows = await conn.query(`SELECT TRIM(R.CODIGOCLIENTEALBARAN) AS C, TRIM(R.SERIEDOCUMENTO) AS S, R.NUMERODOCUMENTO AS N FROM JAVIER.REPARTIDOR_COBROS R FETCH FIRST 5 ROWS ONLY`);
  const out = { repartidorRows: rows };
  if (rows[0]) {
    const c = String(rows[0].C).trim();
    const p = await req('GET', `/cobros/${encodeURIComponent(c)}/pendientes?vendedorCodes=93`, null, token);
    out.api = { client: c, status: p.status, flagged: (p.body.cobros || []).filter((x) => x.cobradoPorRepartidor) };
  }
  await conn.close();
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
