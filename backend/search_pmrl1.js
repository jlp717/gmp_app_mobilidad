const db = require('./config/db');

async function run() {
    try {
        const resCols = await db.query(`
            SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TEXT 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'PMRL1'
        `);
        console.log("=== COLUMNS PMRL1 ===");
        resCols.forEach(r => console.log(r.COLUMN_NAME + ' | ' + r.COLUMN_TEXT));

        const resData = await db.query(`SELECT * FROM DSEDAC.PMRL1 FETCH FIRST 5 ROWS ONLY`);
        console.log("=== DATA PMRL1 ===");
        console.log(JSON.stringify(resData, null, 2));
        
        // Also check if there's a header table PMR
        const resColsH = await db.query(`
            SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TEXT 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'PMR'
        `);
        console.log("=== COLUMNS PMR ===");
        resColsH.forEach(r => console.log(r.COLUMN_NAME + ' | ' + r.COLUMN_TEXT));
        
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}
run();
