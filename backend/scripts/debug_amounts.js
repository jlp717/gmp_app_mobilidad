const { query, initDb } = require('../config/db');

async function debugAlbaranAmounts() {
    await initDb();

    const today = new Date();
    const dia = today.getDate();
    const mes = today.getMonth() + 1;
    const ano = today.getFullYear();

    console.log(`=== DEBUG ALBARANES FOR ${dia}/${mes}/${ano} ===\n`);

    // Find albaran 3 for client ending in 296
    console.log('=== ALBARAN 3, CLIENT *296 ===\n');
    try {
        const alb3 = await query(`
            SELECT 
                CPC.NUMEROALBARAN,
                CPC.EJERCICIOALBARAN,
                CPC.SERIEALBARAN,
                CPC.TERMINALALBARAN,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLI,
                CPC.IMPORTEBRUTO,
                CPC.IMPORTETOTAL,
                CPC.DIADOCUMENTO, CPC.MESDOCUMENTO
            FROM DSEDAC.CPC
            WHERE CPC.ANODOCUMENTO = ${ano}
              AND CPC.NUMEROALBARAN = 3
              AND (TRIM(CPC.CODIGOCLIENTEALBARAN) LIKE '%296' OR TRIM(CPC.CODIGOCLIENTEALBARAN) LIKE '%296%')
        `);
        console.log(`Found ${alb3.length} records:`);
        alb3.forEach(a => {
            console.log(`  Cliente ${a.CLI}: Bruto=${a.IMPORTEBRUTO}€, Total=${a.IMPORTETOTAL}€`);
            console.log(`    Keys: Ejercicio=${a.EJERCICIOALBARAN}, Serie=${a.SERIEALBARAN}, Term=${a.TERMINALALBARAN}, Dia=${a.DIADOCUMENTO}/${a.MESDOCUMENTO}`);
        });
    } catch (e) {
        console.log('Error:', e.message);
    }

    // Find albaran 5 for client ending in 28035
    console.log('\n=== ALBARAN 5, CLIENT *28035 ===\n');
    try {
        const alb5 = await query(`
            SELECT 
                CPC.NUMEROALBARAN,
                CPC.EJERCICIOALBARAN,
                CPC.SERIEALBARAN,
                CPC.TERMINALALBARAN,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLI,
                CPC.IMPORTEBRUTO,
                CPC.IMPORTETOTAL,
                CPC.DIADOCUMENTO, CPC.MESDOCUMENTO
            FROM DSEDAC.CPC
            WHERE CPC.ANODOCUMENTO = ${ano}
              AND CPC.NUMEROALBARAN = 5
              AND TRIM(CPC.CODIGOCLIENTEALBARAN) LIKE '%28035%'
        `);
        console.log(`Found ${alb5.length} records:`);
        alb5.forEach(a => {
            console.log(`  Cliente ${a.CLI}: Bruto=${a.IMPORTEBRUTO}€, Total=${a.IMPORTETOTAL}€`);
            console.log(`    Keys: Ejercicio=${a.EJERCICIOALBARAN}, Serie=${a.SERIEALBARAN}, Term=${a.TERMINALALBARAN}, Dia=${a.DIADOCUMENTO}/${a.MESDOCUMENTO}`);
        });
    } catch (e) {
        console.log('Error:', e.message);
    }

    // Check if there are multiple records for same albaran number but different terminals
    console.log('\n=== CHECK MULTIPLE TERMINALS FOR ALBARAN 3 ===\n');
    try {
        const multi = await query(`
            SELECT 
                CPC.NUMEROALBARAN,
                CPC.TERMINALALBARAN,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLI,
                CPC.IMPORTEBRUTO
            FROM DSEDAC.CPC
            WHERE CPC.ANODOCUMENTO = ${ano} AND CPC.MESDOCUMENTO = ${mes}
              AND CPC.NUMEROALBARAN = 3
            ORDER BY CPC.TERMINALALBARAN
        `);
        console.log(`Found ${multi.length} records for albaran 3:`);
        multi.forEach(m => console.log(`  Term=${m.TERMINALALBARAN}, Cliente=${m.CLI}, Bruto=${m.IMPORTEBRUTO}€`));
    } catch (e) {
        console.log('Error:', e.message);
    }

    process.exit();
}

debugAlbaranAmounts();
