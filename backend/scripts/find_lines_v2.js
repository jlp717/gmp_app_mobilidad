const { query, initDb } = require('../config/db');

async function findTable() {
    await initDb();
    try {
        console.log('Searching for tables with NUMEROALBARAN and CODIGOARTICULO...');

        const sql = `
            SELECT TABLE_SCHEMA, TABLE_NAME
            FROM QSYS2.SYSCOLUMNS C1
            WHERE C1.COLUMN_NAME = 'NUMEROALBARAN'
            AND EXISTS (
                SELECT 1 FROM QSYS2.SYSCOLUMNS C2
                WHERE C2.TABLE_SCHEMA = C1.TABLE_SCHEMA
                AND C2.TABLE_NAME = C1.TABLE_NAME
                AND C2.COLUMN_NAME = 'CODIGOARTICULO'
            )
            AND C1.TABLE_SCHEMA = 'DSEDAC'
            FETCH FIRST 20 ROWS ONLY
        `;

        const rows = await query(sql, false);
        console.log('Found tables:', rows);

        if (rows.length > 0) {
            const table = rows[0].TABLE_NAME;
            console.log(`Checking content of ${table}...`);
            const checkSql = `SELECT * FROM DSEDAC.${table} FETCH FIRST 5 ROWS ONLY`;
            const content = await query(checkSql, false);
            console.log('Content:', content);
        }

    } catch (e) {
        console.error('Error:', e);
    }
}

findTable();
