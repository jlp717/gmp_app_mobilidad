'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const odbc = require('odbc');
const pedidosService = require('../services/pedidos.service');

(async () => {
  const pwd = process.env.ODBC_PWD || process.env.ODBC_PASSWORD;
  const conn = await odbc.connect(`DSN=GMP;UID=JAVIER;PWD=${pwd};NAM=1;CCSID=1208;CMPTDM=1;CPTOUT=120;COMMTIMEOUT=180;DBQ=GMP`);
  const sample = await conn.query(`SELECT TRIM(SERIEPEDIDO) S, TERMINALPEDIDO T, NUMEROPEDIDO N, TRIM(CODIGOTIPOPEDIDO) TIPO, TRIM(SITUACIONPEDIDO) SIT, IMPORTETOTAL
    FROM DSEDAC.CPC WHERE TERMINALPEDIDO=93 AND TRIM(SERIEPEDIDO)='P' ORDER BY NUMEROPEDIDO DESC FETCH FIRST 3 ROWS ONLY`);
  console.log('recent CPC', sample);

  const header = (await conn.query('SELECT * FROM JAVIER.PEDIDOS_CAB WHERE ID=100'))[0];
  const lines = await conn.query('SELECT * FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID=100');
  const target = { ...pedidosService.getPedidosConfirmationTarget(), terminal: 93 };
  const deliveryPlan = { date: { iso: '2026-06-20', day: 20, month: 6, year: 2026 }, allowedDays: ['martes'], validated: true };

  await conn.query('BEGIN WORK');
  try {
    await conn.query(`LOCK TABLE DSEDAC.CPC IN EXCLUSIVE MODE`);
    const rows = await conn.query(`SELECT COALESCE(MAX(NUMEROPEDIDO),0)+1 AS N FROM DSEDAC.CPC WHERE TRIM(SUBEMPRESAPEDIDO)=? AND EJERCICIOPEDIDO=? AND TRIM(SERIEPEDIDO)=? AND TERMINALPEDIDO=?`, ['GMP', 2026, 'P', 93]);
    const numero = rows[0].N;
    const systemRef = { subempresa: 'GMP', ejercicio: 2026, serie: 'P', terminal: 93, numero };
    console.log('next', systemRef);

    // replicate buildDsedacCpcInsert via confirm internals - call service method by evaluating SQL from test
    const mod = require('../services/pedidos.service');
    // Manually test minimal insert matching Acisa mandatory fields from sample row
    const ins = await conn.query(`INSERT INTO DSEDAC.CPC (
      SUBEMPRESAPEDIDO,EJERCICIOPEDIDO,SERIEPEDIDO,TERMINALPEDIDO,NUMEROPEDIDO,
      DIADOCUMENTO,MESDOCUMENTO,ANODOCUMENTO,HORADOCUMENTO,
      CODIGOCLIENTEALBARAN,CODIGOCLIENTEFACTURA,CODIGOVENDEDOR,
      CODIGOFORMAPAGO,CODIGOTARIFA,CODIGOALMACEN,RECARGOSN,
      IMPORTEBASEIMPONIBLEBRUTA1,IMPORTEBASEIMPONIBLE1,IMPORTEBRUTO,IMPORTETOTAL,IMPORTECOSTO,IMPORTEMARGEN,
      SITUACIONPEDIDO,CODIGOOPERACION,DIACREACION,MESCREACION,ANOCREACION,HORACREACION,CODIGOUSUARIO,
      DIASERVICIO,MESSERVICIO,ANOSERVICIO
    ) VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?, ?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?)`, [
      'GMP', 2026, 'P', 93, numero,
      18, 6, 2026, 120000,
      '4300000354', '4300000354', '93',
      '02', 1, 1, 'N',
      1, 1, 1, 1, 0.5, 0.5,
      'A', 'V', 18, 6, 2026, 120000, 'APP',
      20, 6, 2026,
    ]);
    console.log('minimal insert ok', ins);
    await conn.query('ROLLBACK');
  } catch (e) {
    console.log('ERR', e.message, JSON.stringify(e.odbcErrors, null, 2));
    try { await conn.query('ROLLBACK'); } catch (_) {}
  }
  await conn.close();
})().catch((e) => { console.error(e); process.exit(1); });
