const { query, initDb } = require('../config/db');

async function investigateFOP() {
    await initDb();

    console.log('=== 1. FOP TABLE - ALL PAYMENT CONDITIONS ===\n');
    try {
        const fop = await query(`SELECT * FROM DSEDAC.FOP`);

        console.log(`Found ${fop.length} payment conditions:\n`);

        fop.forEach(f => {
            console.log(`CODE: ${f.CODIGOFORMAPAGO}`);
            console.log(`  DESC: ${(f.DESCRIPCIONFORMAPAGO || '').trim()}`);
            console.log(`  CONTADOSN: ${f.CONTADOSN} (S=Contado)`);
            console.log(`  PRIMERPAGO: ${f.PRIMERPAGO} días`);
            console.log(`  NUMEROPAGOS: ${f.NUMEROPAGOS}`);
            console.log(`  PAGARESN: ${f.PAGARESN}`);
            console.log(`  EFECTIVOSN: ${f.EFECTIVOSN}`);
            console.log(`  TRANSFERENCIASN: ${f.TRANSFERENCIASN}`);
            console.log(`  GENERARVENCIMIENTOSSN: ${f.GENERARVENCIMIENTOSSN}`);
            console.log('');
        });
    } catch (e) {
        console.log('FOP error:', e.message);
    }

    console.log('\n=== 2. WHAT PAYMENT CODES ARE USED IN CPC TODAY? ===\n');
    try {
        const used = await query(`
            SELECT TRIM(CODIGOFORMAPAGO) as FP, COUNT(*) as CNT
            FROM DSEDAC.CPC
            WHERE ANODOCUMENTO = 2026 AND MESDOCUMENTO = 1
            GROUP BY TRIM(CODIGOFORMAPAGO)
            ORDER BY CNT DESC
        `);
        console.log('Payment codes used in Jan 2026:');
        used.forEach(u => console.log(`  ${u.FP}: ${u.CNT} albaranes`));
    } catch (e) {
        console.log('Error:', e.message);
    }

    console.log('\n=== 3. CHECK SAMPLE CPC RECORDS FORMA_PAGO ===\n');
    try {
        const samples = await query(`
            SELECT 
                TRIM(CODIGOFORMAPAGO) as FP,
                IMPORTETOTAL,
                IMPORTEBRUTO,
                TRIM(CODIGOCLIENTEALBARAN) as CLI
            FROM DSEDAC.CPC
            WHERE ANODOCUMENTO = 2026 AND MESDOCUMENTO = 1
            FETCH FIRST 10 ROWS ONLY
        `);
        console.log('Sample CPC records:');
        samples.forEach(s => console.log(`  Cliente ${s.CLI}: FP='${s.FP}', Total=${s.IMPORTETOTAL}€, Bruto=${s.IMPORTEBRUTO}€`));
    } catch (e) {
        console.log('Error:', e.message);
    }

    console.log('\n=== 4. COMPARE FOP.CONTADOSN FOR USED CODES ===\n');
    try {
        const compare = await query(`
            SELECT 
                TRIM(FOP.CODIGOFORMAPAGO) as CODE,
                TRIM(FOP.DESCRIPCIONFORMAPAGO) as DESC,
                FOP.CONTADOSN,
                FOP.PRIMERPAGO,
                FOP.EFECTIVOSN,
                FOP.TRANSFERENCIASN
            FROM DSEDAC.FOP
            WHERE TRIM(FOP.CODIGOFORMAPAGO) IN ('01', '02', 'C2', 'C5', 'D1', 'D2', 'D3', 'D6', 'D8', 'T0', 'G1', 'RP')
        `);
        console.log('Payment type analysis:');
        compare.forEach(c => {
            const mustCollect = c.CONTADOSN === 'S' || c.EFECTIVOSN === 'S' || c.PRIMERPAGO === 0;
            console.log(`  ${c.CODE}: ${c.DESC}`);
            console.log(`    CONTADOSN=${c.CONTADOSN}, EFECTIVOSN=${c.EFECTIVOSN}, PRIMERPAGO=${c.PRIMERPAGO}d`);
            console.log(`    → DEBE COBRAR: ${mustCollect ? 'SÍ' : 'NO'}`);
        });
    } catch (e) {
        console.log('Error:', e.message);
    }

    process.exit();
}

investigateFOP();
