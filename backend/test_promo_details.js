const db = require('./config/db');

async function run() {
    try {
        const res = await db.query(`
            SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TEXT 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME IN (
                 SELECT TABLE_NAME FROM QSYS2.SYSCOLUMNS 
                 WHERE TABLE_SCHEMA = 'DSEDAC' AND (COLUMN_NAME = 'CODIGOPROMOCIONREGALO' OR COLUMN_NAME = 'CODIGOPROMOCION')
              )
              AND (COLUMN_NAME LIKE '%ARTICULO%' OR COLUMN_NAME LIKE '%FAMILIA%' OR COLUMN_NAME LIKE '%MARCA%')
            ORDER BY TABLE_NAME
        `);
        console.log("=== LINK TABLES ===");
        res.forEach(r => console.log(r.TABLE_NAME + ' | ' + r.COLUMN_NAME + ' | ' + r.COLUMN_TEXT));
        console.log("=== END ===");
        process.exit(0);
    } catch(e) { console.error(e); process.exit(1); }
}
run();
