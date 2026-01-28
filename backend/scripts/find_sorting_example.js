const { query, initDb } = require('../config/db');

async function findContrast() {
    try {
        await initDb();
        console.log('🔍 Searching for Sort Contrast (Original Code vs Custom Order)...');

        // 1. Get stats of vendors with most overrides
        const topVendors = await query(`
            SELECT TRIM(VENDEDOR) as V, TRIM(DIA) as D, COUNT(*) as C
            FROM JAVIER.RUTERO_CONFIG
            WHERE ORDEN IS NOT NULL AND ORDEN > 0
            GROUP BY VENDEDOR, DIA
            ORDER BY C DESC
            FETCH FIRST 20 ROWS ONLY
        `);

        for (const { V, D } of topVendors) {
            // 2. Fetch details
            const rows = await query(`
                SELECT TRIM(CLIENTE) as CODE, ORDEN
                FROM JAVIER.RUTERO_CONFIG
                WHERE VENDEDOR = '${V}' AND DIA = '${D}'
                AND ORDEN > 0 -- Only manually ordered ones
                ORDER BY ORDEN ASC
            `);

            if (rows.length < 5) continue; // Need enough data

            const customOrder = rows.map(r => r.CODE);
            const originalOrder = [...rows].sort((a, b) => a.CODE.localeCompare(b.CODE)).map(r => r.CODE);

            // Check if different
            let isDifferent = false;
            let diffDetails = [];

            for (let i = 0; i < customOrder.length; i++) {
                if (customOrder[i] !== originalOrder[i]) {
                    isDifferent = true;
                    // Find a striking example: 
                    // Client Code X is Position A in Custom, but Position B in Original
                    const code = customOrder[i];
                    const customPos = i + 1;
                    const originalPos = originalOrder.indexOf(code) + 1;

                    if (Math.abs(customPos - originalPos) > 3) { // Significant move
                        diffDetails.push({ code, customPos, originalPos });
                    }
                }
            }

            if (isDifferent && diffDetails.length > 0) {
                console.log(`\n🎯 FOUND EXAMPLE: Vendor ${V} - ${D} (${rows.length} manual clients)`);
                console.log('   Expected Behavior:');

                // Pick the top diff
                const example = diffDetails[0];
                console.log(`   🔸 Client ${example.code}:`);
                console.log(`      - Modo ORIGINAL (Por Código): Estará en posición #${example.originalPos}`);
                console.log(`      - Modo PERSONALIZADO:         Estará en posición #${example.customPos}`);

                // Show top 5 comparison
                console.log('\n   Top 5 Comparison:');
                console.log('   #  | Original (Code) | Personalizado (Orden)');
                console.log('   ---|-----------------|----------------------');
                for (let k = 0; k < 5 && k < rows.length; k++) {
                    console.log(`   ${k + 1}  | ${originalOrder[k]}      | ${customOrder[k]}`);
                }

                process.exit(0); // Found one, stop
            }
        }

        console.log('❌ No strong examples found.');
        process.exit(0);

    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
findContrast();
