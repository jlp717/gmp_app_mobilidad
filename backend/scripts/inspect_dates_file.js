require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');
const fs = require('fs');

async function inspectDates() {
    try {
        let output = '';

        // 1. Check Status Counts for Feb 2025
        output += '--- 2025 STATUS COUNTS ---\n';
        const stats = await query(`
            SELECT SITUACIONALBARAN, CONFORMADOSN, COUNT(*) as CNT 
            FROM DSEDAC.CPC 
            WHERE ANODOCUMENTO=2025 AND MESDOCUMENTO=2 
            GROUP BY SITUACIONALBARAN, CONFORMADOSN 
            ORDER BY CNT DESC
        `);
        output += JSON.stringify(stats, null, 2) + '\n\n';

        // 2. Check Dates for "Finished" rows
        output += '--- DATE COMPARISON (Finished) ---\n';
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
        output += JSON.stringify(finished, null, 2) + '\n\n';

        // 3. Check what 'X' looks like in 2026
        output += '--- X STATUS SAMPLES (2026) ---\n';
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
        output += JSON.stringify(xStatus, null, 2) + '\n';

        fs.writeFileSync('debug_output.txt', output);
        console.log('Written to debug_output.txt');

    } catch (e) {
        fs.writeFileSync('debug_output.txt', 'ERROR: ' + e.toString());
    }
}

inspectDates();
