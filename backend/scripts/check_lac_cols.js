const { query, initDb } = require('../config/db');

async function findCols() {
    await initDb();
    try {
        const cols = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TEXT
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LAC' 
            AND (COLUMN_NAME LIKE '%IMPORTE%' OR COLUMN_NAME LIKE '%PRECIO%' OR COLUMN_NAME LIKE '%TOTAL%')
        `, false);
        console.log('Columns found:', cols.map(c => c.COLUMN_NAME));
    } catch (e) {
        console.error(e);
    }
    process.exit();
}

findCols();
