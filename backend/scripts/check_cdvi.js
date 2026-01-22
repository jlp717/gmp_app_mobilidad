/**
 * Check CDVI Script
 * Investigates DSEDAC.CDVI as the source of visit days.
 */

const { query, initDb } = require('../config/db');

async function checkCdvi() {
    console.log('='.repeat(60));
    console.log('CHECKING DSEDAC.CDVI (Suspected Visit Table)');
    console.log('='.repeat(60));

    try {
        await initDb();

        // 1. Check Columns
        console.log('\n--- Checking Columns ---');
        const cols = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TEXT
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_NAME = 'CDVI'
              AND TABLE_SCHEMA = 'DSEDAC'
        `);

        if (cols.length > 0) {
            console.log(`✅ Table exists with ${cols.length} columns.`);
            cols.forEach(c => console.log(`   - ${c.COLUMN_NAME} (${c.DATA_TYPE}) - ${c.COLUMN_TEXT || ''}`));
        } else {
            console.log('❌ DSEDAC.CDVI not found in SYSCOLUMNS');
        }

        // 2. Check Client
        console.log('\n--- Checking Client 10339 ---');
        try {
            // Need to guess client column from above list, but if I run this script I won't see output until it finishes.
            // I'll grab ALL columns for the client if I can find a column like '%CDCL' or '%CL%'.
            // Actually, I'll just select * WHERE a generic text search matches, or assume T8CDCL based on previous patterns?
            // "CDVI" probably uses `VICDCL` or `CDCDCL`?
            // Let's rely on the first part output to know column names for next step, BUT to be fast:
            // I will assume standard prefix + CDCL.

            // Or better: List all data for 1 row to see valid column names/values
            console.log('   Sample row:');
            const sample = await query(`SELECT * FROM DSEDAC.CDVI FETCH FIRST 1 ROW ONLY`);
            if (sample.length > 0) {
                console.log(JSON.stringify(sample[sample.length - 1], null, 2));

                // Now I can guess specific query
                const keys = Object.keys(sample[0]);
                const clientCol = keys.find(k => k.endsWith('CDCL') || k.includes('CLIENTE'));

                if (clientCol) {
                    console.log(`   Using client column: ${clientCol}`);
                    const client = await query(`
                        SELECT * FROM DSEDAC.CDVI 
                        WHERE ${clientCol} LIKE '%10339'
                    `);
                    if (client.length > 0) {
                        console.log(`🔥 CLIENT FOUND IN CDVI!`);
                        console.log(JSON.stringify(client[0], null, 2));
                    } else {
                        console.log('❌ Client not found in CDVI');
                    }
                }
            } else {
                console.log('   Table is empty.');
            }

        } catch (e) {
            console.error('Error querying data:', e.message);
        }

    } catch (error) {
        console.error('Fatal Error:', error.message);
    } finally {
        process.exit(0);
    }
}

checkCdvi();
