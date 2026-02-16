/**
 * DIAGNOSTIC: Check LCYEAB vs LCAADC difference
 * And verify what each endpoint actually returns
 */
const odbc = require('odbc');

const LACLAE_SALES_FILTER = `
    L.TPDC = 'LAC'
    AND L.LCTPVT IN ('CC', 'VC')
    AND L.LCCLLN IN ('AB', 'VT')
    AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
`;

async function main() {
    const pool = await odbc.pool('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');

    console.log('=== DIAGNOSTIC: LCYEAB vs LCAADC ===\n');

    // TEST 1: Do LCYEAB and LCAADC differ?
    console.log('--- TEST 1: Records where LCYEAB != LCAADC (Feb 2026) ---');
    const diff = await pool.query(`
        SELECT COUNT(*) as CNT, SUM(L.LCIMVT) as SALES_DIFF
        FROM DSED.LACLAE L
        WHERE L.LCMMDC = 2
          AND ${LACLAE_SALES_FILTER}
          AND L.LCYEAB != L.LCAADC
          AND (L.LCYEAB = 2026 OR L.LCAADC = 2026)
    `);
    console.log(`  Mismatched records: ${diff[0]?.CNT}`);
    console.log(`  Sales amount in mismatched: ${parseFloat(diff[0]?.SALES_DIFF || 0).toFixed(2)}€\n`);

    // TEST 2: Sales using LCYEAB vs LCAADC for Feb 2026
    console.log('--- TEST 2: Total sales Feb 2026 by each year column ---');
    const byYEAB = await pool.query(`
        SELECT SUM(L.LCIMVT) as TOTAL
        FROM DSED.LACLAE L
        WHERE L.LCYEAB = 2026 AND L.LCMMDC = 2
          AND ${LACLAE_SALES_FILTER}
    `);
    const byAADC = await pool.query(`
        SELECT SUM(L.LCIMVT) as TOTAL
        FROM DSED.LACLAE L
        WHERE L.LCAADC = 2026 AND L.LCMMDC = 2
          AND ${LACLAE_SALES_FILTER}
    `);
    const yeabTotal = parseFloat(byYEAB[0]?.TOTAL) || 0;
    const aadcTotal = parseFloat(byAADC[0]?.TOTAL) || 0;
    console.log(`  LCYEAB=2026 & LCMMDC=2: ${yeabTotal.toFixed(2)}€`);
    console.log(`  LCAADC=2026 & LCMMDC=2: ${aadcTotal.toFixed(2)}€`);
    console.log(`  Difference: ${(yeabTotal - aadcTotal).toFixed(2)}€\n`);

    // TEST 3: Same for full year 2026 (all months)
    console.log('--- TEST 3: Total sales Year 2026 (all months) ---');
    const byYEAB_year = await pool.query(`
        SELECT SUM(L.LCIMVT) as TOTAL
        FROM DSED.LACLAE L
        WHERE L.LCYEAB = 2026
          AND ${LACLAE_SALES_FILTER}
    `);
    const byAADC_year = await pool.query(`
        SELECT SUM(L.LCIMVT) as TOTAL
        FROM DSED.LACLAE L
        WHERE L.LCAADC = 2026
          AND ${LACLAE_SALES_FILTER}
    `);
    console.log(`  LCYEAB=2026 all months: ${parseFloat(byYEAB_year[0]?.TOTAL || 0).toFixed(2)}€`);
    console.log(`  LCAADC=2026 all months: ${parseFloat(byAADC_year[0]?.TOTAL || 0).toFixed(2)}€\n`);

    // TEST 4: Dashboard metrics simulation (LCYEAB)
    console.log('--- TEST 4: Dashboard /metrics simulation ---');
    const dashCurr = await pool.query(`
        SELECT COALESCE(SUM(L.LCIMVT), 0) as sales
        FROM DSED.LACLAE L
        WHERE L.LCYEAB = 2026 AND L.LCMMDC = 2
          AND ${LACLAE_SALES_FILTER}
    `);
    const dashPrev = await pool.query(`
        SELECT COALESCE(SUM(L.LCIMVT), 0) as sales
        FROM DSED.LACLAE L
        WHERE L.LCYEAB = 2025 AND L.LCMMDC = 2
          AND ${LACLAE_SALES_FILTER}
    `);
    console.log(`  Dashboard Feb 2026 (LCYEAB): ${parseFloat(dashCurr[0]?.SALES).toFixed(2)}€`);
    console.log(`  Dashboard Feb 2025 (LCYEAB): ${parseFloat(dashPrev[0]?.SALES).toFixed(2)}€\n`);

    // TEST 5: Objectives simulation (LCAADC)
    console.log('--- TEST 5: Objectives simulation ---');
    const objCurr = await pool.query(`
        SELECT L.LCAADC as YEAR, L.LCMMDC as MONTH, SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE L.LCAADC IN (2026, 2025)
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCAADC, L.LCMMDC
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC
    `);
    for (const r of objCurr) {
        if (r.MONTH === 2 || r.MONTH === 1) {
            console.log(`  Objectives ${r.YEAR}-${String(r.MONTH).padStart(2,'0')} (LCAADC): ${parseFloat(r.SALES).toFixed(2)}€`);
        }
    }

    // TEST 6: Commissions simulation - calculateVendorData uses LCAADC
    console.log('\n--- TEST 6: Commissions calculateVendorData simulation (LCAADC) ---');
    const commCurr = await pool.query(`
        SELECT L.LCAADC as YEAR, L.LCMMDC as MONTH, SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE L.LCAADC IN (2026, 2025)
          AND ${LACLAE_SALES_FILTER}
          AND L.LCCDVD IS NOT NULL AND TRIM(L.LCCDVD) <> ''
        GROUP BY L.LCAADC, L.LCMMDC
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC
    `);
    for (const r of commCurr) {
        if (r.MONTH === 2 || r.MONTH === 1) {
            console.log(`  Commissions ${r.YEAR}-${String(r.MONTH).padStart(2,'0')} (LCAADC): ${parseFloat(r.SALES).toFixed(2)}€`);
        }
    }

    // TEST 7: Check if DSEDAC.LAC works with LACLAE_SALES_FILTER (matrix uses it)
    console.log('\n--- TEST 7: DSEDAC.LAC with LACLAE_SALES_FILTER ---');
    try {
        const lacTest = await pool.query(`
            SELECT SUM(L.LCIMVT) as TOTAL
            FROM DSEDAC.LAC L
            WHERE L.LCAADC = 2026 AND L.LCMMDC = 2
              AND ${LACLAE_SALES_FILTER}
        `);
        console.log(`  DSEDAC.LAC with LACLAE filter: ${parseFloat(lacTest[0]?.TOTAL || 0).toFixed(2)}€`);
    } catch(e) {
        console.log(`  ERROR: DSEDAC.LAC doesn't support LACLAE_SALES_FILTER: ${e.message}`);
    }

    // TEST 8: DSED.LACLAE with same filter (reference)
    const laclaeTest = await pool.query(`
        SELECT SUM(L.LCIMVT) as TOTAL
        FROM DSED.LACLAE L
        WHERE L.LCAADC = 2026 AND L.LCMMDC = 2
          AND ${LACLAE_SALES_FILTER}
    `);
    console.log(`  DSED.LACLAE with LACLAE filter: ${parseFloat(laclaeTest[0]?.TOTAL || 0).toFixed(2)}€`);

    console.log('\n=== DIAGNOSTIC COMPLETE ===');
    await pool.close();
}

main().catch(e => console.error('Error:', e.message));
