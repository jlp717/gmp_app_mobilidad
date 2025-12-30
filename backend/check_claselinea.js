/**
 * Check CLASELINEA and TIPOLINEA for section filtering
 * Run with: node check_claselinea.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function check() {
    console.log('='.repeat(70));
    console.log('CHECKING CLASELINEA AND TIPOLINEA FOR FILTERING');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // Check CLASELINEA values
        console.log('\n1. CLASELINEA values (might have K,N,O,G):');
        console.log('-'.repeat(60));
        try {
            const cl = await conn.query(`
        SELECT CLASELINEA, COUNT(*) as CNT, SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024
        GROUP BY CLASELINEA
        ORDER BY TOTAL DESC
      `);
            console.log('  CLASE | Count     | Total Sales');
            console.log('  ' + '-'.repeat(50));
            cl.forEach(r => {
                const clase = (r.CLASELINEA || 'NULL').toString().trim().padEnd(6);
                const cnt = String(r.CNT).padEnd(10);
                const total = parseFloat(r.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 });
                console.log(`  ${clase} | ${cnt} | ${total}€`);
            });
        } catch (e) { console.log('  Error:', e.message); }

        // Check TIPOLINEA values
        console.log('\n\n2. TIPOLINEA values:');
        console.log('-'.repeat(60));
        try {
            const tl = await conn.query(`
        SELECT TIPOLINEA, COUNT(*) as CNT, SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024
        GROUP BY TIPOLINEA
        ORDER BY TOTAL DESC
      `);
            console.log('  TIPO  | Count     | Total Sales');
            console.log('  ' + '-'.repeat(50));
            tl.forEach(r => {
                const tipo = (r.TIPOLINEA || 'NULL').toString().trim().padEnd(6);
                const cnt = String(r.CNT).padEnd(10);
                const total = parseFloat(r.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 });
                console.log(`  ${tipo} | ${cnt} | ${total}€`);
            });
        } catch (e) { console.log('  Error:', e.message); }

        // Calculate totals excluding K, N, O, G from CLASELINEA
        console.log('\n\n3. TOTALS WITH CLASELINEA FILTERS:');
        console.log('-'.repeat(60));

        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA <> 'SC'
          AND CLASELINEA NOT IN ('K', 'N', 'O', 'G')
      `);
            console.log(`  Sin SC + Sin CLASELINEA K,N,O,G: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Check what K, N, O, G totals in CLASELINEA
        try {
            const excluded = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND CLASELINEA IN ('K', 'N', 'O', 'G')
      `);
            console.log(`  Solo CLASELINEA K,N,O,G: ${parseFloat(excluded[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Try final target filter
        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA = 'CC'
          AND CLASELINEA NOT IN ('K', 'N', 'O', 'G')
      `);
            console.log(`  TIPOVENTA='CC' + Sin CLASELINEA K,N,O,G: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
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
