require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');

async function checkTodayDeep() {
    try {
        const today = new Date(); // It is 13/02/2026 based on user context
        const y = 2026;
        const m = 2;
        const d = 13;

        console.log(`--- ANALISIS PROFUNDO PARA ${y}-${m}-${d} ---`);
        console.log(`Hora actual sistema: ${new Date().toLocaleTimeString()}`);

        // 1. General Summary
        const summarySql = `
            SELECT 
                COUNT(*) as TOTAL_DOCS,
                SUM(CASE WHEN CONFORMADOSN = 'S' THEN 1 ELSE 0 END) as CONFIRMADOS_S,
                SUM(CASE WHEN CONFORMADOSN = 'N' OR CONFORMADOSN IS NULL THEN 1 ELSE 0 END) as NO_CONFIRMADOS,
                SUM(CASE WHEN DIALLEGADA > 0 THEN 1 ELSE 0 END) as CON_DIALLEGADA,
                MIN(HORALLEGADA) as MIN_HORA,
                MAX(HORALLEGADA) as MAX_HORA
            FROM DSEDAC.CPC
            WHERE ANODOCUMENTO = ${y} AND MESDOCUMENTO = ${m} AND DIADOCUMENTO = ${d}
        `;

        const summary = await query(summarySql);
        console.log('\nRESUMEN GLOBAL:', summary[0]);

        // 2. Detailed list of "Should have been delivered" (Hora < 100000 approx)
        // Check docs with Planned Time < 10:00 (since it is 9:46)
        console.log('\n--- DOCUMENTOS CON HORA PREVISTA ANTERIOR A LAS 10:00 ---');

        const detailSql = `
            SELECT 
                NUMEROALBARAN, 
                CODIGOREPARTIDOR, 
                HORALLEGADA, 
                CONFORMADOSN,
                DIALLEGADA
            FROM DSEDAC.CPC
            WHERE ANODOCUMENTO = ${y} AND MESDOCUMENTO = ${m} AND DIADOCUMENTO = ${d}
              AND HORALLEGADA > 0 
              AND HORALLEGADA < 100000 
            ORDER BY HORALLEGADA ASC
            FETCH FIRST 15 ROWS ONLY
        `;

        const details = await query(detailSql);

        if (details.length === 0) {
            console.log("No hay documentos con hora prevista anterior a las 10:00 AM.");
        } else {
            console.log("ALBARAN | REP | HORA   | CONFIRMADO (S/N) | DIA LLEGADA");
            console.log("-------------------------------------------------------");
            details.forEach(r => {
                const horaStr = String(r.HORALLEGADA).padStart(6, '0');
                const horaFmt = `${horaStr.substring(0, 2)}:${horaStr.substring(2, 4)}`;
                console.log(`${String(r.NUMEROALBARAN).padEnd(7)} | ${String(r.CODIGOREPARTIDOR).padEnd(3)} | ${horaFmt}  | ${r.CONFORMADOSN || 'N'}                | ${r.DIALLEGADA}`);
            });
        }

        // 3. Check App Status (JAVIER.DELIVERY_STATUS)
        console.log('\n--- ESTADO EN APP (JAVIER.DELIVERY_STATUS) ---');

        // We need to construct IDs or join. Let's just dump summary of today's updates
        const appSql = `
            SELECT STATUS, COUNT(*) as CNT, MIN(UPDATED_AT) as FIRST_UPD, MAX(UPDATED_AT) as LAST_UPD
            FROM JAVIER.DELIVERY_STATUS
            WHERE UPDATED_AT >= '2026-02-13 00:00:00'
            GROUP BY STATUS
        `;
        const appStats = await query(appSql);
        console.log(appStats);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkTodayDeep();
