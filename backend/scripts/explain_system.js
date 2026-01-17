const { query, initDb } = require('../config/db');

async function explainSystem() {
    await initDb();

    console.log('=== UNDERSTANDING THE SYSTEM ===\n');

    // 1. What is TERMINAL?
    console.log('--- 1. WHAT IS TERMINAL? ---');
    console.log('Terminal = The ID of the delivery truck/device generating the albaran.');
    console.log('Each repartidor has a terminal number. So Albaran #3 can exist:');
    console.log('  - Terminal 33 (Repartidor GOYO): Albaran 3, Cliente *296, 187€');
    console.log('  - Terminal 2 (Otro repartidor): Albaran 3, Cliente *8230, 238€');
    console.log('  - Terminal 5 (Otro repartidor): Albaran 3, Cliente *10320, 46€');
    console.log('They are DIFFERENT deliveries, just same albaran number on different terminals.\n');

    // 2. Albaran vs Factura
    console.log('--- 2. ALBARAN vs FACTURA ---');
    try {
        const facVsAlb = await query(`
            SELECT 
                CASE WHEN CAC.NUMEROFACTURA > 0 THEN 'FACTURA' ELSE 'ALBARAN' END as TIPO,
                COUNT(*) as CANT
            FROM DSEDAC.CPC CPC
            INNER JOIN DSEDAC.CAC CAC ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
                AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
                AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            WHERE CPC.ANODOCUMENTO = 2026 AND CPC.MESDOCUMENTO = 1 AND CPC.DIADOCUMENTO = 17
            GROUP BY CASE WHEN CAC.NUMEROFACTURA > 0 THEN 'FACTURA' ELSE 'ALBARAN' END
        `, false);
        console.log('TODAY (17/1/2026):');
        facVsAlb.forEach(r => console.log(`  ${r.TIPO}: ${r.CANT} documentos`));
    } catch (e) {
        console.log('Error:', e.message);
    }

    // 3. Check today's data with specific repartidor
    console.log('\n--- 3. DATA FOR REPARTIDOR 44 TODAY ---');
    try {
        const today = await query(`
            SELECT 
                OPP.DIAREPARTO, OPP.MESREPARTO, OPP.ANOREPARTO,
                COUNT(*) as ENTREGAS
            FROM DSEDAC.OPP OPP
            WHERE TRIM(OPP.CODIGOREPARTIDOR) = '44'
              AND OPP.ANOREPARTO = 2026 AND OPP.MESREPARTO = 1
            GROUP BY OPP.DIAREPARTO, OPP.MESREPARTO, OPP.ANOREPARTO
            ORDER BY OPP.DIAREPARTO
        `, false);
        console.log('Dias con entregas para Repartidor 44:');
        today.forEach(d => console.log(`  ${d.DIAREPARTO}/${d.MESREPARTO}/${d.ANOREPARTO}: ${d.ENTREGAS} entregas`));
    } catch (e) {
        console.log('Error:', e.message);
    }

    // 4. Check form of payment for albaran vs factura
    console.log('\n--- 4. PAYMENT FORM FOR ALBARANES vs FACTURAS ---');
    try {
        const payTypes = await query(`
            SELECT 
                CASE WHEN CAC.NUMEROFACTURA > 0 THEN 'FACTURA' ELSE 'ALBARAN' END as DOC_TIPO,
                TRIM(CPC.CODIGOFORMAPAGO) as FORMA_PAGO,
                COUNT(*) as CANT
            FROM DSEDAC.CPC CPC
            INNER JOIN DSEDAC.CAC CAC ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
                AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
                AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            WHERE CPC.ANODOCUMENTO = 2026 AND CPC.MESDOCUMENTO = 1
            GROUP BY CASE WHEN CAC.NUMEROFACTURA > 0 THEN 'FACTURA' ELSE 'ALBARAN' END, CPC.CODIGOFORMAPAGO
            ORDER BY 1, 3 DESC
            FETCH FIRST 20 ROWS ONLY
        `, false);
        console.log('Payment by Document Type:');
        payTypes.forEach(p => console.log(`  ${p.DOC_TIPO} + ${p.FORMA_PAGO || "''"}: ${p.CANT}`));
    } catch (e) {
        console.log('Error:', e.message);
    }

    process.exit();
}

explainSystem();
