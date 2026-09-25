// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual fix emails | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { initDb, closePool, query } = require('../config/db');

function mask(email) {
  const e = String(email || '').trim();
  if (!e.includes('@')) return { set: false };
  const [local, domain] = e.split('@');
  return {
    set: true,
    domain,
    localLen: local.length,
    preview: `${local.slice(0, 2)}***@${domain}`,
  };
}

async function main() {
  await initDb();
  try {
    const targets = await query(`
      SELECT TRIM(V.CODIGOVENDEDOR) AS C,
             TRIM(V.NOMBREVENDEDOR) AS N,
             TRIM(X.CORREOELECTRONICO) AS EMAIL_X,
             TRIM(D.CORREOELECTRONICO) AS EMAIL_DIM,
             TRIM(X.PERMITEREPARTOSN) AS REPARTO,
             TRIM(X.JEFEVENTASSN) AS JEFE
      FROM DSEDAC.VDD V
      LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
      LEFT JOIN JAVIER.V_DIM_VENDEDOR D ON TRIM(V.CODIGOVENDEDOR) = TRIM(D.CODIGOVENDEDOR)
      WHERE UPPER(V.NOMBREVENDEDOR) LIKE '%LACAL%'
         OR UPPER(V.NOMBREVENDEDOR) LIKE '%CORBAL%'
         OR UPPER(V.NOMBREVENDEDOR) LIKE '%CORVAL%'
         OR UPPER(V.NOMBREVENDEDOR) LIKE '%CARLOS C%'
         OR TRIM(V.CODIGOVENDEDOR) IN ('A2','30','32','98','99')
      ORDER BY V.CODIGOVENDEDOR
    `);
    console.log('TARGETS', JSON.stringify(targets.map((r) => ({
      c: r.C,
      n: r.N,
      vddx: mask(r.EMAIL_X),
      dim: mask(r.EMAIL_DIM),
      reparto: r.REPARTO,
      jefe: r.JEFE,
    })), null, 2));

    // Broader Carlos search
    const carlos = await query(`
      SELECT TRIM(CODIGOVENDEDOR) C, TRIM(NOMBREVENDEDOR) N
      FROM DSEDAC.VDD
      WHERE UPPER(NOMBREVENDEDOR) LIKE '%CARLOS%'
         OR UPPER(NOMBREVENDEDOR) LIKE '%CORB%'
      ORDER BY CODIGOVENDEDOR
    `);
    console.log('CARLOS_ALL', JSON.stringify(carlos, null, 2));

    // Roles table current
    const roles = await query(`
      SELECT ROLE_KEY, VENDOR_CODE, NAME_MATCH, ACTIVE, NOTES
      FROM JAVIER.NOTIFICATION_ROLE_TARGETS
      ORDER BY ROLE_KEY
    `);
    console.log('ROLES', JSON.stringify(roles, null, 2));

    // Sample comerciales with email SET count
    const stats = await query(`
      SELECT
        COUNT(*) AS TOTAL,
        SUM(CASE WHEN NULLIF(TRIM(X.CORREOELECTRONICO),'') IS NOT NULL THEN 1 ELSE 0 END) AS CON_EMAIL,
        SUM(CASE WHEN TRIM(X.PERMITEREPARTOSN)='S' THEN 1 ELSE 0 END) AS REPARTIDORES,
        SUM(CASE WHEN TRIM(X.PERMITEREPARTOSN)='S'
                  AND NULLIF(TRIM(X.CORREOELECTRONICO),'') IS NOT NULL THEN 1 ELSE 0 END) AS REP_CON_EMAIL
      FROM DSEDAC.VDD V
      LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
    `);
    console.log('STATS', JSON.stringify(stats));

    // How LAC links document -> comercial (date column discovery)
    const lacDate = await query(`
      SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME='LAC'
        AND UPPER(COLUMN_NAME) LIKE '%FECHA%'
      ORDER BY COLUMN_NAME
    `);
    console.log('LAC_FECHA', lacDate.map((r) => r.COLUMN_NAME).join(','));
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
