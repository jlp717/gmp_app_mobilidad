const { initDb, query } = require('../config/db');
require('dotenv').config();

async function run() {
    await initDb();
    try {
        console.log('Checking VDC columns...');
        const vdc = await query("SELECT * FROM DSEDAC.VDC FETCH FIRST 1 ROWS ONLY");
        console.log('VDC Keys:', Object.keys(vdc[0]));

        console.log('Checking VDD columns...'); // Try VDD which often holds Descriptions/Names
        const vdd = await query("SELECT * FROM DSEDAC.VDD FETCH FIRST 1 ROWS ONLY");
        if (vdd.length > 0) console.log('VDD Keys:', Object.keys(vdd[0]));

    } catch (e) {
        console.error(e.message);
    }
    process.exit(0);
}
run();
