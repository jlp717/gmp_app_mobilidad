const { query, initDb } = require('../config/db');

async function debugDomingo() {
    try {
        await initDb();

        const VENDOR = '33';
        const YEAR = 2024;

        console.log(`🔍 Debugging Sales 2024 for DOMINGO (${VENDOR})...`);

        // 1. Raw Total (No filters)
        const sqlRaw = `SELECT SUM(IMPORTEVENTA) as TOTAL FROM DSEDAC.LAC WHERE ANODOCUMENTO = ${YEAR} AND TRIM(CODIGOVENDEDOR) = '${VENDOR}'`;
        const resRaw = await query(sqlRaw);
        const rawTotal = parseFloat(resRaw[0].TOTAL || 0);

        // 2. Filtered (Current Logic)
        // LCTPVT <> 'SC' (No 'Servicios Comerciales'?)
        // LCSRAB NOT IN ('K', 'N', 'O', 'G') (Series filters)
        const sqlFiltered = `
      SELECT SUM(IMPORTEVENTA) as TOTAL 
      FROM DSEDAC.LAC 
      WHERE ANODOCUMENTO = ${YEAR} 
        AND TRIM(CODIGOVENDEDOR) = '${VENDOR}'
        AND LCTPVT <> 'SC'
        AND LCSRAB NOT IN ('K', 'N', 'O', 'G')
    `;
        const resFiltered = await query(sqlFiltered);
        const filteredTotal = parseFloat(resFiltered[0].TOTAL || 0);

        // 3. Alternative Filter (Maybe just excluding Returns?)
        // Typically returns are negative values, which should just be summed. 
        // Maybe user is ignoring Returns (Negative values)?
        const sqlPositives = `
      SELECT SUM(IMPORTEVENTA) as TOTAL 
      FROM DSEDAC.LAC 
      WHERE ANODOCUMENTO = ${YEAR} 
        AND TRIM(CODIGOVENDEDOR) = '${VENDOR}'
        AND IMPORTEVENTA > 0
    `;
        const resPositives = await query(sqlPositives);
        const positivesTotal = parseFloat(resPositives[0].TOTAL || 0);

        console.log('--------------------------------------------------');
        console.log(`RAW TOTAL (All Lines):      ${rawTotal.toLocaleString()} €`);
        console.log(`FILTERED (Current Logic):   ${filteredTotal.toLocaleString()} €  <-- used by app`);
        console.log(`POSITIVES ONLY (No returns):${positivesTotal.toLocaleString()} €`);
        console.log('--------------------------------------------------');
        console.log(`User says:                  821,875.00 €`);

        // Check difference
        const diff = rawTotal - filteredTotal;
        console.log(`Excluded Amount:            ${diff.toLocaleString()} €`);

        // Find what is being excluded
        if (diff > 0) {
            console.log('\nExclusion Breakdown:');
            const sqlExclusions = `
          SELECT LCTPVT, LCSRAB, SUM(IMPORTEVENTA) as AMT, COUNT(*) as COUNT
          FROM DSEDAC.LAC 
          WHERE ANODOCUMENTO = ${YEAR} 
            AND TRIM(CODIGOVENDEDOR) = '${VENDOR}'
            AND (LCTPVT = 'SC' OR LCSRAB IN ('K', 'N', 'O', 'G'))
          GROUP BY LCTPVT, LCSRAB
        `;
            const exclusions = await query(sqlExclusions);
            console.table(exclusions);
        }

        process.exit(0);

    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

debugDomingo();
