const path = require('path');
const dotenv = require('dotenv');

// Load env explicitly
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Require db config (which uses process.env)
const { initDb, query } = require('../../config/db');

async function checkColumns() {
    try {
        await initDb();
        console.log('DB Initialized via db.js');

        // Check columns of CAC
        const sql = `SELECT * FROM DSEDAC.CAC FETCH FIRST 1 ROWS ONLY`;
        const result = await query(sql, false); // false = don't log query keys

        if (result.length > 0) {
            console.log('COLUMNS FOUND IN DSEDAC.CAC:');
            console.log(Object.keys(result[0]).join(', '));
        } else {
            console.log('No rows in DSEDAC.CAC, cannot infer columns.');

            // Fallback: Try to query sys tables or just guess? 
            // Querying syscolumns if available?
            // SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE TABLE_NAME = 'CAC' AND TABLE_SCHEMA = 'DSEDAC'

            const sysSql = `SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE TABLE_NAME = 'CAC' AND TABLE_SCHEMA = 'DSEDAC'`;
            try {
                const sysResult = await query(sysSql, false);
                if (sysResult.length > 0) {
                    console.log('COLUMNS FROM CATALOG:');
                    console.log(sysResult.map(r => r.COLUMN_NAME).join(', '));
                }
            } catch (e) {
                console.log('Catalog query failed too.');
            }
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkColumns();
