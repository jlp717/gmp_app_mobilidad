const { getPool, initDb } = require('../config/db');

async function main() {
    console.log("=== 1. CHECK COMERCIAL 33 ===");
    await initDb();
    const conn = await getPool().connect();

    try {
        console.log("-- CDVI (Original Route) Count by Day (Vendedor 33)--");
        const cdvi = await conn.query(`SELECT TRIM(DIA_VISITA) as DIA, COUNT(*) as CNT FROM DSEDAC.CDVI WHERE TRIM(VENDEDOR) = '33' GROUP BY DIA_VISITA ORDER BY DIA_VISITA`);
        console.table(cdvi);

        console.log("-- RUTERO_CONFIG (Custom Route) Count by Day (Vendedor 33)--");
        const config = await conn.query(`SELECT TRIM(DIA) as DIA, COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE TRIM(VENDEDOR) = '33' GROUP BY DIA ORDER BY DIA`);
        console.table(config);

        console.log("-- RUTERO_LOG (Recent Saves Vendedor 33)--");
        const logs = await conn.query(`SELECT ID, FECHA_HORA, TIPO_CAMBIO, TRIM(DIA_ORIGEN) as ORIGEN, TRIM(DIA_DESTINO) as DESTINO, TRIM(CLIENTE) as CLI, POSICION_NUEVA as NUEVA_POS FROM JAVIER.RUTERO_LOG WHERE TRIM(VENDEDOR) = '33' ORDER BY FECHA_HORA DESC FETCH FIRST 10 ROWS ONLY`);
        console.table(logs);
    } catch (e) { console.error(e); } finally { await conn.close(); process.exit(0); }
}
main();
