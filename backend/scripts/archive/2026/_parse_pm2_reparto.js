// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-parse | _-scratch gitignored; parse puntual PM2 reparto | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';
const fs = require('fs');
const file = process.argv[2];
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const seen = new Set();
for (const p of j) {
  const env = Object.assign({}, (p.pm2_env && p.pm2_env.env) || {}, p.pm2_env || {});
  const key = `${p.name}|${p.pid}|${env.REPARTO_TABLE_SET || ''}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`${p.name} pid=${p.pid} port=${env.PORT || env.port || ''} table=${env.REPARTO_TABLE_SET || '-'} writes=${env.REPARTO_WRITES_ENABLED || '-'} env=${env.REPARTO_ENVIRONMENT || '-'}`);
}
