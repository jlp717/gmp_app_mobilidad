require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const http = require('http');
const { getProbeCredentials } = require('./probe-credentials');
const d = JSON.stringify(getProbeCredentials('login probe'));
const r = http.request({ hostname: '127.0.0.1', port: 3335, path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, (res) => {
  let b = '';
  res.on('data', (c) => (b += c));
  res.on('end', () => console.log(JSON.stringify({ status: res.statusCode, body: JSON.parse(b) }, null, 2)));
});
r.write(d);
r.end();
