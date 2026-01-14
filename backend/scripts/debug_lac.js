const { query, initDb } = require('../config/db');

async function debugLac() {
    await initDb();
    console.log('--- DEBUGGING LAC TABLE ---');

    // 1. Check columns
    const columnsSql = `
        SELECT COLUMN_NAME
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LAC'
    `;

    try {
        console.log('Checking columns for DSEDAC.LAC...');
        const cols = await query(columnsSql, false);
        const colNames = cols.map(c => c.COLUMN_NAME);
        console.log('Columns found:', colNames.join(', '));

        // Check for required columns
        const required = ['NUMEROALBARAN', 'EJERCICIOALBARAN', 'NUMEROLINEA', 'CODIGOARTICULO', 'CANTIDADSIRUVIDA'];
        const missing = required.filter(c => !colNames.includes(c));

        if (missing.length > 0) {
            console.warn('⚠️ MISSING COLUMNS:', missing);
            // Search for "DESCRIPCION" variants
            const descCols = colNames.filter(c => c.includes('DESC'));
            console.log('Description candidates:', descCols);
        } else {
            console.log('✅ All key columns present!');
            // Check description specifically
            const descCols = colNames.filter(c => c.includes('DESC'));
            console.log('Description candidates:', descCols);
        }

    } catch (e) {
        console.error('Error checking columns:', e.message);
    }

    // 2. Try SELECT *
    try {
        console.log('\nTesting SELECT * FROM DSEDAC.LAC...');
        const rows = await query('SELECT * FROM DSEDAC.LAC FETCH FIRST 1 ROWS ONLY', false);
        console.log('SELECT * Success. Row keys:', rows.length > 0 ? Object.keys(rows[0]) : 'No rows');
    } catch (e) {
        console.error('❌ SELECT * Failed:', e.message);
    }
}

debugLac();
