'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getPool, initDb } = require('../config/db');
const variants = ['BEGIN WORK', 'BEGIN', 'START TRANSACTION', 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED'];
(async () => {
  await initDb();
  const pool = getPool();
  for (const v of variants) {
    const conn = await pool.connect();
    try {
      await conn.query(v);
      await conn.query('ROLLBACK');
      console.log(v, 'OK');
    } catch (e) {
      console.log(v, 'FAIL', e.odbcErrors?.[0]?.code, e.odbcErrors?.[0]?.state);
      try { await conn.query('ROLLBACK'); } catch (_) {}
    } finally {
      await conn.close();
    }
  }
})();
