'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const odbc = require('odbc');
const pedidosService = require('../services/pedidos.service');

(async () => {
  const pwd = process.env.ODBC_PWD || process.env.ODBC_PASSWORD;
  const conn = await odbc.connect(`DSN=GMP;UID=JAVIER;PWD=${pwd};NAM=1;CCSID=1208;CMPTDM=1;CPTOUT=120;COMMTIMEOUT=180;DBQ=GMP`);
  const target = { ...pedidosService.getPedidosConfirmationTarget(), terminal: 93 };
  const out = { target: { ...target, tables: target.tables } };

  const steps = [];
  async function step(name, fn) {
    try {
      const r = await fn();
      steps.push({ name, ok: true, r });
    } catch (e) {
      steps.push({ name, ok: false, error: e.message, odbcErrors: e.odbcErrors || null });
      throw e;
    }
  }

  try {
    await step('lock_cpc', () => conn.query(`LOCK TABLE ${target.tables.cab} IN EXCLUSIVE MODE`));
    await step('max_numero', () => conn.query(
      `SELECT COALESCE(MAX(NUMEROPEDIDO),0)+1 AS N FROM DSEDAC.CPC WHERE TRIM(SUBEMPRESAPEDIDO)=? AND EJERCICIOPEDIDO=? AND TRIM(SERIEPEDIDO)=? AND TERMINALPEDIDO=?`,
      [target.subempresa, 2026, target.serie, 93],
    ));
    const nextNum = steps[steps.length - 1].r[0].N;
    out.nextNumero = nextNum;

    const header = await conn.query(`SELECT * FROM JAVIER.PEDIDOS_CAB WHERE ID=99 FETCH FIRST 1 ROW ONLY`);
    out.header = header[0];
    const lines = await conn.query(`SELECT * FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID=99`);
    out.lineCount = lines.length;

    await conn.query('BEGIN WORK');
    await step('confirm_order_export', async () => {
      return pedidosService.confirmOrder(99, 'CC', { deliveryDate: '2026-06-20', userId: 'APP' });
    });
    await conn.query('ROLLBACK');
  } catch (e) {
    out.fatal = e.message;
    if (e.odbcErrors) out.odbcErrors = e.odbcErrors;
    try { await conn.query('ROLLBACK'); } catch (_) {}
  }

  out.steps = steps;
  await conn.close();
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
