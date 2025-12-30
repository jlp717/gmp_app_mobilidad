/**
 * DEEP CVC TABLE ANALYSIS
 * ======================
 * CVC appears to be the main table with historical data (80K+ rows)
 * This script analyzes it thoroughly to understand the data structure
 * Run: node analyze_cvc.js
 */

const odbc = require('odbc');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function analyzeCVC() {
    let conn;

    try {
        conn = await odbc.connect(DB_CONFIG);
        console.log('✅ Connected to DB2\n');
        console.log('='.repeat(80));
        console.log('DEEP ANALYSIS OF CVC TABLE (Cartera/Vencimientos/Cobros)');
        console.log('='.repeat(80));

        // 1. Total count
        const count = await conn.query('SELECT COUNT(*) as total FROM DSEDAC.CVC');
        console.log(`\nTotal records: ${count[0].TOTAL}`);

        // 2. Date range analysis - ANOEMISION (emission year)
        console.log('\n\n--- ANOEMISION (Year of document emission) ---');
        const yearEmision = await conn.query(`
      SELECT ANOEMISION as year, COUNT(*) as cnt, SUM(IMPORTEVENCIMIENTO) as total_importe
      FROM DSEDAC.CVC
      WHERE ANOEMISION > 2000
      GROUP BY ANOEMISION
      ORDER BY ANOEMISION
    `);
        console.log('YEAR'.padEnd(8) + 'COUNT'.padEnd(12) + 'TOTAL IMPORTE');
        console.log('-'.repeat(40));
        for (const row of yearEmision) {
            console.log(
                String(row.YEAR).padEnd(8) +
                String(row.CNT).padEnd(12) +
                `€${(row.TOTAL_IMPORTE / 1000).toFixed(0)}K`
            );
        }

        // 3. ANOVENCIMIENTO (maturity year)
        console.log('\n\n--- ANOVENCIMIENTO (Maturity Year) ---');
        const yearVto = await conn.query(`
      SELECT ANOVENCIMIENTO as year, COUNT(*) as cnt, SUM(IMPORTEVENCIMIENTO) as total
      FROM DSEDAC.CVC
      WHERE ANOVENCIMIENTO > 2000
      GROUP BY ANOVENCIMIENTO
      ORDER BY ANOVENCIMIENTO
    `);
        console.log('YEAR'.padEnd(8) + 'COUNT'.padEnd(12) + 'TOTAL');
        for (const row of yearVto) {
            console.log(String(row.YEAR).padEnd(8) + String(row.CNT).padEnd(12) + `€${(row.TOTAL / 1000).toFixed(0)}K`);
        }

        // 4. Monthly breakdown for recent years
        console.log('\n\n--- MONTHLY BREAKDOWN 2024-2025 (ANOEMISION) ---');
        const monthly = await conn.query(`
      SELECT ANOEMISION as year, MESEMISION as month, 
             COUNT(*) as cnt, SUM(IMPORTEVENCIMIENTO) as total
      FROM DSEDAC.CVC
      WHERE ANOEMISION >= 2024
      GROUP BY ANOEMISION, MESEMISION
      ORDER BY ANOEMISION, MESEMISION
    `);
        console.log('PERIOD'.padEnd(12) + 'COUNT'.padEnd(10) + 'TOTAL IMPORTE');
        console.log('-'.repeat(40));
        for (const row of monthly) {
            console.log(
                `${row.YEAR}-${String(row.MONTH).padStart(2, '0')}`.padEnd(12) +
                String(row.CNT).padEnd(10) +
                `€${(row.TOTAL / 1000).toFixed(0)}K`
            );
        }

        // 5. TIPODOCUMENTO analysis
        console.log('\n\n--- TIPODOCUMENTO (Document Types) ---');
        const tipos = await conn.query(`
      SELECT TIPODOCUMENTO as tipo, COUNT(*) as cnt, SUM(IMPORTEVENCIMIENTO) as total
      FROM DSEDAC.CVC
      GROUP BY TIPODOCUMENTO
      ORDER BY cnt DESC
    `);
        for (const row of tipos) {
            console.log(`  ${(row.TIPO || 'NULL').trim().padEnd(15)}: ${row.CNT} docs, €${(row.TOTAL / 1000).toFixed(0)}K`);
        }

        // 6. Sample records
        console.log('\n\n--- SAMPLE RECORDS (3 recent) ---');
        const samples = await conn.query(`
      SELECT * FROM DSEDAC.CVC 
      WHERE ANOEMISION >= 2024 
      ORDER BY ANOEMISION DESC, MESEMISION DESC 
      FETCH FIRST 3 ROWS ONLY
    `);
        for (let i = 0; i < samples.length; i++) {
            console.log(`\nRecord ${i + 1}:`);
            const row = samples[i];
            // Only show important columns
            const importantCols = [
                'TIPODOCUMENTO', 'ANOEMISION', 'MESEMISION', 'DIAEMISION',
                'ANOVENCIMIENTO', 'MESVENCIMIENTO', 'DIAVENCIMIENTO',
                'CODIGOCLIENTEALBARAN', 'CODIGOVENDEDOR', 'CODIGORUTA',
                'IMPORTEVENCIMIENTO', 'IMPORTECANCELADO', 'IMPORTEPENDIENTE',
                'SITUACION', 'CODIGOFORMAPAGO'
            ];
            for (const col of importantCols) {
                if (row[col] !== undefined) {
                    console.log(`  ${col.padEnd(25)}: ${row[col]}`);
                }
            }
        }

        // 7. Check LINDTO with different filters
        console.log('\n\n' + '='.repeat(80));
        console.log('CHECKING LINDTO WITH DIFFERENT FILTERS');
        console.log('='.repeat(80));

        // All years in LINDTO
        const lindtoYears = await conn.query(`
      SELECT DISTINCT ANODOCUMENTO as year FROM DSEDAC.LINDTO ORDER BY year
    `);
        console.log('\nYears in LINDTO:', lindtoYears.map(r => r.YEAR).join(', '));

        // Check if there's data with year = 0 or null
        const lindtoNullYears = await conn.query(`
      SELECT COUNT(*) as cnt FROM DSEDAC.LINDTO WHERE ANODOCUMENTO IS NULL OR ANODOCUMENTO = 0
    `);
        console.log(`Records with NULL/0 year: ${lindtoNullYears[0].CNT}`);

        // Check all months in 2025
        const lindtoMonths2025 = await conn.query(`
      SELECT MESDOCUMENTO as month, COUNT(*) as cnt, SUM(IMPORTEVENTA) as total
      FROM DSEDAC.LINDTO
      WHERE ANODOCUMENTO = 2025
      GROUP BY MESDOCUMENTO
      ORDER BY month
    `);
        console.log('\n2025 months in LINDTO:');
        for (const row of lindtoMonths2025) {
            console.log(`  Month ${row.MONTH}: ${row.CNT} records, €${(row.TOTAL / 1000).toFixed(0)}K`);
        }

        // 8. Try to find relationship between CVC and sales
        console.log('\n\n' + '='.repeat(80));
        console.log('CVC-LINDTO RELATIONSHIP ANALYSIS');
        console.log('='.repeat(80));

        // Check if CVC references documents that might be in LINDTO
        const cvcDocTypes = await conn.query(`
      SELECT TIPODOCUMENTO, 
             MIN(ANOEMISION) as min_year, MAX(ANOEMISION) as max_year,
             COUNT(*) as cnt,
             SUM(IMPORTEVENCIMIENTO) as total
      FROM DSEDAC.CVC
      WHERE ANOEMISION >= 2020
      GROUP BY TIPODOCUMENTO
      ORDER BY total DESC
    `);
        console.log('\nCVC Document Types (2020+):');
        console.log('TYPE'.padEnd(10) + 'YEARS'.padEnd(15) + 'COUNT'.padEnd(10) + 'TOTAL');
        for (const row of cvcDocTypes) {
            console.log(
                (row.TIPODOCUMENTO || '?').trim().padEnd(10) +
                `${row.MIN_YEAR}-${row.MAX_YEAR}`.padEnd(15) +
                String(row.CNT).padEnd(10) +
                `€${(row.TOTAL / 1000).toFixed(0)}K`
            );
        }

        // 9. SUMMARY & RECOMMENDATIONS
        console.log('\n\n' + '='.repeat(80));
        console.log('SUMMARY & RECOMMENDATIONS');
        console.log('='.repeat(80));

        const totalCVC = await conn.query(`
      SELECT 
        SUM(CASE WHEN ANOEMISION = 2023 THEN IMPORTEVENCIMIENTO ELSE 0 END) as y2023,
        SUM(CASE WHEN ANOEMISION = 2024 THEN IMPORTEVENCIMIENTO ELSE 0 END) as y2024,
        SUM(CASE WHEN ANOEMISION = 2025 THEN IMPORTEVENCIMIENTO ELSE 0 END) as y2025
      FROM DSEDAC.CVC
    `);

        console.log('\nCVC TOTALS BY YEAR (IMPORTEVENCIMIENTO):');
        console.log(`  2023: €${((totalCVC[0].Y2023 || 0) / 1000000).toFixed(2)}M`);
        console.log(`  2024: €${((totalCVC[0].Y2024 || 0) / 1000000).toFixed(2)}M`);
        console.log(`  2025: €${((totalCVC[0].Y2025 || 0) / 1000000).toFixed(2)}M`);

        const totalLINDTO = await conn.query(`
      SELECT SUM(IMPORTEVENTA) as total FROM DSEDAC.LINDTO WHERE ANODOCUMENTO = 2025
    `);
        console.log(`\nLINDTO 2025 TOTAL (IMPORTEVENTA): €${((totalLINDTO[0].TOTAL || 0) / 1000).toFixed(0)}K`);

        console.log('\n\nCONCLUSION:');
        console.log('- CVC contains payment/invoice maturity records from 2000-2025');
        console.log('- IMPORTEVENCIMIENTO in CVC = invoice amounts for payment tracking');
        console.log('- LINDTO only has March 2025 sales order lines');
        console.log('- For historical analytics, USE CVC table with ANOEMISION/MESEMISION');
        console.log('- CVC.IMPORTEVENCIMIENTO = Sales amount by document');

    } catch (error) {
        console.error('\nFATAL ERROR:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

analyzeCVC();
