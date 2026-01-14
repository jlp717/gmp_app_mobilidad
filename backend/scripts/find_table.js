const { initDb, query } = require('../config/db');

async function runDebug() {
    await initDb();
    try {
        console.log('=== SEARCHING TABLES IN DSEDAC ===');
        const tables = await query(`
            SELECT TABLE_NAME, TABLE_TEXT 
            FROM QSYS2.SYSTABLES 
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND (TABLE_NAME LIKE 'CPL%' OR TABLE_NAME LIKE 'LAL%' OR TABLE_NAME LIKE '%LIN%')
        `);
        console.log('Tables found:', tables);

        // Also try to query CPL directly just in case it exists but I missed it
        try {
            const checkCPL = await query(`SELECT COUNT(*) as CNT FROM DSEDAC.CPL`);
            console.log('DSEDAC.CPL exists, count:', checkCPL);
        } catch (e) { console.log('DSEDAC.CPL access failed'); }

    } catch (err) {
        console.error('Debug Error:', err);
    } finally {
        process.exit();
    }
}

runDebug();
