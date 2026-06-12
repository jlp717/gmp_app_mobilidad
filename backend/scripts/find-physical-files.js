#!/usr/bin/env node
const odbc = require('odbc');
const db2ConnectionString = require('./db2-connection');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const CONN = db2ConnectionString();

(async () => {
  const pool = await odbc.pool(CONN);
  const conn = await pool.connect();

  const tables = ['CLIL1', 'CLCL1', 'CLIX', 'CRUT', 'VDDL1', 'CVC'];

  console.log('=== TIPO DE ARCHIVO (PF vs LF) ===\n');

  for (const t of tables) {
    const r = await conn.query(`
      SELECT TABLE_NAME, TABLE_TYPE, TABLE_TEXT,
             BASE_TABLE_SCHEMA, BASE_TABLE_NAME
      FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '${t}'
    `);
    if (r.length > 0) {
      const row = r[0];
      const type = row.TABLE_TYPE === 'L' ? 'LOGICAL FILE' : row.TABLE_TYPE === 'T' ? 'TABLE (PF)' : row.TABLE_TYPE;
      console.log(`${t.padEnd(8)} â†’ ${type.padEnd(16)} | ${row.TABLE_TEXT || ''}`);
      if (row.TABLE_TYPE === 'L' && row.BASE_TABLE_NAME) {
        console.log(`           â””â”€ PF base: ${row.BASE_TABLE_SCHEMA}.${row.BASE_TABLE_NAME}`);
      }
    } else {
      console.log(`${t.padEnd(8)} â†’ NO ENCONTRADO`);
    }
  }

  // Buscar archivos fÃ­sicos que puedan ser la base de CLIL1
  console.log('\n=== ARCHIVOS FÃSICOS con patrÃ³n CLI ===');
  const cliPF = await conn.query(`
    SELECT TABLE_NAME, TABLE_TYPE, TABLE_TEXT
    FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND TABLE_TYPE = 'T'
      AND TABLE_NAME LIKE 'CLI%'
    ORDER BY TABLE_NAME
  `);
  for (const row of cliPF) {
    console.log(`  ${row.TABLE_NAME.padEnd(15)} â†’ ${row.TABLE_TEXT || ''}`);
  }

  // Buscar PF para VDD
  console.log('\n=== Archivos FÃSICOS con patrÃ³n VDD ===');
  const vddPF = await conn.query(`
    SELECT TABLE_NAME, TABLE_TYPE, TABLE_TEXT
    FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND TABLE_TYPE = 'T'
      AND TABLE_NAME LIKE 'VDD%'
    ORDER BY TABLE_NAME
  `);
  for (const row of vddPF) {
    console.log(`  ${row.TABLE_NAME.padEnd(15)} â†’ ${row.TABLE_TEXT || ''}`);
  }

  // Buscar PF para CLC
  console.log('\n=== Archivos FÃSICOS con patrÃ³n CLC ===');
  const clcPF = await conn.query(`
    SELECT TABLE_NAME, TABLE_TYPE, TABLE_TEXT
    FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND TABLE_TYPE = 'T'
      AND TABLE_NAME LIKE 'CLC%'
    ORDER BY TABLE_NAME
  `);
  for (const row of clcPF) {
    console.log(`  ${row.TABLE_NAME.padEnd(15)} â†’ ${row.TABLE_TEXT || ''}`);
  }

  // Buscar PF para CVC
  console.log('\n=== Archivos FÃSICOS con patrÃ³n CVC ===');
  const cvcPF = await conn.query(`
    SELECT TABLE_NAME, TABLE_TYPE, TABLE_TEXT
    FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND TABLE_TYPE = 'T'
      AND TABLE_NAME LIKE 'CVC%'
    ORDER BY TABLE_NAME
  `);
  for (const row of cvcPF) {
    console.log(`  ${row.TABLE_NAME.padEnd(15)} â†’ ${row.TABLE_TEXT || ''}`);
  }

  // Buscar PF para CRU
  console.log('\n=== Archivos FÃSICOS con patrÃ³n CRU ===');
  const cruPF = await conn.query(`
    SELECT TABLE_NAME, TABLE_TYPE, TABLE_TEXT
    FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND TABLE_TYPE = 'T'
      AND TABLE_NAME LIKE 'CRU%'
    ORDER BY TABLE_NAME
  `);
  for (const row of cruPF) {
    console.log(`  ${row.TABLE_NAME.padEnd(15)} â†’ ${row.TABLE_TEXT || ''}`);
  }

  // Buscar PF para CLX
  console.log('\n=== Archivos FÃSICOS con patrÃ³n CLX ===');
  const clxPF = await conn.query(`
    SELECT TABLE_NAME, TABLE_TYPE, TABLE_TEXT
    FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND TABLE_TYPE = 'T'
      AND TABLE_NAME LIKE 'CLX%'
    ORDER BY TABLE_NAME
  `);
  for (const row of clxPF) {
    console.log(`  ${row.TABLE_NAME.padEnd(15)} â†’ ${row.TABLE_TEXT || ''}`);
  }

  await conn.close();
  await pool.close();
})();
