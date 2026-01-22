/**
 * Check View Dependencies Script
 * Queries QSYS2.SYSVIEWDEP to find tables underlying DSED.LACLAE
 */

const { query, initDb } = require('../config/db');

async function checkViewDeps() {
    console.log('='.repeat(60));
    console.log('CHECKING VIEW DEPENDENCIES: DSED.LACLAE');
    console.log('='.repeat(60));

    try {
        await initDb();

        const deps = await query(`
            SELECT OBJECT_SCHEMA, OBJECT_NAME, OBJECT_TYPE, TABLE_SCHEMA, TABLE_NAME
            FROM QSYS2.SYSVIEWDEP 
            WHERE VIEW_SCHEMA = 'DSED' 
              AND VIEW_NAME = 'LACLAE'
        `);

        if (deps.length > 0) {
            console.log(`✅ Found ${deps.length} dependencies:`);
            deps.forEach(d => {
                console.log(`   - ${d.OBJECT_SCHEMA}.${d.OBJECT_NAME} (${d.OBJECT_TYPE})`);
            });

            // Should also check "TABLE_NAME" column if different or used differently
            // but usually OBJECT_NAME is the dependency
        } else {
            console.log('❌ No dependencies found in SYSVIEWDEP');
        }

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        process.exit(0);
    }
}

checkViewDeps();
