const { getPool, initDb } = require('../config/db');

async function debugSales() {
    try {
        await initDb();
        const pool = getPool();

        const fullCode = '4300008840';
        console.log(`🔍 Checking Sales for Code: '${fullCode}' in 2026...`);

        const sales = await pool.query(`
            SELECT ANODOCUMENTO, MESDOCUMENTO, DIADOCUMENTO, IMPORTEVENTA, IMPORTECOSTO
            FROM DSEDAC.LAC 
            WHERE TRIM(CODIGOCLIENTEALBARAN) = '${fullCode}'
              AND ANODOCUMENTO IN (2025, 2026)
            ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
        `);
        console.log(`Found ${sales.length} sales for '${fullCode}'.`);

        const y2026 = sales.filter(r => r.ANODOCUMENTO === 2026);
        console.log(`2026 count: ${y2026.length}`);
        if (y2026.length > 0) {
            console.log("Sample 2026:", y2026[0]);
            console.log("All 2026:", y2026);
        } else {
            console.log("❌ No sales in 2026.");
        }

    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

debugSales();
