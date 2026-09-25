// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-check | _-scratch gitignored; check puntual tablas test | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

const odbc = require('odbc');

async function main() {
  const cs = `DSN=${process.env.ODBC_DSN};UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD}`;
  const conn = await odbc.connect({ connectionString: cs });
  try {
    const wanted = [
      'TEST_REPARTO_CONFIRMACIONES',
      'TEST_REPARTO_LINEAS',
      'TEST_REPARTO_EVIDENCIAS',
      'TEST_REPARTO_CONFIRM_EVIDENCIAS',
      'TEST_REPARTIDOR_COBROS',
      'TEST_REPARTIDOR_COBROS_AUDIT',
      'TEST_REPARTIDOR_COMMISSION_TIERS',
      'TEST_REPARTIDOR_FINANCIAL_BALANCES',
      'TEST_REPARTIDOR_LIQUIDACION_EMAILS',
      'TEST_REPARTIDOR_LIQUIDACION_OPS',
      'TEST_REPARTIDOR_LIQUIDACION_GASTOS',
      'TEST_REPARTIDOR_LIQUIDACION_AJUSTES',
      'TEST_REPARTIDOR_LIQUIDACION_INGRESOS',
      'TEST_REPARTIDOR_LIQUIDACION_OUTBOX',
      'TEST_REPARTIDOR_LIQUIDACION_SEQ',
      'TEST_COBROS',
    ];
    const rows = await conn.query(
      "SELECT TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME LIKE 'TEST_%' ORDER BY 1",
    );
    const found = new Set(rows.map((r) => String(r.TABLE_NAME || r.table_name || '').toUpperCase()));
    const missing = wanted.filter((t) => !found.has(t));
    const extra = [...found].filter((t) => t.startsWith('TEST_REPART') || t.startsWith('TEST_REPARTO') || t === 'TEST_COBROS');
    console.log(JSON.stringify({ foundCount: found.size, wantedMissing: missing, relevantFound: extra.sort() }, null, 2));

    // Probe liquidacion catalog via repository bootstrap if present
    try {
      const { resolveRepartoRuntime } = require('../config/reparto-runtime');
      const runtime = resolveRepartoRuntime(process.env);
      console.log(JSON.stringify({
        runtime: {
          valid: runtime.valid,
          env: runtime.environment,
          tableSet: runtime.tableSet,
          writes: runtime.writesEnabled,
          financeCap: runtime.financeCapabilityApproved,
        },
      }));
    } catch (err) {
      console.log(JSON.stringify({ runtimeError: String(err.message || err) }));
    }
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  console.error(String(err && err.stack || err));
  process.exit(1);
});
