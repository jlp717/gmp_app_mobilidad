require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');
const fs = require('fs');

async function debugDeliveryLogic() {
    try {
        console.log('--- DB ANALYSIS ---');

        // 1. Check 2026 vs 2025 counts
        const sql2026 = `SELECT count(*) as CNT, SUM(CASE WHEN CONFORMADOSN='S' THEN 1 ELSE 0 END) as S FROM DSEDAC.CPC WHERE ANODOCUMENTO=2026 AND MESDOCUMENTO=2 AND DIADOCUMENTO=13`;
        const res2026 = await query(sql2026);

        const sql2025 = `SELECT count(*) as CNT, SUM(CASE WHEN CONFORMADOSN='S' THEN 1 ELSE 0 END) as S FROM DSEDAC.CPC WHERE ANODOCUMENTO=2025 AND MESDOCUMENTO=2 AND DIADOCUMENTO=13`;
        const res2025 = await query(sql2025);

        // 2. Find TIME columns using System Catalog
        // Trying QSYS2.SYSCOLUMNS first (Common on IBM i)
        let timeCols = [];
        try {
            const colSql = `
                SELECT COLUMN_NAME, DATA_TYPE, SYSTEM_COLUMN_NAME
                FROM QSYS2.SYSCOLUMNS 
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CPC' 
                AND (COLUMN_NAME LIKE '%HORA%' OR COLUMN_NAME LIKE '%TIME%' OR COLUMN_NAME LIKE '%ENTREGA%')
            `;
            timeCols = await query(colSql);
        } catch (e) {
            console.log('Error querying QSYS2.SYSCOLUMNS: ' + e.message);
            timeCols = [{ error: e.message }];
        }

        // 3. Get Sample Data with all HORA columns if found, else standard
        const sampleSql = `
            SELECT *
            FROM DSEDAC.CPC 
            WHERE ANODOCUMENTO=2026 AND MESDOCUMENTO=2 AND DIADOCUMENTO=13
            FETCH FIRST 1 ROWS ONLY
        `;
        const sampleRow = await query(sampleSql);

        const output = {
            stats2026: res2026[0],
            stats2025: res2025[0],
            potentialTimeColumns: timeCols,
            sampleRow2026: sampleRow[0]
        };

        fs.writeFileSync('debug_output.txt', JSON.stringify(output, null, 2));
        console.log('SUCCESS: Written to debug_output.txt');

    } catch (e) {
        console.error(e);
        fs.writeFileSync('debug_error.txt', e.toString());
    }
}

debugDeliveryLogic();
