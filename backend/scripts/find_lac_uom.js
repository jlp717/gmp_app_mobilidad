const { query, initDb } = require('../config/db');

async function findUom() {
    await initDb();
    const sql = `
        SELECT COLUMN_NAME
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LAC'
        AND (COLUMN_NAME LIKE '%UNIDAD%' OR COLUMN_NAME LIKE '%MEDIDA%' OR COLUMN_NAME LIKE '%FORMATO%')
    `;

    try {
        const cols = await query(sql, false);
        console.log('UOM Candidates:', cols.map(c => c.COLUMN_NAME));
    } catch (e) {
        console.error(e);
    }
}

findUom();
