const { query, initDb } = require('../config/db');

async function debugLal() {
    await initDb();
    console.log('--- DEBUGGING LAL TABLE ---');

    // 1. Check if table DSEDAC.LAL exists and list columns
    const columnsSql = `
        SELECT COLUMN_NAME
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LAL'
    `;

    try {
        console.log('Checking columns for DSEDAC.LAL...');
        const cols = await query(columnsSql, false);
        console.log('Columns found:', cols.map(c => c.COLUMN_NAME).join(', '));
    } catch (e) {
        console.error('Error checking columns:', e.message);
    }

    // 2. Try SELECT * first (proven to work in find_lines?)
    try {
        console.log('\nTesting SELECT * FROM DSEDAC.LAL...');
        const rows = await query('SELECT * FROM DSEDAC.LAL FETCH FIRST 1 ROWS ONLY', false);
        console.log('SELECT * Success. Row keys:', rows.length > 0 ? Object.keys(rows[0]) : 'No rows');
    } catch (e) {
        console.error('❌ SELECT * Failed:', e.message);
    }

    // 3. Try failing query
    const testQuery = `
        SELECT NUMEROLINEA, CODIGOARTICULO
        FROM DSEDAC.LAL
        FETCH FIRST 1 ROWS ONLY
    `;

    try {
        console.log('\nTesting SELECT Specific Cols...');
        const rows = await query(testQuery, false);
        console.log('Specific Cols Success:', rows);
    } catch (e) {
        console.error('❌ Specific Cols Failed:', e.message);
    }
}

debugLal();
