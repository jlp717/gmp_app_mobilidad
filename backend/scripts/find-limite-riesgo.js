#!/usr/bin/env node
const odbc = require('odbc');
const db2ConnectionString = require('./db2-connection');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const CONN = db2ConnectionString();

(async () => {
  const pool = await odbc.pool(CONN);
  const conn = await pool.connect();

  // Buscar en todas las tablas de DSEDAC con "RIESGO" en el nombre de columna
  console.log('=== Buscando columnas con "RIESGO" en DSEDAC ===\n');
  const riesgoCols = await conn.query(`
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, COLUMN_TEXT
    FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND (COLUMN_NAME LIKE '%RIESGO%' OR COLUMN_TEXT LIKE '%riesgo%')
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);
  for (const r of riesgoCols) {
    const text = (r.COLUMN_TEXT || '').trim();
    console.log(`  ${r.TABLE_NAME.padEnd(15)} â†’ ${r.COLUMN_NAME.padEnd(35)} ${r.DATA_TYPE}(${r.LENGTH}${r.NUMERIC_SCALE !== null ? ',' + r.NUMERIC_SCALE : ''})  -- ${text}`);
  }

  // TambiÃ©n buscar con "LIMIT"
  console.log('\n=== Buscando columnas con "LIMIT" en DSEDAC ===\n');
  const limitCols = await conn.query(`
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, COLUMN_TEXT
    FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND (COLUMN_NAME LIKE '%LIMIT%' OR COLUMN_TEXT LIKE '%limite%' OR COLUMN_TEXT LIKE '%lÃ­mite%')
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);
  for (const r of limitCols) {
    const text = (r.COLUMN_TEXT || '').trim();
    console.log(`  ${r.TABLE_NAME.padEnd(15)} â†’ ${r.COLUMN_NAME.padEnd(35)} ${r.DATA_TYPE}(${r.LENGTH}${r.NUMERIC_SCALE !== null ? ',' + r.NUMERIC_SCALE : ''})  -- ${text}`);
  }

  // Buscar tabla CLP (client limit/risk)
  console.log('\n=== Tabla CLP (si existe) ===\n');
  const clpCheck = await conn.query(`
    SELECT TABLE_NAME, TABLE_TYPE, TABLE_TEXT
    FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CLP'
  `);
  if (clpCheck.length > 0) {
    console.log(`  CLP â†’ ${clpCheck[0].TABLE_TEXT || ''} (${clpCheck[0].TABLE_TYPE})`);
    const clpCols = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, COLUMN_TEXT
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CLP'
      ORDER BY ORDINAL_POSITION
    `);
    for (const c of clpCols) {
      const text = (c.COLUMN_TEXT || '').trim();
      console.log(`    ${c.COLUMN_NAME.padEnd(35)} ${c.DATA_TYPE}(${c.LENGTH}${c.NUMERIC_SCALE !== null ? ',' + c.NUMERIC_SCALE : ''})  -- ${text}`);
    }
  } else {
    console.log('  CLP no encontrada');
  }

  await conn.close();
  await pool.close();
})();
