const { query, initDb } = require('../config/db');

async function findCols() {
    await initDb();
    try {
        const cols = await query(`
            SELECT COLUMN_NAME 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LAC'
        `, false);
        console.log('Columns in LAC:', cols.map(c => c.COLUMN_NAME).join(', '));

        const cols2 = await query(`
            SELECT COLUMN_NAME 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CAC'
        `, false);
        console.log('Columns in CAC:', cols2.map(c => c.COLUMN_NAME).join(', '));

    } catch (e) {
        console.error(e);
    }
    process.exit();
}

findCols();
