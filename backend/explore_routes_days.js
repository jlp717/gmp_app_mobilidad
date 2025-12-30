/**
 * Database Exploration Script - Part 3: Analyze Route Codes for Day Pattern
 * Run with: node explore_routes_days.js
 */

const odbc = require('odbc');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function explore() {
    console.log('='.repeat(70));
    console.log('ANALYZING ROUTE CODES FOR DAY-OF-WEEK PATTERNS');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);
        console.log('✓ Connected to database\n');

        // 1. Get ALL distinct route codes with descriptions
        console.log('1. ALL ROUTES WITH DESCRIPTIONS...');
        console.log('-'.repeat(50));
        try {
            const result1 = await conn.query(`
        SELECT R.CODIGORUTA, R.DESCRIPCIONRUTA, COUNT(C.CODIGOCLIENTE) as CLIENTS
        FROM DSEDAC.RUT R
        LEFT JOIN DSEDAC.CLI C ON R.CODIGORUTA = C.CODIGORUTA
        GROUP BY R.CODIGORUTA, R.DESCRIPCIONRUTA
        ORDER BY CLIENTS DESC
        FETCH FIRST 50 ROWS ONLY
      `);
            if (result1.length > 0) {
                result1.forEach(r => {
                    const code = r.CODIGORUTA?.trim() || '(empty)';
                    const desc = r.DESCRIPCIONRUTA?.trim() || '';
                    console.log(`  ${code.padEnd(8)} | ${desc.substring(0, 35).padEnd(35)} | ${r.CLIENTS} clients`);
                });
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 2. Look for routes that START with L, M, X, J, V, S, D (day letters)
        console.log('\n2. ROUTES STARTING WITH DAY LETTERS (L,M,X,J,V,S,D)...');
        console.log('-'.repeat(50));
        try {
            const result2 = await conn.query(`
        SELECT CODIGORUTA, DESCRIPCIONRUTA
        FROM DSEDAC.RUT
        WHERE CODIGORUTA LIKE 'L%' 
           OR CODIGORUTA LIKE 'M%'
           OR CODIGORUTA LIKE 'X%'
           OR CODIGORUTA LIKE 'J%'
           OR CODIGORUTA LIKE 'V%'
           OR CODIGORUTA LIKE 'S%'
           OR CODIGORUTA LIKE 'D%'
        ORDER BY CODIGORUTA
        FETCH FIRST 30 ROWS ONLY
      `);
            if (result2.length > 0) {
                console.log('Routes with day-letter prefixes:');
                result2.forEach(r => {
                    const code = r.CODIGORUTA?.trim() || '';
                    const desc = r.DESCRIPCIONRUTA?.trim() || '';
                    console.log(`  ${code.padEnd(8)} - ${desc}`);
                });
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 3. Count clients per route letter prefix
        console.log('\n3. CLIENT COUNT BY ROUTE PREFIX (first letter)...');
        console.log('-'.repeat(50));
        try {
            const result3 = await conn.query(`
        SELECT 
          CASE
            WHEN SUBSTR(CODIGORUTA, 1, 1) = 'L' THEN 'L-Lunes'
            WHEN SUBSTR(CODIGORUTA, 1, 1) = 'M' THEN 'M-Martes'
            WHEN SUBSTR(CODIGORUTA, 1, 1) = 'X' THEN 'X-Miércoles'
            WHEN SUBSTR(CODIGORUTA, 1, 1) = 'J' THEN 'J-Jueves'
            WHEN SUBSTR(CODIGORUTA, 1, 1) = 'V' THEN 'V-Viernes'
            WHEN SUBSTR(CODIGORUTA, 1, 1) = 'S' THEN 'S-Sábado'
            WHEN SUBSTR(CODIGORUTA, 1, 1) = 'D' THEN 'D-Domingo'
            WHEN SUBSTR(CODIGORUTA, 1, 1) BETWEEN '0' AND '9' THEN 'Numeric'
            WHEN CODIGORUTA IS NULL OR CODIGORUTA = '' OR CODIGORUTA = '    ' THEN 'Empty'
            ELSE 'Other'
          END as DAY_PREFIX,
          COUNT(*) as CLIENT_COUNT
        FROM DSEDAC.CLI
        GROUP BY 
          CASE
            WHEN SUBSTR(CODIGORUTA, 1, 1) = 'L' THEN 'L-Lunes'
            WHEN SUBSTR(CODIGORUTA, 1, 1) = 'M' THEN 'M-Martes'
            WHEN SUBSTR(CODIGORUTA, 1, 1) = 'X' THEN 'X-Miércoles'
            WHEN SUBSTR(CODIGORUTA, 1, 1) = 'J' THEN 'J-Jueves'
            WHEN SUBSTR(CODIGORUTA, 1, 1) = 'V' THEN 'V-Viernes'
            WHEN SUBSTR(CODIGORUTA, 1, 1) = 'S' THEN 'S-Sábado'
            WHEN SUBSTR(CODIGORUTA, 1, 1) = 'D' THEN 'D-Domingo'
            WHEN SUBSTR(CODIGORUTA, 1, 1) BETWEEN '0' AND '9' THEN 'Numeric'
            WHEN CODIGORUTA IS NULL OR CODIGORUTA = '' OR CODIGORUTA = '    ' THEN 'Empty'
            ELSE 'Other'
          END
        ORDER BY CLIENT_COUNT DESC
      `);
            if (result3.length > 0) {
                result3.forEach(r => {
                    console.log(`  ${r.DAY_PREFIX?.padEnd(15)} - ${r.CLIENT_COUNT} clients`);
                });
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 4. Sample clients with L, M, X, J, V routes (day routes)
        console.log('\n4. SAMPLE CLIENTS WITH DAY-LETTER ROUTES...');
        console.log('-'.repeat(50));
        try {
            const result4 = await conn.query(`
        SELECT C.CODIGOCLIENTE, C.NOMBRECLIENTE, C.CODIGORUTA, C.POBLACION
        FROM DSEDAC.CLI C
        WHERE C.CODIGORUTA LIKE 'L%' 
           OR C.CODIGORUTA LIKE 'M%'
           OR C.CODIGORUTA LIKE 'X%'
           OR C.CODIGORUTA LIKE 'J%'
           OR C.CODIGORUTA LIKE 'V%'
        FETCH FIRST 20 ROWS ONLY
      `);
            if (result4.length > 0) {
                console.log('Sample clients with day routes:');
                result4.forEach(r => {
                    console.log(`  ${r.CODIGORUTA?.trim().padEnd(6)} | ${r.NOMBRECLIENTE?.trim().substring(0, 30).padEnd(30)} | ${r.POBLACION?.trim() || ''}`);
                });
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 5. Check if route codes have patterns like "0001" = dia 1 (lunes), etc.
        console.log('\n5. DESCRIPTION OF NUMERIC ROUTES...');
        console.log('-'.repeat(50));
        try {
            const result5 = await conn.query(`
        SELECT CODIGORUTA, DESCRIPCIONRUTA
        FROM DSEDAC.RUT
        WHERE CODIGORUTA BETWEEN '0001' AND '0007'
        ORDER BY CODIGORUTA
      `);
            if (result5.length > 0) {
                console.log('Numeric routes 0001-0007:');
                result5.forEach(r => {
                    console.log(`  ${r.CODIGORUTA?.trim()} - ${r.DESCRIPCIONRUTA?.trim()}`);
                });
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 6. Get clients for specific vendedor (93 had most clients)
        console.log('\n6. CLIENTS FOR VENDEDOR 93 BY ROUTE CODE...');
        console.log('-'.repeat(50));
        try {
            const result6 = await conn.query(`
        SELECT C.CODIGORUTA, COUNT(DISTINCT L.CODIGOCLIENTEALBARAN) as CLIENTS
        FROM DSEDAC.LAC L
        INNER JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
        WHERE L.CODIGOVENDEDOR = '93' 
          AND L.ANODOCUMENTO = 2024 
          AND L.MESDOCUMENTO = 12
        GROUP BY C.CODIGORUTA
        ORDER BY CLIENTS DESC
        FETCH FIRST 15 ROWS ONLY
      `);
            if (result6.length > 0) {
                console.log('Route distribution for vendedor 93:');
                result6.forEach(r => {
                    console.log(`  ${(r.CODIGORUTA?.trim() || '(empty)').padEnd(8)} - ${r.CLIENTS} clients`);
                });
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        console.log('\n' + '='.repeat(70));
        console.log('EXPLORATION COMPLETE');
        console.log('='.repeat(70));

    } catch (error) {
        console.error('Connection error:', error.message);
    } finally {
        if (conn) {
            await conn.close();
        }
    }
}

explore().catch(console.error);
