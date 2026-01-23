const { query, initDb } = require('../config/db');

async function listColumns() {
    try {
        await initDb();
        console.log('🔍 Listing columns for DSEDAC.CLI...');
        const cols = await query(`
            SELECT COLUMN_NAME, DATA_TYPE 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_NAME = 'CLI' AND TABLE_SCHEMA = 'DSEDAC'
            ORDER BY COLUMN_NAME
        `);
        console.log(cols.map(c => c.COLUMN_NAME).join(', '));
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}
listColumns();
