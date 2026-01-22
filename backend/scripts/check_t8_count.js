/**
 * Check T8 Count Script
 * Checks if DSED.T8 or DSEDAC.T8 have data using COUNT(*) to bypass format errors.
 */

const { query, initDb } = require('../config/db');

async function checkT8Count() {
    console.log('='.repeat(60));
    console.log('CHECKING T8 ROW COUNTS');
    console.log('='.repeat(60));

    const candidates = ['DSED.T8', 'DSEDAC.T8', 'DSED.R1T8'];

    try {
        await initDb();

        for (const table of candidates) {
            console.log(`\n--- Checking ${table} ---`);
            try {
                // Try COUNT(*)
                const count = await query(`SELECT COUNT(*) as CNT FROM ${table}`);
                const rows = count[0].CNT;
                console.log(`✅ Table Exists! Rows: ${rows}`);

                if (rows > 0) {
                    // Try selecting valid columns only
                    // We assume T8CDCL, T8CDVD exists based on previous findings/hints
                    console.log(`   Trying to select distinct VENDORS...`);
                    const vendors = await query(`
                        SELECT DISTINCT T8CDVD 
                        FROM ${table} 
                        FETCH FIRST 5 ROWS ONLY
                    `);
                    console.log(`   Vendors found: ${vendors.length}`);
                    vendors.forEach(v => console.log(`   - ${v.T8CDVD}`));

                    // Check for client 10339
                    console.log(`   Checking for client 10339...`);
                    const client = await query(`
                        SELECT T8CDVD, T8CDCL, T8DIVL, T8DIVV 
                        FROM ${table} 
                        WHERE T8CDCL LIKE '%10339'
                        FETCH FIRST 1 ROW ONLY
                    `);

                    if (client.length > 0) {
                        console.log(`🔥 CLIENT FOUND IN ${table}!`);
                        console.log('   Data:', JSON.stringify(client[0], null, 2));
                    } else {
                        console.log(`❌ Client not found in ${table}`);
                    }
                }

            } catch (e) {
                console.log(`❌ Error: ${e.message}`);
                // If table not found...
                if (e.message.includes('not found')) {
                    // ignore
                }
            }
        }

    } catch (error) {
        console.error('Fatal Error:', error.message);
    } finally {
        process.exit(0);
    }
}

checkT8Count();
