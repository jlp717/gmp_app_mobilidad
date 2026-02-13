require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');

async function debugDeliveryLogic() {
    try {
        console.log('--- COMPARING DATES ---');

        // Check 13/02/2026 (Today)
        const sql2026 = `SELECT count(*) as CNT, SUM(CASE WHEN CONFORMADOSN='S' THEN 1 ELSE 0 END) as S FROM DSEDAC.CPC WHERE ANODOCUMENTO=2026 AND MESDOCUMENTO=2 AND DIADOCUMENTO=13`;
        const res2026 = await query(sql2026);
        console.log('13/02/2026:', res2026[0]);

        // Check 13/02/2025 (Last Year)
        const sql2025 = `SELECT count(*) as CNT, SUM(CASE WHEN CONFORMADOSN='S' THEN 1 ELSE 0 END) as S FROM DSEDAC.CPC WHERE ANODOCUMENTO=2025 AND MESDOCUMENTO=2 AND DIADOCUMENTO=13`;
        const res2025 = await query(sql2025);
        console.log('13/02/2025:', res2025[0]);

        // Check columns that might indicate delivery time or status
        // Looking at the user's snippet, we have:
        // HORALLEGADA (Arrival Time?) - likely Planned
        // HORACREACION (Creation Time)
        // SITUACIONALBARAN
        // ESTADOORDENPREPARACION

        console.log('\n--- SAMPLE ROW ANALYSIS (2025 DATA for richness) ---');
        const sampleSql = `
            SELECT 
                NUMEROALBARAN, HORADOCUMENTO, HORALLEGADA, HORACREACION, 
                CONFORMADOSN, SITUACIONALBARAN, ESTADOORDENPREPARACION,
                SITUACIONCARGA, SITUACIONPEDIDO, ENVIADOSN
            FROM DSEDAC.CPC 
            WHERE ANODOCUMENTO=2025 AND MESDOCUMENTO=2 AND DIADOCUMENTO=13
            FETCH FIRST 5 ROWS ONLY
        `;
        const samples = await query(sampleSql);
        console.log(samples);

    } catch (e) {
        console.error(e);
    }
}
// Wrap log to ensure output
const originalLog = console.log;
console.log = function (...args) {
    console.error(...args); // Force to stderr to see in tool output
    originalLog.apply(console, args);
};
debugDeliveryLogic();
