const { getPool, initDb } = require('../config/db');

async function main() {
    console.log("=== 3. CHECK CONTADORES DIAS (Multiple Vendors) ===");
    await initDb();
    const conn = await getPool().connect();
    try {
        // Get list of vendors that have custom configs
        const vendors = await conn.query(`
            SELECT TRIM(VENDEDOR) as VENDEDOR, COUNT(*) as TOTAL_ENTRIES
            FROM JAVIER.RUTERO_CONFIG
            GROUP BY VENDEDOR
            ORDER BY TOTAL_ENTRIES DESC
            FETCH FIRST 10 ROWS ONLY
        `);
        console.log("Top 10 vendors with custom route config:");
        console.table(vendors);

        // For top vendor (33), show detailed day counts
        console.log("\n-- Detailed day counts for vendor 33 --");
        const detail = await conn.query(`
            SELECT TRIM(DIA) as DIA,
                   COUNT(*) as TOTAL,
                   SUM(CASE WHEN ORDEN >= 0 THEN 1 ELSE 0 END) as ACTIVOS,
                   SUM(CASE WHEN ORDEN = -1 THEN 1 ELSE 0 END) as BLOQUEADOS,
                   MIN(ORDEN) as MIN_ORDEN,
                   MAX(ORDEN) as MAX_ORDEN
            FROM JAVIER.RUTERO_CONFIG
            WHERE TRIM(VENDEDOR) = '33'
            GROUP BY DIA
            ORDER BY DIA
        `);
        console.table(detail);

        // Check for orphan entries (vendors without CDVI data)
        console.log("\n-- RUTERO_CONFIG total entries --");
        const totalConfig = await conn.query(`SELECT COUNT(*) as TOTAL FROM JAVIER.RUTERO_CONFIG`);
        console.log(`Total rows in RUTERO_CONFIG: ${totalConfig[0]?.TOTAL}`);

        const totalLog = await conn.query(`SELECT COUNT(*) as TOTAL FROM JAVIER.RUTERO_LOG`);
        console.log(`Total rows in RUTERO_LOG: ${totalLog[0]?.TOTAL}`);

    } catch (e) { console.error(e); } finally { await conn.close(); process.exit(0); }
}
main();
