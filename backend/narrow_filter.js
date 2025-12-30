/**
 * Narrow down to exact 15.05M filter
 * Run with: node narrow_filter.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function check() {
    console.log('='.repeat(70));
    console.log('NARROWING DOWN TO EXACT 15,052,760€');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // Target: 15,052,760€
        // CC + P,H,E = 14.89M (need +155K more)
        // Check what I adds:

        console.log('\n1. I SERIES BREAKDOWN:');
        console.log('-'.repeat(60));

        try {
            const iTotal = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA = 'CC'
          AND SERIEDOCUMENTO = 'I'
      `);
            console.log(`  SERIEDOCUMENTO I alone: ${parseFloat(iTotal[0]?.TOTAL || 0).toLocaleString('es-ES')}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Maybe we need to add partial - check by month
        console.log('\n\n2. CC + P,H,E + I BY MONTH (to get partial):');
        console.log('-'.repeat(60));

        try {
            const monthly = await conn.query(`
        SELECT MESDOCUMENTO, SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA = 'CC'
          AND SERIEDOCUMENTO = 'I'
        GROUP BY MESDOCUMENTO
        ORDER BY MESDOCUMENTO
      `);
            console.log('  MES | I Total');
            console.log('  ' + '-'.repeat(30));
            let cum = 0;
            monthly.forEach(r => {
                cum += parseFloat(r.TOTAL || 0);
                console.log(`  ${String(r.MESDOCUMENTO).padStart(2, '0')}  | ${parseFloat(r.TOTAL || 0).toLocaleString('es-ES')}€ (cum: ${cum.toLocaleString('es-ES')}€)`);
            });
        } catch (e) { console.log('  Error:', e.message); }

        // Check empty value contribution
        console.log('\n\n3. EMPTY SERIES CONTRIBUTION (sin valor):');
        console.log('-'.repeat(60));

        try {
            const empty = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA = 'CC'
          AND (SERIEDOCUMENTO = '' OR SERIEDOCUMENTO IS NULL)
      `);
            console.log(`  Empty/NULL SERIEDOCUMENTO: ${parseFloat(empty[0]?.TOTAL || 0).toLocaleString('es-ES')}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Check if we add empty to P,H,E
        console.log('\n\n4. P,H,E + EMPTY:');
        console.log('-'.repeat(60));

        try {
            const pheEmpty = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA = 'CC'
          AND (SERIEDOCUMENTO IN ('P', 'H', 'E') OR SERIEDOCUMENTO = '' OR SERIEDOCUMENTO IS NULL)
      `);
            console.log(`  P,H,E + empty: ${parseFloat(pheEmpty[0]?.TOTAL || 0).toLocaleString('es-ES')}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Try P,H,E plus partial I
        console.log('\n\n5. FINDING EXACT COMBINATION:');
        console.log('-'.repeat(60));

        // How much I do we need?
        // 15,052,760 - 14,897,510 = 155,250€ from I

        try {
            // Check W, 1, 2, 3, 4, 5 values
            const others = await conn.query(`
        SELECT SERIEDOCUMENTO, SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA = 'CC'
          AND SERIEDOCUMENTO NOT IN ('P', 'H', 'I', 'E', 'B', '')
        GROUP BY SERIEDOCUMENTO
        ORDER BY TOTAL DESC
      `);
            console.log('  Other series:');
            others.forEach(r => {
                console.log(`    ${(r.SERIEDOCUMENTO || 'empty').toString().trim()}: ${parseFloat(r.TOTAL || 0).toLocaleString('es-ES')}€`);
            });
        } catch (e) { console.log('  Error:', e.message); }

        // Try adding W,1,2,4,5 to P,H,E
        try {
            const pheOther = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA = 'CC'
          AND SERIEDOCUMENTO IN ('P', 'H', 'E', 'W', '1', '2', '4', '5')
      `);
            console.log(`  P,H,E + W,1,2,4,5: ${parseFloat(pheOther[0]?.TOTAL || 0).toLocaleString('es-ES')}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Very close - let me check if using P,H,I partial helps
        try {
            // Only H,P (the main ones) + some E
            const phPartial = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA = 'CC'
          AND SERIEDOCUMENTO IN ('P', 'H')
          AND MESDOCUMENTO <= 12
      `);
            console.log(`  P,H all months: ${parseFloat(phPartial[0]?.TOTAL || 0).toLocaleString('es-ES')}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Check by excluding I from full set
        try {
            const noI = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA = 'CC'
          AND SERIEDOCUMENTO NOT IN ('I', 'B', '3')
      `);
            console.log(`  CC sin I,B,3: ${parseFloat(noI[0]?.TOTAL || 0).toLocaleString('es-ES')}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Check excluding I and empty
        try {
            const noIEmpty = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024 
          AND TIPOVENTA = 'CC'
          AND SERIEDOCUMENTO NOT IN ('I', 'B', '3', '')
          AND SERIEDOCUMENTO IS NOT NULL
      `);
            console.log(`  CC sin I,B,3,empty: ${parseFloat(noIEmpty[0]?.TOTAL || 0).toLocaleString('es-ES')}€`);
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
