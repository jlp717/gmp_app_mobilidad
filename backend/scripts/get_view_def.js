/**
 * Get View Definition Script
 * Retrieves the SQL definition of DSED.LACLAE to find the source of R1_T8* columns.
 */

const { query, initDb } = require('../config/db');

async function getViewDef() {
    console.log('='.repeat(60));
    console.log('RETRIEVING VIEW DEFINITION: DSED.LACLAE');
    console.log('='.repeat(60));

    try {
        await initDb();

        const viewDef = await query(`
            SELECT VIEW_DEFINITION
            FROM QSYS2.SYSVIEWS 
            WHERE TABLE_NAME = 'LACLAE' 
              AND TABLE_SCHEMA = 'DSED'
        `);

        if (viewDef.length > 0 && viewDef[0].VIEW_DEFINITION) {
            console.log('✅ View Definition Found!');
            const def = viewDef[0].VIEW_DEFINITION;
            const chunkSize = 500;
            for (let i = 0; i < def.length; i += chunkSize) {
                console.log(def.substring(i, i + chunkSize));
            }
        } else {
            console.log('❌ View definition NOT returned (could be null or restricted)');
        }

        // SEARCH FOR SPECIFIC VISIT COLUMNS
        console.log('\n--- Searching SYSCOLUMNS for column ending in DIVL (Día Visita Lunes) ---');
        const cols = await query(`
            SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME 
            FROM QSYS2.SYSCOLUMNS 
            WHERE COLUMN_NAME LIKE '%DIVL'
              AND TABLE_SCHEMA IN ('DSED', 'DSEDAC')
        `);
        if (cols.length > 0) {
            console.log('✅ Found DIVL-like columns in tables:');
            cols.forEach(c => console.log(`   - ${c.TABLE_SCHEMA}.${c.TABLE_NAME} (${c.COLUMN_NAME})`));
        } else {
            console.log('❌ Column %DIVL not found in any table in DSED/DSEDAC');
        }

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        process.exit(0);
    }
}

getViewDef();
