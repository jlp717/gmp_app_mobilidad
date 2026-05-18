const odbc = require('odbc');

(async () => {
  const pool = await odbc.pool('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;CCSID=1208');
  const conn = await pool.connect();

  try {
    // Get DSEDAC.LQD columns
    const dsedacLqd = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH, SCALE, IS_NULLABLE
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LQD'
      ORDER BY ORDINAL_POSITION
    `);

    // Get JAVIER.LQD columns
    const javierLqd = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH, SCALE, IS_NULLABLE
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'LQD'
      ORDER BY ORDINAL_POSITION
    `);

    console.log('=== LQD: DSEDAC vs JAVIER comparison ===');
    const dMap = new Map(dsedacLqd.map(c => [c.COLUMN_NAME, c]));
    const jMap = new Map(javierLqd.map(c => [c.COLUMN_NAME, c]));

    let match = true;
    for (const [name, d] of dMap) {
      const j = jMap.get(name);
      if (!j) {
        console.log(`  MISSING in JAVIER: ${name} ${d.DATA_TYPE}(${d.LENGTH},${d.SCALE})`);
        match = false;
      } else if (d.DATA_TYPE !== j.DATA_TYPE || d.LENGTH !== j.LENGTH || d.SCALE !== j.SCALE) {
        console.log(`  TYPE MISMATCH: ${name}`);
        console.log(`    DSEDAC: ${d.DATA_TYPE}(${d.LENGTH},${d.SCALE})`);
        console.log(`    JAVIER: ${j.DATA_TYPE}(${j.LENGTH},${j.SCALE})`);
        match = false;
      }
    }
    for (const [name, j] of jMap) {
      if (!dMap.has(name)) {
        console.log(`  EXTRA in JAVIER: ${name} ${j.DATA_TYPE}(${j.LENGTH},${j.SCALE})`);
        match = false;
      }
    }
    if (match) console.log('  LQD: Perfect match ✅');

    // Check DSEDAC for any table that might be the real COBROS/LIQUIDACION
    console.log('\n=== Searching DSEDAC for cobros/liquidacion equivalents ===');

    // Check CVC (deuda/vencimientos) - might be related to cobros
    const cvcCols = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH, SCALE
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CVC'
      ORDER BY ORDINAL_POSITION
    `);
    console.log(`\nDSEDAC.CVC columns (${cvcCols.length}):`);
    console.log(cvcCols.map(c => `  ${c.COLUMN_NAME} ${c.DATA_TYPE}(${c.LENGTH},${c.SCALE})`).join('\n'));

    // Check if there are any tables with COBRO, PAGO, LIQUID in DSEDAC
    const allDsedac = await conn.query(`
      SELECT TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = 'DSEDAC' ORDER BY TABLE_NAME
    `);
    const related = allDsedac.filter(t =>
      t.TABLE_NAME.includes('COB') ||
      t.TABLE_NAME.includes('PAG') ||
      t.TABLE_NAME.includes('LIQ') ||
      t.TABLE_NAME.includes('REP') ||
      t.TABLE_NAME.includes('VEN') ||
      t.TABLE_NAME.includes('ENT')
    );
    console.log(`\nDSEDAC tables potentially related to cobros/liquidacion/repartidor:`);
    console.log(related.map(t => `  ${t.TABLE_NAME}`).join('\n') || '  None found');

  } catch (e) {
    console.log('Error:', e.message);
    console.log('odbcErrors:', JSON.stringify(e.odbcErrors, null, 2));
  } finally {
    await conn.close();
    await pool.close();
  }
})();
