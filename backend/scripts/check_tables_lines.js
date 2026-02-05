require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../config/db');

async function main() {
    console.log(`\n🔍 LINES TABLE DISCOVERY\n`);
    const candidates = ['DSEDAC.LCL', 'DSEDAC.LFCL', 'DSEDAC.LFA', 'DSEDAC.LIN'];
    for (const table of candidates) {
        try {
            console.log(`Checking ${table}...`);
            const rows = await query(`SELECT * FROM ${table} FETCH FIRST 1 ROW ONLY`, false);
            console.log(`   ✅ EXISTS! Columns: ${Object.keys(rows[0]).join(', ')}`);
        } catch (e) {
            console.log(`   ❌ ${table}: ${e.message.split('-')[1] || e.message}`);
        }
    }
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
