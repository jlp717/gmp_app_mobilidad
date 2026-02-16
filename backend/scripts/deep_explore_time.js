require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');
const fs = require('fs');

async function deepExplore() {
    try {
        let output = '=== DEEP TIME EXPLORATION ===\n\n';

        // 1. Find ALL columns in DSEDAC.CPC that might contain time info
        const cpcCols = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TEXT 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CPC'
            AND (COLUMN_NAME LIKE '%HORA%' 
              OR COLUMN_NAME LIKE '%TIME%' 
              OR COLUMN_NAME LIKE '%FECHA%' 
              OR COLUMN_NAME LIKE '%DATE%'
              OR COLUMN_TEXT LIKE '%HORA%'
              OR COLUMN_TEXT LIKE '%TIME%')
        `);
        output += '--- CPC TIME COLUMNS ---\n';
        output += JSON.stringify(cpcCols, null, 2) + '\n\n';

        // 2. Fetch Sample Data for these columns for "Delivered" items (SITUACIONALBARAN='F' or 'R')
        const colNames = cpcCols.map(c => c.COLUMN_NAME).join(', ');
        const samples = await query(`
            SELECT SITUACIONALBARAN, CONFORMADOSN, ${colNames}
            FROM DSEDAC.CPC
            WHERE ANODOCUMENTO=2025 AND MESDOCUMENTO=2
            AND SITUACIONALBARAN IN ('F', 'R')
            FETCH FIRST 5 ROWS ONLY
        `);
        output += '--- SAMPLE DATA (Status F/R) ---\n';
        output += JSON.stringify(samples, null, 2) + '\n\n';

        // 3. Check CVC (Cabecera Ventas Contado) - often has "Ticket" time
        const cvcCols = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TEXT 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CVC'
            AND (COLUMN_NAME LIKE '%HORA%' OR COLUMN_NAME LIKE '%TIME%')
        `);
        output += '--- CVC TIME COLUMNS ---\n';
        output += JSON.stringify(cvcCols, null, 2) + '\n\n';

        // 4. Join CPC with CVC to see if we can find a "Real Ticket Time"
        output += '--- CPC + CVC JOIN SAMPLE ---\n';
        // A common join for ticket data
        const joinSample = await query(`
            SELECT 
                CPC.NUMEROALBARAN, CPC.HORALLEGADA as PLAN_TIME,
                CVC.HORACREACION as TICKET_TIME,
                CVC.HORAMODIFICACION as MOD_TIME
            FROM DSEDAC.CPC CPC
            JOIN DSEDAC.CVC CVC ON 
                CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN AND
                CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN AND
                CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN AND
                CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
            WHERE CPC.ANODOCUMENTO=2025 AND CPC.MESDOCUMENTO=2
            AND CPC.SITUACIONALBARAN IN ('F', 'R')
            FETCH FIRST 10 ROWS ONLY
        `);
        output += JSON.stringify(joinSample, null, 2) + '\n';

        fs.writeFileSync('deep_explore_output.txt', output);
        console.log('Done. Check deep_explore_output.txt');

    } catch (e) {
        console.error(e);
        fs.writeFileSync('deep_explore_error.txt', e.toString());
    }
}

deepExplore();
