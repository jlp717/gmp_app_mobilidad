const { query, initDb } = require('../config/db');

async function listColumns() {
    try {
        await initDb();
        console.log('🔍 Listing columns for RUTERO_LOG...');
        const cols = await query(`
            SELECT COLUMN_NAME, DATA_TYPE 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_NAME = 'RUTERO_LOG' AND TABLE_SCHEMA = 'JAVIER'
            ORDER BY COLUMN_NAME
        `);
        console.log(cols.map(c => c.COLUMN_NAME).join(', '));
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
listColumns();
