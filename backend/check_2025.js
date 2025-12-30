/**
 * Check 2025 data with correct filters
 * Run with: node check_2025.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function check() {
    console.log('='.repeat(70));
    console.log('CHECKING 2025 DATA WITH CC+VC FILTERS');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // 1. Total 2025 sin filtros
        console.log('\n1. TOTAL 2025 SIN FILTROS:');
        console.log('-'.repeat(60));

        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2025
      `);
            console.log(`  LAC 2025 Total: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // 2. TIPOVENTA values in 2025
        console.log('\n\n2. TIPOVENTA VALUES 2025:');
        console.log('-'.repeat(60));

        try {
            const tv = await conn.query(`
        SELECT TIPOVENTA, COUNT(*) as CNT, SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2025
        GROUP BY TIPOVENTA
        ORDER BY TOTAL DESC
      `);
            tv.forEach(r => {
                console.log(`  ${(r.TIPOVENTA || 'NULL').toString().trim()}: ${r.CNT} rows, ${parseFloat(r.TOTAL || 0).toLocaleString('es-ES')}€`);
            });
        } catch (e) { console.log('  Error:', e.message); }

        // 3. SERIEALBARAN values in 2025
        console.log('\n\n3. SERIEALBARAN VALUES 2025:');
        console.log('-'.repeat(60));

        try {
            const sa = await conn.query(`
        SELECT SERIEALBARAN, COUNT(*) as CNT, SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2025
        GROUP BY SERIEALBARAN
        ORDER BY SERIEALBARAN
      `);
            sa.forEach(r => {
                console.log(`  ${(r.SERIEALBARAN || 'NULL').toString().trim()}: ${r.CNT} rows, ${parseFloat(r.TOTAL || 0).toLocaleString('es-ES')}€`);
            });
        } catch (e) { console.log('  Error:', e.message); }

        // 4. CC+VC
        console.log('\n\n4. 2025 CC+VC:');
        console.log('-'.repeat(60));

        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2025 
          AND TIPOVENTA IN ('CC', 'VC')
      `);
            console.log(`  CC+VC: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // 5. CC+VC sin SERIEALBARAN K,N,O,G
        console.log('\n\n5. 2025 CC+VC SIN SERIEALBARAN K,N,O,G:');
        console.log('-'.repeat(60));

        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2025 
          AND TIPOVENTA IN ('CC', 'VC')
          AND SERIEALBARAN NOT IN ('K', 'N', 'O', 'G')
      `);
            console.log(`  CC+VC sin K,N,O,G: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // 6. CC+VC sin SERIEDOCUMENTO K,N,O,G
        console.log('\n\n6. 2025 CC+VC SIN SERIEDOCUMENTO K,N,O,G:');
        console.log('-'.repeat(60));

        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2025 
          AND TIPOVENTA IN ('CC', 'VC')
          AND SERIEDOCUMENTO NOT IN ('K', 'N', 'O', 'G')
      `);
            console.log(`  CC+VC sin SERIEDOC K,N,O,G: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // 7. Check K,N,O,G presence in SERIEDOCUMENTO 2025
        console.log('\n\n7. K,N,O,G IN SERIEDOCUMENTO 2025:');
        console.log('-'.repeat(60));

        try {
            const knog = await conn.query(`
        SELECT SERIEDOCUMENTO, SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2025 
          AND SERIEDOCUMENTO IN ('K', 'N', 'O', 'G')
        GROUP BY SERIEDOCUMENTO
      `);
            if (knog.length > 0) {
                knog.forEach(r => {
                    console.log(`  ${r.SERIEDOCUMENTO}: ${parseFloat(r.TOTAL || 0).toLocaleString('es-ES')}€`);
                });
            } else {
                console.log('  No K,N,O,G found in SERIEDOCUMENTO 2025');
            }
        } catch (e) { console.log('  Error:', e.message); }

        // 8. Check K,N,O,G in SERIEALBARAN 2025
        console.log('\n\n8. K,N,O,G IN SERIEALBARAN 2025:');
        console.log('-'.repeat(60));

        try {
            const knog = await conn.query(`
        SELECT SERIEALBARAN, SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2025 
          AND SERIEALBARAN IN ('K', 'N', 'O', 'G')
        GROUP BY SERIEALBARAN
      `);
            if (knog.length > 0) {
                knog.forEach(r => {
                    console.log(`  ${r.SERIEALBARAN}: ${parseFloat(r.TOTAL || 0).toLocaleString('es-ES')}€`);
                });
            } else {
                console.log('  No K,N,O,G found in SERIEALBARAN 2025');
            }
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
