const { query, initDb } = require('../config/db');

async function showRoute() {
    try {
        await initDb();

        const VENDEDOR = '33';
        const DIA = 'viernes'; // User mentioned Friday changes

        console.log(`📊 ANALIZANDO RUTA DEL ${DIA.toUpperCase()} PARA VENDEDOR ${VENDEDOR}`);

        // 1. ORIGINAL ROUTE (Natural from CDVI/LACLAE)
        // Heuristic: Clients with VIS_V = 'S' in CDVI, or LACLAE history
        console.log('\n--- RUTA ORIGINAL (BASE DE DATOS) ---');
        const originalClients = await query(`
            SELECT TRIM(C.CODIGOCLIENTE) as CODE, TRIM(CLI.NOMBRECLIENTE) as NAME 
            FROM DSEDAC.CDVI C
            LEFT JOIN DSEDAC.CLI CLI ON C.CODIGOCLIENTE = CLI.CODIGOCLIENTE
            WHERE C.CODIGOVENDEDOR = '${VENDEDOR}' 
              AND C.DIAVISITAVIERNESSN = 'S'
            FETCH FIRST 20 ROWS ONLY
        `);

        if (originalClients.length === 0) {
            console.log('(No se encontraron clientes naturales para este día en CDVI)');
        } else {
            console.log(originalClients.map(c => `- ${c.NAME} (${c.CODE})`).join('\n'));
            console.log(`... (Total aprox: ${originalClients.length} mostrados)`);
        }

        // 2. CUSTOM ROUTE (From JAVIER.RUTERO_CONFIG)
        console.log('\n--- RUTA PERSONALIZADA (JAVIER.RUTERO_CONFIG) ---');
        const customOrder = await query(`
            SELECT C.ORDEN, TRIM(C.CLIENTE) as CODE, TRIM(CLI.NOMBRECLIENTE) as NAME
            FROM JAVIER.RUTERO_CONFIG C
            LEFT JOIN DSEDAC.CLI CLI ON C.CLIENTE = CLI.CODIGOCLIENTE
            WHERE C.VENDEDOR = '${VENDEDOR}' AND C.DIA = '${DIA}'
            ORDER BY C.ORDEN ASC
            FETCH FIRST 20 ROWS ONLY
        `);

        if (customOrder.length === 0) {
            console.log('(No hay orden personalizado guardado para este día - Se usaría el original)');
        } else {
            console.log(customOrder.map(c => `[Pos ${c.ORDEN}] ${c.NAME} (${c.CODE})`).join('\n'));
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

showRoute();
