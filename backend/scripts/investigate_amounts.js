const { query, initDb } = require('../config/db');

async function investigateAmounts() {
    await initDb();

    console.log('=== CPC FIELDS CHECK ===\n');

    // Check what columns CPC has for amounts
    try {
        const sample = await query(`
            SELECT * FROM DSEDAC.CPC
            WHERE ANODOCUMENTO = 2026 AND MESDOCUMENTO = 1 AND IMPORTETOTAL > 100
            FETCH FIRST 1 ROWS ONLY
        `);

        if (sample.length > 0) {
            const cols = Object.keys(sample[0]).filter(c =>
                c.includes('IMPORTE') || c.includes('TOTAL') || c.includes('IVA')
            );
            console.log('Amount-related columns in CPC:');
            cols.forEach(c => console.log(`  ${c}: ${sample[0][c]}`));
        }
    } catch (e) {
        console.log('Error:', e.message);
    }

    console.log('\n=== COMPARE CPC.IMPORTETOTAL VS LAC SUM ===');
    try {
        const cpc = await query(`
            SELECT EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN, IMPORTETOTAL
            FROM DSEDAC.CPC
            WHERE ANODOCUMENTO = 2026 AND MESDOCUMENTO = 1 AND IMPORTETOTAL > 100
            FETCH FIRST 3 ROWS ONLY
        `);

        for (const alb of cpc) {
            const lac = await query(`
                SELECT IMPORTEVENTA FROM DSEDAC.LAC
                WHERE EJERCICIOALBARAN = ${alb.EJERCICIOALBARAN}
                  AND SERIEALBARAN = '${(alb.SERIEALBARAN || '').trim()}'
                  AND TERMINALALBARAN = ${alb.TERMINALALBARAN}
                  AND NUMEROALBARAN = ${alb.NUMEROALBARAN}
            `);

            const lacSum = lac.reduce((sum, l) => sum + (parseFloat(l.IMPORTEVENTA) || 0), 0);
            const diff = (alb.IMPORTETOTAL - lacSum).toFixed(2);

            console.log(`Alb ${alb.NUMEROALBARAN}: CPC=${alb.IMPORTETOTAL}€, LAC sum=${lacSum.toFixed(2)}€, Diff=${diff}€`);
        }
    } catch (e) {
        console.log('Error:', e.message);
    }

    process.exit();
}

investigateAmounts();
