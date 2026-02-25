const { getPool, initDb } = require('../config/db');

async function main() {
    console.log("=== 2. COMPARE ORIGINAL VS CUSTOM (SAB & MIE) ===");
    await initDb();
    const conn = await getPool().connect();

    try {
        const cdviSab = await conn.query(`SELECT COUNT(*) as CNT FROM DSEDAC.CDVI WHERE TRIM(VENDEDOR) = '33' AND TRIM(DIA_VISITA) = '6'`);
        const configSab = await conn.query(`SELECT COUNT(*) as CNT, SUM(CASE WHEN ORDEN < 0 THEN 1 ELSE 0 END) as BLOCKS FROM JAVIER.RUTERO_CONFIG WHERE TRIM(VENDEDOR) = '33' AND TRIM(DIA) IN ('SAB', 'SABADO', '6')`);
        console.log(`SABADO Original (CDVI): ${cdviSab[0]?.CNT} | Custom (RUTERO_CONFIG): Total = ${configSab[0]?.CNT}, Blocks = ${configSab[0]?.BLOCKS}`);

        const cdviMie = await conn.query(`SELECT COUNT(*) as CNT FROM DSEDAC.CDVI WHERE TRIM(VENDEDOR) = '33' AND TRIM(DIA_VISITA) = '3'`);
        const configMie = await conn.query(`SELECT COUNT(*) as CNT, SUM(CASE WHEN ORDEN < 0 THEN 1 ELSE 0 END) as BLOCKS FROM JAVIER.RUTERO_CONFIG WHERE TRIM(VENDEDOR) = '33' AND TRIM(DIA) IN ('MIE', 'MIERCOLES', '3')`);
        console.log(`MIERCOLES Original (CDVI): ${cdviMie[0]?.CNT} | Custom (RUTERO_CONFIG): Total = ${configMie[0]?.CNT}, Blocks = ${configMie[0]?.BLOCKS}`);
    } catch (e) { console.error(e); } finally { await conn.close(); process.exit(0); }
}
main();
