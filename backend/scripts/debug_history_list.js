const { query } = require('../config/db');
const moment = require('moment');

async function test() {
    const repartidorId = '21,39,41,43,44,53,66,67,74,79,84,85,87,89,98';
    const cleanRepartidorId = repartidorId.split(',').map(id => `'${id.trim()}'`).join(',');
    const dateLimit = moment().subtract(6, 'months').format('YYYYMMDD');

    console.log(`Testing IDs: ${cleanRepartidorId}`);
    console.log(`Date Limit: ${dateLimit}`);

    const sql = `
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

    try {
        const rows = await query(sql, false);
        console.log(`Found ${rows.length} rows.`);
        if (rows.length > 0) {
            console.table(rows.slice(0, 5));
        } else {
            console.log("NO DATA FOUND for these IDs in the last 6 months.");

            // Try without date limit to see if it's a date issue
            const countAll = await query(`SELECT COUNT(*) as CNT FROM DSEDAC.OPP WHERE TRIM(CODIGOREPARTIDOR) IN (${cleanRepartidorId})`, false);
            console.log(`Total OPP records for these reps: ${countAll[0].CNT}`);

            if (countAll[0].CNT > 0) {
                const sample = await query(`SELECT ANOREPARTO, MESREPARTO, DIAREPARTO FROM DSEDAC.OPP WHERE TRIM(CODIGOREPARTIDOR) IN (${cleanRepartidorId}) FETCH FIRST 5 ROWS ONLY`, false);
                console.log("Sample dates in OPP:");
                console.table(sample);
            }
        }
    } catch (e) {
        console.error("SQL Error:", e);
    }
}

test();
