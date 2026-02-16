require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');
const fs = require('fs');

async function simpleExplore() {
    try {
        let output = '=== SIMPLE TIME EXPLORATION ===\n\n';

        // Check CVC (Cabecera Ventas Contado) for Time Columns
        const cvcCols = await query(`
            SELECT COLUMN_NAME, COLUMN_TEXT 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CVC'
            AND (COLUMN_NAME LIKE '%HORA%' OR COLUMN_NAME LIKE '%TIME%')
        `);
        output += '--- CVC TIME COLUMNS ---\n';
        output += JSON.stringify(cvcCols, null, 2) + '\n\n';

        // Check recent CVC records linked to CPC to see values
        const data = await query(`
            SELECT 
                CPC.NUMEROALBARAN, 
                CPC.HORALLEGADA as PLAN_TIME,
                CVC.HORACREACION as REAL_TIME_CVC,
                CVC.HORAMODIFICACION as MOD_TIME_CVC,
                CPC.SITUACIONALBARAN
            FROM DSEDAC.CPC CPC
            JOIN DSEDAC.CVC CVC ON 
                CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN AND
                CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN AND
                CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN AND
                CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
            WHERE CPC.ANODOCUMENTO = 2025 AND CPC.MESDOCUMENTO = 2
            AND CPC.SITUACIONALBARAN IN ('F', 'R')
            FETCH FIRST 10 ROWS ONLY
        `, false);

        output += '--- DATA SAMPLE ---\n';
        output += JSON.stringify(data, null, 2);

        fs.writeFileSync('simple_explore_output.txt', output);
        console.log('Done');

    } catch (e) {
        fs.writeFileSync('simple_explore_error.txt', e.message);
        console.error(e);
    }
}

simpleExplore();
