const { query, initDb } = require('../config/db');

async function inspectColumns() {
    try {
        await initDb();

        // 1. Get one row to see all column names (keys)
        const row = await query(`SELECT * FROM DSEDAC.LAC FETCH FIRST 1 ROWS ONLY`);

        console.log('🔍 Columns in DSEDAC.LAC:');
        if (row.length > 0) {
            console.log(Object.keys(row[0]).join(', '));
        } else {
            console.log('No rows found.');
        }

        // 2. Check for potential "Type" columns distribution in 2025
        // Looking for columns that might distinguish "LAC" (Albaranes) from others.
        // Common candidates: TIPO, DOC, SERIE (already checked), TIPO_DOC, etc.
        const year = 2025;

        // Let's check distinct values of some potential columns if found (or guessed based on common naming)
        // I'll grab distinct values of TIPOVENTA just to be sure

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

inspectColumns();
