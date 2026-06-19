'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const odbc = require('odbc');
(async () => {
  const pwd = process.env.ODBC_PWD || process.env.ODBC_PASSWORD;
  const conn = await odbc.connect(`DSN=GMP;UID=JAVIER;PWD=${pwd};NAM=1;CCSID=1208;CMPTDM=1;CPTOUT=120;COMMTIMEOUT=180;DBQ=GMP`);
  for (const step of ['begin', 'lock_only', 'begin_lock', 'begin_insert']) {
    try {
      if (step === 'begin') {
        await conn.query('BEGIN WORK');
        await conn.query('ROLLBACK');
        console.log(step, 'OK');
      } else if (step === 'lock_only') {
        await conn.query('LOCK TABLE DSEDAC.CPC IN EXCLUSIVE MODE');
        console.log(step, 'OK');
      } else if (step === 'begin_lock') {
        await conn.query('BEGIN WORK');
        await conn.query('LOCK TABLE DSEDAC.CPC IN EXCLUSIVE MODE');
        await conn.query('ROLLBACK');
        console.log(step, 'OK');
      } else if (step === 'begin_insert') {
        await conn.query('BEGIN WORK');
        const n = (await conn.query(`SELECT COALESCE(MAX(NUMEROPEDIDO),0)+1 AS N FROM DSEDAC.CPC WHERE TERMINALPEDIDO=93 AND TRIM(SERIEPEDIDO)='P'`))[0].N;
        await conn.query(`INSERT INTO DSEDAC.CPC (SUBEMPRESAPEDIDO,EJERCICIOPEDIDO,SERIEPEDIDO,TERMINALPEDIDO,NUMEROPEDIDO,DIADOCUMENTO,MESDOCUMENTO,ANODOCUMENTO,HORADOCUMENTO,CODIGOCLIENTEALBARAN,CODIGOCLIENTEFACTURA,CODIGOVENDEDOR,CODIGOFORMAPAGO,CODIGOTARIFA,CODIGOALMACEN,RECARGOSN,IMPORTETOTAL,SITUACIONPEDIDO,CODIGOOPERACION) VALUES ('GMP',2026,'P',93,?,18,6,2026,120000,'4300000354','4300000354','93','02',1,1,'N',1,'A','V')`, [n]);
        await conn.query('ROLLBACK');
        console.log(step, 'OK', 'num', n);
      }
    } catch (e) {
      console.log(step, 'FAIL', e.message, JSON.stringify(e.odbcErrors));
      try { await conn.query('ROLLBACK'); } catch (_) {}
    }
  }
  await conn.close();
})();
