#!/usr/bin/env node
/**
 * discover-vista-unificada.js
 * Descubre TODAS las columnas de las 5 tablas exactas del usuario:
 *   DSEDAC.VDDL1, DSEDAC.CLCL1, DSEDAC.CLIX, DSEDAC.CRUT, DSEDAC.CLIL1
 * 
 * También analiza:
 *   - Claves primarias (desde SYSTABLES/SYSKEYS del catálogo)
 *   - Relaciones entre tablas (columnas comunes)
 *   - Número de filas por tabla
 *   - Valores UNIQUE de las columnas clave de JOIN
 *
 * Salida: backend/scripts/results/vista-unificada-discovery.json
 */

const odbc = require('odbc');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const DB_DSN = process.env.ODBC_DSN || 'GMP';
const DB_UID = process.env.ODBC_UID || 'JAVIER';
const DB_PWD = process.env.ODBC_PWD || 'JAVIER';

const CONNECTION_STRING = [
  `DSN=${DB_DSN}`,
  `UID=${DB_UID}`,
  `PWD=${DB_PWD}`,
  'NAM=1',
  'CCSID=1208',
  'CMPTDM=1',
].join(';');

// TABLAS EXACTAS QUE PIDIÓ EL USUARIO
const TABLES = ['VDDL1', 'CLCL1', 'CLIX', 'CRUT', 'CLIL1'];

async function main() {
  let pool = null;
  let conn = null;

  try {
    pool = await odbc.pool(CONNECTION_STRING);
    conn = await pool.connect();

    // 1. Columnas por tabla (QSYS2.SYSCOLUMNS)
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  DESCUBRIMIENTO DE COLUMNAS — VISTA UNIFICADA JAVIER');
    console.log('═══════════════════════════════════════════════════════════\n');

    const results = {};

    for (const tbl of TABLES) {
      console.log(`━━━ DSEDAC.${tbl} ━━━`);

      try {
        // Verificar que la tabla existe
        const checkQuery = `
          SELECT TABLE_NAME, TABLE_SCHEMA, TABLE_TYPE, TABLE_TEXT
          FROM QSYS2.SYSTABLES
          WHERE TABLE_SCHEMA = 'DSEDAC'
            AND TABLE_NAME = '${tbl}'
        `;
        const tableInfo = await conn.query(checkQuery);
        if (tableInfo.length === 0) {
          console.log(`  ⚠️  TABLA NO ENCONTRADA en QSYS2.SYSTABLES para schema DSEDAC\n`);
          results[tbl] = { error: 'NOT_FOUND', columns: [], tableInfo: null };
          continue;
        }
        console.log(`  Tipo: ${tableInfo[0].TABLE_TYPE}, Desc: ${(tableInfo[0].TABLE_TEXT || '').trim()}`);

        // Columnas
        const colQuery = `
          SELECT 
            COLUMN_NAME,
            SYSTEM_COLUMN_NAME,
            DATA_TYPE,
            LENGTH,
            NUMERIC_SCALE,
            IS_NULLABLE,
            HAS_DEFAULT,
            COLUMN_DEFAULT,
            COLUMN_TEXT,
            ORDINAL_POSITION,
            IS_IDENTITY
          FROM QSYS2.SYSCOLUMNS
          WHERE TABLE_SCHEMA = 'DSEDAC'
            AND TABLE_NAME = '${tbl}'
          ORDER BY ORDINAL_POSITION
        `;
        const columns = await conn.query(colQuery);
        console.log(`  Columnas encontradas: ${columns.length}`);

        for (const col of columns) {
          const nullable = col.IS_NULLABLE === 'Y' ? 'NULL' : 'NOT NULL';
          const dtype = col.DATA_TYPE;
          const len = col.LENGTH || '';
          const scale = col.NUMERIC_SCALE !== null ? `,${col.NUMERIC_SCALE}` : '';
          const def = col.HAS_DEFAULT === 'Y' ? ` DEFAULT ${col.COLUMN_DEFAULT || ''}` : '';
          const text = col.COLUMN_TEXT ? ` -- ${(col.COLUMN_TEXT || '').trim()}` : '';
          console.log(`    ${String(col.ORDINAL_POSITION).padStart(3)}. ${col.COLUMN_NAME} ${dtype}(${len}${scale}) ${nullable}${def}${text}`);
        }

        // Contar filas
        let rowCount = null;
        try {
          const countResult = await conn.query(`SELECT COUNT(*) AS CNT FROM DSEDAC.${tbl}`);
          rowCount = countResult[0].CNT;
          console.log(`  Filas totales: ${rowCount.toLocaleString()}`);
        } catch (e) {
          console.log(`  Filas: ERROR - ${e.message}`);
        }

        // Claves foráneas detectables (columnas comunes con otras tablas del set)
        const colNames = columns.map(c => c.COLUMN_NAME);
        
        results[tbl] = {
          tableInfo: tableInfo[0],
          columns,
          columnNames: colNames,
          rowCount,
        };

        console.log();
      } catch (err) {
        console.error(`  ERROR: ${err.message}\n`);
        results[tbl] = { error: err.message, columns: [], tableInfo: null };
      }
    }

    // 2. Análisis de intersección de columnas (para JOINs)
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  ANÁLISIS DE RELACIONES ENTRE TABLAS');
    console.log('═══════════════════════════════════════════════════════════\n');

    const intersections = {};
    const validTables = Object.entries(results).filter(([, v]) => !v.error);
    
    for (let i = 0; i < validTables.length; i++) {
      for (let j = i + 1; j < validTables.length; j++) {
        const [nameA, dataA] = validTables[i];
        const [nameB, dataB] = validTables[j];
        const common = (dataA.columnNames || []).filter(c => (dataB.columnNames || []).includes(c));
        if (common.length > 0) {
          const key = `${nameA}↔${nameB}`;
          intersections[key] = common;
          console.log(`  ${nameA} ↔ ${nameB}: ${common.join(', ')}`);
        }
      }
    }

    // 3. Muestrear valores de las columnas de JOIN más probables
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  MUESTREO DE VALORES DE COLUMNAS CLAVE');
    console.log('═══════════════════════════════════════════════════════════\n');

    const sampleResults = {};
    const keyCols = ['CODIGOCLIENTE', 'CODIGOVENDEDOR', 'CODIGORUTA', 'SUBEMPRESA'];

    for (const tbl of TABLES) {
      if (!results[tbl] || results[tbl].error) continue;
      const colNames = results[tbl].columnNames || [];
      const relevantCols = keyCols.filter(kc => colNames.includes(kc));

      if (relevantCols.length > 0) {
        for (const kc of relevantCols) {
          try {
            const sampleQuery = `
              SELECT ${kc}, COUNT(*) AS CNT
              FROM DSEDAC.${tbl}
              GROUP BY ${kc}
              ORDER BY CNT DESC
              FETCH FIRST 5 ROWS ONLY
            `;
            const samples = await conn.query(sampleQuery);
            const key = `${tbl}.${kc}`;
            sampleResults[key] = samples;
            console.log(`  ${key} (top 5):`);
            for (const s of samples) {
              console.log(`    "${(s[kc] || '').trim()}" → ${s.CNT} filas`);
            }
          } catch (e) {
            console.log(`  ${tbl}.${kc}: ERROR - ${e.message}`);
          }
        }
      }
    }

    // Guardar resultados
    const outputPath = path.resolve(__dirname, 'results', 'vista-unificada-discovery.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify({
      results,
      intersections,
      sampleResults,
      timestamp: new Date().toISOString(),
    }, null, 2));
    console.log(`\n✅ Resultados guardados en: ${outputPath}`);

  } catch (err) {
    console.error(`\n❌ FATAL: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (conn) { try { await conn.close(); } catch (_) {} }
    if (pool) { try { await pool.close(); } catch (_) {} }
  }
}

main();
