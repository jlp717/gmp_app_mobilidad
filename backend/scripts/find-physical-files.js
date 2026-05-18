#!/usr/bin/env node
const odbc = require('odbc');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const CONN = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;CCSID=1208;';

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
      console.log(`${t.padEnd(8)} → ${type.padEnd(16)} | ${row.TABLE_TEXT || ''}`);
      if (row.TABLE_TYPE === 'L' && row.BASE_TABLE_NAME) {
        console.log(`           └─ PF base: ${row.BASE_TABLE_SCHEMA}.${row.BASE_TABLE_NAME}`);
      }
    } else {
      console.log(`${t.padEnd(8)} → NO ENCONTRADO`);
    }
  }

  // Buscar archivos físicos que puedan ser la base de CLIL1
  console.log('\n=== ARCHIVOS FÍSICOS con patrón CLI ===');
  const cliPF = await conn.query(`
    SELECT TABLE_NAME, TABLE_TYPE, TABLE_TEXT
    FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND TABLE_TYPE = 'T'
      AND TABLE_NAME LIKE 'CLI%'
    ORDER BY TABLE_NAME
  `);
  for (const row of cliPF) {
    console.log(`  ${row.TABLE_NAME.padEnd(15)} → ${row.TABLE_TEXT || ''}`);
  }

  // Buscar PF para VDD
  console.log('\n=== Archivos FÍSICOS con patrón VDD ===');
  const vddPF = await conn.query(`
    SELECT TABLE_NAME, TABLE_TYPE, TABLE_TEXT
    FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND TABLE_TYPE = 'T'
      AND TABLE_NAME LIKE 'VDD%'
    ORDER BY TABLE_NAME
  `);
  for (const row of vddPF) {
    console.log(`  ${row.TABLE_NAME.padEnd(15)} → ${row.TABLE_TEXT || ''}`);
  }

  // Buscar PF para CLC
  console.log('\n=== Archivos FÍSICOS con patrón CLC ===');
  const clcPF = await conn.query(`
    SELECT TABLE_NAME, TABLE_TYPE, TABLE_TEXT
    FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND TABLE_TYPE = 'T'
      AND TABLE_NAME LIKE 'CLC%'
    ORDER BY TABLE_NAME
  `);
  for (const row of clcPF) {
    console.log(`  ${row.TABLE_NAME.padEnd(15)} → ${row.TABLE_TEXT || ''}`);
  }

  // Buscar PF para CVC
  console.log('\n=== Archivos FÍSICOS con patrón CVC ===');
  const cvcPF = await conn.query(`
    SELECT TABLE_NAME, TABLE_TYPE, TABLE_TEXT
    FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND TABLE_TYPE = 'T'
      AND TABLE_NAME LIKE 'CVC%'
    ORDER BY TABLE_NAME
  `);
  for (const row of cvcPF) {
    console.log(`  ${row.TABLE_NAME.padEnd(15)} → ${row.TABLE_TEXT || ''}`);
  }

  // Buscar PF para CRU
  console.log('\n=== Archivos FÍSICOS con patrón CRU ===');
  const cruPF = await conn.query(`
    SELECT TABLE_NAME, TABLE_TYPE, TABLE_TEXT
    FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND TABLE_TYPE = 'T'
      AND TABLE_NAME LIKE 'CRU%'
    ORDER BY TABLE_NAME
  `);
  for (const row of cruPF) {
    console.log(`  ${row.TABLE_NAME.padEnd(15)} → ${row.TABLE_TEXT || ''}`);
  }

  // Buscar PF para CLX
  console.log('\n=== Archivos FÍSICOS con patrón CLX ===');
  const clxPF = await conn.query(`
    SELECT TABLE_NAME, TABLE_TYPE, TABLE_TEXT
    FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND TABLE_TYPE = 'T'
      AND TABLE_NAME LIKE 'CLX%'
    ORDER BY TABLE_NAME
  `);
  for (const row of clxPF) {
    console.log(`  ${row.TABLE_NAME.padEnd(15)} → ${row.TABLE_TEXT || ''}`);
  }

  await conn.close();
  await pool.close();
})();
