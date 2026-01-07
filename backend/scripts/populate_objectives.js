const { query, initDb } = require('../config/db');

async function populateDefaults() {
    try {
        await initDb();
        console.log('🚀 Populating Objectives Config with defaults (10%)...');

        // 1. Get all active Client-Vendor pairs from recent sales (last 2 years)
        // We filter out internal/invalid codes as usual
        const sqlGetPairs = `
      SELECT DISTINCT TRIM(CODIGOVENDEDOR) as VENDOR, TRIM(CODIGOCLIENTEALBARAN) as CLIENT
      FROM DSEDAC.LAC
      WHERE ANODOCUMENTO >= YEAR(CURRENT DATE) - 2
        AND LCTPVT <> 'SC'
        AND LCSRAB NOT IN ('K', 'N', 'O', 'G')
    `;

        const rows = await query(sqlGetPairs);
        console.log(`📊 Found ${rows.length} active client-vendor pairs.`);

        let inserted = 0;
        let skipped = 0;

        // 2. Insert into JAVIER.OBJ_CONFIG
        // We use a loop or batch insert. DB2 via ODBC can be picky with batch, so we'll do loop with try-catch for duplicates.
        // Or we could use MERGE if supported, but simple INSERT IGNORE logic is safer for this script.

        for (const row of rows) {
            if (!row.VENDOR || !row.CLIENT) continue;

            try {
                await query(`
          INSERT INTO JAVIER.OBJ_CONFIG (CODIGOVENDEDOR, CODIGOCLIENTE, TARGET_PERCENTAGE, UPDATED_BY)
          VALUES ('${row.VENDOR}', '${row.CLIENT}', 10.00, 'SYSTEM_INIT')
        `, false); // Don't log every insert
                inserted++;
            } catch (e) {
                if (e.message.includes('SQL0803') || e.message.includes('duplicate')) {
                    // Duplicate key, skip
                    skipped++;
                } else {
                    console.error(`❌ Failed to insert ${row.VENDOR}-${row.CLIENT}: ${e.message}`);
                }
            }

            if ((inserted + skipped) % 100 === 0) process.stdout.write('.');
        }

        console.log('\n');
        console.log(`✅ Population Complete: ${inserted} inserted, ${skipped} skipped (already existed).`);
        process.exit(0);

    } catch (error) {
        console.error('❌ Script Fatal Error:', error);
        process.exit(1);
    }
}

populateDefaults();
