require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');

async function inspectDates() {
    try {
        // 1. Check Status Counts for Feb 2025 (History)
        console.error('--- 2025 STATUS COUNTS ---');
        const stats = await query(`
            SELECT SITUACIONALBARAN, CONFORMADOSN, COUNT(*) as CNT 
            FROM DSEDAC.CPC 
            WHERE ANODOCUMENTO=2025 AND MESDOCUMENTO=2 
            GROUP BY SITUACIONALBARAN, CONFORMADOSN 
            ORDER BY CNT DESC
        `);
        console.error(JSON.stringify(stats, null, 2));

        // 2. Check Dates for "Finished" rows (F/R) vs "Document Date"
        console.error('--- DATE COMPARISON (Finished) ---');
        const finished = await query(`
            SELECT SITUACIONALBARAN, 
                   DIADOCUMENTO, MESDOCUMENTO, 
                   DIAESTADO, MESESTADO, 
                   DIALLEGADA, MESLLEGADA, HORALLEGADA
            FROM DSEDAC.CPC 
            WHERE ANODOCUMENTO=2025 AND MESDOCUMENTO=2 
            AND SITUACIONALBARAN IN ('F', 'R')
            FETCH FIRST 5 ROWS ONLY
        `);
        console.error(JSON.stringify(finished, null, 2));

        // 3. Check what 'X' looks like in 2026
        console.error('--- X STATUS SAMPLES (2026) ---');
        const xStatus = await query(`
            SELECT SITUACIONALBARAN, CONFORMADOSN,
                   DIADOCUMENTO, MESDOCUMENTO,
                   DIAESTADO, MESESTADO,
                   DIALLEGADA, MESLLEGADA, HORALLEGADA
            FROM DSEDAC.CPC 
            WHERE ANODOCUMENTO=2026 AND MESDOCUMENTO=2 
            AND SITUACIONALBARAN = 'X'
            FETCH FIRST 5 ROWS ONLY
        `);
        console.error(JSON.stringify(xStatus, null, 2));

    } catch (e) { console.error(e); }
}

// Redirect formatting
const originalLog = console.log;
console.log = function (...args) {
    console.error(...args);
    originalLog.apply(console, args);
};

inspectDates();
