/**
 * Find Populated DCTFL3 Script
 * Searches specifically for DCTFL3 tables in all schemas and checks if they have data.
 */

const { query, initDb } = require('../config/db');

async function findDctfl3() {
    console.log('='.repeat(60));
    console.log('SEARCHING FOR POPULATED DCTFL3 TABLES');
    console.log('='.repeat(60));

    try {
        await initDb();

        // Find all DCTFL3 tables
        console.log('\n--- Finding DCTFL3 tables ---');
        const tables = await query(`
            SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TEXT
            FROM QSYS2.SYSTABLES 
            WHERE TABLE_NAME = 'DCTFL3'
              AND TABLE_SCHEMA NOT LIKE 'Q%'
        `);

        if (tables.length > 0) {
            console.log(`✅ Found ${tables.length} DCTFL3 tables.`);

            for (const t of tables) {
                const fullName = `${t.TABLE_SCHEMA}.${t.TABLE_NAME}`;
                console.log(`\n--- Checking ${fullName} ---`);

                try {
                    // Check row count (fetch first 1 is faster than count(*))
                    const check = await query(`SELECT 1 FROM ${fullName} FETCH FIRST 1 ROW ONLY`);

                    if (check.length > 0) {
                        console.log(`✅ Table HAS DATA!`);

                        // Check for client
                        console.log(`   Checking for client 10339...`);
                        try {
                            const client = await query(`
                                SELECT * FROM ${fullName} 
                                WHERE T8CDCL LIKE '%10339' 
                                FETCH FIRST 1 ROW ONLY
                             `);
                            if (client.length > 0) {
                                console.log(`🔥 CLIENT FOUND IN ${fullName}!`);
                                console.log('   Data:', JSON.stringify(client[0], null, 2));
                            } else {
                                console.log(`❌ Client NOT found in ${fullName}.`);
                            }
                        } catch (e) {
                            console.log(`   Error querying client: ${e.message}`);
                        }

                    } else {
                        console.log(`   Table is empty.`);
                    }

                } catch (e) {
                    console.log(`   Error accessing: ${e.message}`);
                }
            }
        } else {
            console.log('❌ No DCTFL3 tables found globally.');
        }

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        process.exit(0);
    }
}

findDctfl3();
