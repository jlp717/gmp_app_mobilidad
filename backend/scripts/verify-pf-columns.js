#!/usr/bin/env node
const odbc = require('odbc');
const db2ConnectionString = require('./db2-connection');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const CONN = db2ConnectionString();

(async () => {
  const pool = await odbc.pool(CONN);
  const conn = await pool.connect();

  const pairs = [
    { lf: 'CLIL1', pf: 'CLI' },
    { lf: 'CLCL1', pf: 'CLC' },
    { lf: 'VDDL1', pf: 'VDD' },
  ];

  for (const { lf, pf } of pairs) {
    const lfCols = await conn.query(`
      SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '${lf}'
      ORDER BY ORDINAL_POSITION
    `);
    const pfCols = await conn.query(`
      SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '${pf}'
      ORDER BY ORDINAL_POSITION
    `);

    const lfNames = lfCols.map(r => r.COLUMN_NAME);
    const pfNames = pfCols.map(r => r.COLUMN_NAME);
    const onlyInLF = lfNames.filter(c => !pfNames.includes(c));
    const onlyInPF = pfNames.filter(c => !lfNames.includes(c));

    console.log(`${lf} (${lfNames.length} cols) â†’ ${pf} (${pfNames.length} cols)`);
    if (onlyInLF.length) console.log(`  Solo en LF: ${onlyInLF.join(', ')}`);
    if (onlyInPF.length) console.log(`  Solo en PF: ${onlyInPF.join(', ')}`);
    if (!onlyInLF.length && !onlyInPF.length) console.log(`  âœ… Columnas idÃ©nticas`);

    // Verificar que el PF funciona en vista
    console.log(`  Probando CREATE VIEW con ${pf}...`);
    try {
      await conn.query('DROP VIEW JAVIER.TEST_PF');
    } catch(_) {}
    try {
      await conn.query(`CREATE VIEW JAVIER.TEST_PF AS SELECT ${pfNames[0]} FROM DSEDAC.${pf}`);
      console.log(`  âœ… ${pf} funciona en CREATE VIEW`);
      await conn.query('DROP VIEW JAVIER.TEST_PF');
    } catch(e) {
      console.log(`  âŒ ${pf}: ${e.message.substring(0,100)}`);
    }
    console.log();
  }

  await conn.close();
  await pool.close();
})();
