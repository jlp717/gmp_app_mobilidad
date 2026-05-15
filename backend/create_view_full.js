const odbc = require('odbc');
const fs = require('fs');
const path = require('path');
const CONN = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;CCSID=1208;';

(async () => {
  const pool = await odbc.pool(CONN);
  const conn = await pool.connect();
  console.log('Conectado OK');

  // Get column lists
  async function getCols(table) {
    const r = await conn.query("SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '" + table + "' AND COLUMN_NAME NOT IN ('ID','MARCAACTUALIZACION') ORDER BY ORDINAL_POSITION");
    return r.map(c => c.COLUMN_NAME);
  }

  const [cvcCols, cpcCols, cliCols, clcCols, clpCols] = await Promise.all([
    getCols('CVC'), getCols('CPC'), getCols('CLI'), getCols('CLC'), getCols('CLP')
  ]);

  console.log('CVC: ' + cvcCols.length + ' cols, CPC: ' + cpcCols.length + ', CLI: ' + cliCols.length + ', CLC: ' + clcCols.length + ', CLP: ' + clpCols.length);

  // CPC columns that are useful
  const cpcUseful = cpcCols.filter(n => 
    n.includes('PEDIDO') || n.includes('ALBARAN') || n.includes('DOCUMENTO') || 
    n.includes('CLIENTE') || n.includes('VENDEDOR') || n.includes('IMPORTE') ||
    n === 'SITUACIONALBARAN' || n === 'SITUACIONCARGA' || n === 'CODIGOFORMAPAGO' ||
    n === 'CODIGORUTA' || n === 'CODIGOTARIFA' || n === 'CODIGOALMACEN' ||
    n === 'EMPRESACONTABLE' || n === 'NUMEROBULTOS' || n === 'MATRICULA' ||
    n === 'CODIGODELEGACION' || n === 'OBSERVACION1' || n === 'OBSERVACION2' ||
    n === 'RECARGOSN' || n === 'EFECTIVOTALON' || n === 'LATITUD' || n === 'LONGITUD'
  );

  const used = new Set();
  const sqlLines = [];

  sqlLines.push('CREATE OR REPLACE VIEW JAVIER.VISTA_DEUDA_BASE AS');
  sqlLines.push('SELECT');

  // CVC columns
  for (const col of cvcCols) {
    sqlLines.push('  CVC.' + col + ',');
    used.add(col);
  }

  // CPC columns
  for (const col of cpcUseful) {
    if (used.has(col)) {
      sqlLines.push('  CPC.' + col + ' AS CPC_' + col + ',');
    } else {
      sqlLines.push('  CPC.' + col + ',');
      used.add(col);
    }
  }

  // CLI columns
  for (const col of cliCols) {
    if (used.has(col)) {
      sqlLines.push('  CLI.' + col + ' AS CLI_' + col + ',');
    } else {
      sqlLines.push('  CLI.' + col + ',');
      used.add(col);
    }
  }

  // CLC columns
  for (const col of clcCols) {
    if (used.has(col)) {
      sqlLines.push('  CLC.' + col + ' AS CLC_' + col + ',');
    } else {
      sqlLines.push('  CLC.' + col + ',');
      used.add(col);
    }
  }

  // CLP columns
  for (const col of clpCols) {
    if (used.has(col)) {
      sqlLines.push('  CLP.' + col + ' AS CLP_' + col + ',');
    } else {
      sqlLines.push('  CLP.' + col + ',');
      used.add(col);
    }
  }

  // Remove last comma
  sqlLines[sqlLines.length - 1] = sqlLines[sqlLines.length - 1].replace(/,$/, '');

  // FROM with subquery instead of CTE
  sqlLines.push('FROM DSEDAC.CVC CVC');
  sqlLines.push('LEFT JOIN (');
  sqlLines.push('  SELECT');
  
  const cpcSelect = cpcUseful.map(n => '    ' + n);
  sqlLines.push(cpcSelect.join(',\n'));
  sqlLines.push('  , ROW_NUMBER() OVER (');
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
  sqlLines.push('LEFT JOIN DSEDAC.CLI CLI');
  sqlLines.push('  ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
  sqlLines.push('LEFT JOIN DSEDAC.CLC CLC');
  sqlLines.push('  ON TRIM(CLC.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
  sqlLines.push('LEFT JOIN DSEDAC.CLP CLP');
  sqlLines.push('  ON TRIM(CLP.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
  sqlLines.push('WHERE CVC.IMPORTEPENDIENTE <> 0');
  sqlLines.push('  AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> ' + "'" + "S" + "'" + ')');
  sqlLines.push('  AND (CVC.ANOEMISION * 10000 + CVC.MESEMISION * 100 + CVC.DIAEMISION) >= 20030101');

  const sql = sqlLines.join('\n');
  console.log('SQL generado: ~' + sql.length + ' chars, ~' + (sql.match(/,/g) || []).length + ' columnas');

  // Save to file
  fs.writeFileSync('C:\\Users\\Javier\\Desktop\\Repositorios\\gmp_app_mobilidad\\database_backup_20260513\\VISTA_DEUDA_BASE_FULL.sql', sql);
  console.log('SQL guardado en backup');

  // Execute
  try {
    await conn.query('DROP VIEW JAVIER.VISTA_DEUDA_BASE');
    console.log('Vista antigua eliminada');
  } catch(e) {}

  try {
    const stmt = await conn.createStatement();
    await stmt.prepare(sql);
    await stmt.execute();
    await stmt.close();
    console.log('VISTA_DEUDA_BASE FULL creada correctamente');
  } catch(e) {
    console.log('Error prepare: ' + e.message.substring(0,120));
    try {
      await conn.query(sql);
      console.log('Creada via query()');
    } catch(e2) {
      console.log('Error query: ' + e2.message.substring(0,120));
    }
  }

  // Verify
  try {
    const r = await conn.query("SELECT COUNT(1) AS C FROM JAVIER.VISTA_DEUDA_BASE");
    console.log('Filas: ' + r[0].C);
    const c = await conn.query("SELECT COLUMN_NAME, ORDINAL_POSITION FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'VISTA_DEUDA_BASE' AND COLUMN_NAME IN ('SUBEMPRESAPEDIDO','CODIGOCLIENTE','NOMBRECLIENTE','NIF','IMPORTELIMITERIESGO') ORDER BY ORDINAL_POSITION");
    for (const col of c) {
      console.log('  Columna ' + col.ORDINAL_POSITION + ': ' + col.COLUMN_NAME);
    }
    const totalCols = await conn.query("SELECT COUNT(1) AS C FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'VISTA_DEUDA_BASE'");
    console.log('Total columnas: ' + totalCols[0].C);
  } catch(e) {
    console.log('Verify error: ' + e.message.substring(0,100));
  }

  await conn.close();
  await pool.close();
})().catch(e => console.log('FATAL: ' + e.message));
