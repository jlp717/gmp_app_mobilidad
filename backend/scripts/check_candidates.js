/**
 * Check All Candidate Tables Script
 * Checks all tables found in global search for the client.
 */

const { query, initDb } = require('../config/db');

async function checkCandidates() {
    console.log('='.repeat(60));
    console.log('CHECKING ALL CANDIDATE T8 TABLES');
    console.log('='.repeat(60));

    const candidates = [
        'DSTF.DCTFL3',
        'DSEF.DCTFL3',
        'DSEF.DCTFL6',
        'WTAF.DCTFL3',
        // Add variations if needed
    ];

    const patterns = ['%10339', '010339', '4300010339'];

    try {
        await initDb();

        for (const table of candidates) {
            console.log(`\n--- Checking ${table} ---`);
            try {
                // Check if table exists/accessible first by counting general rows
                try {
                    const count = await query(`SELECT COUNT(*) as CNT FROM ${table}`);
                    console.log(`   Table exists (${count[0].CNT} rows).`);
                } catch (e) {
                    console.log(`   Table not accessible or empty: ${e.message}`);
                    continue;
                }

                // Check for client with different patterns
                // We use regex or multiple ORs cause parameter binding might be tricky with LIKE
                const q = `
                    SELECT * FROM ${table} 
                    WHERE T8CDCL LIKE '%10339'
                    FETCH FIRST 1 ROW ONLY
                `;

                const res = await query(q);

                if (res.length > 0) {
                    console.log(`✅ FOUND in ${table}!`);
                    console.log('   Data:', JSON.stringify(res[0], null, 2));
                    // Highlight schema
                    console.log(`   !!! USE SCHEMA: ${table.split('.')[0]} !!!`);
                    break; // Stop if found? OR continue to see duplicates? Let's stop for now.
                } else {
                    console.log(`❌ Client not found in ${table}`);
                }

            } catch (e) {
                console.log(`   Error querying ${table}: ${e.message}`);
            }
        }

    } catch (error) {
        console.error('Fatal Error:', error.message);
    } finally {
        process.exit(0);
    }
}

checkCandidates();
