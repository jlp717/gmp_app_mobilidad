const { query, initDb } = require('../config/db');

async function debugPaymentConditions() {
    await initDb();

    console.log('=== 1. CHECK JAVIER.PAYMENT_CONDITIONS TABLE ===\n');
    try {
        const pc = await query(`SELECT * FROM JAVIER.PAYMENT_CONDITIONS ORDER BY CODIGO`);
        console.log(`Records in table: ${pc.length}`);
        pc.forEach(r => console.log(`  ${r.CODIGO}: ${r.DESCRIPCION} (DEBE=${r.DEBE_COBRAR}, COLOR=${r.COLOR})`));
    } catch (e) {
        console.log('Error reading PAYMENT_CONDITIONS:', e.message);
    }

    console.log('\n=== 2. SAMPLE CPC RECORDS WITH DIFFERENT PAYMENT TYPES ===\n');
    try {
        // Get sample albaranes with different payment codes
        const samples = await query(`
            SELECT 
                CPC.NUMEROALBARAN,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
                TRIM(CPC.CODIGOFORMAPAGO) as FORMA_PAGO,
                CPC.IMPORTEBRUTO,
                CPC.IMPORTETOTAL
            FROM DSEDAC.CPC
            WHERE CPC.ANODOCUMENTO = 2026 AND CPC.MESDOCUMENTO = 1
              AND CPC.IMPORTEBRUTO > 0
            FETCH FIRST 20 ROWS ONLY
        `);

        console.log('Sample albaranes with their payment codes:');
        const byPayment = {};
        samples.forEach(s => {
            const fp = s.FORMA_PAGO || '(empty)';
            if (!byPayment[fp]) byPayment[fp] = [];
            byPayment[fp].push(s);
        });

        for (const [fp, items] of Object.entries(byPayment)) {
            console.log(`\nPayment Code "${fp}":`);
            items.slice(0, 3).forEach(i => {
                console.log(`  Albaran ${i.NUMEROALBARAN}, Cliente ${i.CLIENTE}: Bruto=${i.IMPORTEBRUTO}€, Total=${i.IMPORTETOTAL}€`);
            });
        }
    } catch (e) {
        console.log('Error:', e.message);
    }

    console.log('\n=== 3. FIND CLIENTS WITH DIFFERENT PAYMENT CODES FOR TESTING ===\n');
    try {
        // Find at least one client per payment type
        const types = ['02', 'D6', 'D2', 'C2', 'T0', 'D3'];
        for (const fp of types) {
            const sample = await query(`
                SELECT 
                    CPC.NUMEROALBARAN as ALB,
                    TRIM(CPC.CODIGOCLIENTEALBARAN) as CLI,
                    TRIM(CLI.NOMBRECLIENTE) as NOMBRE,
                    CPC.IMPORTEBRUTO as BRUTO
                FROM DSEDAC.CPC CPC
                LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
                WHERE CPC.ANODOCUMENTO = 2026 AND CPC.MESDOCUMENTO = 1
                  AND TRIM(CPC.CODIGOFORMAPAGO) = '${fp}'
                  AND CPC.IMPORTEBRUTO > 10
                FETCH FIRST 1 ROWS ONLY
            `);
            if (sample.length > 0) {
                const s = sample[0];
                console.log(`${fp}: Cliente ${s.CLI} (${(s.NOMBRE || '').trim().substring(0, 25)}), Albaran ${s.ALB}, ${s.BRUTO}€`);
            } else {
                console.log(`${fp}: No samples found`);
            }
        }
    } catch (e) {
        console.log('Error:', e.message);
    }

    console.log('\n=== 4. CHECK SPECIFIC ALBARAN 119 / CLIENT *7515 ===\n');
    try {
        const alb119 = await query(`
            SELECT 
                CPC.NUMEROALBARAN,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLI,
                TRIM(CPC.CODIGOFORMAPAGO) as FP,
                CPC.IMPORTEBRUTO,
                CPC.IMPORTETOTAL
            FROM DSEDAC.CPC
            WHERE CPC.ANODOCUMENTO = 2026 
              AND (CPC.NUMEROALBARAN = 119 OR TRIM(CPC.CODIGOCLIENTEALBARAN) LIKE '%7515')
            FETCH FIRST 5 ROWS ONLY
        `);
        console.log('Albaran 119 or client *7515:');
        alb119.forEach(a => console.log(`  Alb ${a.NUMEROALBARAN}, Cliente ${a.CLI}, FP=${a.FP}, Bruto=${a.IMPORTEBRUTO}€`));
    } catch (e) {
        console.log('Error:', e.message);
    }

    console.log('\n=== 5. CHECK IF PAYMENT_CONDITIONS HAS CORRECT CODES ===\n');
    try {
        // Check if codes in CPC match codes in PAYMENT_CONDITIONS
        const cpcCodes = await query(`
            SELECT DISTINCT TRIM(CODIGOFORMAPAGO) as FP
            FROM DSEDAC.CPC
            WHERE ANODOCUMENTO = 2026
        `);

        const pcCodes = await query(`SELECT CODIGO FROM JAVIER.PAYMENT_CONDITIONS`);
        const pcSet = new Set(pcCodes.map(p => p.CODIGO.trim()));

        console.log('CPC payment codes vs PAYMENT_CONDITIONS:');
        cpcCodes.forEach(c => {
            const fp = (c.FP || '').trim();
            const exists = pcSet.has(fp);
            console.log(`  "${fp}": ${exists ? '✅ In table' : '❌ MISSING'}`);
        });
    } catch (e) {
        console.log('Error:', e.message);
    }

    process.exit();
}

debugPaymentConditions();
