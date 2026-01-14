const { initDb, query } = require('../config/db');

async function runDebug() {
    await initDb();
    try {
        console.log('=== 1. CHECKING VENDORS (Duplicates) ===');
        const vendors = await query(`
            SELECT TRIM(R1_T8CDVD) as CODE, TRIM(D.NOMBREVENDEDOR) as NAME
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.VDD D ON TRIM(L.R1_T8CDVD) = TRIM(D.CODIGOVENDEDOR)
            WHERE R1_T8CDVD = '89' OR R1_T8CDVD = ' 89'
            FETCH FIRST 5 ROWS ONLY
        `);
        console.log('Vendors found:', vendors);

        console.log('\n=== 2. CHECKING REPARTIDOR 21 (Low Amounts) ===');
        // Fetch recent albaranes for Repartidor 21
        const albaranes = await query(`
            SELECT 
                CPC.NUMEROALBARAN, CPC.IMPORTETOTAL, CPC.BASEIMPONIBLE, 
                CPC.CODIGOCLIENTEALBARAN,
                CLI.NOMBRECLIENTE, CLI.NOMBREALTERNATIVO
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            WHERE TRIM(OPP.CODIGOREPARTIDOR) = '21'
              AND OPP.ANOREPARTO = 2024
              AND OPP.MESREPARTO >= 1
            ORDER BY CPC.IMPORTETOTAL ASC
            FETCH FIRST 10 ROWS ONLY
        `);
        console.log('Low amount albaranes:', albaranes);

        if (albaranes.length > 0) {
            const sampleAlb = albaranes[0];
            console.log(`\n=== 3. CHECKING ITEMS FOR ALBARAN ${sampleAlb.NUMEROALBARAN} ===`);
            // Check lines for this albaran
            // Note: Assuming lines are in DSEDAC.CPL or similar?
            // The route used `repartidor.js` doesn't seem to fetch lines from DSEDAC, but relies on `JAVIER.REPARTIDOR_ENTREGA_LINEAS` which might be empty if not synced?
            // Wait, looking at `repartidor.js`, the `POST /entregas/:id/lineas` SAVES lines. 
            // BUT where do we GET lines from initially? 
            // Ah, the user said "when I click articles to deliver it is always empty".
            // I need to check `DSEDAC.CPL` (Lineas de Albaran) to see if we can fetch them.

            const lines = await query(`
                SELECT * FROM DSEDAC.CPL 
                WHERE NUMEROALBARAN = ${sampleAlb.NUMEROALBARAN}
                FETCH FIRST 5 ROWS ONLY
            `);
            console.log('DSEDAC.CPL Lines:', lines);
        }

    } catch (err) {
        console.error('Debug Error:', err);
    } finally {
        process.exit();
    }
}

runDebug();
