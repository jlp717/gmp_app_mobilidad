const db = require('./config/db');

async function run() {
    try {
        const res = await db.query(`
            SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TEXT 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND (UPPER(COLUMN_TEXT) LIKE '%REGALO%' OR UPPER(COLUMN_TEXT) LIKE '%PROMOCIO%' OR UPPER(COLUMN_NAME) LIKE '%REGALO%' OR UPPER(COLUMN_NAME) LIKE '%PROMO%')
        `);
        console.log("=== RESULTS ===");
        res.forEach(r => console.log(r.TABLE_NAME + ' | ' + r.COLUMN_NAME + ' | ' + r.COLUMN_TEXT));
        console.log("=== END ===");
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}
run();
