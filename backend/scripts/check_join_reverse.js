/**
 * Trace valid LAC -> CPC -> OPP
 */
const { query } = require('../config/db');

async function main() {
    console.log('Sampling LAC...');

    const lacs = await query(`
    SELECT * 
    FROM DSEDAC.LAC 
    WHERE NUMEROALBARAN > 0 
      AND CODIGOARTICULO <> ''
    FETCH FIRST 1 ROWS ONLY
  `);

    if (lacs.length > 0) {
        const lac = lacs[0];
        console.log(`LAC: Albaran ${lac.NUMEROALBARAN} (${lac.EJERCICIOALBARAN}) - Art: ${lac.CODIGOARTICULO}`);

        // Check CPC
        const cpcs = await query(`
      SELECT * 
      FROM DSEDAC.CPC 
      WHERE NUMEROALBARAN = ${lac.NUMEROALBARAN}
        AND EJERCICIOALBARAN = ${lac.EJERCICIOALBARAN}
        AND SERIEALBARAN = '${lac.SERIEALBARAN}'
    `);
        console.log(`Found ${cpcs.length} CPCs for this LAC`);

        if (cpcs.length > 0) {
            const cpc = cpcs[0];
            console.log(`CPC: PrepOrder ${cpc.NUMEROORDENPREPARACION} (${cpc.EJERCICIOORDENPREPARACION})`);

            if (cpc.NUMEROORDENPREPARACION > 0) {
                // Check OPP
                const opps = await query(`
          SELECT * 
          FROM DSEDAC.OPP 
          WHERE NUMEROORDENPREPARACION = ${cpc.NUMEROORDENPREPARACION}
            AND EJERCICIOORDENPREPARACION = ${cpc.EJERCICIOORDENPREPARACION}
        `);
                console.log(`Found ${opps.length} OPPs for this CPC`);
                if (opps.length > 0) {
                    console.log('SUCCESS! Full chain confirmed: LAC -> CPC -> OPP');
                }
            } else {
                console.log('CPC has no PrepOrder (0)');
            }
        }
    } else {
        console.log('No valid LACs found');
    }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
