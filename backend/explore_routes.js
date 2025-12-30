/**
 * Database Exploration Script - Part 2: Explore Routes
 * Run with: node explore_routes.js
 */

const odbc = require('odbc');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function explore() {
    console.log('='.repeat(70));
    console.log('EXPLORING ROUTES AND VISIT SCHEDULE');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);
        console.log('✓ Connected to database\n');

        // 1. Check distinct CODIGORUTA values in CLI
        console.log('1. DISTINCT CODIGORUTA VALUES IN CLI...');
        console.log('-'.repeat(50));
        try {
            const result1 = await conn.query(`
        SELECT CODIGORUTA, COUNT(*) as CLIENT_COUNT
        FROM DSEDAC.CLI
        GROUP BY CODIGORUTA
        ORDER BY CLIENT_COUNT DESC
        FETCH FIRST 20 ROWS ONLY
      `);
            if (result1.length > 0) {
                console.log('Route codes and client counts:');
                result1.forEach(r => console.log(`  Route "${r.CODIGORUTA?.trim() || '(empty)'}" - ${r.CLIENT_COUNT} clients`));
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 2. Try to find a RUTA table
        console.log('\n2. LOOKING FOR RUTA/RUT TABLE IN DSEDAC...');
        console.log('-'.repeat(50));
        try {
            // First try RUT
            const result2 = await conn.query(`
        SELECT * FROM DSEDAC.RUT
        FETCH FIRST 5 ROWS ONLY
      `);
            console.log('Found RUT table:');
            if (result2.length > 0) {
                console.log('Columns:', Object.keys(result2[0]).join(', '));
                result2.forEach((r, i) => console.log(`  Row ${i}:`, JSON.stringify(r).substring(0, 200)));
            }
        } catch (e) {
            console.log('  RUT table not found or error:', e.message.substring(0, 80));
        }

        // 3. Try RUTAS table
        console.log('\n3. LOOKING FOR RUTAS TABLE...');
        console.log('-'.repeat(50));
        try {
            const result3 = await conn.query(`
        SELECT * FROM DSEDAC.RUTAS
        FETCH FIRST 5 ROWS ONLY
      `);
            console.log('Found RUTAS table:');
            if (result3.length > 0) {
                console.log('Columns:', Object.keys(result3[0]).join(', '));
            }
        } catch (e) {
            console.log('  RUTAS table not found:', e.message.substring(0, 60));
        }

        // 4. Check how CODIGORUTA is distributed
        console.log('\n4. SAMPLE CLIENTS WITH THEIR ROUTE CODES...');
        console.log('-'.repeat(50));
        try {
            const result4 = await conn.query(`
        SELECT CODIGOCLIENTE, NOMBRECLIENTE, CODIGORUTA, POBLACION
        FROM DSEDAC.CLI
        WHERE CODIGORUTA IS NOT NULL AND CODIGORUTA <> ''
        FETCH FIRST 15 ROWS ONLY
      `);
            if (result4.length > 0) {
                result4.forEach(r => console.log(`  ${r.CODIGOCLIENTE?.trim()} | Ruta: ${r.CODIGORUTA?.trim()} | ${r.NOMBRECLIENTE?.trim()?.substring(0, 30)}`));
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 5. Try to find VDC (vendedores) with routes
        console.log('\n5. CHECKING VDC (VENDEDORES) FOR ROUTE INFO...');
        console.log('-'.repeat(50));
        try {
            const result5 = await conn.query(`
        SELECT * FROM DSEDAC.VDC
        FETCH FIRST 3 ROWS ONLY
      `);
            if (result5.length > 0) {
                console.log('VDC columns:', Object.keys(result5[0]).join(', '));
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 6. How many clients per vendedor in current month
        console.log('\n6. CLIENT COUNT PER VENDEDOR (Dec 2024)...');
        console.log('-'.repeat(50));
        try {
            const result6 = await conn.query(`
        SELECT CODIGOVENDEDOR, COUNT(DISTINCT CODIGOCLIENTEALBARAN) as CLIENTS
        FROM DSEDAC.LAC
        WHERE ANODOCUMENTO = 2024 AND MESDOCUMENTO = 12
        GROUP BY CODIGOVENDEDOR
        ORDER BY CLIENTS DESC
        FETCH FIRST 10 ROWS ONLY
      `);
            if (result6.length > 0) {
                console.log('Top vendedores by client count:');
                result6.forEach(r => console.log(`  ${r.CODIGOVENDEDOR?.trim()} - ${r.CLIENTS} clients`));
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 7. Check if there's a table with day-of-week scheduling (DOS = Day Of Service?)
        console.log('\n7. LOOKING FOR DOS/DDS/SCHEDULE TABLES...');
        console.log('-'.repeat(50));
        const tableNamesToTry = ['DOS', 'DDS', 'SCH', 'SCHEDULE', 'CALENDARIO', 'CAL', 'HORARIO', 'HOR', 'RUTERO'];
        for (const tbl of tableNamesToTry) {
            try {
                const result = await conn.query(`SELECT * FROM DSEDAC.${tbl} FETCH FIRST 1 ROWS ONLY`);
                console.log(`  ✓ Found DSEDAC.${tbl}:`, Object.keys(result[0] || {}).join(', '));
            } catch (e) {
                // Table doesn't exist, continue
            }
        }
        console.log('  (Other tables not found)');

        // 8. Try LACLAE in DSEDAC
        console.log('\n8. CHECKING FOR LACLAE IN DSEDAC...');
        console.log('-'.repeat(50));
        try {
            const result8 = await conn.query(`
        SELECT * FROM DSEDAC.LACLAE
        FETCH FIRST 3 ROWS ONLY
      `);
            console.log('Found DSEDAC.LACLAE:');
            if (result8.length > 0) {
                console.log('Columns:', Object.keys(result8[0]).join(', '));
            }
        } catch (e) {
            console.log('  LACLAE not found in DSEDAC');
        }

        // 9. Try DSED.LACLAE
        console.log('\n9. CHECKING FOR LACLAE IN DSED...');
        console.log('-'.repeat(50));
        try {
            const result9 = await conn.query(`
        SELECT * FROM DSED.LACLAE
        FETCH FIRST 3 ROWS ONLY
      `);
            console.log('Found DSED.LACLAE:');
            if (result9.length > 0) {
                console.log('Columns:', Object.keys(result9[0]).join(', '));
                result9.forEach((r, i) => {
                    const keys = Object.keys(r).filter(k => k.includes('DIV') || k.includes('DIA'));
                    if (keys.length > 0) {
                        console.log(`  Day fields found: ${keys.join(', ')}`);
                    }
                });
            }
        } catch (e) {
            console.log('  LACLAE not found in DSED');
        }

        // 10. Try DSEMOVIL schema
        console.log('\n10. CHECKING DSEMOVIL SCHEMA FOR SCHEDULE...');
        console.log('-'.repeat(50));
        const movilTables = ['CLI', 'RUT', 'RUTA', 'RUTAS', 'RUTERO', 'SCHEDULE'];
        for (const tbl of movilTables) {
            try {
                const result = await conn.query(`SELECT * FROM DSEMOVIL.${tbl} FETCH FIRST 1 ROWS ONLY`);
                console.log(`  ✓ Found DSEMOVIL.${tbl}:`, Object.keys(result[0] || {}).slice(0, 10).join(', ') + '...');
            } catch (e) {
                // Continue
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
