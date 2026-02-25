const { getPool, initDb } = require('../config/db');

async function main() {
    console.log("=== 7. FIND TABLAS RUTERO Y COMISIONES ===");
    await initDb();
    const conn = await getPool().connect();
    try {
        const cdviCount = await conn.query(`SELECT COUNT(*) as CNT FROM DSEDAC.CDVI`);
        const configCount = await conn.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG`);
        const logCount = await conn.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_LOG`);
        console.table([
            { Tabla: 'CDVI', Registros: cdviCount[0]?.CNT },
            { Tabla: 'RUTERO_CONFIG', Registros: configCount[0]?.CNT },
            { Tabla: 'RUTERO_LOG', Registros: logCount[0]?.CNT }
        ]);
    } catch (e) { console.error(e); } finally { await conn.close(); process.exit(0); }
}
main();
