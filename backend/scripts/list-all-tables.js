const odbc = require('odbc');
const db2ConnectionString = require('./db2-connection');

(async () => {
  const pool = await odbc.pool(db2ConnectionString());
  const conn = await pool.connect();

  try {
    // List ALL tables in DSEDAC to understand the full landscape
    console.log('=== ALL DSEDAC tables ===');
    const allTables = await conn.query(`
      SELECT TABLE_NAME, TABLE_TYPE, LONG_COMMENT
      FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = 'DSEDAC'
      ORDER BY TABLE_NAME
    `);
    console.log(`Total: ${allTables.length} tables`);
    console.log(allTables.map(t => `  ${t.TABLE_NAME} (${t.TABLE_TYPE}) ${t.LONG_COMMENT || ''}`).join('\n'));

    // Also check JAVIER tables
    console.log('\n=== ALL JAVIER tables ===');
    const javierTables = await conn.query(`
      SELECT TABLE_NAME, TABLE_TYPE, LONG_COMMENT
      FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = 'JAVIER'
      ORDER BY TABLE_NAME
    `);
    console.log(`Total: ${javierTables.length} tables`);
    console.log(javierTables.map(t => `  ${t.TABLE_NAME} (${t.TABLE_TYPE}) ${t.LONG_COMMENT || ''}`).join('\n'));

  } catch (e) {
    console.log('Error:', e.message);
  } finally {
    await conn.close();
    await pool.close();
  }
})();
