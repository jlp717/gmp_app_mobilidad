const { query, initDb } = require('../config/db');
const { LAC_SALES_FILTER, formatCurrency } = require('../utils/common');

async function checkVendors() {
    try {
        await initDb();
        console.log('📊 VENDOR BREAKDOWN (2025)');

        const sql = `
            SELECT 
                COALESCE(TRIM(L.CODIGOVENDEDOR), 'MISSING') as VENDOR,
                SUM(L.IMPORTEVENTA) as TOTAL
            FROM DSEDAC.LAC L
            WHERE L.ANODOCUMENTO = 2025
              AND ${LAC_SALES_FILTER}
            GROUP BY L.CODIGOVENDEDOR
            ORDER BY TOTAL DESC
        `;

        const rows = await query(sql);

        console.log('VENDOR | TOTAL');
        rows.forEach(r => {
            console.log(`${r.VENDOR.padEnd(10)} | ${formatCurrency(r.TOTAL)}`);
        });

        const total = rows.reduce((acc, r) => acc + parseFloat(r.TOTAL), 0);
        console.log('--------------------------------');
        console.log(`TOTAL DB : ${formatCurrency(total)}`);

        process.exit(0);

    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkVendors();
