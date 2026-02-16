require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');
const fs = require('fs');

async function inspectCacFirmas() {
    try {
        console.log('Inspecting CACFIRMAS...');

        // 1. Get Columns of CACFIRMAS to find the link to Albaran
        const cols = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TEXT 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CACFIRMAS'
        `, false);
        fs.writeFileSync('cacfirmas_cols.json', JSON.stringify(cols, null, 2));

        // 2. Sample Data (without BLOB/CLOB first to avoid partial reads)
        // Check if we can select non-LOB columns
        const nonLobCols = cols.filter(c => c.DATA_TYPE !== 'CLOB' && c.DATA_TYPE !== 'BLOB').map(c => c.COLUMN_NAME).join(', ');

        if (nonLobCols.length > 0) {
            const data = await query(`
                SELECT ${nonLobCols} 
                FROM DSEDAC.CACFIRMAS 
                FETCH FIRST 5 ROWS ONLY
            `, false);
            fs.writeFileSync('cacfirmas_data.json', JSON.stringify(data, null, 2));
        } else {
            console.log('Only LOB columns?');
        }

    } catch (e) {
        console.error(e);
        fs.writeFileSync('cacfirmas_error.txt', e.message);
    }
}

inspectCacFirmas();
