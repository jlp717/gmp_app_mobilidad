'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const odbc = require('odbc');

(async () => {
  const pwd = process.env.ODBC_PWD || process.env.ODBC_PASSWORD;
  const conn = await odbc.connect(`DSN=GMP;UID=JAVIER;PWD=${pwd};NAM=1;CCSID=1208;CMPTDM=1;CPTOUT=120;COMMTIMEOUT=180;DBQ=GMP`);
  const out = {};

  const cob = await conn.query(`
    SELECT COALESCE(SUM(CVC.IMPORTEPENDIENTE),0) GT, COUNT(DISTINCT TRIM(CVC.CODIGOCLIENTEALBARAN)) CLIENTS
    FROM DSEDAC.CVC CVC
    WHERE CVC.IMPORTEPENDIENTE<>0 AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN<>'S')
      AND EXISTS (SELECT 1 FROM DSEDAC.CLP CLP WHERE TRIM(CLP.CODIGOCLIENTE)=TRIM(CVC.CODIGOCLIENTEALBARAN) AND TRIM(CLP.VENDEDORCOMERCIAL)='93')
  `);
  out.cobros93 = { apiGrandTotal: 80313.08, db2: Number(cob[0].GT), clients: cob[0].CLIENTS, delta: Math.abs(80313.08 - Number(cob[0].GT)) };

  const bolsa = await conn.query(`SELECT SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO FROM JAVIER.BOLSA_COMERCIAL WHERE TRIM(CODIGOVENDEDOR)='93' AND EJERCICIO=2026 AND MES=6 FETCH FIRST 1 ROW ONLY`);
  out.bolsa93 = bolsa[0];

  for (const id of [88, 105, 108]) {
    const p = await conn.query(`SELECT ID,ESTADO,SYNC_STATUS,SYSTEM_NUMEROPEDIDO,TERMINAL,NUMEROPEDIDO,SERIEPEDIDO FROM JAVIER.PEDIDOS_CAB WHERE ID=?`, [id]);
    if (!p[0]) continue;
    const row = p[0];
    let cpc = null;
    if (row.SYNC_STATUS === 'SYNCED' && row.SYSTEM_NUMEROPEDIDO > 0) {
      const c = await conn.query(`SELECT TRIM(SERIEPEDIDO)||'-'||DIGITS(TERMINALPEDIDO)||'-'||DIGITS(NUMEROPEDIDO) FMT, IMPORTETOTAL, TRIM(SITUACIONPEDIDO) SIT FROM DSEDAC.CPC WHERE TERMINALPEDIDO=? AND NUMEROPEDIDO=?`, [row.TERMINAL, row.SYSTEM_NUMEROPEDIDO]);
      cpc = c[0];
    }
    out[`pedido${id}`] = { local: row, dsedacCpc: cpc, formatted: row.SYNC_STATUS === 'SYNCED' ? `P-${String(row.TERMINAL).padStart(3,'0')}-${String(row.SYSTEM_NUMEROPEDIDO).padStart(6,'0')}` : `P-${String(row.TERMINAL).padStart(3,'0')}-${String(row.NUMEROPEDIDO).padStart(6,'0')}` };
  }

  const erpRecent = await conn.query(`SELECT TRIM(SERIEPEDIDO)||'-'||DIGITS(TERMINALPEDIDO)||'-'||DIGITS(NUMEROPEDIDO) FMT, IMPORTETOTAL, TRIM(CODIGOCLIENTEALBARAN) CLI FROM DSEDAC.CPC WHERE TERMINALPEDIDO=93 ORDER BY NUMEROPEDIDO DESC FETCH FIRST 5 ROWS ONLY`);
  out.erpRecent093 = erpRecent;

  await conn.close();
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
