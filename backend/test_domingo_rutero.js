/**
 * Test script for DOMINGO commercial - Find vendedor code and verify rutero data
 * Run with: node test_domingo_rutero.js
 */

const odbc = require('odbc');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function test() {
    console.log('='.repeat(70));
    console.log('TESTING RUTERO FOR COMMERCIAL DOMINGO');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);
        console.log('✓ Connected to database\n');

        // 1. Find DOMINGO in JAVIER.CUSTOMER_USERS (login table)
        console.log('1. FINDING DOMINGO IN LOGIN TABLE...');
        console.log('-'.repeat(50));
        try {
            const result1 = await conn.query(`
        SELECT USERNAME, ROLE, VENDEDOR_CODES
        FROM JAVIER.CUSTOMER_USERS
        WHERE UPPER(USERNAME) LIKE '%DOMINGO%'
      `);
            if (result1.length > 0) {
                console.log('Found in JAVIER.CUSTOMER_USERS:');
                result1.forEach(r => {
                    console.log(`  Username: ${r.USERNAME}`);
                    console.log(`  Role: ${r.ROLE}`);
                    console.log(`  Vendedor Codes: ${r.VENDEDOR_CODES}`);
                });
            } else {
                console.log('  Not found in CUSTOMER_USERS');
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 2. Get ALL vendedor codes to understand which one is DOMINGO
        console.log('\n2. ALL VENDEDOR CODES IN VDC TABLE...');
        console.log('-'.repeat(50));
        try {
            const result2 = await conn.query(`
        SELECT CODIGOVENDEDOR, TIPOVENDEDOR
        FROM DSEDAC.VDC
        ORDER BY CODIGOVENDEDOR
      `);
            if (result2.length > 0) {
                console.log('Vendedores:');
                result2.forEach(r => {
                    console.log(`  ${r.CODIGOVENDEDOR?.trim().padEnd(10)} | Type: ${r.TIPOVENDEDOR?.trim() || ''}`);
                });
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 3. Assuming DOMINGO's code is in CUSTOMER_USERS, let's find it
        console.log('\n3. DOMINGO CLIENT COUNT IN LACLAE BY DAY...');
        console.log('-'.repeat(50));

        // Try common vendedor codes that might be DOMINGO
        const possibleCodes = ['93', '10', '02', '16', '81', '03', '73', '05'];

        for (const code of possibleCodes.slice(0, 3)) {
            console.log(`\n  Vendedor ${code}:`);
            try {
                const result3 = await conn.query(`
          SELECT 
            COUNT(DISTINCT CASE WHEN R1_T8DIVL = 'S' THEN LCCDCL END) AS LUNES_V,
            COUNT(DISTINCT CASE WHEN R1_T8DIVM = 'S' THEN LCCDCL END) AS MARTES_V,
            COUNT(DISTINCT CASE WHEN R1_T8DIVX = 'S' THEN LCCDCL END) AS MIERCOLES_V,
            COUNT(DISTINCT CASE WHEN R1_T8DIVJ = 'S' THEN LCCDCL END) AS JUEVES_V,
            COUNT(DISTINCT CASE WHEN R1_T8DIVV = 'S' THEN LCCDCL END) AS VIERNES_V,
            COUNT(DISTINCT CASE WHEN R1_T8DIVS = 'S' THEN LCCDCL END) AS SABADO_V,
            COUNT(DISTINCT CASE WHEN R1_T8DIVD = 'S' THEN LCCDCL END) AS DOMINGO_V
          FROM DSED.LACLAE
          WHERE R1_T8CDVD = '${code}'
        `);
                console.log(`    VISIT days: L=${result3[0]?.LUNES_V || 0} M=${result3[0]?.MARTES_V || 0} X=${result3[0]?.MIERCOLES_V || 0} J=${result3[0]?.JUEVES_V || 0} V=${result3[0]?.VIERNES_V || 0} S=${result3[0]?.SABADO_V || 0} D=${result3[0]?.DOMINGO_V || 0}`);
            } catch (e) {
                console.log(`    Error: ${e.message}`);
            }

            try {
                const result3b = await conn.query(`
          SELECT 
            COUNT(DISTINCT CASE WHEN R1_T8DIRL = 'S' THEN LCCDCL END) AS LUNES_R,
            COUNT(DISTINCT CASE WHEN R1_T8DIRM = 'S' THEN LCCDCL END) AS MARTES_R,
            COUNT(DISTINCT CASE WHEN R1_T8DIRX = 'S' THEN LCCDCL END) AS MIERCOLES_R,
            COUNT(DISTINCT CASE WHEN R1_T8DIRJ = 'S' THEN LCCDCL END) AS JUEVES_R,
            COUNT(DISTINCT CASE WHEN R1_T8DIRV = 'S' THEN LCCDCL END) AS VIERNES_R,
            COUNT(DISTINCT CASE WHEN R1_T8DIRS = 'S' THEN LCCDCL END) AS SABADO_R,
            COUNT(DISTINCT CASE WHEN R1_T8DIRD = 'S' THEN LCCDCL END) AS DOMINGO_R
          FROM DSED.LACLAE
          WHERE R1_T8CDVD = '${code}'
        `);
                console.log(`    DELIVERY days: L=${result3b[0]?.LUNES_R || 0} M=${result3b[0]?.MARTES_R || 0} X=${result3b[0]?.MIERCOLES_R || 0} J=${result3b[0]?.JUEVES_R || 0} V=${result3b[0]?.VIERNES_R || 0} S=${result3b[0]?.SABADO_R || 0} D=${result3b[0]?.DOMINGO_R || 0}`);
            } catch (e) {
                console.log(`    Error: ${e.message}`);
            }
        }

        // 4. Check what happens when NO vendedor filter is applied (this might be the bug)
        console.log('\n4. CLIENT COUNT WITHOUT VENDEDOR FILTER (ALL)...');
        console.log('-'.repeat(50));
        try {
            const result4 = await conn.query(`
        SELECT 
          COUNT(DISTINCT CASE WHEN R1_T8DIVL = 'S' THEN LCCDCL END) AS LUNES_V,
          COUNT(DISTINCT CASE WHEN R1_T8DIVM = 'S' THEN LCCDCL END) AS MARTES_V,
          COUNT(DISTINCT CASE WHEN R1_T8DIVX = 'S' THEN LCCDCL END) AS MIERCOLES_V,
          COUNT(DISTINCT CASE WHEN R1_T8DIVJ = 'S' THEN LCCDCL END) AS JUEVES_V,
          COUNT(DISTINCT CASE WHEN R1_T8DIVV = 'S' THEN LCCDCL END) AS VIERNES_V,
          COUNT(DISTINCT CASE WHEN R1_T8DIVS = 'S' THEN LCCDCL END) AS SABADO_V,
          COUNT(DISTINCT CASE WHEN R1_T8DIVD = 'S' THEN LCCDCL END) AS DOMINGO_V
        FROM DSED.LACLAE
        WHERE LCCDCL IS NOT NULL
      `);
            console.log(`  VISIT days (ALL): L=${result4[0]?.LUNES_V || 0} M=${result4[0]?.MARTES_V || 0} X=${result4[0]?.MIERCOLES_V || 0} J=${result4[0]?.JUEVES_V || 0} V=${result4[0]?.VIERNES_V || 0} S=${result4[0]?.SABADO_V || 0} D=${result4[0]?.DOMINGO_V || 0}`);
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 5. Check sample client sales YoY
        console.log('\n5. SAMPLE CLIENT SALES YoY FOR VENDEDOR 93...');
        console.log('-'.repeat(50));
        try {
            const result5 = await conn.query(`
        SELECT 
          L.CODIGOCLIENTEALBARAN as CODE,
          SUM(CASE WHEN L.ANODOCUMENTO = 2024 THEN L.IMPORTEVENTA ELSE 0 END) as SALES_2024,
          SUM(CASE WHEN L.ANODOCUMENTO = 2023 THEN L.IMPORTEVENTA ELSE 0 END) as SALES_2023
        FROM DSEDAC.LAC L
        WHERE L.MESDOCUMENTO = 12
          AND L.CODIGOVENDEDOR = '93'
          AND L.ANODOCUMENTO IN (2024, 2023)
        GROUP BY L.CODIGOCLIENTEALBARAN
        ORDER BY SALES_2024 DESC
        FETCH FIRST 10 ROWS ONLY
      `);
            console.log('Sample clients (Dec 2024 vs Dec 2023):');
            result5.forEach(r => {
                const s24 = parseFloat(r.SALES_2024) || 0;
                const s23 = parseFloat(r.SALES_2023) || 0;
                const diff = s24 - s23;
                const pct = s23 > 0 ? ((s24 - s23) / s23 * 100).toFixed(1) : (s24 > 0 ? '100' : '0');
                const indicator = diff >= 0 ? '↑' : '↓';
                console.log(`  ${r.CODE?.trim()} | 2024: ${s24.toFixed(2)}€ | 2023: ${s23.toFixed(2)}€ | ${indicator} ${diff.toFixed(2)}€ (${pct}%)`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 6. Check if the first 759.54€ client is being compared correctly
        console.log('\n6. CHECKING SPECIFIC CLIENT WITH ~759€ SALES...');
        console.log('-'.repeat(50));
        try {
            const result6 = await conn.query(`
        SELECT 
          L.CODIGOCLIENTEALBARAN as CODE,
          COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE)) as NAME,
          SUM(L.IMPORTEVENTA) as SALES
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
        WHERE L.ANODOCUMENTO = 2024 
          AND L.MESDOCUMENTO = 12
        GROUP BY L.CODIGOCLIENTEALBARAN, C.NOMBREALTERNATIVO, C.NOMBRECLIENTE
        HAVING SUM(L.IMPORTEVENTA) BETWEEN 750 AND 770
        FETCH FIRST 5 ROWS ONLY
      `);
            if (result6.length > 0) {
                console.log('Clients with ~759€ in Dec 2024:');
                for (const r of result6) {
                    console.log(`  ${r.CODE?.trim()} | ${r.NAME?.trim()} | ${parseFloat(r.SALES).toFixed(2)}€`);

                    // Get previous year for this client
                    const prevResult = await conn.query(`
            SELECT SUM(IMPORTEVENTA) as PREV_SALES
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO = 2023 AND MESDOCUMENTO = 12
              AND CODIGOCLIENTEALBARAN = '${r.CODE?.trim()}'
          `);
                    const prevSales = parseFloat(prevResult[0]?.PREV_SALES) || 0;
                    const diff = parseFloat(r.SALES) - prevSales;
                    console.log(`    2023: ${prevSales.toFixed(2)}€ | Diff: ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}€`);
                }
            } else {
                console.log('  No clients found with ~759€');
            }
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
