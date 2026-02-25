const { getPool, initDb } = require('../config/db');

async function main() {
    console.log("=== 8. VERIFICAR PERSISTENCIA TOTAL ===");
    await initDb();
    const conn = await getPool().connect();
    try {
        await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE TRIM(VENDEDOR) = 'TEST99'`);
        await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('TEST99', 'LUN', '12345', 1)`);
        console.log("Insert row: OK");

        const check = await conn.query(`SELECT TRIM(VENDEDOR) as V, TRIM(CLIENTE) as C, ORDEN FROM JAVIER.RUTERO_CONFIG WHERE TRIM(VENDEDOR) = 'TEST99'`);
        console.table(check);

        await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE TRIM(VENDEDOR) = 'TEST99'`);
        console.log("Cleaned test row: OK");
    } catch (e) { console.error(e); } finally { await conn.close(); process.exit(0); }
}
main();
