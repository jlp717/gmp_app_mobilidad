const { initDb, query } = require('../config/db');

async function runDebug() {
    await initDb();
    try {
        console.log('=== SEARCHING TABLES WITH CODIGOARTICULO ===');
        const tables = await query(`
            SELECT TABLE_NAME, COLUMN_NAME 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND COLUMN_NAME = 'CODIGOARTICULO'
            FETCH FIRST 20 ROWS ONLY
        `);
        console.log('Candidate Tables:', tables);

    } catch (err) {
        console.error('Debug Error:', err);
    } finally {
        process.exit();
    }
}

runDebug();
