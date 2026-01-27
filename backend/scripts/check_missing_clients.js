const { query, initDb } = require('../config/db');

async function checkClients() {
    try {
        await initDb();
        const clients = ['4300009046', '4300010203'];
        console.log(`🔍 Checking Clients: ${clients.join(', ')}`);

        for (const client of clients) {
            console.log(`\n--- Client ${client} ---`);

            // 1. Check CLI (Master Data)
            const cli = await query(`
                SELECT CODIGOCLIENTE, NOMBRECLIENTE, CODIGOVENDEDOR, CODIGORUTA, POBLACION
                FROM DSEDAC.CLI WHERE CODIGOCLIENTE = '${client}'
            `);
            if (cli.length > 0) {
                console.log('CLI:', cli[0]);
            } else {
                console.log('CLI: Not Found');
            }

            // 2. Check CDVI (Visit Schedule)
            const cdvi = await query(`
                SELECT CODIGOVENDEDOR, 
                       DIAVISITALUNESSN as L, DIAVISITAMARTESSN as M, DIAVISITAMIERCOLESSN as X,
                       DIAVISITAJUEVESSN as J, DIAVISITAVIERNESSN as V, DIAVISITASABADOSN as S
                FROM DSEDAC.CDVI WHERE CODIGOCLIENTE = '${client}'
            `);
            if (cdvi.length > 0) {
                console.log('CDVI:', cdvi.map(r => `${r.CODIGOVENDEDOR} (L:${r.L} V:${r.V})`).join(', '));
            } else {
                console.log('CDVI: Oprhan (No entries)');
            }

            // 3. Check LACLAE (Sales History)
            const laclae = await query(`
                SELECT DISTINCT R1_T8CDVD as VENDEDOR, LCAADC as YEAR
                FROM DSED.LACLAE 
                WHERE LCCDCL = '${client}' AND LCAADC >= 2024
            `);
            console.log('LACLAE (Recent Sales):', laclae.map(r => `${r.VENDEDOR} (${r.YEAR})`).join(', '));
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
checkClients();
