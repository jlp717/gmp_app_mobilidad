const db = require('./config/db');

async function run() {
    try {
        const pabl1 = await db.query(`SELECT * FROM DSEDAC.PABL1 FETCH FIRST 5 ROWS ONLY`);
        console.log("=== PABL1 ===");
        console.log(JSON.stringify(pabl1, null, 2));

        const pmpl1 = await db.query(`SELECT * FROM DSEDAC.PMPL1 FETCH FIRST 5 ROWS ONLY`);
        console.log("=== PMPL1 ===");
        console.log(JSON.stringify(pmpl1, null, 2));
        
        const cpesl1 = await db.query(`SELECT * FROM DSEDAC.CPESL1 FETCH FIRST 5 ROWS ONLY`);
        console.log("=== CPESL1 ===");
        console.log(JSON.stringify(cpesl1, null, 2));

        process.exit(0);
    } catch(e) { console.error(e); process.exit(1); }
}
run();
