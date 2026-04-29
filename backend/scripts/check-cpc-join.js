#!/usr/bin/env node
const odbc = require('odbc');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const CONN = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;CCSID=1208;';

(async () => {
  const pool = await odbc.pool(CONN);
  const conn = await pool.connect();

  // Get a sample CVC row with associated document fields
  const cvcRow = await conn.query(`
    SELECT SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO, TERMINALDOCUMENTO, NUMERODOCUMENTO,
           SUBEMPRESADOCUMENTOASOCIADO, EJERCICIODOCUMENTOASOCIADO, SERIEDOCUMENTOASOCIADO,
           TERMINALDOCUMENTOASOCIADO, NUMERODOCUMENTOASOCIADO,
           CODIGOCLIENTEALBARAN, TIPODOCUMENTO, IMPORTEPENDIENTE
    FROM DSEDAC.CVC
    WHERE IMPORTEPENDIENTE <> 0 AND ANULADOSN <> 'S'
    FETCH FIRST 1 ROW ONLY
  `);
  console.log('CVC row:', JSON.stringify(cvcRow[0], null, 2));

  const r = cvcRow[0];

  // Try joining on associated document → CPC albaran fields
  console.log('\n=== Try 1: CVC associated doc → CPC albaran ===');
  try {
    const t1 = await conn.query(`
      SELECT CPC.DIADOCUMENTO, CPC.MESDOCUMENTO, CPC.ANODOCUMENTO,
             CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN,
             CPC.TERMINALALBARAN, CPC.NUMEROALBARAN
      FROM DSEDAC.CPC CPC
      WHERE CPC.SUBEMPRESAALBARAN = ?
        AND CPC.EJERCICIOALBARAN = ?
        AND CPC.SERIEALBARAN = ?
        AND CPC.TERMINALALBARAN = ?
        AND CPC.NUMEROALBARAN = ?
      FETCH FIRST 3 ROWS ONLY
    `, [r.SUBEMPRESADOCUMENTOASOCIADO, r.EJERCICIODOCUMENTOASOCIADO, r.SERIEDOCUMENTOASOCIADO,
         r.TERMINALDOCUMENTOASOCIADO, r.NUMERODOCUMENTOASOCIADO]);
    if (t1.length > 0) {
      console.log('✅ Match found:', JSON.stringify(t1[0], null, 2));
    } else {
      console.log('❌ No match on associated doc → albaran');
    }
  } catch(e) { console.log('Error:', e.message.substring(0,150)); }

  // Try 2: CVC document → CPC order prep
  console.log('\n=== Try 2: CVC doc → CPC order prep ===');
  try {
    const t2 = await conn.query(`
      SELECT CPC.DIADOCUMENTO, CPC.MESDOCUMENTO, CPC.ANODOCUMENTO,
             CPC.SUBEMPRESA, CPC.EJERCICIOORDENPREPARACION, CPC.NUMEROORDENPREPARACION
      FROM DSEDAC.CPC CPC
      WHERE CPC.SUBEMPRESA = ?
        AND CPC.EJERCICIOORDENPREPARACION = ?
        AND CPC.NUMEROORDENPREPARACION = ?
      FETCH FIRST 3 ROWS ONLY
    `, [r.SUBEMPRESADOCUMENTO, r.EJERCICIODOCUMENTO, r.NUMERODOCUMENTO]);
    if (t2.length > 0) {
      console.log('✅ Match found:', JSON.stringify(t2[0], null, 2));
    } else {
      console.log('❌ No match on doc → order prep');
    }
  } catch(e) { console.log('Error:', e.message.substring(0,150)); }

  // Try 3: Just check if DIADOCUMENTO/MESDOCUMENTO in CPC for this client
  console.log('\n=== Try 3: CPC by client ===');
  try {
    const t3 = await conn.query(`
      SELECT CPC.DIADOCUMENTO, CPC.MESDOCUMENTO, CPC.ANODOCUMENTO,
             CPC.CODIGOCLIENTEALBARAN, CPC.NUMEROORDENPREPARACION
      FROM DSEDAC.CPC CPC
      WHERE CPC.CODIGOCLIENTEALBARAN = ?
      ORDER BY CPC.ANODOCUMENTO DESC, CPC.MESDOCUMENTO DESC, CPC.DIADOCUMENTO DESC
      FETCH FIRST 3 ROWS ONLY
    `, [r.CODIGOCLIENTEALBARAN]);
    if (t3.length > 0) {
      console.log('✅ Found for client:', JSON.stringify(t3, null, 2));
    } else {
      console.log('❌ No CPC for this client');
    }
  } catch(e) { console.log('Error:', e.message.substring(0,150)); }

  // Try 4: CVC document key → CPC via SUBEMPRESA/SERIE/TERMINAL/NUMERO matching different combos
  console.log('\n=== Try 4: CVC doc → CPC (various key combos) ===');
  // CVC has: SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO, TERMINALDOCUMENTO, NUMERODOCUMENTO
  // CPC has: SUBEMPRESA, EJERCICIOORDENPREPARACION, NUMEROORDENPREPARACION (no SERIE/TERMINAL for order prep)
  // But CPC also has: SUBEMPRESAALBARAN, EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN
  // And: SUBEMPRESAPEDIDO, EJERCICIOPEDIDO, SERIEPEDIDO, TERMINALPEDIDO, NUMEROPEDIDO
  
  // The CVC document might be a factura, not an albaran. Let's check what TIPODOCUMENTO means
  console.log(`CVC TIPODOCUMENTO: "${r.TIPODOCUMENTO}"`);
  console.log(`CVC NUMERODOCUMENTO: ${r.NUMERODOCUMENTO}`);
  console.log(`CVC associated doc: ${r.SUBEMPRESADOCUMENTOASOCIADO}/${r.EJERCICIODOCUMENTOASOCIADO}/${r.SERIEDOCUMENTOASOCIADO}/${r.TERMINALDOCUMENTOASOCIADO}/${r.NUMERODOCUMENTOASOCIADO}`);

  // Try: CVC associated doc → CPC albaran
  if (r.SUBEMPRESADOCUMENTOASOCIADO && r.NUMERODOCUMENTOASOCIADO) {
    try {
      const t4 = await conn.query(`
        SELECT DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, SUBEMPRESAALBARAN, SERIEALBARAN, NUMEROALBARAN
        FROM DSEDAC.CPC
        WHERE SUBEMPRESAALBARAN = ? AND SERIEALBARAN = ? AND NUMEROALBARAN = ?
        FETCH FIRST 3 ROWS ONLY
      `, [r.SUBEMPRESADOCUMENTOASOCIADO, r.SERIEDOCUMENTOASOCIADO, r.NUMERODOCUMENTOASOCIADO]);
      if (t4.length > 0) {
        console.log('✅ Match via albaran key:', JSON.stringify(t4[0], null, 2));
      } else {
        console.log('❌ No match');
      }
    } catch(e) { console.log('Error:', e.message.substring(0,150)); }
  }

  await conn.close();
  await pool.close();
})();
