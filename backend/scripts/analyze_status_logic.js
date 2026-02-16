require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');
const fs = require('fs');

async function analyzeStatuses() {
    try {
        console.log('--- ANALYIS START ---');

        // 2026 Analysis
        const sql2026 = `SELECT CONFORMADOSN, SITUACIONALBARAN, COUNT(*) as CNT FROM DSEDAC.CPC WHERE ANODOCUMENTO=2026 AND MESDOCUMENTO=2 AND DIADOCUMENTO=13 GROUP BY CONFORMADOSN, SITUACIONALBARAN ORDER BY CNT DESC`;
        const active = await query(sql2026);
        console.error('2026 ACTIVE:', JSON.stringify(active, null, 2));

        // 2025 Analysis (Use a known busy day, e.g., 10th feb)
        const sql2025 = `SELECT CONFORMADOSN, SITUACIONALBARAN, COUNT(*) as CNT FROM DSEDAC.CPC WHERE ANODOCUMENTO=2025 AND MESDOCUMENTO=2 AND DIADOCUMENTO=13 GROUP BY CONFORMADOSN, SITUACIONALBARAN ORDER BY CNT DESC`;
        const history = await query(sql2025);
        console.error('2025 HISTORY:', JSON.stringify(history, null, 2));

        // Check distinctive values for "Delivered"
        const deliveredCheck = await query(`
            SELECT DISTINCT SITUACIONALBARAN, CONFORMADOSN 
            FROM DSEDAC.CPC 
            WHERE ANODOCUMENTO=2025 AND MESDOCUMENTO=2
        `);
        console.error('DISTINCT VALUES FEB 2025:', JSON.stringify(deliveredCheck, null, 2));

    } catch (e) {
        console.error('FATAL ERROR:', e);
    }
}

// Redirect stdout to stderr just in case
const originalLog = console.log;
console.log = function (...args) {
    console.error(...args);
    originalLog.apply(console, args);
};

analyzeStatuses();
