require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../config/db');

async function debug() {
    try {
        const repartidores = [21, 39, 41, 43, 44, 53, 66, 67, 74, 79, 84, 85, 87, 89, 98];
        const repStr = repartidores.map(id => `'${id}'`).join(',');
        const dateLimit = 20240101; // Further back to be sure

        console.log(`--- DEBUGGING HISTORICAL CLIENTS ---`);

        // 1. OPP Count
        const oppRes = await query(`SELECT COUNT(*) as CNT FROM DSEDAC.OPP WHERE TRIM(CODIGOREPARTIDOR) IN (${repStr})`, false);
        console.log(`1. OPP (All time for these reps): ${oppRes[0].CNT}`);

        // 2. JOIN OPP + CPC
        const joinRes = await query(`
            SELECT COUNT(*) as CNT
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            WHERE (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) >= ${dateLimit}
            AND TRIM(OPP.CODIGOREPARTIDOR) IN (${repStr})
        `, false);
        console.log(`2. JOIN OPP + CPC: ${joinRes[0].CNT}`);

        console.log("\n--- PER REPARTIDOR ANALYSIS ---");
        for (const id of repartidores) {
            const count = await query(`
                SELECT COUNT(DISTINCT CPC.CODIGOCLIENTEALBARAN) as CNT
                FROM DSEDAC.OPP OPP
                INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                WHERE (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) >= ${dateLimit}
                AND TRIM(OPP.CODIGOREPARTIDOR) = '${id}'
            `, false);
            process.stdout.write(`Repartidor ${id}: ${count[0].CNT} clients | `);
        }
        console.log("\n\n--- SAMPLE DATA ---");
        const sampleData = await query(`
            SELECT DISTINCT TRIM(CPC.CODIGOCLIENTEALBARAN) as ID, TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE)) as NAME
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            WHERE (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) >= ${dateLimit}
            AND TRIM(OPP.CODIGOREPARTIDOR) IN (${repStr})
            FETCH FIRST 5 ROWS ONLY
        `, false);
        console.table(sampleData);

    } catch (e) {
        console.error("ERROR:", e);
    } finally {
        process.exit(0);
    }
}

debug();
