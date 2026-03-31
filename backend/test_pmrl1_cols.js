const db = require('./config/db');

async function run() {
    try {
        const pmrl1 = await db.query(`SELECT * FROM DSEDAC.PMRL1 FETCH FIRST 5 ROWS ONLY`);
        console.log("=== PMRL1 ===");
        console.log(JSON.stringify(pmrl1, null, 2));
        process.exit(0);
    } catch(e) { console.error(e); process.exit(1); }
}
run();
