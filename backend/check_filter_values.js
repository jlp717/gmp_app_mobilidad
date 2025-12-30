/**
 * Check actual column values for sales filtering
 * Run with: node check_filter_values.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function check() {
    console.log('='.repeat(70));
    console.log('CHECKING FILTER VALUES IN LAC');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // Check TIPOVENTA values (might be SC, CC, etc.)
        console.log('\n1. TIPOVENTA values and totals:');
        console.log('-'.repeat(60));
        try {
            const tv = await conn.query(`
        SELECT TIPOVENTA, COUNT(*) as CNT, SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024
        GROUP BY TIPOVENTA
        ORDER BY TOTAL DESC
      `);
            console.log('  TIPOVENTA | Count    | Total Sales');
            console.log('  ' + '-'.repeat(45));
            tv.forEach(r => {
                const tipo = (r.TIPOVENTA || 'NULL').toString().trim().padEnd(10);
                const cnt = String(r.CNT).padEnd(8);
                const total = parseFloat(r.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 });
                console.log(`  ${tipo} | ${cnt} | ${total}€`);
            });
        } catch (e) { console.log('  Error:', e.message); }

        // Check SERIEDOCUMENTO values  
        console.log('\n\n2. SERIEDOCUMENTO values (TPDC filter):');
        console.log('-'.repeat(60));
        try {
            const sd = await conn.query(`
        SELECT SERIEDOCUMENTO, COUNT(*) as CNT, SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024
        GROUP BY SERIEDOCUMENTO
        ORDER BY TOTAL DESC
      `);
            console.log('  SERIE | Count    | Total Sales');
            console.log('  ' + '-'.repeat(45));
            sd.forEach(r => {
                const serie = (r.SERIEDOCUMENTO || 'NULL').toString().trim().padEnd(6);
                const cnt = String(r.CNT).padEnd(8);
                const total = parseFloat(r.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 });
                console.log(`  ${serie} | ${cnt} | ${total}€`);
            });
        } catch (e) { console.log('  Error:', e.message); }

        // Check CODIGOSECCION values (for LCSRAB)
        console.log('\n\n3. CODIGOSECCION values (LCSRAB filter K,N,O,G):');
        console.log('-'.repeat(60));
        try {
            const cs = await conn.query(`
        SELECT CODIGOSECCION, COUNT(*) as CNT, SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024
        GROUP BY CODIGOSECCION
        ORDER BY TOTAL DESC
      `);
            console.log('  SECCION | Count    | Total Sales');
            console.log('  ' + '-'.repeat(50));
            cs.forEach(r => {
                const seccion = (r.CODIGOSECCION || 'NULL').toString().trim().padEnd(8);
                const cnt = String(r.CNT).padEnd(8);
                const total = parseFloat(r.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 });
                console.log(`  ${seccion} | ${cnt} | ${total}€`);
            });
        } catch (e) { console.log('  Error:', e.message); }

        // Calculate totals with different filters
        console.log('\n\n4. TOTAL WITH FILTERS:');
        console.log('-'.repeat(60));

        // Total without SC in TIPOVENTA
        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 AND TIPOVENTA <> 'SC'
      `);
            console.log(`  Sin TIPOVENTA='SC': ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES')}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Total sin K, N, O, G en CODIGOSECCION
        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 AND CODIGOSECCION NOT IN ('K', 'N', 'O', 'G')
      `);
            console.log(`  Sin CODIGOSECCION K,N,O,G: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES')}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Combined
        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA <> 'SC'
          AND CODIGOSECCION NOT IN ('K', 'N', 'O', 'G')
      `);
            console.log(`  Sin SC + Sin K,N,O,G: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES')}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Check if there's a SERIEDOCUMENTO = LAE to exclude
        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA <> 'SC'
          AND CODIGOSECCION NOT IN ('K', 'N', 'O', 'G')
          AND SERIEDOCUMENTO <> 'LAE'
      `);
            console.log(`  Sin SC + Sin K,N,O,G + Sin LAE: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES')}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Check target: 15,052,760€
        console.log('\n  TARGET: 15,052,760€');

        console.log('\n' + '='.repeat(70));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

check().catch(console.error);
