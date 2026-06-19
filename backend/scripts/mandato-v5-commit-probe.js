'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getPool, initDb } = require('../config/db');
(async () => {
  await initDb();
  const conn = await getPool().connect();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    const n = (await conn.query(`SELECT COALESCE(MAX(NUMEROPEDIDO),0)+1 AS N FROM DSEDAC.CPC WHERE TERMINALPEDIDO=93 AND TRIM(SERIEPEDIDO)='P'`))[0].N;
    await conn.query(`INSERT INTO DSEDAC.CPC (SUBEMPRESAPEDIDO,EJERCICIOPEDIDO,SERIEPEDIDO,TERMINALPEDIDO,NUMEROPEDIDO,DIADOCUMENTO,MESDOCUMENTO,ANODOCUMENTO,HORADOCUMENTO,CODIGOCLIENTEALBARAN,CODIGOCLIENTEFACTURA,CODIGOVENDEDOR,CODIGOFORMAPAGO,CODIGOTARIFA,CODIGOALMACEN,RECARGOSN,IMPORTETOTAL,SITUACIONPEDIDO,CODIGOOPERACION) VALUES ('GMP',2026,'P',93,?,18,6,2026,120000,'4300000354','4300000354','93','02',1,1,'N',1,'A','V')`, [n]);
    await conn.query('COMMIT');
    const chk = await conn.query(`SELECT COUNT(*) C FROM DSEDAC.CPC WHERE TERMINALPEDIDO=93 AND NUMEROPEDIDO=?`, [n]);
    console.log('committed', n, 'exists', chk[0].C);
    // cleanup test row
    await conn.query(`DELETE FROM DSEDAC.CPC WHERE TERMINALPEDIDO=93 AND NUMEROPEDIDO=? AND IMPORTETOTAL=1`, [n]);
    await conn.query('COMMIT');
    console.log('cleaned');
  } catch (e) {
    console.log('FAIL', e.message, JSON.stringify(e.odbcErrors));
    try { await conn.query('ROLLBACK'); } catch (_) {}
  } finally {
    await conn.close();
  }
})();
