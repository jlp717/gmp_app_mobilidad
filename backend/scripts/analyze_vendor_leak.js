const { query, initDb } = require('../config/db');

async function analyzeCrossData() {
    try {
        await initDb();

        const CLIENTE_INCIDENCE = '4300000680'; // SPAR ALIAGA
        const VENDEDOR_VIEWER = '15'; // ALFONSO SALAS
        const VENDEDOR_OWNER = '05'; // RODRIGUEZ

        console.log(`🔍 Analizando Cliente ${CLIENTE_INCIDENCE}...`);

        // 1. Check Client Data
        const cliRows = await query(`
            SELECT CODIGOCLIENTE, NOMBRECLIENTE, CODIGOVENDEDOR, CODIGORUTA, ANOBAJA
            FROM DSEDAC.CLI
            WHERE CODIGOCLIENTE = '${CLIENTE_INCIDENCE}'
        `);

        if (cliRows.length > 0) {
            const c = cliRows[0];
            console.log(`\n📋 DATOS CLIENTE 680:`);
            console.log(`   - Vendedor Asignado (CLI): ${c.CODIGOVENDEDOR}`);
            console.log(`   - Ruta (CLI): ${c.CODIGORUTA}`);
            console.log(`   - Año Baja: ${c.ANOBAJA}`);

            // 2. Check if Viewer (15) has access to this Route
            if (c.CODIGORUTA) {
                console.log(`\n🛣️ ANALISIS DE RUTA '${c.CODIGORUTA}':`);

                // Which vendors operate in this route according to LACLAE?
                const viewersInRoute = await query(`
                    SELECT DISTINCT R1_T8CDVD as VENDEDOR
                    FROM DSED.LACLAE l
                    JOIN DSEDAC.CLI c ON l.LCCDCL = c.CODIGOCLIENTE
                    WHERE c.CODIGORUTA = '${c.CODIGORUTA}'
                      AND l.LCAADC >= 2024
                `);
                console.log(`   - Vendedores con ventas en esta ruta: ${viewersInRoute.map(r => r.VENDEDOR).join(', ')}`);

                // Is 15 in this list?
                const is15InRoute = viewersInRoute.some(r => r.VENDEDOR.trim() === VENDEDOR_VIEWER);
                console.log(`   - ¿Vendedor ${VENDEDOR_VIEWER} opera en esta ruta?: ${is15InRoute ? 'SÍ (Por eso lo ve)' : 'NO'}`);
            }

            // 3. Check Route Assignments in CDVI (Visit Schedule) for this client
            const cdviRows = await query(`
                SELECT CODIGOVENDEDOR, DIAVISITALUNESSN
                FROM DSEDAC.CDVI
                WHERE CODIGOCLIENTE = '${CLIENTE_INCIDENCE}'
            `);
            console.log(`\n📅 ASIGNACION VISITAS (CDVI):`);
            cdviRows.forEach(r => {
                console.log(`   - Asignado a Vendedor: ${r.CODIGOVENDEDOR}`);
            });

        } else {
            console.log('Cliente no encontrado.');
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

analyzeCrossData();
