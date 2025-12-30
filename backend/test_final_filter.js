/**
 * Test final filter: CC+VC, exclude K,N,O,G
 * Run with: node test_final_filter.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function check() {
    console.log('='.repeat(70));
    console.log('TESTING FINAL FILTER: CC+VC, Sin K,N,O,G');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // Test TIPOVENTA IN (CC, VC) + exclude SERIEALBARAN K,N,O,G
        console.log('\n1. TIPOVENTA IN (CC, VC):');
        console.log('-'.repeat(60));

        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA IN ('CC', 'VC')
      `);
            console.log(`  CC+VC: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Test with SERIEALBARAN K,N,O,G exclusion
        console.log('\n\n2. CC+VC + Sin SERIEALBARAN K,N,O,G:');
        console.log('-'.repeat(60));

        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA IN ('CC', 'VC')
          AND SERIEALBARAN NOT IN ('K', 'N', 'O', 'G')
      `);
            console.log(`  CC+VC sin SERIEALBARAN K,N,O,G: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Test with SERIEDOCUMENTO K,N,O,G exclusion (just in case)
        console.log('\n\n3. CC+VC + Sin SERIEDOCUMENTO K,N,O,G:');
        console.log('-'.repeat(60));

        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA IN ('CC', 'VC')
          AND SERIEDOCUMENTO NOT IN ('K', 'N', 'O', 'G')
      `);
            console.log(`  CC+VC sin SERIEDOCUMENTO K,N,O,G: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Combined: both SERIE columns
        console.log('\n\n4. CC+VC + Sin AMBAS SERIES K,N,O,G:');
        console.log('-'.repeat(60));

        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA IN ('CC', 'VC')
          AND SERIEALBARAN NOT IN ('K', 'N', 'O', 'G')
          AND SERIEDOCUMENTO NOT IN ('K', 'N', 'O', 'G')
      `);
            console.log(`  CC+VC sin AMBAS K,N,O,G: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Check what K,N,O,G contribute in SERIEALBARAN
        console.log('\n\n5. Contribution of K,N,O,G in SERIEALBARAN:');
        console.log('-'.repeat(60));

        try {
            const knog = await conn.query(`
        SELECT SERIEALBARAN, SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA IN ('CC', 'VC')
          AND SERIEALBARAN IN ('K', 'N', 'O', 'G')
        GROUP BY SERIEALBARAN
      `);
            knog.forEach(r => {
                console.log(`  ${(r.SERIEALBARAN || 'NULL').toString().trim()}: ${parseFloat(r.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
            });
            const totalKnog = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA IN ('CC', 'VC')
          AND SERIEALBARAN IN ('K', 'N', 'O', 'G')
      `);
            console.log(`  TOTAL K,N,O,G: ${parseFloat(totalKnog[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        console.log('\n  TARGET: 15,052,760€');
        console.log('\n' + '='.repeat(70));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

check().catch(console.error);
