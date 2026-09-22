#!/usr/bin/env node
'use strict';
/**
 * Sync JAVIER.TEST_VDDX.PEDIDOSPENDIENTESSINCRONIZAR from DSEDAC.VDDX
 * for vendors with threshold > 0 (expand-contract prep; TEST only write).
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const odbc = require('odbc');
const db2ConnectionString = require('./db2-connection');

(async () => {
  const apply = process.argv.includes('--apply');
  const pool = await odbc.pool(db2ConnectionString());
  const conn = await pool.connect();

  const src = await conn.query(`
    SELECT TRIM(CODIGOVENDEDOR) AS VD, PEDIDOSPENDIENTESSINCRONIZAR AS T
    FROM DSEDAC.VDDX
    WHERE PEDIDOSPENDIENTESSINCRONIZAR > 0
  `);
  console.log('source vendors with T>0:', src.length);
  for (const r of src) console.log(JSON.stringify(r));

  if (!apply) {
    console.log('DRY-RUN. Re-run with --apply to UPDATE JAVIER.TEST_VDDX');
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

  const verify = await conn.query(`
    SELECT TRIM(CODIGOVENDEDOR) AS VD, PEDIDOSPENDIENTESSINCRONIZAR AS T
    FROM JAVIER.TEST_VDDX
    WHERE PEDIDOSPENDIENTESSINCRONIZAR > 0
    ORDER BY T DESC, VD
  `);
  console.log('TEST_VDDX after:', verify.length);
  for (const r of verify) console.log(JSON.stringify(r));
  console.log('done updated~', updated);

  await conn.close();
  await pool.close();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
