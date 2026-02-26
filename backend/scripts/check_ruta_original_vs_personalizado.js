const { getPool, initDb } = require('../config/db');

async function main() {
    console.log("=== 2. COMPARE ORIGINAL VS CUSTOM (ALL DAYS, Vendor 33) ===");
    await initDb();
    const conn = await getPool().connect();

    try {
        const days = [
            { name: 'LUNES',     col: 'DIAVISITALUNESSN' },
            { name: 'MARTES',    col: 'DIAVISITAMARTESSN' },
            { name: 'MIERCOLES', col: 'DIAVISITAMIERCOLESSN' },
            { name: 'JUEVES',    col: 'DIAVISITAJUEVESSN' },
            { name: 'VIERNES',   col: 'DIAVISITAVIERNESSN' },
            { name: 'SABADO',    col: 'DIAVISITASABADOSN' },
        ];

        const results = [];
        for (const d of days) {
            const cdviRes = await conn.query(`
                SELECT COUNT(*) as CNT FROM DSEDAC.CDVI C
                JOIN DSEDAC.CLI K ON C.CODIGOCLIENTE = K.CODIGOCLIENTE
                WHERE TRIM(C.CODIGOVENDEDOR) = '33'
                  AND TRIM(C.${d.col}) = 'S'
                  AND (C.MARCAACTUALIZACION <> 'B' OR C.MARCAACTUALIZACION IS NULL OR TRIM(C.MARCAACTUALIZACION) = '')
                  AND (K.ANOBAJA = 0 OR K.ANOBAJA IS NULL)
            `);

            const dayLower = d.name.toLowerCase();
            const configRes = await conn.query(`
                SELECT
                    COUNT(*) as TOTAL,
                    SUM(CASE WHEN ORDEN >= 0 THEN 1 ELSE 0 END) as POSITIVOS,
                    SUM(CASE WHEN ORDEN = -1 THEN 1 ELSE 0 END) as BLOQUEADOS
                FROM JAVIER.RUTERO_CONFIG
                WHERE TRIM(VENDEDOR) = '33' AND TRIM(DIA) = '${dayLower}'
            `);

            results.push({
                DIA: d.name,
                CDVI_ORIGINAL: cdviRes[0]?.CNT || 0,
                CONFIG_TOTAL: configRes[0]?.TOTAL || 0,
                CONFIG_POSITIVOS: configRes[0]?.POSITIVOS || 0,
                CONFIG_BLOQUEADOS: configRes[0]?.BLOQUEADOS || 0,
            });
        }

        console.table(results);
        console.log("\nNOTA: CONFIG_POSITIVOS = clientes con orden personalizado >= 0");
        console.log("      CONFIG_BLOQUEADOS = clientes removidos de ese día (orden = -1)");
    } catch (e) { console.error(e); } finally { await conn.close(); process.exit(0); }
}
main();
