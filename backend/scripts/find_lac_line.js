const { query, initDb } = require('../config/db');

async function findLineCol() {
    await initDb();
    const sql = `
        SELECT COLUMN_NAME
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LAC'
    `; // Get all to be sure

    try {
        const cols = await query(sql, false);
        const names = cols.map(c => c.COLUMN_NAME);
        console.log('ALL Columns:', names);

        const candidates = names.filter(n => n.includes('NUM') || n.includes('LIN') || n.includes('SEC'));
        console.log('Line Number Candidates:', candidates);

    } catch (e) {
        console.error(e);
    }
}

findLineCol();
