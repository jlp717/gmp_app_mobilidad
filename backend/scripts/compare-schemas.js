const odbc = require('odbc');

(async () => {
  const pool = await odbc.pool('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;CCSID=1208');
  const conn = await pool.connect();

  try {
    // 1. List all tables in DSEDAC that might be related to repartidor/liquidacion/cobros
    console.log('=== Tables in DSEDAC matching patterns ===');
    const tables = await conn.query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, LONG_COMMENT
      FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = 'DSEDAC'
        AND (
          TABLE_NAME LIKE '%LIQ%' OR
          TABLE_NAME LIKE '%COB%' OR
          TABLE_NAME LIKE '%REP%' OR
          TABLE_NAME LIKE '%LQD%' OR
          TABLE_NAME LIKE '%DELIV%' OR
          TABLE_NAME LIKE '%COMM%' OR
          TABLE_NAME LIKE '%BALAN%' OR
          TABLE_NAME LIKE '%EMAIL%'
        )
      ORDER BY TABLE_NAME
    `);
    console.log('Matching tables:', tables.map(t => `${t.TABLE_SCHEMA}.${t.TABLE_NAME} (${t.TABLE_TYPE}) ${t.LONG_COMMENT || ''}`).join('\n'));

    // 2. Check DSEDAC.LQD structure (the source of JAVIER.LQD)
    console.log('\n=== DSEDAC.LQD columns ===');
    const lqdCols = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH, SCALE, IS_NULLABLE, DEFAULT, LONG_COMMENT
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LQD'
      ORDER BY ORDINAL_POSITION
    `);
    console.log(lqdCols.map(c => `${c.COLUMN_NAME} ${c.DATA_TYPE}(${c.LENGTH},${c.SCALE}) ${c.IS_NULLABLE}`).join('\n'));

    // 3. Check if there's a cobros/liquidacion table in DSEDAC
    console.log('\n=== DSEDAC tables with COBROS/LIQUIDACION in name ===');
    const cobrosTables = await conn.query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
      FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = 'DSEDAC'
        AND (TABLE_NAME LIKE '%COBRO%' OR TABLE_NAME LIKE '%LIQUID%' OR TABLE_NAME LIKE '%REPART%')
      ORDER BY TABLE_NAME
    `);
    console.log('Cobros/Liquidacion tables:', cobrosTables.map(t => `${t.TABLE_SCHEMA}.${t.TABLE_NAME}`).join('\n') || 'None found');

    // 4. Check specific tables that might be the real equivalents
    const candidates = ['COBROS', 'LIQUIDACION', 'REPARTIDOR', 'ENTREGAS', 'DELIVERY', 'COMISION', 'SALDOS'];
    for (const name of candidates) {
      const rows = await conn.query(`
        SELECT TABLE_NAME FROM QSYS2.SYSTABLES
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME LIKE '%${name}%'
      `);
      if (rows.length > 0) {
        console.log(`\n=== DSEDAC tables matching '%${name}%' ===`);
        console.log(rows.map(r => r.TABLE_NAME).join(', '));
      }
    }

  } catch (e) {
    console.log('Error:', e.message);
    console.log('odbcErrors:', JSON.stringify(e.odbcErrors, null, 2));
  } finally {
    await conn.close();
    await pool.close();
  }
})();
