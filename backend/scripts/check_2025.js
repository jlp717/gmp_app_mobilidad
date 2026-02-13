require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');

async function check2025() {
    try {
        const sql = `
            SELECT SITUACIONALBARAN, COUNT(*) as CNT
            FROM DSEDAC.CPC 
            WHERE ANODOCUMENTO=2025 AND MESDOCUMENTO=2
            GROUP BY SITUACIONALBARAN
        `;
        const res = await query(sql);
        console.error(JSON.stringify(res, null, 2));
    } catch (e) { console.error(e); }
}
check2025();
