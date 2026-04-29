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

  const [cvcCols, cpcCols, cliCols, clcCols, clpCols] = await Promise.all([
    getColumns(conn, 'CVC'),
    getColumns(conn, 'CPC'),
    getColumns(conn, 'CLI'),
    getColumns(conn, 'CLC'),
    getColumns(conn, 'CLP'),
  ]);

  console.log(`CVC:${cvcCols.length} CPC:${cpcCols.length} CLI:${cliCols.length} CLC:${clcCols.length} CLP:${clpCols.length}`);

  // ===== VISTA DEUDA COMPLETA (con CPC para DIADOCUMENTO/MESDOCUMENTO) =====
  const used = new Set();
  const lines = [];

  lines.push('-- VISTA DEUDA COMPLETA — JAVIER');
  lines.push('-- CVC + CPC + CLI + CLC + CLP | Filtro: pendiente<>0, no anulado, emision>=2003');
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

  // 2. CPC — solo columnas útiles (no todas para mantener < 10000 bytes)
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

  // 3. CLI
  for (const col of cliCols) {
    addCol('CLI', col);
  }

  // 4. CLC
  for (const col of clcCols) {
    addCol('CLC', col);
  }

  // 5. CLP
  for (const col of clpCols) {
    addCol('CLP', col);
  }

  // Quitar última coma
  const lastIdx = lines.length - 1;
  lines[lastIdx] = lines[lastIdx].replace(/,$/, '');

  // JOIN: CVC → CPC por albarán (como en producción)
  lines.push('FROM DSEDAC.CVC CVC');
  lines.push('LEFT JOIN DSEDAC.CPC CPC');
  lines.push('  ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN');
  lines.push('  AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN');
  lines.push('  AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN');
  lines.push('  AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN');
  lines.push('LEFT JOIN DSEDAC.CLI CLI');
  lines.push('  ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
  lines.push('LEFT JOIN DSEDAC.CLC CLC');
  lines.push('  ON TRIM(CLC.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
  lines.push('LEFT JOIN DSEDAC.CLP CLP');
  lines.push('  ON TRIM(CLP.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
  lines.push('WHERE CVC.IMPORTEPENDIENTE <> 0');
  lines.push('  AND CVC.ANULADOSN <> \'S\'');
  lines.push('  AND (CVC.ANOEMISION * 10000 + CVC.MESEMISION * 100 + CVC.DIAEMISION) >= 20030101;');

  const sql = lines.join('\n');
  const bytes = Buffer.byteLength(sql, 'utf8');
  const colCount = (sql.match(/,/g) || []).length;

  console.log(`\n📊 VISTA_DEUDA_COMPLETA:`);
  console.log(`   Columnas: ~${colCount}`);
  console.log(`   Bytes: ${bytes}`);
  console.log(`   ${bytes < 10000 ? '✅ Cabe en catálogo' : '⚠️ Supera 10000 bytes'}`);

  // Verificar DIADOCUMENTO/MESDOCUMENTO
  console.log(`\n📋 DIADOCUMENTO: ${sql.includes('DIADOCUMENTO') ? '✅' : '❌'}`);
  console.log(`📋 MESDOCUMENTO: ${sql.includes('MESDOCUMENTO') ? '✅' : '❌'}`);
  console.log(`📋 ANODOCUMENTO: ${sql.includes('ANODOCUMENTO') ? '✅' : '❌'}`);

  // Guardar
  const mdPath = path.resolve(__dirname, '..', '..', 'VISTA_DEUDA_COMPLETA.md');
  fs.writeFileSync(mdPath, '```sql\n' + sql + '\n```\n');
  console.log(`\n📄 Guardado: ${mdPath}`);

  await conn.close();
  await pool.close();
})();
