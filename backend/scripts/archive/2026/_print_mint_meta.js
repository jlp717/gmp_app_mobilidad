// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-mint | _-scratch gitignored; impresion puntual meta mint | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';
const j = require('./_mint_out.json');
console.log(JSON.stringify({
  ok: j.ok,
  code: j.code,
  role: j.role,
  hasToken: Boolean(j.token),
}));
