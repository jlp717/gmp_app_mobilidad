const { initDb, query } = require('../../config/db');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

async function listCols() {
    try {
        await initDb();
        const rows = await query(`SELECT * FROM DSEDAC.CAC FETCH FIRST 1 ROWS ONLY`, false);
        if (rows.length > 0) {
            console.log('--- COLUMNS START ---');
            console.log(Object.keys(rows[0]).join(', '));
            console.log('--- COLUMNS END ---');
        } else {
            console.log('No rows found.');
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
listCols();
