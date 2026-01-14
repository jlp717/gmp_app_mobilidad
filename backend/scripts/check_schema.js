const { query, initDb } = require('../config/db');

async function checkSchema() {
    await initDb();

    // Check FAC (Facturas) table exists and columns
    console.log('=== FAC (Facturas) Columns ===');
    try {
        const facCols = await query(`
            SELECT COLUMN_NAME 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'FAC'
            ORDER BY ORDINAL_POSITION
        `, false);
        console.log(facCols.map(c => c.COLUMN_NAME).join(', '));
    } catch (e) {
        console.log('FAC table not found or error:', e.message);
    }

    // Check CLI for payment condition columns
    console.log('\n=== CLI Payment-Related Columns ===');
    try {
        const cliCols = await query(`
            SELECT COLUMN_NAME 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CLI'
            AND (COLUMN_NAME LIKE '%PAGO%' OR COLUMN_NAME LIKE '%CRED%' OR COLUMN_NAME LIKE '%COBR%' OR COLUMN_NAME LIKE '%FORMA%')
        `, false);
        console.log(cliCols.map(c => c.COLUMN_NAME).join(', '));
    } catch (e) {
        console.log('Error:', e.message);
    }

    // Check FOP (Formas de Pago) table
    console.log('\n=== FOP (Formas de Pago) Columns ===');
    try {
        const fopCols = await query(`
            SELECT COLUMN_NAME 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'FOP'
        `, false);
        console.log(fopCols.map(c => c.COLUMN_NAME).join(', '));
    } catch (e) {
        console.log('FOP table not found');
    }

    // Sample FOP data
    console.log('\n=== Sample Formas de Pago ===');
    try {
        const fopData = await query(`SELECT * FROM DSEDAC.FOP FETCH FIRST 10 ROWS ONLY`, false);
        console.log(JSON.stringify(fopData, null, 2));
    } catch (e) {
        console.log('Error:', e.message);
    }

    process.exit();
}

checkSchema();
