require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');
const fs = require('fs');

async function compareCounts() {
    try {
        const sqlTotal = `
            SELECT COUNT(*) as TOTAL
            FROM DSEDAC.CPC 
            WHERE ANODOCUMENTO = 2025 AND MESDOCUMENTO = 2 AND DIADOCUMENTO = 13
        `;
        const sqlS = `
            SELECT COUNT(*) as CONFORMADO
            FROM DSEDAC.CPC 
            WHERE ANODOCUMENTO = 2025 AND MESDOCUMENTO = 2 AND DIADOCUMENTO = 13
            AND CONFORMADOSN = 'S'
        `;

        const totalParams = await query(sqlTotal, false);
        const sParams = await query(sqlS, false);

        const result = {
            total: totalParams[0].TOTAL,
            conformado: sParams[0].CONFORMADO,
            ratio: (sParams[0].CONFORMADO / totalParams[0].TOTAL * 100).toFixed(2) + '%'
        };

        console.log('COMPARISON TODAY:', result);
        fs.writeFileSync('count_comparison.txt', JSON.stringify(result, null, 2));
    } catch (e) {
        console.error(e);
        fs.writeFileSync('count_error.txt', e.message);
    }
}

compareCounts();
