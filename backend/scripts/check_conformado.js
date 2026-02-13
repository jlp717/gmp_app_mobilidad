require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');
const fs = require('fs');

async function checkConformadoUpdate() {
    try {
        // Check if there are any updates to 'S' during typical working hours (8am - 6pm)
        // This is tricky as we don't have update timestamp on CPC.
        // But we can check if there are any today?
        const sql = `
            SELECT COUNT(*) as COUNT
            FROM DSEDAC.CPC 
            WHERE CONFORMADOSN = 'S'
            AND ANODOCUMENTO = 2025 AND MESDOCUMENTO = 2 AND DIADOCUMENTO = 13
        `;
        const result = await query(sql, false);
        console.log('CONFORMADO TODAY:', result);

        fs.writeFileSync('conformado_check.txt', JSON.stringify(result, null, 2));
    } catch (e) {
        console.error(e);
        fs.writeFileSync('conformado_error.txt', e.message);
    }
}

checkConformadoUpdate();
