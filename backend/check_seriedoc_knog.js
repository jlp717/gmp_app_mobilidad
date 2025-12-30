/**
 * Check SERIEDOCUMENTO for K, N, O, G filtering
 * Run with: node check_seriedoc_knog.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function check() {
    console.log('='.repeat(70));
    console.log('CHECKING SERIEDOCUMENTO FOR K, N, O, G FILTERING');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // Check all SERIEDOCUMENTO values
        console.log('\n1. ALL SERIEDOCUMENTO values in 2024:');
        console.log('-'.repeat(60));
        try {
            const sd = await conn.query(`
        SELECT SERIEDOCUMENTO, COUNT(*) as CNT, SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024
        GROUP BY SERIEDOCUMENTO
        ORDER BY SERIEDOCUMENTO
      `);
            console.log('  SERIE | Count     | Total Sales');
            console.log('  ' + '-'.repeat(50));
            sd.forEach(r => {
                const serie = (r.SERIEDOCUMENTO || 'NULL').toString().trim().padEnd(6);
                const cnt = String(r.CNT).padEnd(10);
                const total = parseFloat(r.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 });
                console.log(`  ${serie} | ${cnt} | ${total}€`);
            });
        } catch (e) { console.log('  Error:', e.message); }

        // Check SERIEALBARAN values (might be different)
        console.log('\n\n2. SERIEALBARAN values:');
        console.log('-'.repeat(60));
        try {
            const sa = await conn.query(`
        SELECT SERIEALBARAN, COUNT(*) as CNT, SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024
        GROUP BY SERIEALBARAN
        ORDER BY SERIEALBARAN
      `);
            console.log('  SERIE | Count     | Total Sales');
            console.log('  ' + '-'.repeat(50));
            sa.forEach(r => {
                const serie = (r.SERIEALBARAN || 'NULL').toString().trim().padEnd(6);
                const cnt = String(r.CNT).padEnd(10);
                const total = parseFloat(r.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 });
                console.log(`  ${serie} | ${cnt} | ${total}€`);
            });
        } catch (e) { console.log('  Error:', e.message); }

        // Calculate totals with different filters
        console.log('\n\n3. TOTALS WITH FILTERS:');
        console.log('-'.repeat(60));

        // Base: TIPOVENTA = CC (removing SC)
        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 AND TIPOVENTA = 'CC'
      `);
            console.log(`  TIPOVENTA='CC': ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Remove SERIEALBARAN K, N, O, G
        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA = 'CC'
          AND SERIEALBARAN NOT IN ('K', 'N', 'O', 'G')
      `);
            console.log(`  CC + Sin SERIEALBARAN K,N,O,G: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Remove SERIEDOCUMENTO K, N, O, G
        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA = 'CC'
          AND SERIEDOCUMENTO NOT IN ('K', 'N', 'O', 'G')
      `);
            console.log(`  CC + Sin SERIEDOCUMENTO K,N,O,G: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // What if we only keep P, H, I, E series?
        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA = 'CC'
          AND SERIEDOCUMENTO IN ('P', 'H', 'I', 'E')
      `);
            console.log(`  CC + SOLO SERIEDOCUMENTO P,H,I,E: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // What if we keep only P, H?
        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA = 'CC'
          AND SERIEDOCUMENTO IN ('P', 'H')
      `);
            console.log(`  CC + SOLO SERIEDOCUMENTO P,H: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // What if we only include P?
        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA = 'CC'
          AND SERIEDOCUMENTO = 'P'
      `);
            console.log(`  CC + SOLO SERIEDOCUMENTO P: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Check SERIEALBARAN P only
        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA = 'CC'
          AND SERIEALBARAN = 'P'
      `);
            console.log(`  CC + SOLO SERIEALBARAN P: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
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
