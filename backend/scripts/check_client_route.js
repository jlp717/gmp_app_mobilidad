/**
 * Check Client Route Script (V2)
 * Investigates where the route data is stored for a specific client.
 * Usage: node scripts/check_client_route.js
 */

const { query, initDb } = require('../config/db');

async function checkClientRoute() {
    const CLIENT_PATTERN = '%10339'; // Searching for client ending in 10339

    console.log('='.repeat(60));
    console.log(`INVESTIGATING ROUTE DATA FOR CLIENT PATTERN: ${CLIENT_PATTERN}`);
    console.log('='.repeat(60));

    try {
        await initDb();

        // 0. Search for T8 tables in SYSTABLES
        console.log('\n--- 0. Searching for T8 tables in System Catalog ---');
        try {
            // AS400/iSeries specific system catalog
            const tables = await query(`
                SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TEXT
                FROM QSYS2.SYSTABLES 
                WHERE TABLE_NAME LIKE '%T8%' 
                  AND TABLE_SCHEMA IN ('DSED', 'DSEDAC')
            `);
            if (tables.length > 0) {
                console.log(`✅ Found ${tables.length} potential T8 tables:`);
                tables.forEach(t => console.log(`   - ${t.TABLE_SCHEMA}.${t.TABLE_NAME} (${t.TABLE_TEXT || 'No Desc'})`));
            } else {
                console.log('❌ No tables matching %T8% found in DSED/DSEDAC');
            }
        } catch (e) {
            console.error('Error querying SYSTABLES:', e.message);
        }

        // 1. Check DSEDAC.CLI (Known good)
        console.log('\n--- 1. Checking DSEDAC.CLI (Known good) ---');
        try {
            const cli = await query(`
                SELECT *
                FROM DSEDAC.CLI 
                WHERE CODIGOCLIENTE LIKE '${CLIENT_PATTERN}'
                FETCH FIRST 1 ROW ONLY
            `);
            if (cli.length > 0) {
                const c = cli[0];
                console.log(`✅ Found client in CLI: ${c.CODIGOCLIENTE} - ${c.NOMBRECLIENTE}`);
                // Check if any route info is in CLI directly
                const routeKeys = Object.keys(c).filter(k => k.includes('DIV') || k.includes('DIR'));
                if (routeKeys.length > 0) {
                    console.log('   Possible Route Columns in CLI:', routeKeys.join(', '));
                    routeKeys.forEach(k => console.log(`   ${k}: ${c[k]}`));
                } else {
                    console.log('   No obvious route columns (DIV/DIR) in CLI.');
                }
            } else {
                console.log('❌ Client NOT found in DSEDAC.CLI');
            }
        } catch (e) {
            console.error('Error checking CLI:', e.message);
        }

        // 2. Check DSED.LACLAE
        console.log('\n--- 2. Checking DSED.LACLAE ---');
        try {
            const lac = await query(`
                SELECT *
                FROM DSED.LACLAE 
                WHERE LCCDCL LIKE '${CLIENT_PATTERN}'
                FETCH FIRST 1 ROW ONLY
            `);
            if (lac.length > 0) {
                console.log(`✅ Found record in LACLAE.`);
            } else {
                console.log('❌ Client NOT found in DSED.LACLAE');
            }
        } catch (e) {
            console.error('Error checking LACLAE:', e.message);
        }

        // 3. Check specific tables if found or guessed
        const tablesToCheck = [
            'DSED.T8',
            'DSEDAC.T8',
            'DSED.R1T8'
        ];

        for (const tableName of tablesToCheck) {
            console.log(`\n--- 3. Checking ${tableName} ---`);
            try {
                const t8 = await query(`
                    SELECT * FROM ${tableName} 
                    WHERE T8CDCL LIKE '${CLIENT_PATTERN}' 
                    FETCH FIRST 1 ROW ONLY
                `);

                if (t8.length > 0) {
                    console.log(`✅ FOUND in ${tableName}!`);
                    const record = t8[0];
                    console.log('   Data:', JSON.stringify(record, null, 2));
                } else {
                    console.log(`❌ No record found in ${tableName}.`);
                }
            } catch (e) {
                console.log(`⚠️  Error querying ${tableName}: ${e.message}`);
            }
        }

    } catch (error) {
        console.error('Fatal Error:', error.message);
    } finally {
        process.exit(0);
    }
}

checkClientRoute();
