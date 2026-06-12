#!/usr/bin/env node
const odbc = require('odbc');
const db2ConnectionString = require('./db2-connection');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const CONN = db2ConnectionString();

(async () => {
  const pool = await odbc.pool(CONN);
  const conn = await pool.connect();
  console.log('âœ… Conectado\n');

  // 1. Verificar que VISTA_DEUDA_BASE existe y funciona
  console.log('=== Verificando VISTA_DEUDA_BASE ===');
  try {
    const r = await conn.query('SELECT COUNT(*) AS C FROM JAVIER.VISTA_DEUDA_BASE');
    console.log(`âœ… Filas: ${r[0].C.toLocaleString()}`);
  } catch(e) {
    console.log(`âŒ Error: ${e.message.substring(0,150)}`);
  }

  // 2. Verificar que DIAEMISION/MESEMISION estÃ¡n en la vista
  console.log('\n=== Columnas de fecha en VISTA_DEUDA_BASE ===');
  const cols = await conn.query(`
    SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE
    FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'VISTA_DEUDA_BASE'
      AND (COLUMN_NAME LIKE '%DIA%' OR COLUMN_NAME LIKE '%MES%' OR COLUMN_NAME LIKE '%ANO%' OR COLUMN_NAME LIKE '%EMISION%' OR COLUMN_NAME LIKE '%DOCUMENTO%')
    ORDER BY ORDINAL_POSITION
  `);
  for (const c of cols) {
    console.log(`  ${c.COLUMN_NAME.padEnd(45)} ${c.DATA_TYPE}(${c.LENGTH}${c.NUMERIC_SCALE !== null ? ','+c.NUMERIC_SCALE : ''})`);
  }

  // 3. Buscar DIADOCUMENTO/MESDOCUMENTO en TODAS las tablas de DSEDAC
  console.log('\n=== Buscando DIADOCUMENTO/MESDOCUMENTO en DSEDAC ===');
  const docCols = await conn.query(`
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, LENGTH, COLUMN_TEXT
    FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND (COLUMN_NAME LIKE '%DIADOC%' OR COLUMN_NAME LIKE '%MESDOC%')
    ORDER BY TABLE_NAME, COLUMN_NAME
  `);
  if (docCols.length === 0) {
    console.log('  âŒ NO existen columnas DIADOCUMENTO ni MESDOCUMENTO en DSEDAC');
  } else {
    for (const c of docCols) {
      console.log(`  ${c.TABLE_NAME.padEnd(15)} â†’ ${c.COLUMN_NAME.padEnd(30)} ${c.DATA_TYPE}(${c.LENGTH}) -- ${c.COLUMN_TEXT || ''}`);
    }
  }

  // 4. Muestra de datos reales
  console.log('\n=== Muestra de VISTA_DEUDA_BASE (3 filas) ===');
  const sample = await conn.query(`
    SELECT TIPODOCUMENTO, SERIEDOCUMENTO, NUMERODOCUMENTO,
           DIAEMISION, MESEMISION, ANOEMISION,
           IMPORTEPENDIENTE, NOMBRECLIENTE, CLP_IMPORTELIMITERIESGO
    FROM JAVIER.VISTA_DEUDA_BASE
    FETCH FIRST 3 ROWS ONLY
  `);
  for (const row of sample) {
    console.log(JSON.stringify(row, null, 2));
  }

  await conn.close();
  await pool.close();
})();
