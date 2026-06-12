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

  // 1. Check CVC â†’ CPC join match rate
  console.log('=== CVC â†’ CPC JOIN match rate ===\n');
  const matchRate = await conn.query(`
    SELECT 
      COUNT(*) AS total_cvc,
      COUNT(CPC.SUBEMPRESAALBARAN) AS matched_cpc,
      COUNT(*) - COUNT(CPC.SUBEMPRESAALBARAN) AS unmatched
    FROM DSEDAC.CVC CVC
    LEFT JOIN DSEDAC.CPC CPC
      ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
      AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
      AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
      AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
    WHERE CVC.IMPORTEPENDIENTE <> 0
      AND CVC.ANULADOSN <> 'S'
      AND (CVC.ANOEMISION * 10000 + CVC.MESEMISION * 100 + CVC.DIAEMISION) >= 20030101
  `);
  console.log(`Total CVC rows:    ${matchRate[0].TOTAL_CVC}`);
  console.log(`Matched CPC:       ${matchRate[0].MATCHED_CPC}`);
  console.log(`Unmatched:         ${matchRate[0].UNMATCHED}`);
  console.log(`Match %:           ${((matchRate[0].MATCHED_CPC / matchRate[0].TOTAL_CVC) * 100).toFixed(1)}%\n`);

  // 2. Check by TIPODOCUMENTO
  console.log('=== Match rate by TIPODOCUMENTO ===\n');
  const byType = await conn.query(`
    SELECT 
      CVC.TIPODOCUMENTO,
      COUNT(*) AS total,
      COUNT(CPC.SUBEMPRESAALBARAN) AS matched,
      COUNT(*) - COUNT(CPC.SUBEMPRESAALBARAN) AS unmatched
    FROM DSEDAC.CVC CVC
    LEFT JOIN DSEDAC.CPC CPC
      ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
      AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
      AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
      AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
    WHERE CVC.IMPORTEPENDIENTE <> 0
      AND CVC.ANULADOSN <> 'S'
      AND (CVC.ANOEMISION * 10000 + CVC.MESEMISION * 100 + CVC.DIAEMISION) >= 20030101
    GROUP BY CVC.TIPODOCUMENTO
    ORDER BY total DESC
  `);
  for (const r of byType) {
    const pct = ((r.MATCHED / r.TOTAL) * 100).toFixed(1);
    console.log(`  ${r.TIPODOCUMENTO || 'NULL'}: ${String(r.TOTAL).padStart(5)} total, ${String(r.MATCHED).padStart(5)} matched, ${String(r.UNMATCHED).padStart(5)} unmatched (${pct}%)`);
  }

  // 3. Check if CPC has data for a matched row
  console.log('\n=== Sample matched CVCâ†’CPC row ===\n');
  const sample = await conn.query(`
    SELECT 
      CVC.TIPODOCUMENTO, CVC.SUBEMPRESADOCUMENTO, CVC.EJERCICIODOCUMENTO, CVC.SERIEDOCUMENTO, CVC.NUMERODOCUMENTO,
      CVC.DIAEMISION, CVC.MESEMISION, CVC.ANOEMISION,
      CPC.DIADOCUMENTO, CPC.MESDOCUMENTO, CPC.ANODOCUMENTO,
      CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN, CPC.NUMEROALBARAN,
      CPC.CODIGOCLIENTEALBARAN AS CPC_CLIENTE, CVC.CODIGOCLIENTEALBARAN AS CVC_CLIENTE
    FROM DSEDAC.CVC CVC
    LEFT JOIN DSEDAC.CPC CPC
      ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
      AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
      AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
      AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
    WHERE CVC.IMPORTEPENDIENTE <> 0
      AND CVC.ANULADOSN <> 'S'
      AND CPC.SUBEMPRESAALBARAN IS NOT NULL
    FETCH FIRST 3 ROWS ONLY
  `);
  for (const row of sample) {
    console.log(JSON.stringify(row, null, 2));
  }

  // 4. Check sample UNMATCHED row
  console.log('\n=== Sample UNMATCHED CVC row ===\n');
  const unmatched = await conn.query(`
    SELECT 
      CVC.TIPODOCUMENTO, CVC.SUBEMPRESADOCUMENTO, CVC.EJERCICIODOCUMENTO, 
      CVC.SERIEDOCUMENTO, CVC.TERMINALDOCUMENTO, CVC.NUMERODOCUMENTO,
      CVC.SUBEMPRESADOCUMENTOASOCIADO, CVC.EJERCICIODOCUMENTOASOCIADO,
      CVC.SERIEDOCUMENTOASOCIADO, CVC.TERMINALDOCUMENTOASOCIADO, CVC.NUMERODOCUMENTOASOCIADO,
      CVC.DIAEMISION, CVC.MESEMISION, CVC.ANOEMISION
    FROM DSEDAC.CVC CVC
    LEFT JOIN DSEDAC.CPC CPC
      ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
      AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
      AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
      AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
    WHERE CVC.IMPORTEPENDIENTE <> 0
      AND CVC.ANULADOSN <> 'S'
      AND (CVC.ANOEMISION * 10000 + CVC.MESEMISION * 100 + CVC.DIAEMISION) >= 20030101
      AND CPC.SUBEMPRESAALBARAN IS NULL
    FETCH FIRST 3 ROWS ONLY
  `);
  for (const row of unmatched) {
    console.log(JSON.stringify(row, null, 2));
  }

  // 5. Alternative: Does CPC have records at all?
  console.log('\n=== CPC table stats ===\n');
  const cpcStats = await conn.query(`
    SELECT COUNT(*) AS total_cpc,
           COUNT(DISTINCT SUBEMPRESAALBARAN || EJERCICIOALBARAN || SERIEALBARAN || NUMEROALBARAN) AS unique_albaran_keys
    FROM DSEDAC.CPC
  `);
  console.log(`Total CPC rows: ${cpcStats[0].TOTAL_CPC}`);
  console.log(`Unique albarÃ¡n keys: ${cpcStats[0].UNIQUE_ALBARAN_KEYS}`);

  await conn.close();
  await pool.close();
})();
