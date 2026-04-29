#!/usr/bin/env node
const odbc = require('odbc');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const CONN = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;CCSID=1208;';

const OMITIR = ['ID', 'MARCAACTUALIZACION'];

async function getColumns(conn, table) {
  const r = await conn.query(`
    SELECT COLUMN_NAME, COLUMN_TEXT, DATA_TYPE, LENGTH, NUMERIC_SCALE, ORDINAL_POSITION
    FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '${table}'
    ORDER BY ORDINAL_POSITION
  `);
  return r.filter(c => !OMITIR.includes(c.COLUMN_NAME));
}

(async () => {
  const pool = await odbc.pool(CONN);
  const conn = await pool.connect();
  console.log('✅ Conectado\n');

  // Verificar si hay duplicados reales en CVC
  console.log('=== Verificando duplicados en CVC ===\n');
  const dupes = await conn.query(`
    SELECT SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO, TERMINALDOCUMENTO, NUMERODOCUMENTO,
           COUNT(*) AS cnt
    FROM DSEDAC.CVC
    GROUP BY SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO, TERMINALDOCUMENTO, NUMERODOCUMENTO
    HAVING COUNT(*) > 1
    FETCH FIRST 5 ROWS ONLY
  `);
  if (dupes.length > 0) {
    console.log(`⚠️  CVC tiene ${dupes.length} claves duplicadas (mostrando 5):`);
    for (const d of dupes) {
      console.log(`  ${d.SUBEMPRESADOCUMENTO}/${d.EJERCICIODOCUMENTO}/${d.SERIEDOCUMENTO}/${d.TERMINALDOCUMENTO}/${d.NUMERODOCUMENTO}: ${d.CNT} filas`);
    }
  } else {
    console.log('✅ CVC: sin duplicados por clave primaria\n');
  }

  // Verificar si CPC produce duplicados al hacer JOIN
  console.log('=== Verificando si CPC produce duplicados ===\n');
  const cpcDupes = await conn.query(`
    SELECT SUBEMPRESAALBARAN, EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN,
           COUNT(*) AS cnt
    FROM DSEDAC.CPC
    GROUP BY SUBEMPRESAALBARAN, EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN
    HAVING COUNT(*) > 1
    FETCH FIRST 5 ROWS ONLY
  `);
  if (cpcDupes.length > 0) {
    console.log(`⚠️  CPC tiene ${cpcDupes.length} claves duplicadas:`);
    for (const d of cpcDupes) {
      console.log(`  ${d.SUBEMPRESAALBARAN}/${d.EJERCICIOALBARAN}/${d.SERIEALBARAN}/${d.TERMINALALBARAN}/${d.NUMEROALBARAN}: ${d.CNT} filas`);
    }
  } else {
    console.log('✅ CPC: sin duplicados por clave de albarán\n');
  }

  // Obtener columnas
  const [cvcCols, cpcCols, cliCols, clcCols, clpCols] = await Promise.all([
    getColumns(conn, 'CVC'),
    getColumns(conn, 'CPC'),
    getColumns(conn, 'CLI'),
    getColumns(conn, 'CLC'),
    getColumns(conn, 'CLP'),
  ]);

  // Construir SQL
  const used = new Set();
  const lines = [];

  lines.push('-- ============================================================================');
  lines.push('-- VISTA DE DEUDA BASE — JAVIER');
  lines.push('-- Ancla: DSEDAC.CVC (1 fila = 1 vencimiento/documento de deuda)');
  lines.push('-- JOINs: CPC (albarán), CLI (cliente), CLC (crédito), CLP (riesgo)');
  lines.push('-- FILTRO: IMPORTEPENDIENTE <> 0, no anulado, emision >= 01/01/2003');
  lines.push('-- FECHA_DOCUMENTO: COALESCE(CPC.fecha_albaran, CVC.fecha_emision)');
  lines.push('-- ORIGEN_FECHA: indica si la fecha viene de albarán o de emisión');
  lines.push('-- NOTA: CPC vacío para TIPODOCUMENTO IN (COB, PGC, PAG, CNP) = no son albaranes');
  lines.push('-- ============================================================================');
  lines.push('');
  lines.push('CREATE VIEW JAVIER.VISTA_DEUDA_BASE AS');
  lines.push('SELECT');

  function addCol(alias, col) {
    const name = col.COLUMN_NAME;
    if (used.has(name)) {
      lines.push(`  ${alias}.${name} AS ${alias}_${name},`);
      used.add(`${alias}_${name}`);
    } else {
      lines.push(`  ${alias}.${name},`);
      used.add(name);
    }
  }

  // 1. CVC
  for (const col of cvcCols) {
    lines.push(`  CVC.${col.COLUMN_NAME},`);
    used.add(col.COLUMN_NAME);
  }

  // 2. CPC — columnas útiles (no todas)
  const cpcUseful = cpcCols.filter(c => {
    const n = c.COLUMN_NAME;
    return n.includes('DIADOC') || n.includes('MESDOC') || n.includes('ANODOC') ||
           n.includes('HORADOC') || n.includes('CODIGOCL') || n.includes('ALBARAN') ||
           n.includes('SITUACION') || n.includes('SUBEMPRESA') || n.includes('EJERCICIO') ||
           n.includes('SERIE') || n.includes('TERMINAL') || n.includes('NUMERO') ||
           n.includes('IMPORTETOTAL') || n.includes('PEDIDO') || n.includes('BULTO');
  });
  for (const col of cpcUseful) {
    addCol('CPC', col);
  }

  // 3. Columnas calculadas (fecha unificada + origen)
  lines.push('');
  lines.push('  -- ═══ COLUMNAS CALCULADAS (fecha unificada + origen) ═══');
  lines.push(`  COALESCE(CPC.DIADOCUMENTO, CVC.DIAEMISION) AS FECHA_DOC_DIA,`);
  lines.push(`  COALESCE(CPC.MESDOCUMENTO, CVC.MESEMISION) AS FECHA_DOC_MES,`);
  lines.push(`  COALESCE(CPC.ANODOCUMENTO, CVC.ANOEMISION) AS FECHA_DOC_ANO,`);
  lines.push(`  CASE`);
  lines.push(`    WHEN CPC.DIADOCUMENTO IS NOT NULL THEN 'ALBARAN'`);
  lines.push(`    ELSE 'EMISION_CVC'`);
  lines.push(`  END AS ORIGEN_FECHA_DOC,`);
  lines.push(`  CASE`);
  lines.push(`    WHEN CPC.DIADOCUMENTO IS NOT NULL THEN 'Fecha del albarán (CPC)'`);
  lines.push(`    ELSE 'Fecha de emisión del documento de deuda (CVC). No es albarán.'`);
  lines.push(`  END AS ORIGEN_FECHA_DOC_DESC,`);
  used.add('FECHA_DOC_DIA');
  used.add('FECHA_DOC_MES');
  used.add('FECHA_DOC_ANO');
  used.add('ORIGEN_FECHA_DOC');
  used.add('ORIGEN_FECHA_DOC_DESC');

  // 4. CLI
  for (const col of cliCols) {
    addCol('CLI', col);
  }

  // 5. CLC
  for (const col of clcCols) {
    addCol('CLC', col);
  }

  // 6. CLP
  for (const col of clpCols) {
    addCol('CLP', col);
  }

  // Quitar última coma
  const lastIdx = lines.length - 1;
  lines[lastIdx] = lines[lastIdx].replace(/,$/, '');

  // FROM + JOINs
  lines.push('FROM DSEDAC.CVC CVC');
  lines.push('LEFT JOIN DSEDAC.CPC CPC');
  lines.push('  ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN');
  lines.push('  AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN');
  lines.push('  AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN');
  lines.push('  AND CVC.TERMINALDOCUMENTO = CPC.TERMINALALBARAN');
  lines.push('  AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN');
  lines.push('  AND TRIM(CPC.SUBEMPRESAALBARAN) <> \'\'');
  lines.push('  AND CPC.NUMEROALBARAN <> 0');
  lines.push('  AND CPC.NUMEROALBARAN <> 999999');
  lines.push('LEFT JOIN DSEDAC.CLI CLI');
  lines.push('  ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
  lines.push('LEFT JOIN DSEDAC.CLC CLC');
  lines.push('  ON TRIM(CLC.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
  lines.push('LEFT JOIN DSEDAC.CLP CLP');
  lines.push('  ON TRIM(CLP.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
  lines.push('WHERE CVC.IMPORTEPENDIENTE <> 0');
  lines.push('  AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> \'S\')');
  lines.push('  AND (CVC.ANOEMISION * 10000 + CVC.MESEMISION * 100 + CVC.DIAEMISION) >= 20030101;');

  const sql = lines.join('\n');
  const bytes = Buffer.byteLength(sql, 'utf8');

  // Guardar
  const mdPath = path.resolve(__dirname, '..', '..', 'VISTA_DEUDA_COMPLETA.md');
  fs.writeFileSync(mdPath, '```sql\n' + sql + '\n```\n');

  console.log(`\n✅ SQL generado:`);
  console.log(`   Columnas: ~${(sql.match(/,/g) || []).length}`);
  console.log(`   Bytes: ${bytes}`);
  console.log(`   ${bytes < 10000 ? '✅ Cabe en catálogo' : '⚠️ Supera 10000 bytes'}`);

  // Test: ejecutar y verificar
  console.log('\n🔨 Actualizando vista en DB2...');
  try { await conn.query('DROP VIEW JAVIER.VISTA_DEUDA_BASE'); } catch(_) {}
  
  try {
    await conn.query(sql);
    console.log('✅ VISTA_DEUDA_BASE actualizada');

    // Verificar FECHA_DOC_* no son NULL
    const check = await conn.query(`
      SELECT 
        COUNT(*) AS total,
        COUNT(FECHA_DOC_DIA) AS con_dia,
        COUNT(FECHA_DOC_MES) AS con_mes,
        COUNT(FECHA_DOC_ANO) AS con_ano,
        COUNT(ORIGEN_FECHA_DOC) AS con_origen
      FROM JAVIER.VISTA_DEUDA_BASE
    `);
    console.log(`\n📊 Verificación FECHA_DOC:`);
    console.log(`   Total filas: ${check[0].TOTAL}`);
    console.log(`   Con FECHA_DOC_DIA: ${check[0].CON_DIA} (${((check[0].CON_DIA/check[0].TOTAL)*100).toFixed(0)}%)`);
    console.log(`   Con FECHA_DOC_MES: ${check[0].CON_MES} (${((check[0].CON_MES/check[0].TOTAL)*100).toFixed(0)}%)`);
    console.log(`   Con FECHA_DOC_ANO: ${check[0].CON_ANO} (${((check[0].CON_ANO/check[0].TOTAL)*100).toFixed(0)}%)`);
    console.log(`   Con ORIGEN_FECHA_DOC: ${check[0].CON_ORIGEN}`);

    // Verificar distribución de ORIGEN_FECHA_DOC
    const origen = await conn.query(`
      SELECT ORIGEN_FECHA_DOC, COUNT(*) AS cnt
      FROM JAVIER.VISTA_DEUDA_BASE
      GROUP BY ORIGEN_FECHA_DOC
    `);
    console.log(`\n📋 Distribución ORIGEN_FECHA_DOC:`);
    for (const o of origen) {
      console.log(`   ${o.ORIGEN_FECHA_DOC}: ${o.CNT} filas`);
    }

    // Verificar duplicados en la vista
    const viewDupes = await conn.query(`
      SELECT CODIGOCLIENTEALBARAN, COUNT(*) AS cnt
      FROM JAVIER.VISTA_DEUDA_BASE
      GROUP BY CODIGOCLIENTEALBARAN
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
      FETCH FIRST 5 ROWS ONLY
    `);
    console.log(`\n📋 Clientes con múltiples deudas (top 5):`);
    for (const d of viewDupes) {
      console.log(`   ${d.CODIGOCLIENTEALBARAN.trim()}: ${d.CNT} documentos de deuda`);
    }
    console.log(`   (NOTA: múltiples filas por cliente = NORMAL. Es 1 fila por documento de deuda)`);

  } catch(e) {
    console.log(`❌ Error: ${e.message.substring(0,200)}`);
    if (e.odbcErrors) {
      for (const oe of e.odbcErrors) {
        console.log(`   ODBC: state=${oe.state} code=${oe.code}: ${oe.message}`);
      }
    }
  }

  await conn.close();
  await pool.close();
})();
