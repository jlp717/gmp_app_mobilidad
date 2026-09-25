// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-fix | _-scratch gitignored; fix puntual logger finanzas | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '../routes/repartidor-finanzas.js');
let c = fs.readFileSync(p, 'utf8');
const before = c;
c = c.replace(
  /logger\.warn\(\[liq-outbox\] post-close send failed: \);/g,
  "logger.warn('[liq-outbox] post-close send failed: ' + (emailError && emailError.message ? emailError.message : emailError));",
);
c = c.replace(
  /logger\.warn\(\[variance\] post-confirm notify failed: \);/g,
  "logger.warn('[variance] post-confirm notify failed: ' + (notifyError && notifyError.message ? notifyError.message : notifyError));",
);
if (c === before) {
  console.error('NO_CHANGE');
  process.exit(2);
}
fs.writeFileSync(p, c);
console.log('OK');
