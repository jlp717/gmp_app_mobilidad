const { getPool, initDb } = require('../config/db');

async function main() {
    console.log("=== 1. CHECK COMERCIAL 33 ===");
    await initDb();
    const conn = await getPool().connect();

    try {
        console.log("\n-- CDVI (Original Route) Count by Day (Vendedor 33)--");
        const cdvi = await conn.query(`
            SELECT
                SUM(CASE WHEN TRIM(DIAVISITALUNESSN)='S' THEN 1 ELSE 0 END) as LUNES,
                SUM(CASE WHEN TRIM(DIAVISITAMARTESSN)='S' THEN 1 ELSE 0 END) as MARTES,
                SUM(CASE WHEN TRIM(DIAVISITAMIERCOLESSN)='S' THEN 1 ELSE 0 END) as MIERCOLES,
                SUM(CASE WHEN TRIM(DIAVISITAJUEVESSN)='S' THEN 1 ELSE 0 END) as JUEVES,
                SUM(CASE WHEN TRIM(DIAVISITAVIERNESSN)='S' THEN 1 ELSE 0 END) as VIERNES,
                SUM(CASE WHEN TRIM(DIAVISITASABADOSN)='S' THEN 1 ELSE 0 END) as SABADO
            FROM DSEDAC.CDVI C
            JOIN DSEDAC.CLI K ON C.CODIGOCLIENTE = K.CODIGOCLIENTE
            WHERE TRIM(C.CODIGOVENDEDOR) = '33'
              AND (C.MARCAACTUALIZACION <> 'B' OR C.MARCAACTUALIZACION IS NULL OR TRIM(C.MARCAACTUALIZACION) = '')
              AND (K.ANOBAJA = 0 OR K.ANOBAJA IS NULL)
        `);
        console.table(cdvi);

        console.log("-- RUTERO_CONFIG (Custom Route) Count by Day (Vendedor 33)--");
        const config = await conn.query(`
            SELECT TRIM(DIA) as DIA,
                   COUNT(*) as TOTAL,
                   SUM(CASE WHEN ORDEN >= 0 THEN 1 ELSE 0 END) as POSITIVOS,
                   SUM(CASE WHEN ORDEN = -1 THEN 1 ELSE 0 END) as BLOQUEADOS
            FROM JAVIER.RUTERO_CONFIG
            WHERE TRIM(VENDEDOR) = '33'
            GROUP BY DIA ORDER BY DIA
        `);
        console.table(config);

        console.log("-- RUTERO_LOG (Recent Saves Vendedor 33) --");
        const logs = await conn.query(`
            SELECT ID, FECHA_HORA, TIPO_CAMBIO, TRIM(DIA_ORIGEN) as ORIGEN,
                   TRIM(DIA_DESTINO) as DESTINO, TRIM(CLIENTE) as CLI,
                   POSICION_NUEVA as NUEVA_POS
            FROM JAVIER.RUTERO_LOG
            WHERE TRIM(VENDEDOR) = '33'
            ORDER BY FECHA_HORA DESC
            FETCH FIRST 10 ROWS ONLY
        `);
        console.table(logs);

        console.log("-- Total clients in CDVI for vendor 33 --");
        const totalCdvi = await conn.query(`
            SELECT COUNT(*) as TOTAL
            FROM DSEDAC.CDVI C
            JOIN DSEDAC.CLI K ON C.CODIGOCLIENTE = K.CODIGOCLIENTE
            WHERE TRIM(C.CODIGOVENDEDOR) = '33'
              AND (C.MARCAACTUALIZACION <> 'B' OR C.MARCAACTUALIZACION IS NULL OR TRIM(C.MARCAACTUALIZACION) = '')
              AND (K.ANOBAJA = 0 OR K.ANOBAJA IS NULL)
        `);
        console.log(`Total unique clients in CDVI: ${totalCdvi[0]?.TOTAL}`);

    } catch (e) { console.error(e); } finally { await conn.close(); process.exit(0); }
}
main();
