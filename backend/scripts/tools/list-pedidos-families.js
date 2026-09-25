// tools/list-pedidos-families.js - moved from scripts/list-pedidos-families.js (WS2 tools consolidation, rama test).
// familias pedidos lectura
// Uso: node backend/scripts/tools/list-pedidos-families.js Env: env ODBC_* DB2: R (detalle: backend/scripts/tools/README.md).
'use strict';

/**
 * Read-only: list all product families for pedidos comercial filters.
 * Never writes. Never dumps secrets.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, queryWithParams } = require('../../config/db');

async function main() {
  await initDb();
  try {
    const tables = await queryWithParams(
      `SELECT TABLE_SCHEMA, TABLE_NAME
         FROM QSYS2.SYSTABLES
        WHERE TABLE_SCHEMA IN ('DSEDAC', 'JAVIER')
          AND TABLE_NAME IN ('FAM', 'TEST_FAM', 'ART', 'TEST_ART')
        ORDER BY 1, 2`,
      [],
    );
    console.log('=== QSYS2 tables ===');
    console.log(JSON.stringify(tables, null, 2));

    const cols = await queryWithParams(
      `SELECT TRIM(COLUMN_NAME) AS COLUMN_NAME,
              TRIM(DATA_TYPE) AS DATA_TYPE,
              LENGTH
         FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'FAM'
        ORDER BY ORDINAL_POSITION`,
      [],
    );
    console.log('=== DSEDAC.FAM columns ===');
    console.log(JSON.stringify(cols, null, 2));

    const allFam = await queryWithParams(
      `SELECT TRIM(CODIGOFAMILIA) AS CODE,
              TRIM(DESCRIPCIONFAMILIA) AS NAME
         FROM DSEDAC.FAM
        ORDER BY CODIGOFAMILIA`,
      [],
    );
    console.log(`=== ALL DSEDAC.FAM count=${(allFam || []).length} ===`);
    for (const r of allFam || []) {
      console.log(`${String(r.CODE || '').padEnd(12)} | ${r.NAME || ''}`);
    }

    const artFam = await queryWithParams(
      `SELECT TRIM(A.CODIGOFAMILIA) AS CODE,
              COALESCE(MAX(TRIM(F.DESCRIPCIONFAMILIA)), MIN(TRIM(A.CODIGOFAMILIA))) AS NAME,
              COALESCE(MAX(TRIM(A.CODIGOPREFAMILIA)), '') AS PREFAMILY,
              COUNT(*) AS ART_COUNT
         FROM DSEDAC.ART A
         LEFT JOIN DSEDAC.FAM F ON A.CODIGOFAMILIA = F.CODIGOFAMILIA
        WHERE (A.ANOBAJA = 0 OR A.ANOBAJA IS NULL)
          AND TRIM(A.CODIGOFAMILIA) <> ''
        GROUP BY TRIM(A.CODIGOFAMILIA)
        ORDER BY NAME`,
      [],
    );
    console.log(`=== ART active families count=${(artFam || []).length} ===`);
    for (const r of artFam || []) {
      console.log(
        `${String(r.CODE || '').padEnd(12)} | ${String(r.NAME || '').padEnd(30)} | pref=${String(r.PREFAMILY || '').padEnd(12)} | arts=${r.ART_COUNT}`,
      );
    }

    const impulso = await queryWithParams(
      `SELECT TRIM(CODIGOFAMILIA) AS CODE,
              TRIM(DESCRIPCIONFAMILIA) AS NAME
         FROM DSEDAC.FAM
        WHERE UPPER(TRIM(CODIGOFAMILIA)) LIKE ?
           OR UPPER(TRIM(DESCRIPCIONFAMILIA)) LIKE ?`,
      ['%IMPUL%', '%IMPUL%'],
    );
    console.log('=== impulso match FAM ===');
    console.log(JSON.stringify(impulso, null, 2));

    const impulsoArt = await queryWithParams(
      `SELECT TRIM(CODIGOFAMILIA) AS CODE,
              TRIM(CODIGOPREFAMILIA) AS PREF,
              COUNT(*) AS N
         FROM DSEDAC.ART
        WHERE (UPPER(TRIM(CODIGOFAMILIA)) LIKE ?
            OR UPPER(TRIM(CODIGOPREFAMILIA)) LIKE ?
            OR UPPER(TRIM(DESCRIPCIONARTICULO)) LIKE ?)
          AND (ANOBAJA = 0 OR ANOBAJA IS NULL)
        GROUP BY TRIM(CODIGOFAMILIA), TRIM(CODIGOPREFAMILIA)
        ORDER BY N DESC
        FETCH FIRST 30 ROWS ONLY`,
      ['%IMPUL%', '%IMPUL%', '%IMPUL%'],
    );
    console.log('=== impulso match ART ===');
    console.log(JSON.stringify(impulsoArt, null, 2));

    // Prefamilias distinct for Nestlé / grouping context
    const prefs = await queryWithParams(
      `SELECT TRIM(CODIGOPREFAMILIA) AS PREF, COUNT(*) AS N
         FROM DSEDAC.ART
        WHERE (ANOBAJA = 0 OR ANOBAJA IS NULL)
          AND TRIM(CODIGOPREFAMILIA) <> ''
        GROUP BY TRIM(CODIGOPREFAMILIA)
        ORDER BY N DESC
        FETCH FIRST 40 ROWS ONLY`,
      [],
    );
    console.log('=== top prefamilias ===');
    console.log(JSON.stringify(prefs, null, 2));

    const testFamCount = await queryWithParams(
      `SELECT COUNT(*) AS N FROM JAVIER.TEST_FAM`,
      [],
    );
    const testImpulso = await queryWithParams(
      `SELECT TRIM(CODIGOFAMILIA) AS CODE, TRIM(DESCRIPCIONFAMILIA) AS NAME
         FROM JAVIER.TEST_FAM
        WHERE TRIM(CODIGOFAMILIA) = ?`,
      ['003'],
    );
    const testArtImpulso = await queryWithParams(
      `SELECT COUNT(*) AS N
         FROM JAVIER.TEST_ART
        WHERE TRIM(CODIGOFAMILIA) = ?
          AND (ANOBAJA = 0 OR ANOBAJA IS NULL)`,
      ['003'],
    );
    console.log('=== TEST_FAM ===');
    console.log(JSON.stringify({ testFamCount, testImpulso, testArtImpulso }, null, 2));

    const fs = require('fs');
    const path = require('path');
    const outDir = path.resolve(__dirname, '../../docs/audits/2026-09-23-pedidos-families');
    fs.mkdirSync(outDir, { recursive: true });
    const evidence = {
      capturedAt: new Date().toISOString(),
      qsys2: tables,
      famColumns: cols,
      famMasterCount: (allFam || []).length,
      famMaster: (allFam || []).map((r) => ({
        code: String(r.CODE || '').trim(),
        name: String(r.NAME || '').trim(),
      })),
      artActiveCount: (artFam || []).length,
      artActive: (artFam || []).map((r) => ({
        code: String(r.CODE || '').trim(),
        name: String(r.NAME || '').trim(),
        prefamily: String(r.PREFAMILY || '').trim(),
        artCount: Number(r.ART_COUNT) || 0,
      })),
      impulsoFam: impulso,
      test: { testFamCount, testImpulso, testArtImpulso },
      recommendation: {
        defaultVisiblePinned: ['003', '001', '013', '002', '060', '0031', '700', '701'],
        todas: 'clear family+prefamily',
        nestleChip: 'prefamily search NESTLE (marca/descripcion)',
        impulso: { code: '003', name: 'NESTLE IMPULSO' },
      },
    };
    fs.writeFileSync(
      path.join(outDir, 'families-db-evidence.json'),
      `${JSON.stringify(evidence, null, 2)}\n`,
      'utf8',
    );
    console.log(`Wrote ${path.join(outDir, 'families-db-evidence.json')}`);
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
