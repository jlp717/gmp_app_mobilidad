// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual confirmados fechareparto | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const odbc = require('odbc');

function cs() {
  const dsn = process.env.ODBC_DSN || 'GMP';
  const uid = process.env.ODBC_UID || process.env.DB2_USER || 'JAVIER';
  const pwd = process.env.ODBC_PWD || process.env.ODBC_PASSWORD;
  return `DSN=${dsn};UID=${uid};PWD=${pwd};NAM=1;CCSID=1208;CMPTDM=1;CPTOUT=120;COMMTIMEOUT=180;DBQ=${dsn}`;
}

(async () => {
  const c = await odbc.connect(cs());
  const r = await c.query(`
    SELECT ID, TRIM(CODIGOVENDEDOR) V, TRIM(ESTADO) E, TRIM(CODIGOCLIENTE) CL,
           VARCHAR_FORMAT(FECHAREPARTO,'YYYY-MM-DD') FD
      FROM JAVIER.TEST_PEDIDOS_CAB
     WHERE TRIM(ESTADO)='CONFIRMADO' AND FECHAREPARTO IS NOT NULL
     ORDER BY FECHAREPARTO DESC
     FETCH FIRST 10 ROWS ONLY
  `);
  console.log(JSON.stringify(r, null, 2));
  await c.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
