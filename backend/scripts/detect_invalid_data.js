/**
 * Detect Invalid Data Script
 * Detects and logs invalid data patterns like "CTR CTR CTR" or mismatched quantities
 */

const { query, initDb } = require('../config/db');

async function detectInvalidData() {
    await initDb();

    console.log('=== INVALID DATA DETECTION ===\n');

    // Check 1: Detect duplicate payment codes in description fields
    console.log('--- Check 1: Invalid Payment Codes ---');
    try {
        const sql1 = `
            SELECT DISTINCT TRIM(CPC.CODIGOFORMAPAGO) as CODIGO
            FROM DSEDAC.CPC CPC
            WHERE CPC.ANODOCUMENTO >= 2025
              AND (
                  UPPER(TRIM(CPC.CODIGOFORMAPAGO)) LIKE '%CTR CTR%'
                  OR UPPER(TRIM(CPC.CODIGOFORMAPAGO)) LIKE '% %'
                  OR LENGTH(TRIM(CPC.CODIGOFORMAPAGO)) > 10
              )
            FETCH FIRST 20 ROWS ONLY
        `;
        const rows1 = await query(sql1, false) || [];
        if (rows1.length > 0) {
            console.log('  Found suspicious payment codes:');
            rows1.forEach(r => console.log(`    - "${r.CODIGO}"`));
        } else {
            console.log('  ✓ No suspicious payment codes found');
        }
    } catch (e) {
        console.log(`  Error: ${e.message}`);
    }

    // Check 2: Detect mismatched quantities (delivered > ordered)
    console.log('\n--- Check 2: Quantity Mismatches ---');
    try {
        // This would check JAVIER.REPARTIDOR_ENTREGA_LINEAS if it exists
        const sql2 = `
            SELECT COUNT(*) as CNT
            FROM JAVIER.REPARTIDOR_ENTREGA_LINEAS
            WHERE CANTIDAD_ENTREGADA > CANTIDAD_PEDIDA * 1.5
              AND CANTIDAD_PEDIDA > 0
        `;
        const rows2 = await query(sql2, false) || [];
        const mismatchCount = rows2[0]?.CNT || 0;
        if (mismatchCount > 0) {
            console.log(`  ⚠ Found ${mismatchCount} records with delivered > ordered by 50%+`);
        } else {
            console.log('  ✓ No significant quantity mismatches');
        }
    } catch (e) {
        console.log(`  Note: ${e.message} (table may not exist yet)`);
    }

    // Check 3: Detect orphan records
    console.log('\n--- Check 3: Orphan OPP Records ---');
    try {
        const sql3 = `
            SELECT COUNT(*) as CNT
            FROM DSEDAC.OPP OPP
            LEFT JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            WHERE CPC.NUMEROALBARAN IS NULL
              AND OPP.ANOREPARTO >= 2025
        `;
        const rows3 = await query(sql3, false) || [];
        const orphanCount = rows3[0]?.CNT || 0;
        if (orphanCount > 0) {
            console.log(`  ⚠ Found ${orphanCount} OPP records without matching CPC`);
        } else {
            console.log('  ✓ All OPP records have matching CPC');
        }
    } catch (e) {
        console.log(`  Error: ${e.message}`);
    }

    // Check 4: Validate amounts
    console.log('\n--- Check 4: Amount Validation ---');
    try {
        const sql4 = `
            SELECT COUNT(*) as CNT
            FROM DSEDAC.CPC
            WHERE IMPORTETOTAL < 0
              AND ANODOCUMENTO >= 2025
        `;
        const rows4 = await query(sql4, false) || [];
        const negativeCount = rows4[0]?.CNT || 0;
        if (negativeCount > 0) {
            console.log(`  ℹ Found ${negativeCount} records with negative amounts (returns/credits)`);
        } else {
            console.log('  ✓ No negative amounts');
        }
    } catch (e) {
        console.log(`  Error: ${e.message}`);
    }

    console.log('\n=== DETECTION COMPLETE ===');
    process.exit();
}

detectInvalidData().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
