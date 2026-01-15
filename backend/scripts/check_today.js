const { query, initDb } = require('../config/db');

async function checkTodayPayments() {
    await initDb();

    const today = new Date();
    const dia = today.getDate();
    const mes = today.getMonth() + 1;
    const ano = today.getFullYear();

    console.log(`=== TODAY'S DELIVERIES: ${dia}/${mes}/${ano} ===\n`);

    // Check what payment codes are used today
    try {
        const payments = await query(`
            SELECT 
                TRIM(CPC.CODIGOFORMAPAGO) as FP,
                COUNT(*) as CNT
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
              ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            WHERE OPP.DIAREPARTO = ${dia}
              AND OPP.MESREPARTO = ${mes}
              AND OPP.ANOREPARTO = ${ano}
            GROUP BY TRIM(CPC.CODIGOFORMAPAGO)
            ORDER BY CNT DESC
        `);

        console.log('Payment codes for today:');
        payments.forEach(p => console.log(`  ${p.FP || '(empty)'}: ${p.CNT} deliveries`));
    } catch (e) {
        console.log('Error:', e.message);
    }

    console.log('\n=== CHECK ALBARAN 79 AMOUNTS ===\n');
    try {
        // Find albaran 79 for today
        const alb79 = await query(`
            SELECT 
                CPC.NUMEROALBARAN,
                CPC.IMPORTETOTAL,
                CPC.IMPORTEBRUTO,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLI,
                TRIM(CPC.CODIGOFORMAPAGO) as FP
            FROM DSEDAC.CPC
            WHERE CPC.ANODOCUMENTO = ${ano}
              AND CPC.MESDOCUMENTO = ${mes}
              AND CPC.NUMEROALBARAN = 79
        `);
        console.log('Albaran 79 in CPC:');
        alb79.forEach(a => console.log(`  Cliente ${a.CLI}: Bruto=${a.IMPORTEBRUTO}€, Total=${a.IMPORTETOTAL}€, FP=${a.FP}`));
    } catch (e) {
        console.log('Error:', e.message);
    }

    console.log('\n=== CHECK LAC LINES FOR ALBARAN 79 ===\n');
    try {
        const lines = await query(`
            SELECT 
                TRIM(LAC.CODIGOARTICULO) as ART,
                LAC.CANTIDADUNIDADES as QTY,
                LAC.CANTIDADCAJAS as CAJAS,
                LAC.IMPORTEVENTA as VENTA
            FROM DSEDAC.LAC
            WHERE LAC.EJERCICIOALBARAN = ${ano}
              AND LAC.NUMEROALBARAN = 79
            FETCH FIRST 10 ROWS ONLY
        `);
        console.log(`LAC lines for albaran 79 (${lines.length} shown):`);
        lines.forEach(l => console.log(`  ${l.ART}: Qty=${l.QTY}, Cajas=${l.CAJAS}, Venta=${l.VENTA}€`));
    } catch (e) {
        console.log('Error:', e.message);
    }

    process.exit();
}

checkTodayPayments();
