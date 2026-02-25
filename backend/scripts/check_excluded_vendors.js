const { getPool, initDb } = require('../config/db');
require('dotenv').config({ path: '../.env' });

async function main() {
    console.log("=== 5. CHECK EXCLUDED VENDORS ===");
    console.log("EXCLUDED_VENDORS en .env:", process.env.EXCLUDED_VENDORS);
    await initDb();
    const conn = await getPool().connect();
    try {
        const excl = process.env.EXCLUDED_VENDORS ? process.env.EXCLUDED_VENDORS.split(',') : [];
        if (excl.length > 0) {
            const inClause = excl.map(v => `'${v}'`).join(',');
            const query = await conn.query(`SELECT TRIM(CVVEND) as VENDEDOR, TRIM(CVOMB) as NOMBRE FROM DSEDAC.CVC WHERE TRIM(CVVEND) IN (${inClause})`);
            console.table(query);
        } else {
            console.log("No excluded vendors found in .env");
        }
    } catch (e) { console.error(e); } finally { await conn.close(); process.exit(0); }
}
main();
