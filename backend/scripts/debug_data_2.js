const { initDb, query } = require('../config/db');

async function runDebug() {
    await initDb();
    try {
        console.log('\n=== 1. CHECKING REPARTIDOR 21 ALBARANES (Raw Values) ===');
        const albaranes = await query(`
            SELECT 
                CPC.NUMEROALBARAN, CPC.IMPORTETOTAL, 
                CPC.CODIGOCLIENTEALBARAN
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            WHERE TRIM(OPP.CODIGOREPARTIDOR) = '21'
              AND OPP.ANOREPARTO = 2024
              AND OPP.MESREPARTO >= 1
            ORDER BY CPC.IMPORTETOTAL ASC
            FETCH FIRST 5 ROWS ONLY
        `);
        console.log('Albaranes:', albaranes);

        if (albaranes.length > 0) {
            const alb = albaranes[0];
            console.log(`\n=== 2. CHECKING ITEMS IN DSEDAC.LAL FOR ALBARAN ${alb.NUMEROALBARAN} ===`);
            const items = await query(`
                SELECT * FROM DSEDAC.LAL 
                WHERE NUMEROALBARAN = ${alb.NUMEROALBARAN}
                FETCH FIRST 5 ROWS ONLY
            `);
            console.log('LAL Items:', items);
            console.log('Count:', items.length);
        }

    } catch (err) {
        console.error('Debug Error:', err);
    } finally {
        process.exit();
    }
}

runDebug();
