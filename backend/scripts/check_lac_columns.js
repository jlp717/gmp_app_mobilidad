require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../config/db');

async function main() {
    console.log(`\n🔍 LAC COLUMNS DISCOVERY\n`);
    try {
        const rows = await query(`SELECT * FROM DSEDAC.LAC FETCH FIRST 1 ROW ONLY`, false);
        console.log(`Columns: ${Object.keys(rows[0]).sort().join(', ')}`);
    } catch (e) {
        console.log(`Error: ${e.message}`);
    }
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
