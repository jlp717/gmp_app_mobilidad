const { initDb, query } = require('../../config/db');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

async function listValues() {
    try {
        await initDb();
        const rows = await query(`SELECT * FROM DSEDAC.CAC FETCH FIRST 1 ROWS ONLY`, false);
        if (rows.length > 0) {
            const row = rows[0];
            console.log('--- VALUES START ---');
            for (const [key, value] of Object.entries(row)) {
                console.log(`${key}: ${typeof value} (${value})`);
            }
            console.log('--- VALUES END ---');
        } else {
            console.log('No rows found.');
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
listValues();
