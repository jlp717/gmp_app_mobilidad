const { getPool, initDb } = require('../config/db');

async function main() {
    console.log("=== 3. CHECK CONTADORES DIAS ===");
    await initDb();
    const conn = await getPool().connect();
    try {
        console.log("Original route counters per day (comercial 33):");
        const cdvi = await conn.query(`SELECT TRIM(DIA_VISITA) as DIA, COUNT(*) as CNT FROM DSEDAC.CDVI WHERE TRIM(VENDEDOR) = '33' GROUP BY DIA_VISITA`);
        console.table(cdvi);

        console.log("Custom route valid entries per day (comercial 33):");
        const custom = await conn.query(`SELECT TRIM(DIA) as DIA, COUNT(*) as CNT, SUM(CASE WHEN ORDEN < 0 THEN 1 ELSE 0 END) as BLOCKED FROM JAVIER.RUTERO_CONFIG WHERE TRIM(VENDEDOR) = '33' GROUP BY DIA`);
        console.table(custom);
    } catch (e) { console.error(e); } finally { await conn.close(); process.exit(0); }
}
main();
