/**
 * Global Search Table Script
 * Searches ALL schemas for columns resembling T8 structure.
 * This is a heavy query but necessary since DSED/DSEDAC search failed.
 */

const { query, initDb } = require('../config/db');

async function globalSearch() {
    console.log('='.repeat(60));
    console.log('GLOBAL SEARCH FOR T8 TABLES');
    console.log('='.repeat(60));

    try {
        await initDb();

        // Search for T8CDCL (Client Code in T8 table?)
        console.log('\n--- Searching SYSCOLUMNS for T8CDCL in ALL SCHEMAS ---');
        // Filter out QSYS and system schemas to be faster
        const cols = await query(`
            SELECT TABLE_SCHEMA, TABLE_NAME 
            FROM QSYS2.SYSCOLUMNS 
            WHERE COLUMN_NAME = 'T8CDCL'
              AND TABLE_SCHEMA NOT LIKE 'Q%'
              AND TABLE_SCHEMA NOT LIKE 'SYSIBM%'
              FETCH FIRST 20 ROWS ONLY
        `);

        if (cols.length > 0) {
            console.log(`✅ Found T8CDCL in:`);
            cols.forEach(c => console.log(`   - ${c.TABLE_SCHEMA}.${c.TABLE_NAME}`));
        } else {
            console.log('❌ T8CDCL not found (excluding Q* schemas)');
        }

        // Search for ANY table named T8
        console.log('\n--- Searching SYSTABLES for Table T8 in ALL SCHEMAS ---');
        const tables = await query(`
            SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TEXT
            FROM QSYS2.SYSTABLES 
            WHERE TABLE_NAME = 'T8'
              AND TABLE_SCHEMA NOT LIKE 'Q%'
              AND TABLE_SCHEMA NOT LIKE 'SYSIBM%'
              FETCH FIRST 20 ROWS ONLY
        `);
        if (tables.length > 0) {
            console.log(`✅ Found T8 Tables:`);
            tables.forEach(t => console.log(`   - ${t.TABLE_SCHEMA}.${t.TABLE_NAME} (${t.TABLE_TEXT})`));
        } else {
            console.log('❌ No table named T8 found');
        }

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        process.exit(0);
    }
}

globalSearch();
