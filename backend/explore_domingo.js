/**
 * Database Exploration - Find REAL visit and delivery days for commercial DOMINGO
 * Run with: node explore_domingo.js
 */

const odbc = require('odbc');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function explore() {
    console.log('='.repeat(70));
    console.log('EXPLORING REAL SCHEDULE FOR COMMERCIAL "DOMINGO"');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);
        console.log('✓ Connected to database\n');

        // 1. Find commercial DOMINGO's code
        console.log('1. FINDING COMMERCIAL DOMINGO...');
        console.log('-'.repeat(50));
        let domingoCode = null;
        try {
            const result1 = await conn.query(`
        SELECT CODIGOVENDEDOR, TIPOVENDEDOR
        FROM DSEDAC.VDC
        WHERE UPPER(CODIGOVENDEDOR) LIKE '%DOMINGO%'
           OR UPPER(CODIGOVENDEDOR) = 'DOMINGO'
        FETCH FIRST 5 ROWS ONLY
      `);
            if (result1.length > 0) {
                console.log('Found:');
                result1.forEach(r => {
                    consol +.log(`  Code: ${r.CODIGOVENDEDOR?.trim()} | Type: ${r.TIPOVENDEDOR}`);
                    domingoCode = r.CODIGOVENDEDOR?.trim();
                });
            } else {
                // Try LAC table
                const result1b = await conn.query(`
          SELECT DISTINCT CODIGOVENDEDOR
          FROM DSEDAC.LAC
          WHERE UPPER(CODIGOVENDEDOR) LIKE '%DOMINGO%'
          FETCH FIRST 5 ROWS ONLY
        `);
                if (result1b.length > 0) {
                    console.log('Found in LAC:');
                    result1b.forEach(r => {
                        console.log(`  Code: ${r.CODIGOVENDEDOR?.trim()}`);
                        domingoCode = r.CODIGOVENDEDOR?.trim();
                    });
                }
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 2. Count unique clients for DOMINGO in Dec 2024
        console.log('\n2. UNIQUE CLIENTS FOR DOMINGO IN DEC 2024...');
        console.log('-'.repeat(50));
        try {
            // Try to find the code used for this vendedor
            const resultCodes = await conn.query(`
        SELECT DISTINCT CODIGOVENDEDOR, COUNT(DISTINCT CODIGOCLIENTEALBARAN) as CLIENTS
        GROUP BY CODIGOVENDEDOR
        ORDER BY CLIENTS DESC
        FETCH FIRST 15 ROWS ONLY
      `);
            console.log('All vendedores with clients in Dec 2024:');
            resultCodes.forEach(r => {
                console.log(`  ${r.CODIGOVENDEDOR?.trim().padEnd(15)} - ${r.CLIENTS} clients`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 3. Check if CLI has visit/delivery day columns
        console.log('\n3. ALL CLI COLUMNS (looking for visit/delivery days)...');
        console.log('-'.repeat(50));
        try {
            const result3 = await conn.query(`SELECT * FROM DSEDAC.CLI FETCH FIRST 1 ROWS ONLY`);
            if (result3.length > 0) {
                const cols = Object.keys(result3[0]);
                console.log(`CLI has ${cols.length} columns:`);
                // Show all columns
                cols.forEach((c, i) => {
                    if (i % 4 === 0) process.stdout.write('\n  ');
                    process.stdout.write(c.padEnd(25));
                });
                console.log();
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 4. Look for RUT table with more detail
        console.log('\n4. RUT TABLE COLUMNS...');
        console.log('-'.repeat(50));
        try {
            const result4 = await conn.query(`SELECT * FROM DSEDAC.RUT FETCH FIRST 1 ROWS ONLY`);
            if (result4.length > 0) {
                const cols = Object.keys(result4[0]);
                console.log('RUT columns:', cols.join(', '));
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 5. Check if there's a VENDEDOR-specific route table
        console.log('\n5. LOOKING FOR VENDEDOR ROUTE TABLES...');
        console.log('-'.repeat(50));
        const tablesToTry = ['RUTVDC', 'VDCRUT', 'RUTAVDC', 'VENDEDORRUTA', 'ZONAS', 'ZONA', 'SECTOR'];
        for (const tbl of tablesToTry) {
            try {
                const result = await conn.query(`SELECT * FROM DSEDAC.${tbl} FETCH FIRST 1 ROWS ONLY`);
                console.log(`  ✓ Found DSEDAC.${tbl}: ${Object.keys(result[0] || {}).join(', ')}`);
            } catch (e) {
                // Not found
            }
        }

        // 6. Sample clients with route for vendedor 93 (top vendedor)
        console.log('\n6. SAMPLE CLIENTS FOR TOP VENDEDOR WITH THEIR ROUTES...');
        console.log('-'.repeat(50));
        try {
            const result6 = await conn.query(`
        SELECT DISTINCT 
          L.CODIGOCLIENTEALBARAN as CLIENT,
          C.NOMBRECLIENTE as NAME,
          C.CODIGORUTA as ROUTE,
          R.DESCRIPCIONRUTA as ROUTE_DESC
        FROM DSEDAC.LAC L
        INNER JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
        LEFT JOIN DSEDAC.RUT R ON C.CODIGORUTA = R.CODIGORUTA
        WHERE L.ANODOCUMENTO = 2024 AND L.MESDOCUMENTO = 12
          AND L.CODIGOVENDEDOR = '93'
        FETCH FIRST 15 ROWS ONLY
      `);
            if (result6.length > 0) {
                console.log('Clients for vendedor 93:');
                result6.forEach(r => {
                    const route = r.ROUTE?.trim() || '(none)';
                    const desc = r.ROUTE_DESC?.trim()?.substring(0, 40) || '';
                    console.log(`  ${route.padEnd(6)} | ${desc.padEnd(40)} | ${r.NAME?.trim()?.substring(0, 25)}`);
                });
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 7. Count routes that have day patterns
        console.log('\n7. ROUTES WITH DAY PATTERNS (parsed)...');
        console.log('-'.repeat(50));
        try {
            const result7 = await conn.query(`
        SELECT CODIGORUTA, DESCRIPCIONRUTA
        FROM DSEDAC.RUT
        WHERE DESCRIPCIONRUTA LIKE '%/%'
        FETCH FIRST 30 ROWS ONLY
      `);

            const dayPattern = /[\/\s]([LMXJVSD](?:,[LMXJVSD])*)\s/i;
            let withDays = 0;
            let withoutDays = 0;

            result7.forEach(r => {
                const desc = r.DESCRIPCIONRUTA?.toUpperCase() || '';
                if (dayPattern.test(' ' + desc + ' ')) {
                    withDays++;
                } else {
                    withoutDays++;
                }
            });

            console.log(`  Routes with day patterns: ${withDays}`);
            console.log(`  Routes without day patterns: ${withoutDays}`);
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 8. Check for specific day in LACLAE if it exists
        console.log('\n8. LOOKING FOR LACLAE TABLE (with day columns)...');
        console.log('-'.repeat(50));
        try {
            const result8 = await conn.query(`SELECT * FROM DSED.LACLAE FETCH FIRST 1 ROWS ONLY`);
            console.log('Found DSED.LACLAE columns:', Object.keys(result8[0] || {}).join(', '));
        } catch (e) {
            console.log('  DSED.LACLAE not found');
            try {
                const result8b = await conn.query(`SELECT * FROM DSEDAC.LACLAE FETCH FIRST 1 ROWS ONLY`);
                console.log('Found DSEDAC.LACLAE columns:', Object.keys(result8b[0] || {}).join(', '));
            } catch (e2) {
                console.log('  DSEDAC.LACLAE not found either');
            }
        }

        // 9. Check for RAZ (razones/routes) or similar tables
        console.log('\n9. CHECKING FOR OTHER POTENTIAL TABLES...');
        console.log('-'.repeat(50));
        const moreTables = ['RAZ', 'RAZON', 'DIA', 'DIAS', 'HORARIO', 'PROGRAMA', 'PLAN'];
        for (const tbl of moreTables) {
            try {
                const result = await conn.query(`SELECT * FROM DSEDAC.${tbl} FETCH FIRST 1 ROWS ONLY`);
                console.log(`  ✓ Found DSEDAC.${tbl}: ${Object.keys(result[0] || {}).join(', ')}`);
            } catch (e) {
                // Not found
            }
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
