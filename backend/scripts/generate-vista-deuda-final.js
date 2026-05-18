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

  // Verificar duplicados en CPC
  console.log('=== Verificando duplicados en CPC ===\n');
  const cpcDupes = await conn.query(`
    SELECT COUNT(*) AS total_keys,
           SUM(CASE WHEN cnt > 1 THEN 1 ELSE 0 END) AS dup_keys
    FROM (
      SELECT SUBEMPRESAALBARAN, EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN, COUNT(*) AS cnt
      FROM DSEDAC.CPC
      GROUP BY SUBEMPRESAALBARAN, EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN
    ) X
  `);
  console.log(`Total CPC albaran keys: ${cpcDupes[0].TOTAL_KEYS}`);
  console.log(`Duplicated keys: ${cpcDupes[0].DUP_KEYS}`);

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
  lines.push('-- JOINs: CPC (albaran/pedido), CLI (cliente), CLC (credito), CLP (riesgo)');
  lines.push('-- FILTRO: IMPORTEPENDIENTE <> 0, no anulado, emision >= 01/01/2003');
  lines.push('--');
  lines.push('-- NOTA IMPORTANTE SOBRE CPC:');
  lines.push('--   CPC contiene datos de ALBARANES y PEDIDOS. Solo los documentos de CVC');
  lines.push('--   que son albaranes (CAC, DEV, PGP, etc.) tendran datos en CPC.');
  lines.push('--   Los documentos de tipo COB, PGC, PAG son cobros/pagos; NO son albaranes');
  lines.push('--   y por tanto NO tienen fila correspondiente en CPC. Esto es CORRECTO.');
  lines.push('--   Las columnas CPC.DIADOCUMENTO/MESDOCUMENTO/ANODOCUMENTO seran NULL');
  lines.push('--   para estos tipos de documento. Usar CVC.DIAEMISION/MESEMISION/ANOEMISION');
  lines.push('--   para la fecha de emision del documento de deuda (siempre disponible).');
  lines.push('--');
  lines.push('-- DEDUPLICACION CPC:');
  lines.push('--   CPC tiene claves de albaran duplicadas. Se usa ROW_NUMBER()');
  lines.push('--   para garantizar 1 fila de CPC por clave de albaran y evitar duplicados');
  lines.push('--   en la vista.');
  lines.push('-- ============================================================================');
  lines.push('');
  lines.push('CREATE VIEW JAVIER.VISTA_DEUDA_BASE AS');

  // CTE para deduplicar CPC
  const cpcUseful = cpcCols.filter(c => {
    const n = c.COLUMN_NAME;
    return n.includes('DIADOC') || n.includes('MESDOC') || n.includes('ANODOC') ||
           n.includes('HORADOC') || n.includes('CODIGOCL') || n.includes('ALBARAN') ||
           n.includes('SITUACION') || n.includes('SUBEMPRESA') || n.includes('EJERCICIO') ||
           n.includes('SERIE') || n.includes('TERMINAL') || n.includes('NUMERO') ||
           n.includes('IMPORTETOTAL') || n.includes('PEDIDO') || n.includes('BULTO');
  });

  lines.push('WITH CPC_UNICO AS (');
  lines.push('  SELECT');
  for (const col of cpcUseful) {
    lines.push(`    ${col.COLUMN_NAME},`);
  }
  lines.push('    ROW_NUMBER() OVER (');
  lines.push('      PARTITION BY SUBEMPRESAALBARAN, EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN');
  lines.push('      ORDER BY NUMEROPEDIDO, SUBEMPRESAPEDIDO');
  lines.push('    ) AS RN');
  lines.push('  FROM DSEDAC.CPC');
  lines.push(')');
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

  // 2. CPC - renombrar con prefijo ALBARAN_ para claridad
  for (const col of cpcUseful) {
    const name = col.COLUMN_NAME;
    if (name === 'SUBEMPRESAPEDIDO' || name === 'EJERCICIOPEDIDO' || name === 'SERIEPEDIDO' || name === 'TERMINALPEDIDO' || name === 'NUMEROPEDIDO' ||
        name === 'SUBEMPRESAALBARAN' || name === 'EJERCICIOALBARAN' || name === 'SERIEALBARAN' || name === 'TERMINALALBARAN' || name === 'NUMEROALBARAN') {
      // Claves de join, mantener nombre original para claridad del JOIN
      lines.push(`  CPC.${name},`);
    } else if (used.has(name)) {
      lines.push(`  CPC.${name} AS ALBARAN_${name},`);
      used.add(`ALBARAN_${name}`);
    } else {
      lines.push(`  CPC.${name} AS ALBARAN_${name},`);
      used.add(`ALBARAN_${name}`);
    }
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

  // Quitar ultima coma
  const lastIdx = lines.length - 1;
  lines[lastIdx] = lines[lastIdx].replace(/,$/, '');

  // FROM + JOINs
  lines.push('FROM DSEDAC.CVC CVC');
  lines.push('LEFT JOIN CPC_UNICO CPC');
  lines.push('  ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN');
  lines.push('  AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN');
  lines.push('  AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN');
  lines.push('  AND CVC.TERMINALDOCUMENTO = CPC.TERMINALALBARAN');
  lines.push('  AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN');
  lines.push('  AND CPC.RN = 1');
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
  const sqlNoComments = sql.replace(/--.*$/gm, '').replace(/\n\s*\n/g, '\n').trim();
  const bytesNoComments = Buffer.byteLength(sqlNoComments, 'utf8');

  // Guardar
  const mdPath = path.resolve(__dirname, '..', '..', 'VISTA_DEUDA_COMPLETA.md');
  fs.writeFileSync(mdPath, '```sql\n' + sql + '\n```\n');

  console.log(`\n✅ SQL generado:`);
  console.log(`   Columnas: ~${(sql.match(/,/g) || []).length}`);
  console.log(`   Bytes (con comentarios): ${bytes}`);
  console.log(`   Bytes (sin comentarios): ${bytesNoComments}`);
  console.log(`   ${bytesNoComments < 10000 ? '✅ Cabe en catalogo' : '⚠️ Supera 10000 bytes'}`);

  await conn.close();
  await pool.close();
})();
