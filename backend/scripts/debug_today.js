require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');

async function checkToday() {
    try {
        const today = new Date();
        const y = today.getFullYear();
        const m = today.getMonth() + 1;
        const d = today.getDate();

        console.log(`Checking for ${y}-${m}-${d}...`);

        const sql = `
            SELECT 
                COUNT(*) as TOTAL,
                SUM(CASE WHEN CONFORMADOSN = 'S' THEN 1 ELSE 0 END) as LEGACY_CONFIRMED,
                SUM(CASE WHEN DIALLEGADA > 0 THEN 1 ELSE 0 END) as WITH_DIALLEGADA,
                MIN(HORALLEGADA) as MIN_TIME,
                MAX(HORALLEGADA) as MAX_TIME
            FROM DSEDAC.CPC
            WHERE ANODOCUMENTO = ${y} AND MESDOCUMENTO = ${m} AND DIADOCUMENTO = ${d}
        `;

        const rows = await query(sql);
        console.log('CPC Today:', rows);

        const dsSql = `
            SELECT STATUS, COUNT(*) as CNT 
            FROM JAVIER.DELIVERY_STATUS 
            WHERE DATE(UPDATED_AT) = '${y}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}'
            GROUP BY STATUS
        `;
        // Note: DATE() function might verify depending on DB2/SQL version. 
        // Safer to use timestamp compare if unsure. 
        // But for quick check let's try.

        // Actually, let's use a simpler query for DS to avoid syntax error if DATE() not supported
        const dsSqlSafe = `
             SELECT STATUS, COUNT(*) as CNT 
             FROM JAVIER.DELIVERY_STATUS 
             WHERE UPDATED_AT >= '${y}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')} 00:00:00'
             GROUP BY STATUS
        `;

        const dsRows = await query(dsSqlSafe);
        console.log('Delivery Status Today:', dsRows);

        // Check Repartidores (for "Ver Como" issue)
        const repSql = `SELECT CODIGOREPARTIDOR, NOMBREREPARTIDOR FROM DSEDAC.REP FETCH FIRST 10 ROWS ONLY`;
        const repRows = await query(repSql);
        console.log('Repartidores Sample:', repRows);

    } catch (e) {
        console.error(e);
    }
}

checkToday();
