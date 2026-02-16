
const { query } = require('../config/db');

async function investigate() {
    try {
        console.log('--- COMPARING TODAY VS YESTERDAY FOR COMPLETION FLAGS ---');

        // 1. Get Today's rows (13/02/2026) - Assumed "En Ruta" or "Planned"
        const todaySql = `
            SELECT * FROM DSEDAC.CPC 
            WHERE ANODOCUMENTO = 2026 AND MESDOCUMENTO = 2 AND DIADOCUMENTO = 13
            FETCH FIRST 3 ROWS ONLY
        `;
        const todayRows = await query(todaySql, false);

        // 2. Get Yesterday's rows (12/02/2026) - Assumed "Entregado"
        const yestSql = `
            SELECT * FROM DSEDAC.CPC 
            WHERE ANODOCUMENTO = 2026 AND MESDOCUMENTO = 2 AND DIADOCUMENTO = 12
            FETCH FIRST 3 ROWS ONLY
        `;
        const yestRows = await query(yestSql, false);

        if (todayRows.length === 0 || yestRows.length === 0) {
            console.log('Not enough data to compare.');
            return;
        }

        // 3. Find columns that are 0/NULL/Empty in Today but Populated in Yesterday
        const keys = Object.keys(todayRows[0]);
        const candidates = [];

        keys.forEach(key => {
            const todayVal = todayRows[0][key];
            const yestVal = yestRows[0][key];

            // Check if Today is "Empty-ish" and Yesterday is "Full-ish"
            const todayEmpty = (todayVal === 0 || todayVal === null || String(todayVal).trim() === '');
            const yestFull = (yestVal !== 0 && yestVal !== null && String(yestVal).trim() !== '');

            if (todayEmpty && yestFull) {
                candidates.push({ key, today: todayVal, yesterday: yestVal });
            }
        });

        console.log('Potential Completion Flags (Empty Today, Full Yesterday):');
        console.table(candidates);

        // Also check if SITUACION or ESTADO columns exist
        const statusCols = keys.filter(k => k.includes('SITU') || k.includes('ESTADO') || k.includes('ST'));
        console.log('\nStatus Columns Check:', statusCols);
        statusCols.forEach(k => {
            console.log(`${k} -> Today: ${todayRows[0][k]}, Yesterday: ${yestRows[0][k]}`);
        });

    } catch (e) {
        console.error('Error:', e);
    }
}

investigate();
