/**
 * Check T8 Columns Script
 * Verify if table T8 exists and what columns it has.
 */

const { query, initDb } = require('../config/db');

async function checkT8() {
    console.log('='.repeat(60));
    console.log('CHECKING TABLE T8 STRUCTURE');
    console.log('='.repeat(60));

    try {
        await initDb();

        // Check explicit table T8
        console.log('\n--- Searching SYSCOLUMNS for TABLE_NAME = T8 ---');
        const cols = await query(`
            SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TEXT
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_NAME = 'T8'
              AND TABLE_SCHEMA IN ('DSED', 'DSEDAC')
            ORDER BY ORDINAL_POSITION
        `);

        if (cols.length > 0) {
            console.log(`✅ Found T8 table with ${cols.length} columns!`);
            console.log('   Schema:', cols[0].TABLE_SCHEMA);
            console.log('   Columns snippet:');
            cols.slice(0, 20).forEach(c => console.log(`   - ${c.COLUMN_NAME} (${c.DATA_TYPE}) - ${c.COLUMN_TEXT || ''}`));
        } else {
            console.log('❌ Table T8 not found in DSED/DSEDAC schemas via SYSCOLUMNS');
        }

        // Search for tables starting with T8 just in case
        console.log('\n--- Searching SYSTABLES for TABLE_NAME LIKE T8% ---');
        const tables = await query(`
            SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TEXT
            FROM QSYS2.SYSTABLES 
            WHERE TABLE_NAME LIKE 'T8%'
              AND TABLE_SCHEMA IN ('DSED', 'DSEDAC')
        `);
        if (tables.length > 0) {
            console.log(`✅ Found potential T8 variants:`);
            tables.forEach(t => console.log(`   - ${t.TABLE_SCHEMA}.${t.TABLE_NAME} (${t.TABLE_TEXT})`));
        } else {
            console.log('❌ No tables starting with T8 found');
        }

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        process.exit(0);
    }
}

checkT8();
