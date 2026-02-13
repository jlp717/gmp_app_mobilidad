require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');
const fs = require('fs');

async function listCols() {
    try {
        const sql = `
            SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TEXT 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CVC'
            AND (COLUMN_NAME LIKE '%HORA%' OR COLUMN_NAME LIKE '%TIME%' OR COLUMN_TEXT LIKE '%HORA%')
        `;
        const result = await query(sql, false);
        fs.writeFileSync('cvc_cols.json', JSON.stringify(result, null, 2));
        console.log('Done');
    } catch (e) {
        console.error(e);
        fs.writeFileSync('cvc_cols_error.txt', e.message);
    }
}

listCols();
