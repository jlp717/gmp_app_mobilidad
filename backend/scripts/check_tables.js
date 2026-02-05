require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../config/db');

async function main() {
    console.log(`\n🔍 TABLE DISCOVERY\n`);

    const candidates = ['DSEDAC.FAC', 'DSEDAC.FCL', 'DSEDAC.CFC', 'DSEDAC.CABFAC', 'DSEDAC.FACTURAS', 'DSEDAC.FACC', 'DSEDAC.FACCL'];

    for (const table of candidates) {
        try {
            console.log(`Checking ${table}...`);
            const rows = await query(`SELECT * FROM ${table} FETCH FIRST 1 ROW ONLY`, false);
            console.log(`   ✅ EXISTS! Columns: ${Object.keys(rows[0]).join(', ')}`);
        } catch (e) {
            const msg = e.message.includes('SQL0204') ? 'Not found' : e.message;
            console.log(`   ❌ ${table}: ${msg}`);
        }
    }
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
