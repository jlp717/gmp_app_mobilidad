const { query, initDb } = require('../config/db');

async function simpleInvestigation() {
    await initDb();

    console.log('=== 1. SIMPLE: Get one albaran with IMPORTETOTAL from CPC ===');
    try {
        const cpc = await query(`
            SELECT NUMEROALBARAN, IMPORTETOTAL, TRIM(CODIGOCLIENTEALBARAN) as CLI
            FROM DSEDAC.CPC
            WHERE ANODOCUMENTO = 2026 AND MESDOCUMENTO = 1
              AND IMPORTETOTAL > 0
            FETCH FIRST 3 ROWS ONLY
        `);
        console.log('CPC sample:');
        console.log(JSON.stringify(cpc, null, 2));

        if (cpc.length > 0) {
            // Now get same albaran from CAC
            const albNum = cpc[0].NUMEROALBARAN;
            console.log(`\n=== 2. Getting CAC for albaran ${albNum} ===`);

            const cac = await query(`
                SELECT NUMEROALBARAN, TOTALALBARAN, IMPORTEBRUTO, NUMEROFACTURA
                FROM DSEDAC.CAC
                WHERE NUMEROALBARAN = ${albNum}
                  AND ANODOCUMENTO = 2026 AND MESDOCUMENTO = 1
                FETCH FIRST 1 ROWS ONLY
            `);
            console.log('CAC data:');
            console.log(JSON.stringify(cac, null, 2));

            if (cac.length > 0) {
                console.log(`\nCompare: CPC.IMPORTETOTAL=${cpc[0].IMPORTETOTAL}, CAC.TOTALALBARAN=${cac[0].TOTALALBARAN}`);
            }
        }
    } catch (e) {
        console.log('Error:', e.message);
    }

    console.log('\n=== 3. CHECK FOR FACTURA IN CAC (where NUMEROFACTURA > 0) ===');
    try {
        // Just query CAC directly for albaranes that have a factura number
        const facturados = await query(`
            SELECT NUMEROALBARAN, NUMEROFACTURA, SERIEFACTURA
            FROM DSEDAC.CAC
            WHERE ANODOCUMENTO = 2025 
              AND NUMEROFACTURA > 0
            FETCH FIRST 5 ROWS ONLY
        `);
        console.log(`Albaranes with factura (2025):`, facturados.length);
        if (facturados.length > 0) {
            console.log(JSON.stringify(facturados, null, 2));
        }
    } catch (e) {
        console.log('Error:', e.message);
    }

    process.exit();
}

simpleInvestigation();
