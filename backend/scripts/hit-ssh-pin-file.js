'use strict';

const fs = require('fs');
const { initDb, queryWithParams, closePool } = require('/opt/gmp-api/backend/config/db');

const VENDOR = String(process.env.HIT_COMERCIAL_VENDOR || '80').trim();

(async () => {
  await initDb();
  try {
    const rows = await queryWithParams(
      `SELECT TRIM(CODIGOPIN) AS PIN
         FROM DSEDAC.VDPL1
        WHERE TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))
        FETCH FIRST 1 ROW ONLY`,
      [VENDOR],
    );
    const pin = String(rows?.[0]?.PIN || '').trim();
    fs.writeFileSync('/tmp/.gmp-ui-pin', pin, { mode: 0o600 });
    process.stdout.write(`pin_chars=${pin.length}\n`);
  } finally {
    await closePool();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
