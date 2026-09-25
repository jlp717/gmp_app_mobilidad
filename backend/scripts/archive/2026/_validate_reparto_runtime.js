// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-validate | _-scratch gitignored; validacion puntual runtime reparto (canon vive en backend/config) | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';
const { resolveRepartoRuntime } = require('../config/reparto-runtime');
const r = resolveRepartoRuntime(process.env);
if (!r.valid) {
  process.stdout.write(`${JSON.stringify({ valid: false, errors: r.errors }, null, 2)}\n`);
  process.exit(2);
}
process.stdout.write(`${JSON.stringify({
  valid: r.valid,
  env: r.environment,
  tableSet: r.tableSet,
  conf: r.tables.confirmation.confirmations,
  cobros: r.tables.finance.cobros,
  writes: r.writesEnabled,
  confirmationCap: r.confirmationCapabilityApproved,
  financeCap: r.financeCapabilityApproved,
}, null, 2)}\n`);
