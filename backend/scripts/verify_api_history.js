const axios = require('axios');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const API_BASE = 'http://localhost:3334/api'; // Adjust if needed

async function verify() {
    try {
        const repartidorId = '21'; // One that has data
        console.log(`Verifying API for Repartidor: ${repartidorId}`);

        // We need a token since it's protected
        // For simplicity, let's assume we can bypass or use a test token if available
        // Or better yet, I'll just run the logic inside a script without HTTP if I have to.
        // But let's try to simulate the query logic exactly as in the route.

        const { query } = require('../config/db');
        const moment = require('moment');

        const cleanRepartidorId = `'${repartidorId}'`;
        const dateLimit = moment().subtract(6, 'months').format('YYYYMMDD');

        let sql = `
            SELECT DISTINCT
                TRIM(CPC.CODIGOCLIENTEALBARAN) as ID,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NAME,
                TRIM(COALESCE(CLI.DIRECCION, '')) as ADDRESS,
                COUNT(CPC.NUMEROALBARAN) as TOTAL_DOCS
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            LEFT JOIN DSEDAC.CLI CLI 
                ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            WHERE (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) >= ${dateLimit}
              AND TRIM(OPP.CODIGOREPARTIDOR) IN (${cleanRepartidorId})
            GROUP BY TRIM(CPC.CODIGOCLIENTEALBARAN), TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')), TRIM(COALESCE(CLI.DIRECCION, ''))
            ORDER BY NAME FETCH FIRST 50 ROWS ONLY
        `;

        console.log("Executing SQL...");
        const rows = await query(sql, false);
        console.log(`Found ${rows.length} rows.`);
        if (rows.length > 0) {
            console.table(rows.slice(0, 5));
        }

    } catch (e) {
        console.error("ERROR:", e);
    } finally {
        process.exit(0);
    }
}

verify();
