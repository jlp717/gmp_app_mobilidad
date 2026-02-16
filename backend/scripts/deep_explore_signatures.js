require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');
const fs = require('fs');

async function exploreSignatures() {
    try {
        console.log('Starting Deep Exploration for Signatures...');
        let output = '=== DEEP SIGNATURE EXPLORATION ===\n\n';

        // 1. Search ALL columns in DSEDAC for "FIRMA", "SIGN", "IMG", "JPG", "PDF"
        const sqlCols = `
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TEXT 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' 
            AND (
                COLUMN_NAME LIKE '%FIRMA%' OR 
                COLUMN_TEXT LIKE '%FIRMA%' OR 
                COLUMN_NAME LIKE '%SIGN%' OR
                COLUMN_TEXT LIKE '%SIGN%' OR
                COLUMN_NAME LIKE '%IMG%' OR
                COLUMN_NAME LIKE '%FOTO%'
            )
            ORDER BY TABLE_NAME
        `;
        const cols = await query(sqlCols, false);
        output += `--- FOUND ${cols.length} POTENTIAL COLUMNS ---\n`;
        output += JSON.stringify(cols, null, 2) + '\n\n';

        // 2. Search ALL tables for "FIRMA", "IMG", "DOC"
        const sqlTables = `
            SELECT TABLE_NAME, TABLE_TEXT 
            FROM QSYS2.SYSTABLES 
            WHERE TABLE_SCHEMA = 'DSEDAC' 
            AND (
                TABLE_NAME LIKE '%FIRMA%' OR 
                TABLE_TEXT LIKE '%FIRMA%' OR 
                TABLE_NAME LIKE '%IMG%' OR
                TABLE_NAME LIKE '%DOC%'
            )
        `;
        const tables = await query(sqlTables, false);
        output += `--- FOUND ${tables.length} POTENTIAL TABLES ---\n`;
        output += JSON.stringify(tables, null, 2) + '\n\n';

        fs.writeFileSync('deep_signatures_output.txt', output);
        console.log('Done. Check deep_signatures_output.txt');

    } catch (e) {
        console.error(e);
        fs.writeFileSync('deep_signatures_error.txt', e.message);
    }
}

exploreSignatures();
