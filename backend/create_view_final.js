const odbc = require('odbc');
const fs = require('fs');
const CONN = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;CCSID=1208;';

(async () => {
  const pool = await odbc.pool(CONN);
  const conn = await pool.connect();
  console.log('Conectado OK');

  async function getCols(table) {
    const r = await conn.query("SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '" + table + "' AND COLUMN_NAME NOT IN ('ID','MARCAACTUALIZACION') ORDER BY ORDINAL_POSITION");
    return r.map(c => c.COLUMN_NAME);
  }

  const [cvcCols, cpcRaw, cliCols, clcCols, clpCols] = await Promise.all([
    getCols('CVC'), getCols('CPC'), getCols('CLI'), getCols('CLC'), getCols('CLP')
  ]);

  // EXACT same filter as generate-vista-deuda-final.js
  const cpcUseful = cpcRaw.filter(n => {
    return n.includes('DIADOC') || n.includes('MESDOC') || n.includes('ANODOC') ||
           n.includes('HORADOC') || n.includes('CODIGOCL') || n.includes('ALBARAN') ||
           n.includes('SITUACION') || n.includes('SUBEMPRESA') || n.includes('EJERCICIO') ||
           n.includes('SERIE') || n.includes('TERMINAL') || n.includes('NUMERO') ||
           n.includes('IMPORTETOTAL') || n.includes('PEDIDO') || n.includes('BULTO');
  });

  console.log('CVC: ' + cvcCols.length + ', CPC useful: ' + cpcUseful.length + ', CLI: ' + cliCols.length + ', CLC: ' + clcCols.length + ', CLP: ' + clpCols.length);

  const used = new Set();
  const sqlLines = [];

  sqlLines.push('CREATE OR REPLACE VIEW JAVIER.VISTA_DEUDA_BASE AS');
  sqlLines.push('SELECT');

  // CVC
  for (const col of cvcCols) {
    sqlLines.push('  CVC.' + col + ',');
    used.add(col);
  }

  // CPC - with renaming for duplicates (same as original)
  for (const col of cpcUseful) {
    const name = col;
    if (name === 'SUBEMPRESAPEDIDO' || name === 'EJERCICIOPEDIDO' || name === 'SERIEPEDIDO' || 
        name === 'TERMINALPEDIDO' || name === 'NUMEROPEDIDO' ||
        name === 'SUBEMPRESAALBARAN' || name === 'EJERCICIOALBARAN' || name === 'SERIEALBARAN' || 
        name === 'TERMINALALBARAN' || name === 'NUMEROALBARAN') {
      sqlLines.push('  CPC.' + name + ',');
    } else if (used.has(name)) {
      sqlLines.push('  CPC.' + name + ' AS ALBARAN_' + name + ',');
      used.add('ALBARAN_' + name);
    } else {
      sqlLines.push('  CPC.' + name + ' AS ALBARAN_' + name + ',');
      used.add('ALBARAN_' + name);
    }
  }

  // CLI
  for (const col of cliCols) {
    if (used.has(col)) {
      sqlLines.push('  CLI.' + col + ' AS CLI_' + col + ',');
    } else {
      sqlLines.push('  CLI.' + col + ',');
      used.add(col);
    }
  }

  // CLC
  for (const col of clcCols) {
    if (used.has(col)) {
      sqlLines.push('  CLC.' + col + ' AS CLC_' + col + ',');
    } else {
      sqlLines.push('  CLC.' + col + ',');
      used.add(col);
    }
  }

  // CLP
  for (const col of clpCols) {
    if (used.has(col)) {
      sqlLines.push('  CLP.' + col + ' AS CLP_' + col + ',');
    } else {
      sqlLines.push('  CLP.' + col + ',');
      used.add(col);
    }
  }

  // Last col = no comma
  sqlLines[sqlLines.length - 1] = sqlLines[sqlLines.length - 1].replace(/,$/, '');

  // FROM + subquery
  sqlLines.push('FROM DSEDAC.CVC CVC');
  sqlLines.push('LEFT JOIN (');
  sqlLines.push('  SELECT');
  cpcUseful.forEach((n, i) => sqlLines.push('    ' + n + ','));
  sqlLines.push('    ROW_NUMBER() OVER (');
  sqlLines.push('      PARTITION BY SUBEMPRESAALBARAN, EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN');
  sqlLines.push('      ORDER BY NUMEROPEDIDO, SUBEMPRESAPEDIDO');
  sqlLines.push('    ) AS RN');
  sqlLines.push('  FROM DSEDAC.CPC');
  sqlLines.push(') CPC');
  sqlLines.push('  ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN');
  sqlLines.push('  AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN');
  sqlLines.push('  AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN');
  sqlLines.push('  AND CVC.TERMINALDOCUMENTO = CPC.TERMINALALBARAN');
  sqlLines.push('  AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN');
  sqlLines.push('  AND CPC.RN = 1');
  sqlLines.push('LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
  sqlLines.push('LEFT JOIN DSEDAC.CLC CLC ON TRIM(CLC.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
  sqlLines.push('LEFT JOIN DSEDAC.CLP CLP ON TRIM(CLP.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
  sqlLines.push('WHERE CVC.IMPORTEPENDIENTE <> 0');
  sqlLines.push("  AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')");
  sqlLines.push('  AND (CVC.ANOEMISION * 10000 + CVC.MESEMISION * 100 + CVC.DIAEMISION) >= 20030101');

  const sql = sqlLines.join('\n');
  const totalCols = (sql.match(/,/g) || []).length;
  const bytes = Buffer.byteLength(sql, 'utf8');
  console.log('Columnas: ~' + totalCols + ' | Bytes: ' + bytes);

  // Save
  fs.writeFileSync('C:\\Users\\Javier\\Desktop\\Repositorios\\gmp_app_mobilidad\\database_backup_20260513\\VISTA_DEUDA_BASE_FINAL.sql', sql);

  // Drop old
  try { await conn.query('DROP VIEW JAVIER.VISTA_DEUDA_BASE'); } catch(e) {}

  // Create
  const stmt = await conn.createStatement();
  await stmt.prepare(sql);
  await stmt.execute();
  await stmt.close();
  console.log('VISTA_DEUDA_BASE recreada OK');

  // Verify size in catalog
  const cat = await conn.query("SELECT CHAR_LENGTH(VIEW_DEFINITION) AS LEN FROM QSYS2.SYSVIEWS WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'VISTA_DEUDA_BASE'");
  console.log('Longitud en catalogo: ' + cat[0].LEN + ' bytes');

  const r = await conn.query("SELECT COUNT(1) AS C FROM JAVIER.VISTA_DEUDA_BASE");
  console.log('Filas: ' + r[0].C);

  await conn.close();
  await pool.close();
})().catch(e => console.log('FATAL: ' + e.message));
