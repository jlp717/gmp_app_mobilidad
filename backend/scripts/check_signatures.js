require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');
const fs = require('fs');

async function checkSignatures() {
    try {
        console.log('Checking JAVIER.DELIVERY_STATUS for signatures...');

        // Count total rows with signature
        const countSql = `SELECT COUNT(*) as TOTAL FROM JAVIER.DELIVERY_STATUS WHERE FIRMA_PATH IS NOT NULL AND FIRMA_PATH <> ''`;
        const countRes = await query(countSql, false);
        console.log('Total Signatures:', countRes[0].TOTAL);

        // Get last 5 signatures
        const recallSql = `
            SELECT ID, STATUS, UPDATED_AT, FIRMA_PATH 
            FROM JAVIER.DELIVERY_STATUS 
            WHERE FIRMA_PATH IS NOT NULL AND FIRMA_PATH <> ''
            ORDER BY UPDATED_AT DESC
            FETCH FIRST 5 ROWS ONLY
        `;
        const rows = await query(recallSql, false);
        console.log('Last 5 Signatures:', JSON.stringify(rows, null, 2));

        fs.writeFileSync('signatures_check.txt', JSON.stringify({ total: countRes[0].TOTAL, samples: rows }, null, 2));

    } catch (e) {
        console.error(e);
        fs.writeFileSync('signatures_error.txt', e.message);
    }
}

checkSignatures();
