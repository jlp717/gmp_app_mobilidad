const { query, initDb } = require('../config/db');

async function findOverrides() {
    try {
        await initDb();
        console.log('🔍 Searching for Vendor/Day with most overrides...');

        const rows = await query(`
            SELECT TRIM(VENDEDOR) as VENDEDOR, TRIM(DIA) as DIA, COUNT(*) as COUNT
            FROM JAVIER.RUTERO_CONFIG
            GROUP BY VENDEDOR, DIA
            ORDER BY COUNT DESC
            FETCH FIRST 5 ROWS ONLY
        `);

        console.log('📋 Top Modified Routes:', rows);
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
findOverrides();
