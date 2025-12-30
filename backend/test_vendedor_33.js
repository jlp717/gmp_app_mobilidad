/**
 * Test script for DOMINGO (Vendedor 33) - Verify exact client counts
 * Run with: node test_vendedor_33.js
 */

const odbc = require('odbc');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function test() {
    console.log('='.repeat(70));
    console.log('TESTING RUTERO FOR VENDEDOR 33 (DOMINGO)');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);
        console.log('✓ Connected to database\n');

        // 1. VISIT day counts for vendedor 33
        console.log('1. VISIT DAY COUNTS FOR VENDEDOR 33...');
        console.log('-'.repeat(50));
        try {
            const result1 = await conn.query(`
        SELECT 
          COUNT(DISTINCT CASE WHEN R1_T8DIVL = 'S' THEN LCCDCL END) AS LUNES,
          COUNT(DISTINCT CASE WHEN R1_T8DIVM = 'S' THEN LCCDCL END) AS MARTES,
          COUNT(DISTINCT CASE WHEN R1_T8DIVX = 'S' THEN LCCDCL END) AS MIERCOLES,
          COUNT(DISTINCT CASE WHEN R1_T8DIVJ = 'S' THEN LCCDCL END) AS JUEVES,
          COUNT(DISTINCT CASE WHEN R1_T8DIVV = 'S' THEN LCCDCL END) AS VIERNES,
          COUNT(DISTINCT CASE WHEN R1_T8DIVS = 'S' THEN LCCDCL END) AS SABADO,
          COUNT(DISTINCT CASE WHEN R1_T8DIVD = 'S' THEN LCCDCL END) AS DOMINGO
        FROM DSED.LACLAE
        WHERE R1_T8CDVD = '33'
      `);
            console.log(`VISIT: L=${result1[0]?.LUNES} M=${result1[0]?.MARTES} X=${result1[0]?.MIERCOLES} J=${result1[0]?.JUEVES} V=${result1[0]?.VIERNES} S=${result1[0]?.SABADO} D=${result1[0]?.DOMINGO}`);
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 2. DELIVERY day counts for vendedor 33
        console.log('\n2. DELIVERY DAY COUNTS FOR VENDEDOR 33...');
        console.log('-'.repeat(50));
        try {
            const result2 = await conn.query(`
        SELECT 
          COUNT(DISTINCT CASE WHEN R1_T8DIRL = 'S' THEN LCCDCL END) AS LUNES,
          COUNT(DISTINCT CASE WHEN R1_T8DIRM = 'S' THEN LCCDCL END) AS MARTES,
          COUNT(DISTINCT CASE WHEN R1_T8DIRX = 'S' THEN LCCDCL END) AS MIERCOLES,
          COUNT(DISTINCT CASE WHEN R1_T8DIRJ = 'S' THEN LCCDCL END) AS JUEVES,
          COUNT(DISTINCT CASE WHEN R1_T8DIRV = 'S' THEN LCCDCL END) AS VIERNES,
          COUNT(DISTINCT CASE WHEN R1_T8DIRS = 'S' THEN LCCDCL END) AS SABADO,
          COUNT(DISTINCT CASE WHEN R1_T8DIRD = 'S' THEN LCCDCL END) AS DOMINGO
        FROM DSED.LACLAE
        WHERE R1_T8CDVD = '33'
      `);
            console.log(`DELIVERY: L=${result2[0]?.LUNES} M=${result2[0]?.MARTES} X=${result2[0]?.MIERCOLES} J=${result2[0]?.JUEVES} V=${result2[0]?.VIERNES} S=${result2[0]?.SABADO} D=${result2[0]?.DOMINGO}`);
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 3. Sample clients with sales for vendedor 33 in Dec 2024
        console.log('\n3. SAMPLE CLIENTS FOR VENDEDOR 33 (Dec 2024)...');
        console.log('-'.repeat(50));
        try {
            const result3 = await conn.query(`
        SELECT 
          L.CODIGOCLIENTEALBARAN as CODE,
          COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE)) as NAME,
          SUM(L.IMPORTEVENTA) as SALES
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
        WHERE L.CODIGOVENDEDOR = '33'
          AND L.ANODOCUMENTO = 2024
          AND L.MESDOCUMENTO = 12
        GROUP BY L.CODIGOCLIENTEALBARAN, C.NOMBREALTERNATIVO, C.NOMBRECLIENTE
        ORDER BY SALES DESC
        FETCH FIRST 10 ROWS ONLY
      `);
            console.log('Top clients Dec 2024:');
            result3.forEach(r => {
                console.log(`  ${r.CODE?.trim()} | ${parseFloat(r.SALES).toFixed(2)}€ | ${r.NAME?.trim()?.substring(0, 35)}`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 4. YoY comparison for vendedor 33
        console.log('\n4. YoY COMPARISON FOR VENDEDOR 33 TOP CLIENTS...');
        console.log('-'.repeat(50));
        try {
            const result4 = await conn.query(`
        SELECT 
          L.CODIGOCLIENTEALBARAN as CODE,
          SUM(CASE WHEN L.ANODOCUMENTO = 2024 THEN L.IMPORTEVENTA ELSE 0 END) as SALES_2024,
          SUM(CASE WHEN L.ANODOCUMENTO = 2023 THEN L.IMPORTEVENTA ELSE 0 END) as SALES_2023
        FROM DSEDAC.LAC L
        WHERE L.CODIGOVENDEDOR = '33'
          AND L.MESDOCUMENTO = 12
          AND L.ANODOCUMENTO IN (2024, 2023)
        GROUP BY L.CODIGOCLIENTEALBARAN
        ORDER BY SALES_2024 DESC
        FETCH FIRST 10 ROWS ONLY
      `);
            console.log('YoY comparison (Dec 2024 vs Dec 2023):');
            result4.forEach(r => {
                const s24 = parseFloat(r.SALES_2024) || 0;
                const s23 = parseFloat(r.SALES_2023) || 0;
                const diff = s24 - s23;
                const pct = s23 > 0 ? ((s24 - s23) / s23 * 100).toFixed(1) : (s24 > 0 ? '100' : '0');
                const indicator = diff >= 0 ? '↑ GREEN' : '↓ RED';
                console.log(`  ${r.CODE?.trim()} | 2024: ${s24.toFixed(2)}€ | 2023: ${s23.toFixed(2)}€ | ${indicator} ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}€`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 5. Check specific client with ~759€
        console.log('\n5. FINDING CLIENT WITH ~759€ FOR VENDEDOR 33...');
        console.log('-'.repeat(50));
        try {
            const result5 = await conn.query(`
        SELECT 
          L.CODIGOCLIENTEALBARAN as CODE,
          SUM(L.IMPORTEVENTA) as SALES
        FROM DSEDAC.LAC L
        WHERE L.CODIGOVENDEDOR = '33'
          AND L.ANODOCUMENTO = 2024
          AND L.MESDOCUMENTO = 12
        GROUP BY L.CODIGOCLIENTEALBARAN
        HAVING SUM(L.IMPORTEVENTA) BETWEEN 750 AND 770
      `);
            if (result5.length > 0) {
                console.log('Clients with ~759€ for vendedor 33:');
                for (const r of result5) {
                    console.log(`  ${r.CODE?.trim()} | ${parseFloat(r.SALES).toFixed(2)}€`);

                    // Get previous year
                    const prevResult = await conn.query(`
            SELECT SUM(IMPORTEVENTA) as PREV_SALES
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO = 2023 AND MESDOCUMENTO = 12
              AND CODIGOCLIENTEALBARAN = '${r.CODE?.trim()}'
              AND CODIGOVENDEDOR = '33'
          `);
                    const prevSales = parseFloat(prevResult[0]?.PREV_SALES) || 0;
                    const diff = parseFloat(r.SALES) - prevSales;
                    const isPositive = diff >= 0;
                    console.log(`    Dec 2023: ${prevSales.toFixed(2)}€ | Diff: ${isPositive ? '+' : ''}${diff.toFixed(2)}€ | Should be: ${isPositive ? 'GREEN ↑' : 'RED ↓'}`);
                }
            } else {
                console.log('  No clients found with ~759€ for vendedor 33');
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 6. Total unique clients for vendedor 33
        console.log('\n6. TOTAL UNIQUE CLIENTS FOR VENDEDOR 33 (Dec 2024)...');
        console.log('-'.repeat(50));
        try {
            const result6 = await conn.query(`
        SELECT COUNT(DISTINCT CODIGOCLIENTEALBARAN) as TOTAL
        FROM DSEDAC.LAC
        WHERE CODIGOVENDEDOR = '33'
          AND ANODOCUMENTO = 2024
          AND MESDOCUMENTO = 12
      `);
            console.log(`  Total unique clients: ${result6[0]?.TOTAL || 0}`);
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
