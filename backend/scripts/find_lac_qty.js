const { query, initDb } = require('../config/db');

async function findQty() {
    await initDb();
    const sql = `
        SELECT COLUMN_NAME
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LAC'
        AND (COLUMN_NAME LIKE '%CANT%' OR COLUMN_NAME LIKE '%Q%')
    `;

    try {
        const cols = await query(sql, false);
        console.log('Qty Columns:', cols.map(c => c.COLUMN_NAME));
    } catch (e) {
        console.error(e);
    }
}

findQty();
