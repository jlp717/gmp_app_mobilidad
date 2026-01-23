const { query, initDb } = require('../config/db');

async function checkRouteDominance() {
    try {
        await initDb();
        const client = '4300005862';

        // 1. Get Route
        const cli = await query(`SELECT CODIGORUTA FROM DSEDAC.CLI WHERE CODIGOCLIENTE = '${client}'`);
        if (cli.length === 0) { console.log('Client not found'); process.exit(0); }

        const ruta = cli[0].CODIGORUTA;
        console.log(`Client Route: ${ruta}`);

        // 2. Who dominates this route? (Same logic as clients.js)
        const dominance = await query(`
            SELECT
                LAC_R.R1_T8CDVD as VENDEDOR,
                COUNT(*) as CLIENT_COUNT
            FROM DSED.LACLAE LAC_R
            JOIN DSEDAC.CLI CLI_R ON LAC_R.LCCDCL = CLI_R.CODIGOCLIENTE
            WHERE LAC_R.LCAADC >= 2024
              AND LAC_R.TPDC = 'LAC'
              AND CLI_R.CODIGORUTA = '${ruta}'
            GROUP BY LAC_R.R1_T8CDVD
            ORDER BY CLIENT_COUNT DESC
        `);

        console.log('Route Dominance:', dominance);

        // 3. Check CDVI for 5862
        const cdvi = await query(`SELECT * FROM DSEDAC.CDVI WHERE CODIGOCLIENTE = '${client}'`);
        console.log(`CDVI Entries: ${cdvi.length}`);

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
checkRouteDominance();
