'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getPool, initDb } = require('../config/db');
(async () => {
  await initDb();
  const pool = getPool();
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN WORK');
    await conn.query('LOCK TABLE DSEDAC.CPC IN EXCLUSIVE MODE');
    const n = (await conn.query(`SELECT COALESCE(MAX(NUMEROPEDIDO),0)+1 AS N FROM DSEDAC.CPC WHERE TERMINALPEDIDO=93 AND TRIM(SERIEPEDIDO)='P'`))[0].N;
    console.log('pool begin+lock OK, next', n);
    await conn.query('ROLLBACK');
  } catch (e) {
    console.log('FAIL', e.message, JSON.stringify(e.odbcErrors));
    try { await conn.query('ROLLBACK'); } catch (_) {}
  } finally {
    await conn.close();
  }
})();
