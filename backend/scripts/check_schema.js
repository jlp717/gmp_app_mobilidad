require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');

async function checkSchema() {
    try {
        const sql = `
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'DELIVERY_STATUS'
        `;
        const rows = await query(sql, false);
        console.log("=== SCHEMA JAVIER.DELIVERY_STATUS ===");
        console.table(rows);
    } catch (e) {
        console.error("Error checking schema:", e);
    }
}

checkSchema();
