require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');
const fs = require('fs');

async function listCpcCols() {
    try {
        const sql = `
            SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TEXT 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CPC'
            AND (COLUMN_NAME LIKE '%HORA%' OR COLUMN_NAME LIKE '%TIME%' OR COLUMN_TEXT LIKE '%HORA%')
        `;
        const result = await query(sql, false);
        fs.writeFileSync('cpc_cols.json', JSON.stringify(result, null, 2));
        console.log('Done');
    } catch (e) {
        console.error(e);
        fs.writeFileSync('cpc_cols_error.txt', e.message);
    }
}

listCpcCols();
