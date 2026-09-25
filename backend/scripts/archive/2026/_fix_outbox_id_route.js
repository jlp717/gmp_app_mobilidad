// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-fix | _-scratch gitignored; fix puntual ruta outbox id | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '../routes/repartidor-finanzas.js');
let c = fs.readFileSync(p, 'utf8');
if (c.includes('outboxId: result.outboxId')) {
  console.log('ALREADY');
  process.exit(0);
}
const next = c.replace(
  /processLiquidacionOutboxIntent\(\{\s*liquidacion: result\.liquidacion,\s*repartidorId: body\.repartidorId,\s*\}\)/,
  `processLiquidacionOutboxIntent({
          liquidacion: result.liquidacion,
          repartidorId: body.repartidorId,
          outboxId: result.outboxId ?? result.outboxIntent?.outboxId ?? null,
        })`,
);
if (next === c) {
  console.error('NO_MATCH');
  process.exit(2);
}
const tmp = `${p}.tmp2`;
fs.writeFileSync(tmp, next);
fs.copyFileSync(tmp, p);
fs.unlinkSync(tmp);
console.log('OK');
