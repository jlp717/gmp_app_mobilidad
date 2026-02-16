require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');
const fs = require('fs');

async function listTables() {
    try {
        const sql = `
            SELECT TABLE_NAME, TABLE_TEXT 
            FROM QSYS2.SYSTABLES 
            WHERE TABLE_SCHEMA = 'DSEDAC' 
            AND (TABLE_NAME LIKE '%HIST%' OR TABLE_NAME LIKE '%SITU%' OR TABLE_NAME LIKE '%ESTADO%' OR TABLE_TEXT LIKE '%HIST%')
        `;
        const result = await query(sql, false);
        fs.writeFileSync('dsedac_tables_tracking.json', JSON.stringify(result, null, 2));
        console.log('Done');
    } catch (e) {
        console.error(e);
        fs.writeFileSync('dsedac_tables_error.txt', e.message);
    }
}

listTables();
