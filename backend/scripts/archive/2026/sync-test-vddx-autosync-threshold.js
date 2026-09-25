// ARCHIVE one-off [2026/anio-gitlog]: header-no-leido;sync-threshold | sync puntual umbral autosync VDDX test | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
#!/usr/bin/env node
'use strict';
/**
 * Sync JAVIER.TEST_VDDX.PEDIDOSPENDIENTESSINCRONIZAR from DSEDAC.VDDX
 * (expand-contract prep; TEST only write).
 *
 * Semantics (product):
 *   PEDIDOSPENDIENTESSINCRONIZAR = 0 / NULL / missing → auto-envío OFF
 *   > 0 → confirm automático al alcanzar ese número de borradores pendientes
 *
 * Flags:
 *   --apply                 write to JAVIER.TEST_VDDX
 *   --default-zero <n>      set TEST vendors still at 0 to <n> (demo default: 3)
 *                           Does NOT touch DSEDAC.VDDX (prod frontier).
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const odbc = require('odbc');
const db2ConnectionString = require('./db2-connection');

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return null;
  const raw = process.argv[idx + 1];
  if (!raw || raw.startsWith('--')) return null;
  return raw;
}

(async () => {
  const apply = process.argv.includes('--apply');
  const defaultZeroRaw = argValue('--default-zero');
  const defaultZero = defaultZeroRaw == null
    ? null
    : Math.max(0, parseInt(defaultZeroRaw, 10) || 0);

  const pool = await odbc.pool(db2ConnectionString());
  const conn = await pool.connect();

  const src = await conn.query(`
    SELECT TRIM(CODIGOVENDEDOR) AS VD, PEDIDOSPENDIENTESSINCRONIZAR AS T
    FROM DSEDAC.VDDX
    WHERE PEDIDOSPENDIENTESSINCRONIZAR > 0
  `);
  console.log(JSON.stringify({
    policy: 'TH=0 means auto-envio OFF (no silent default in app code)',
    sourceVendorsWithTgt0: src.length,
    defaultZeroForTest: defaultZero,
    apply,
  }));
  for (const r of src) console.log(JSON.stringify(r));

  if (!apply) {
    const zeros = await conn.query(`
      SELECT COUNT(*) AS ZERO_TH
        FROM JAVIER.TEST_VDDX
       WHERE COALESCE(PEDIDOSPENDIENTESSINCRONIZAR, 0) = 0
    `);
    console.log(JSON.stringify({
      dryRun: true,
      testZeroCount: zeros?.[0]?.ZERO_TH,
      hint: 'Re-run with --apply [--default-zero 3] to UPDATE JAVIER.TEST_VDDX only',
    }));
    await conn.close();
    await pool.close();
    return;
  }

  let updated = 0;
  for (const r of src) {
    const result = await conn.query(
      `UPDATE JAVIER.TEST_VDDX
          SET PEDIDOSPENDIENTESSINCRONIZAR = ?
        WHERE TRIM(CODIGOVENDEDOR) = ?`,
      [r.T, r.VD],
    );
    const count = typeof result?.count === 'number' ? result.count : 1;
    updated += count;
    console.log('updated', r.VD, '→', r.T, 'rows~', count);
  }

  let defaulted = 0;
  if (defaultZero && defaultZero > 0) {
    const result = await conn.query(
      `UPDATE JAVIER.TEST_VDDX
          SET PEDIDOSPENDIENTESSINCRONIZAR = ?
        WHERE COALESCE(PEDIDOSPENDIENTESSINCRONIZAR, 0) = 0`,
      [defaultZero],
    );
    defaulted = typeof result?.count === 'number' ? result.count : 0;
    console.log(JSON.stringify({ defaultZeroApplied: defaultZero, rows: defaulted }));
  }

  const verify = await conn.query(`
    SELECT
      SUM(CASE WHEN COALESCE(PEDIDOSPENDIENTESSINCRONIZAR,0) > 0 THEN 1 ELSE 0 END) AS WITH_TH,
      SUM(CASE WHEN COALESCE(PEDIDOSPENDIENTESSINCRONIZAR,0) = 0 THEN 1 ELSE 0 END) AS ZERO_TH,
      COUNT(*) AS TOTAL
    FROM JAVIER.TEST_VDDX
  `);
  console.log(JSON.stringify({
    done: true,
    syncedFromProd: updated,
    defaultedZeros: defaulted,
    testCounts: verify?.[0] || null,
  }));

  await conn.close();
  await pool.close();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
