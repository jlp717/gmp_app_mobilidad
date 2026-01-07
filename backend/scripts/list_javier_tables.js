const { query, initDb } = require('../config/db');

async function listTables() {
    try {
        await initDb();
        console.log('Searching for tables in JAVIER schema...');
        const tables = await query(`
            SELECT TABLE_NAME as TABNAME, TABLE_TYPE as TYPE, TABLE_TEXT as REMARKS 
            FROM QSYS2.SYSTABLES 
            WHERE TABLE_SCHEMA = 'JAVIER'
            ORDER BY TABLE_NAME
        `);

        console.log('Tables found:', tables.length);
        tables.forEach(t => console.log(`- ${t.TABNAME} (${t.TYPE}): ${t.REMARKS || ''}`));

        process.exit(0);
    } catch (err) {
        console.error('Error listing tables:', err);
        process.exit(1);
    }
}

listTables();
