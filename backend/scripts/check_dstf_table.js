/**
 * Check DCTFL3 Structure Script
 * Investigates DSTF.DCTFL3 as the potential source of route data.
 */

const { query, initDb } = require('../config/db');

async function checkDctfl3() {
    console.log('='.repeat(60));
    console.log('CHECKING CANDIDATE TABLE: DSTF.DCTFL3');
    console.log('='.repeat(60));

    try {
        await initDb();

        // 1. Check Columns
        console.log('\n--- Checking Columns of DSTF.DCTFL3 ---');
        const cols = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TEXT
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_NAME = 'DCTFL3'
              AND TABLE_SCHEMA = 'DSTF'
            ORDER BY ORDINAL_POSITION
        `);

        if (cols.length > 0) {
            console.log(`✅ Table exists with ${cols.length} columns.`);
            // Filter likely route columns
            const routeCols = cols.filter(c => c.COLUMN_NAME.includes('DIV') || c.COLUMN_NAME.includes('DIR') || c.COLUMN_NAME.startsWith('T8'));
            if (routeCols.length > 0) {
                console.log('✅ FOUND ROUTE/T8 COLUMNS:');
                routeCols.forEach(c => console.log(`   - ${c.COLUMN_NAME} (${c.DATA_TYPE})`));
            } else {
                console.log('❌ No obvious route columns (DIV/DIR/T8*) found.');
                // Print first 10 columns to see naming convention
                cols.slice(0, 10).forEach(c => console.log(`   - ${c.COLUMN_NAME}`));
            }
        } else {
            console.log('❌ Table DSTF.DCTFL3 not found in SYSCOLUMNS');
        }

        // 2. Check Client 10339 in this table
        console.log('\n--- Checking Client 10339 in DSTF.DCTFL3 ---');
        // We assume T8CDCL is the client code column based on previous search
        try {
            const row = await query(`
                SELECT * 
                FROM DSTF.DCTFL3
                WHERE T8CDCL LIKE '%10339'
                FETCH FIRST 1 ROW ONLY
            `);
            if (row.length > 0) {
                console.log('✅ Client FOUND in DSTF.DCTFL3!');
                console.log('   Data:', JSON.stringify(row[0], null, 2));
            } else {
                console.log('❌ Client NOT found in DSTF.DCTFL3');
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

checkDctfl3();
