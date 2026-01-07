const { initDb, query } = require('../config/db');
const { LAC_SALES_FILTER } = require('../utils/common');

async function run() {
    try {
        console.log('🔌 Connecting to DB...');
        await initDb();

        const today = new Date();
        const year = 2025; // Hardcoded as per user context
        const month = 12;
        const day = 31;

        console.log(`\n--- Verifying Sales for ${year}-${month}-${day} ---`);
        console.log(`Filter Used: ${LAC_SALES_FILTER}`);

        // 1. Get Total
        const totalQuery = `
            SELECT 
                COUNT(*) as COUNT,
                SUM(IMPORTEVENTA) as TOTAL_SALES
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO = ${year} 
              AND MESDOCUMENTO = ${month} 
              AND DIADOCUMENTO = ${day}
              AND ${LAC_SALES_FILTER}
        `;
        const totals = await query(totalQuery);
        console.log('📊 Totals:', totals[0]);

        // 2. Get Sample Rows to inspect content
        const sampleQuery = `
            SELECT 
                TRIM(SERIEALBARAN) as SERIE,
                TRIM(NUMERODOCUMENTO) as DOC_NUM,
                TRIM(TIPOVENTA) as TYPE,
                IMPORTEVENTA as AMOUNT,
                TRIM(CODIGOCLIENTEALBARAN) as CLIENT
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO = ${year} 
              AND MESDOCUMENTO = ${month} 
              AND DIADOCUMENTO = ${day}
              AND ${LAC_SALES_FILTER}
            ORDER BY IMPORTEVENTA DESC
            FETCH FIRST 10 ROWS ONLY
        `;

        const samples = await query(sampleQuery);
        console.log('\n🔎 Top 10 Sales Today:');
        console.table(samples);

        process.exit(0);
    } catch (e) {
        console.error('❌ Error:', e);
        process.exit(1);
    }
}

run();
