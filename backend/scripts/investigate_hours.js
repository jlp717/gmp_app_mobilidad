
const { query } = require('../config/db');

async function investigate() {
    try {
        console.log('--- INVESTIGATING HORALLEGADA ---');

        // Check for "Today" (or most recent active day if today is empty)
        // We look for records with DIALLEGADA > 0
        const sql = `
            SELECT 
                DIAREPARTO, MESREPARTO, ANOREPARTO,
                COUNT(*) as TOTAL_OPS,
                SUM(CASE WHEN DIALLEGADA > 0 THEN 1 ELSE 0 END) as WITH_DATE,
                SUM(CASE WHEN DIALLEGADA > 0 AND HORALLEGADA > 0 THEN 1 ELSE 0 END) as WITH_TIME,
                SUM(CASE WHEN DIALLEGADA > 0 AND HORALLEGADA = 0 THEN 1 ELSE 0 END) as WITH_DATE_NO_TIME,
                MIN(CASE WHEN HORALLEGADA > 0 THEN HORALLEGADA ELSE 999999 END) as MIN_TIME,
                MAX(HORALLEGADA) as MAX_TIME
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            WHERE (ANOREPARTO * 10000 + MESREPARTO * 100 + DIAREPARTO) >= 20260210
            GROUP BY DIAREPARTO, MESREPARTO, ANOREPARTO
            ORDER BY ANOREPARTO DESC, MESREPARTO DESC, DIAREPARTO DESC
        `;

        const rows = await query(sql, false);
        console.log('SUMMARY:', JSON.stringify(rows, null, 2));

        // Detail sample for rows with Date but No Time
        const noTimeSql = `
            SELECT 
                OPP.DIAREPARTO, CPC.NUMEROALBARAN, CPC.DIALLEGADA, CPC.HORALLEGADA
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            WHERE (ANOREPARTO * 10000 + MESREPARTO * 100 + DIAREPARTO) >= 20260210
              AND CPC.DIALLEGADA > 0 
              AND CPC.HORALLEGADA = 0
            FETCH FIRST 5 ROWS ONLY
        `;
        const noTimeRows = await query(noTimeSql, false);
        console.log('\nSample No Time:', JSON.stringify(noTimeRows, null, 2));

    } catch (e) {
        console.error('Error:', e);
    }
}

investigate();
