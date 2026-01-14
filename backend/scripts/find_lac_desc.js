const { query, initDb } = require('../config/db');

async function findDesc() {
    await initDb();
    const sql = `
        SELECT COLUMN_NAME
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LAC'
        AND COLUMN_NAME LIKE '%DESC%'
    `;

    try {
        const cols = await query(sql, false);
        console.log('Description Columns:', cols.map(c => c.COLUMN_NAME));
    } catch (e) {
        console.error(e);
    }
}

findDesc();
