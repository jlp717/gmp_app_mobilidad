/**
 * Test script to verify LACLAE data
 * Run with: node test_laclae.js
 */

const odbc = require('odbc');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function test() {
    console.log('='.repeat(70));
    console.log('TESTING LACLAE DATA FOR VISIT AND DELIVERY DAYS');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);
        console.log('✓ Connected to database\n');

        // 1. Count clients with visit days set
        console.log('1. COUNT CLIENTS BY VISIT DAY (DIV columns)...');
        console.log('-'.repeat(50));
        try {
            const result1 = await conn.query(`
        SELECT 
          SUM(CASE WHEN R1_T8DIVL = 'S' THEN 1 ELSE 0 END) as LUNES_V,
          SUM(CASE WHEN R1_T8DIVM = 'S' THEN 1 ELSE 0 END) as MARTES_V,
          SUM(CASE WHEN R1_T8DIVX = 'S' THEN 1 ELSE 0 END) as MIERCOLES_V,
          SUM(CASE WHEN R1_T8DIVJ = 'S' THEN 1 ELSE 0 END) as JUEVES_V,
          SUM(CASE WHEN R1_T8DIVV = 'S' THEN 1 ELSE 0 END) as VIERNES_V,
          SUM(CASE WHEN R1_T8DIVS = 'S' THEN 1 ELSE 0 END) as SABADO_V,
          SUM(CASE WHEN R1_T8DIVD = 'S' THEN 1 ELSE 0 END) as DOMINGO_V
        FROM DSED.LACLAE
      `);
            console.log('Visit days (DIV):');
            console.log(`  Lunes:     ${result1[0]?.LUNES_V || 0}`);
            console.log(`  Martes:    ${result1[0]?.MARTES_V || 0}`);
            console.log(`  Miércoles: ${result1[0]?.MIERCOLES_V || 0}`);
            console.log(`  Jueves:    ${result1[0]?.JUEVES_V || 0}`);
            console.log(`  Viernes:   ${result1[0]?.VIERNES_V || 0}`);
            console.log(`  Sábado:    ${result1[0]?.SABADO_V || 0}`);
            console.log(`  Domingo:   ${result1[0]?.DOMINGO_V || 0}`);
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 2. Count clients by delivery day (DIR columns)
        console.log('\n2. COUNT CLIENTS BY DELIVERY DAY (DIR columns)...');
        console.log('-'.repeat(50));
        try {
            const result2 = await conn.query(`
        SELECT 
          SUM(CASE WHEN R1_T8DIRL = 'S' THEN 1 ELSE 0 END) as LUNES_R,
          SUM(CASE WHEN R1_T8DIRM = 'S' THEN 1 ELSE 0 END) as MARTES_R,
          SUM(CASE WHEN R1_T8DIRX = 'S' THEN 1 ELSE 0 END) as MIERCOLES_R,
          SUM(CASE WHEN R1_T8DIRJ = 'S' THEN 1 ELSE 0 END) as JUEVES_R,
          SUM(CASE WHEN R1_T8DIRV = 'S' THEN 1 ELSE 0 END) as VIERNES_R,
          SUM(CASE WHEN R1_T8DIRS = 'S' THEN 1 ELSE 0 END) as SABADO_R,
          SUM(CASE WHEN R1_T8DIRD = 'S' THEN 1 ELSE 0 END) as DOMINGO_R
        FROM DSED.LACLAE
      `);
            console.log('Delivery days (DIR):');
            console.log(`  Lunes:     ${result2[0]?.LUNES_R || 0}`);
            console.log(`  Martes:    ${result2[0]?.MARTES_R || 0}`);
            console.log(`  Miércoles: ${result2[0]?.MIERCOLES_R || 0}`);
            console.log(`  Jueves:    ${result2[0]?.JUEVES_R || 0}`);
            console.log(`  Viernes:   ${result2[0]?.VIERNES_R || 0}`);
            console.log(`  Sábado:    ${result2[0]?.SABADO_R || 0}`);
            console.log(`  Domingo:   ${result2[0]?.DOMINGO_R || 0}`);
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 3. Total records in LACLAE
        console.log('\n3. TOTAL RECORDS IN LACLAE...');
        console.log('-'.repeat(50));
        try {
            const result3 = await conn.query(`SELECT COUNT(*) as TOTAL FROM DSED.LACLAE`);
            console.log(`  Total: ${result3[0]?.TOTAL || 0}`);
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 4. Sample data
        console.log('\n4. SAMPLE LACLAE DATA WITH VISIT DAYS...');
        console.log('-'.repeat(50));
        try {
            const result4 = await conn.query(`
        SELECT LCCDCL, R1_T8CDVD, R1_T8DIVL, R1_T8DIVM, R1_T8DIVX, R1_T8DIVJ, 
               R1_T8DIVV, R1_T8DIVS, R1_T8DIVD,
               R1_T8DIRL, R1_T8DIRM, R1_T8DIRX, R1_T8DIRJ, R1_T8DIRV, R1_T8DIRS, R1_T8DIRD
        FROM DSED.LACLAE
        WHERE R1_T8DIVL = 'S' OR R1_T8DIVM = 'S' OR R1_T8DIVX = 'S'
        FETCH FIRST 10 ROWS ONLY
      `);
            console.log('Sample (client, vendedor, L M X J V S D visit, L M X J V S D delivery):');
            result4.forEach(r => {
                const v = [r.R1_T8DIVL, r.R1_T8DIVM, r.R1_T8DIVX, r.R1_T8DIVJ, r.R1_T8DIVV, r.R1_T8DIVS, r.R1_T8DIVD].map(d => d === 'S' ? '✓' : '-').join('');
                const d = [r.R1_T8DIRL, r.R1_T8DIRM, r.R1_T8DIRX, r.R1_T8DIRJ, r.R1_T8DIRV, r.R1_T8DIRS, r.R1_T8DIRD].map(d => d === 'S' ? '✓' : '-').join('');
                console.log(`  ${r.LCCDCL?.trim()} | VD:${r.R1_T8CDVD?.trim()} | Visit:${v} | Deliv:${d}`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 5. Check what LCCDCL is (client code)
        console.log('\n5. VERIFY LCCDCL IS CLIENT CODE...');
        console.log('-'.repeat(50));
        try {
            const result5 = await conn.query(`
        SELECT L.LCCDCL, C.NOMBRECLIENTE
        FROM DSED.LACLAE L
        INNER JOIN DSEDAC.CLI C ON L.LCCDCL = C.CODIGOCLIENTE
        FETCH FIRST 5 ROWS ONLY
      `);
            console.log('Client code mapping:');
            result5.forEach(r => {
                console.log(`  ${r.LCCDCL?.trim()} = ${r.NOMBRECLIENTE?.trim()?.substring(0, 40)}`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 6. Check R1_T8CDVD is vendedor code
        console.log('\n6. VERIFY R1_T8CDVD IS VENDEDOR CODE...');
        console.log('-'.repeat(50));
        try {
            const result6 = await conn.query(`
        SELECT DISTINCT R1_T8CDVD, COUNT(*) as CLIENTS
        FROM DSED.LACLAE
        GROUP BY R1_T8CDVD
        ORDER BY CLIENTS DESC
        FETCH FIRST 15 ROWS ONLY
      `);
            console.log('Vendedor codes in LACLAE:');
            result6.forEach(r => {
                console.log(`  ${(r.R1_T8CDVD?.trim() || '(empty)').padEnd(10)} - ${r.CLIENTS} clients`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        console.log('\n' + '='.repeat(70));
        console.log('TEST COMPLETE');
        console.log('='.repeat(70));

    } catch (error) {
        console.error('Connection error:', error.message);
    } finally {
        if (conn) {
            await conn.close();
        }
    }
}

test().catch(console.error);
