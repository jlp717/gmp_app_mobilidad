// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-repair | _-scratch gitignored; reparacion puntual repo finanzas | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '../repositories/reparto-finance-db2-repository.js.fromgit');
const dest = path.join(__dirname, '../repositories/reparto-finance-db2-repository.js.repaired');
let c = fs.readFileSync(src, 'utf8');

if (!c.includes('function resolveFinanceBindings')) {
  throw new Error('fromgit source invalid');
}

c = c.replace(
  `  return Object.freeze({
    runtime,
    tables: Object.freeze({ ...runtime.tables.finance }),
    erpDataSchema: runtime.schemas.read,
    erpAppSchema: runtime.schemas.app,
    commissionConfigSchema,
  });
}`,
  `  return Object.freeze({
    runtime,
    tables: Object.freeze({ ...runtime.tables.finance }),
    deliveryStatusTable: runtime.tables?.notifications?.deliveryStatus
      || (runtime.schemas.app + '.DELIVERY_STATUS'),
    erpDataSchema: runtime.schemas.read,
    erpAppSchema: runtime.schemas.app,
    commissionConfigSchema,
  });
}`,
);

c = c.replace(
  `  const {
    tables,
    erpDataSchema,
    erpAppSchema,
    commissionConfigSchema,
  } = bindings;
  const qwp = options.queryWithParams || queryWithParams;`,
  `  const {
    tables,
    erpDataSchema,
    erpAppSchema,
    commissionConfigSchema,
    deliveryStatusTable,
  } = bindings;
  const deliveryStatus = deliveryStatusTable
    || (erpAppSchema + '.DELIVERY_STATUS');
  const qwp = options.queryWithParams || queryWithParams;`,
);

c = c.split('${erpAppSchema}.DELIVERY_STATUS').join('${deliveryStatus}');

if (c.includes('${erpAppSchema}.DELIVERY_STATUS')) {
  throw new Error('still has erpAppSchema.DELIVERY_STATUS');
}
if (!c.includes('${deliveryStatus}')) {
  throw new Error('deliveryStatus not injected');
}

fs.writeFileSync(dest, c);
console.log('WROTE', dest, 'bytes', c.length);
