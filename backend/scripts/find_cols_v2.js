const { query, initDb } = require('../config/db');

async function findCols() {
    await initDb();

    // Check Header for Invoice info
    const headerCols = await query(`
        SELECT COLUMN_NAME 
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CAC' 
        AND (COLUMN_NAME LIKE '%FACTURA%' OR COLUMN_NAME LIKE '%SERIEFACTURA%')
    `, false);
    console.log('Header (CAC) Invoice Candidates:', headerCols.map(c => c.COLUMN_NAME));

    // Check Lines for Price info
    const lineCols = await query(`
        SELECT COLUMN_NAME 
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LAC' 
        AND (COLUMN_NAME LIKE '%PRECIO%' OR COLUMN_NAME LIKE '%IMPORTE%')
    `, false);
    console.log('Lines (LAC) Price Candidates:', lineCols.map(c => c.COLUMN_NAME));
}

findCols();
