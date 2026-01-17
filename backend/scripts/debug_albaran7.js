const { query, initDb } = require('../config/db');

async function debugAlbaran7() {
    await initDb();

    console.log('=== ALBARAN 7 FOR SATURDAY 17/1/2026 ===\n');

    // Check albaran 7 for client *4694
    try {
        const cpc = await query(`
            SELECT 
                CPC.NUMEROALBARAN,
                CPC.EJERCICIOALBARAN,
                CPC.SERIEALBARAN,
                CPC.TERMINALALBARAN,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLI,
                CPC.IMPORTETOTAL,
                CPC.IMPORTEBRUTO,
                CPC.ANODOCUMENTO, CPC.MESDOCUMENTO, CPC.DIADOCUMENTO
            FROM DSEDAC.CPC
            WHERE CPC.ANODOCUMENTO = 2026 
              AND CPC.MESDOCUMENTO = 1
              AND CPC.DIADOCUMENTO = 17
              AND CPC.NUMEROALBARAN = 7
        `);

        console.log(`Found ${cpc.length} records for albaran 7 on 17/1/2026:`);
        cpc.forEach(c => {
            console.log(`  Cliente ${c.CLI}: Bruto=${c.IMPORTEBRUTO}€, Total=${c.IMPORTETOTAL}€`);
            console.log(`    Keys: Ejercicio=${c.EJERCICIOALBARAN}, Serie=${c.SERIEALBARAN}, Term=${c.TERMINALALBARAN}`);
        });

        // Find specific client *4694
        const client4694 = cpc.find(c => c.CLI && c.CLI.endsWith('4694'));
        if (client4694) {
            console.log(`\n=== FOUND CLIENT *4694 ===`);
            console.log(`Albaran 7 for *4694: Bruto=${client4694.IMPORTEBRUTO}€, Total=${client4694.IMPORTETOTAL}€`);
        }
    } catch (e) {
        console.log('CPC Error:', e.message);
    }

    console.log('\n=== CHECK OPP FOR SATURDAY DELIVERIES ===\n');
    try {
        const opp = await query(`
            SELECT 
                OPP.NUMEROORDENPREPARACION,
                TRIM(OPP.CODIGOREPARTIDOR) as REP,
                CPC.NUMEROALBARAN,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLI,
                CPC.IMPORTEBRUTO
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            WHERE OPP.DIAREPARTO = 17
              AND OPP.MESREPARTO = 1
              AND OPP.ANOREPARTO = 2026
              AND CPC.NUMEROALBARAN = 7
        `);

        console.log(`OPP records for albaran 7 on Saturday 17:`);
        opp.forEach(o => console.log(`  Rep ${o.REP}: Alb ${o.NUMEROALBARAN}, Cliente ${o.CLI}, Bruto=${o.IMPORTEBRUTO}€`));
    } catch (e) {
        console.log('OPP Error:', e.message);
    }

    process.exit();
}

debugAlbaran7();
