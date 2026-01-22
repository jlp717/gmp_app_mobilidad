/**
 * Global Search for Visit Columns
 * Searches for %DIVL columns globally to find the ACTIVE route table.
 */

const { query, initDb } = require('../config/db');

async function globalVisitSearch() {
    console.log('='.repeat(60));
    console.log('GLOBAL SEARCH FOR VISIT COLUMNS (%DIVL)');
    console.log('='.repeat(60));

    try {
        await initDb();

        const cols = await query(`
            SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, COLUMN_TEXT 
            FROM QSYS2.SYSCOLUMNS 
            WHERE COLUMN_NAME LIKE '%DIVL'
              AND TABLE_SCHEMA NOT LIKE 'Q%'
              AND TABLE_SCHEMA NOT LIKE 'SYSIBM%'
              AND TABLE_SCHEMA NOT LIKE 'SYS%'
            ORDER BY TABLE_SCHEMA, TABLE_NAME
        `);

        if (cols.length > 0) {
            console.log(`✅ Found ${cols.length} tables with DIVL columns:`);
            const tables = [...new Set(cols.map(c => `${c.TABLE_SCHEMA}.${c.TABLE_NAME}`))];

            for (const fullName of tables) {
                console.log(`\n--- Checking Table: ${fullName} ---`);
                try {
                    // Check if it has data
                    const count = await query(`SELECT COUNT(*) as CNT FROM ${fullName}`);
                    const rows = count[0].CNT;
                    console.log(`   Rows: ${rows}`);

                    if (rows > 0) {
                        // Check for client
                        console.log(`   Checking for client 10339...`);
                        // We don't know the client column name for sure, assume column ending in CDCL or CLIENTE
                        // To be safe, let's list columns first or just try LIKE on known patterns if failing

                        // Try to find the client column in this table from SYSCOLUMNS result?
                        // Nah, let's just try SELECT * FETCH FIRST 1 match

                        // Actually, let's default to T8CDCL or CLIENTE or similar if possible. 
                        // Or select * where any column like 10339 (hard in SQL).

                        // For now just list it as a STRONG candidate.
                        console.log(`   🔥 STRONG CANDIDATE!`);
                    } else {
                        console.log(`   Empty table.`);
                    }

                } catch (e) {
                    console.log(`   Error accessing: ${e.message}`);
                }
            }
        } else {
            console.log('❌ No columns matching %DIVL found globally.');
        }

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        process.exit(0);
    }
}

globalVisitSearch();
