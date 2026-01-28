const { query, initDb } = require('../config/db');

async function checkSchema() {
    try {
        await initDb();
        const rows = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_NAME = 'RUTERO_CONFIG' AND TABLE_SCHEMA = 'JAVIER'
        `);
        console.log(JSON.stringify(rows, null, 2));
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
checkSchema();
