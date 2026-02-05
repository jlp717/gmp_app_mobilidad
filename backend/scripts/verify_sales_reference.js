/**
 * Verify sales data matches user's reference Excel
 * Reference totals for January 2026:
 * - 01 GOYO: 12,243.38€
 * - 02 BARTOLO: 82,829.02€
 * - 03 MARTIN MANCHON: 72,333.50€
 * - 05 RODRIGUEZ: 60,013.07€
 * - 10 EDGAR: 141,075.99€
 * - 13 BAYONAS: 52,888.71€ (+ 12,075.15€ B-sales = 64,963.86€)
 * - 15 ALFONSO SALAS: 23,215.57€
 * - 16 FRANCISCO ASENSIO: 35,024.84€
 * - ...
 * Total: 814,759.94€
 */
const { query } = require('../config/db');

// The filter user specified (from Excel)
// TPDC = 'LAC', LCTPVT IN ('CC', 'VC'), LCCLLN IN ('AB', 'VT'), LCSRAB NOT IN ('N', 'Z', 'G', 'D')
const LACLAE_SALES_FILTER = `
    L.TPDC = 'LAC'
    AND L.LCTPVT IN ('CC', 'VC') 
    AND L.LCCLLN IN ('AB', 'VT') 
    AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
`.replace(/\s+/g, ' ').trim();

async function verifySalesByVendor() {
    console.log('=== VERIFYING SALES BY VENDOR (January 2026) ===\n');
    console.log('Filter:', LACLAE_SALES_FILTER);
    console.log('');

    // Expected values from user's Excel (January 2026, MES=1)
    const expected = {
        '01': 12243.38,
        '02': 82829.02,
        '03': 72333.50,
        '05': 60013.07,
        '10': 141075.99,
        '13': 52888.71,  // without B-sales
        '15': 23215.57,
        '16': 35024.84,
        '30': 109.97,
        '33': 35080.89,
        '35': 44982.09,
        '72': 46401.75,
        '73': 56508.93,
        '80': 57291.68,
        '81': 34620.57,
        '83': 1180.47,
        '93': 48842.08,
        '97': 10117.43
    };
    const expectedTotal = 814759.94;

    // Query 1: Using LCAADC (Document Year) - current approach
    console.log('--- Query using LCAADC (Document Year) ---');
    const rowsLCAADC = await query(`
        SELECT 
            TRIM(L.LCCDVD) as VENDOR,
            SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE L.LCAADC = 2026 AND L.LCMMDC = 1
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCCDVD
        ORDER BY VENDOR
    `, false);

    console.log('\nVendor Sales (LCAADC=2026, LCMMDC=1):');
    let totalLCAADC = 0;
    for (const row of rowsLCAADC) {
        const vd = row.VENDOR?.trim() || 'NULL';
        const sales = parseFloat(row.SALES) || 0;
        totalLCAADC += sales;
        const exp = expected[vd];
        const diff = exp ? (sales - exp).toFixed(2) : 'N/A';
        const match = exp && Math.abs(sales - exp) < 1 ? '✅' : '❌';
        console.log(`  ${vd.padEnd(5)} ${sales.toFixed(2).padStart(12)}  (expected: ${exp ? exp.toFixed(2) : 'N/A'}, diff: ${diff}) ${match}`);
    }
    console.log(`\n  TOTAL: ${totalLCAADC.toFixed(2)} (expected: ${expectedTotal.toFixed(2)}, diff: ${(totalLCAADC - expectedTotal).toFixed(2)})`);

    // Query 2: Using LCYEAB (Albaran Year) - alternative
    console.log('\n--- Query using LCYEAB (Albaran Year) ---');
    const rowsLCYEAB = await query(`
        SELECT 
            TRIM(L.LCCDVD) as VENDOR,
            SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE L.LCYEAB = 2026 AND L.LCMMDC = 1
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCCDVD
        ORDER BY VENDOR
    `, false);

    console.log('\nVendor Sales (LCYEAB=2026, LCMMDC=1):');
    let totalLCYEAB = 0;
    for (const row of rowsLCYEAB) {
        const vd = row.VENDOR?.trim() || 'NULL';
        const sales = parseFloat(row.SALES) || 0;
        totalLCYEAB += sales;
        const exp = expected[vd];
        const diff = exp ? (sales - exp).toFixed(2) : 'N/A';
        const match = exp && Math.abs(sales - exp) < 1 ? '✅' : '❌';
        console.log(`  ${vd.padEnd(5)} ${sales.toFixed(2).padStart(12)}  (expected: ${exp ? exp.toFixed(2) : 'N/A'}, diff: ${diff}) ${match}`);
    }
    console.log(`\n  TOTAL: ${totalLCYEAB.toFixed(2)} (expected: ${expectedTotal.toFixed(2)}, diff: ${(totalLCYEAB - expectedTotal).toFixed(2)})`);

    // Check BARTOLO (02) specifically
    console.log('\n--- BARTOLO (02) Detailed Analysis ---');
    const bartoloDetail = await query(`
        SELECT 
            L.LCSRAB as SERIE,
            COUNT(*) as NUM_ROWS,
            SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE L.LCAADC = 2026 AND L.LCMMDC = 1
          AND TRIM(L.LCCDVD) = '2'
          AND L.TPDC = 'LAC'
          AND L.LCTPVT IN ('CC', 'VC') 
          AND L.LCCLLN IN ('AB', 'VT')
        GROUP BY L.LCSRAB
        ORDER BY L.LCSRAB
    `, false);
    console.log('Sales by SERIE (before exclusion):');
    let bartoloTotal = 0;
    let excludedTotal = 0;
    for (const row of bartoloDetail) {
        const serie = row.SERIE?.trim() || 'NULL';
        const sales = parseFloat(row.SALES) || 0;
        const excluded = ['N', 'Z', 'G', 'D'].includes(serie);
        if (excluded) {
            excludedTotal += sales;
            console.log(`  ${serie}: ${sales.toFixed(2)} [EXCLUDED]`);
        } else {
            bartoloTotal += sales;
            console.log(`  ${serie}: ${sales.toFixed(2)}`);
        }
    }
    console.log(`\n  Included: ${bartoloTotal.toFixed(2)}`);
    console.log(`  Excluded (N,Z,G,D): ${excludedTotal.toFixed(2)}`);
    console.log(`  Expected: 82,829.02€`);
    console.log(`  Difference: ${(bartoloTotal - 82829.02).toFixed(2)}`);

    process.exit(0);
}

verifySalesByVendor().catch(e => {
    console.error('Error:', e);
    process.exit(1);
});
