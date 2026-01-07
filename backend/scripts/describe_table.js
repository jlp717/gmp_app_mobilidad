const { query, initDb } = require('../config/db');

const tableName = process.argv[2] || 'OBJ_CONFIG';

async function describeTable() {
    try {
        await initDb();
        console.log(`Describing JAVIER.${tableName}...`);
        const rows = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH, COLUMN_TEXT 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = '${tableName}'
            ORDER BY ORDINAL_POSITION
        `);

        if (rows.length === 0) {
            console.log('Table not found or no columns.');
        } else {
            console.table(rows.map(r => ({
                Name: r.COLUMN_NAME,
                Type: r.DATA_TYPE,
                Len: r.LENGTH,
                Text: r.COLUMN_TEXT || ''
            })));
        }
        process.exit(0);
    } catch (err) {
        console.error('Error describing table:', err);
        process.exit(1);
    }
}

describeTable();
