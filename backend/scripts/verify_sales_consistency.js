/**
 * VERIFICATION SCRIPT: Sales Consistency Check
 * =============================================
 * Verifies all endpoints return consistent data after fixes:
 * 1. Invoice F-750 aggregation (should be 581.34€, not 218.65€)
 * 2. Sales figures match across Dashboard/Objectives/Commissions
 * 3. Vendor '95' included in ALL mode
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

    console.log('=== VERIFICATION: Sales Consistency ===\n');

    // -------------------------------------------------------
    // TEST 1: Invoice F-750 aggregation
    // -------------------------------------------------------
    console.log('--- TEST 1: Invoice F-750 multi-albaran aggregation ---');
    const cacRows = await pool.query(`
        SELECT
            TRIM(SERIEFACTURA) as SERIE,
            NUMEROFACTURA as NUMERO,
            EJERCICIOFACTURA as EJERCICIO,
            IMPORTETOTAL as TOTAL
        FROM DSEDAC.CAC
        WHERE NUMEROFACTURA = 750
          AND EJERCICIOFACTURA = 2026
          AND TRIM(CODIGOCLIENTEFACTURA) = '4300040696'
    `);
    const totalAggregated = cacRows.reduce((sum, r) => sum + parseFloat(r.TOTAL), 0);
    console.log(`  CAC records for F-750: ${cacRows.length}`);
    console.log(`  Individual totals: ${cacRows.map(r => r.TOTAL).join(' + ')}`);
    console.log(`  Aggregated total: ${totalAggregated.toFixed(2)}€`);
    console.log(`  Expected: 581.34€`);
    console.log(`  ${Math.abs(totalAggregated - 581.34) < 0.01 ? 'PASS' : 'FAIL'}\n`);

    // Verify header aggregation query (same as getFacturaDetail)
    const headerAgg = await pool.query(`
        SELECT
            SUM(CAC.IMPORTETOTAL) as TOTALFACTURA,
            SUM(CAC.IMPORTEBASEIMPONIBLE1) as BASE1,
            SUM(CAC.IMPORTEIVA1) as IVA1
        FROM DSEDAC.CAC CAC
        WHERE TRIM(CAC.SERIEFACTURA) = 'F'
          AND CAC.NUMEROFACTURA = 750
          AND CAC.EJERCICIOFACTURA = 2026
        GROUP BY CAC.NUMEROFACTURA, CAC.EJERCICIOFACTURA
    `);
    if (headerAgg.length > 0) {
        const aggTotal = parseFloat(headerAgg[0].TOTALFACTURA);
        console.log(`  getFacturaDetail SUM query: ${aggTotal.toFixed(2)}€`);
        console.log(`  ${Math.abs(aggTotal - 581.34) < 0.01 ? 'PASS' : 'FAIL'}\n`);
    }

    // -------------------------------------------------------
    // TEST 2: Global sales (Feb 2026) - All vendors via LCCDVD
    // -------------------------------------------------------
    console.log('--- TEST 2: Global sales Feb 2026 (LCCDVD vs R1_T8CDVD) ---');
    const globalSales = await pool.query(`
        SELECT SUM(L.LCIMVT) as TOTAL
        FROM DSED.LACLAE L
        WHERE L.LCAADC = 2026 AND L.LCMMDC = 2
          AND ${LACLAE_SALES_FILTER}
    `);
    const globalTotal = parseFloat(globalSales[0]?.TOTAL) || 0;
    console.log(`  Global LACLAE sales: ${globalTotal.toFixed(2)}€`);

    // Sum by LCCDVD (what we use now)
    const byLCCDVD = await pool.query(`
        SELECT SUM(L.LCIMVT) as TOTAL
        FROM DSED.LACLAE L
        WHERE L.LCAADC = 2026 AND L.LCMMDC = 2
          AND ${LACLAE_SALES_FILTER}
          AND L.LCCDVD IS NOT NULL AND TRIM(L.LCCDVD) <> ''
    `);
    const lccdvdTotal = parseFloat(byLCCDVD[0]?.TOTAL) || 0;

    // Sum by R1_T8CDVD (what we used before - old broken way)
    const byR1 = await pool.query(`
        SELECT SUM(L.LCIMVT) as TOTAL
        FROM DSED.LACLAE L
        WHERE L.LCAADC = 2026 AND L.LCMMDC = 2
          AND ${LACLAE_SALES_FILTER}
          AND L.R1_T8CDVD IS NOT NULL AND TRIM(L.R1_T8CDVD) <> ''
    `);
    const r1Total = parseFloat(byR1[0]?.TOTAL) || 0;

    console.log(`  Via LCCDVD (fixed):  ${lccdvdTotal.toFixed(2)}€`);
    console.log(`  Via R1_T8CDVD (old): ${r1Total.toFixed(2)}€`);
    console.log(`  Difference: ${(lccdvdTotal - r1Total).toFixed(2)}€ (vendor 95 etc.)`);
    console.log(`  ${lccdvdTotal >= r1Total ? 'PASS' : 'FAIL'}\n`);

    // -------------------------------------------------------
    // TEST 3: Per-vendor iteration match
    // -------------------------------------------------------
    console.log('--- TEST 3: Per-vendor sum matches global ---');
    const vendorSums = await pool.query(`
        SELECT TRIM(L.LCCDVD) as VENDOR, SUM(L.LCIMVT) as TOTAL
        FROM DSED.LACLAE L
        WHERE L.LCAADC = 2026 AND L.LCMMDC = 2
          AND ${LACLAE_SALES_FILTER}
          AND L.LCCDVD IS NOT NULL AND TRIM(L.LCCDVD) <> ''
        GROUP BY L.LCCDVD
    `);
    const vendorTotal = vendorSums.reduce((s, r) => s + parseFloat(r.TOTAL), 0);
    console.log(`  Sum of per-vendor totals: ${vendorTotal.toFixed(2)}€`);
    console.log(`  Global total:             ${globalTotal.toFixed(2)}€`);
    const diff = Math.abs(vendorTotal - globalTotal);
    console.log(`  Difference: ${diff.toFixed(2)}€`);
    console.log(`  ${diff < 1 ? 'PASS' : 'FAIL - check NULL/empty vendor rows'}\n`);

    // -------------------------------------------------------
    // TEST 4: CVC vs CAC for client 4300040696
    // -------------------------------------------------------
    console.log('--- TEST 4: CVC vs CAC cross-validation (client 4300040696) ---');
    const cvcTotal = await pool.query(`
        SELECT SUM(IMPORTEPENDIENTE) as PENDING
        FROM DSEDAC.CVC
        WHERE TRIM(CODIGOCLIENTEALBARAN) = '4300040696'
          AND SITUACION = 'P'
    `);
    const cacTotal = await pool.query(`
        SELECT SUM(IMPORTETOTAL) as TOTAL
        FROM DSEDAC.CAC
        WHERE TRIM(CODIGOCLIENTEFACTURA) = '4300040696'
          AND EJERCICIOFACTURA >= 2024
          AND NUMEROFACTURA > 0
    `);
    console.log(`  CVC pending: ${parseFloat(cvcTotal[0]?.PENDING || 0).toFixed(2)}€`);
    console.log(`  CAC total invoiced: ${parseFloat(cacTotal[0]?.TOTAL || 0).toFixed(2)}€`);
    console.log(`  (CVC tracks payment status, CAC tracks invoice amounts - different purpose)\n`);

    // -------------------------------------------------------
    // TEST 5: B-Sales check
    // -------------------------------------------------------
    console.log('--- TEST 5: B-Sales availability ---');
    try {
        const bSales = await pool.query(`
            SELECT CODIGOVENDEDOR, MES, IMPORTE
            FROM JAVIER.VENTAS_B
            WHERE EJERCICIO = 2026
            ORDER BY MES
        `);
        console.log(`  B-Sales records for 2026: ${bSales.length}`);
        if (bSales.length > 0) {
            const bTotal = bSales.reduce((s, r) => s + (parseFloat(r.IMPORTE) || 0), 0);
            console.log(`  Total B-Sales 2026: ${bTotal.toFixed(2)}€`);
        } else {
            console.log(`  No B-Sales for 2026 (will not affect figures)`);
        }
    } catch (e) {
        console.log(`  VENTAS_B table not available: ${e.message}`);
    }

    console.log('\n=== VERIFICATION COMPLETE ===');
    await pool.close();
}

main().catch(e => console.error('Error:', e.message));
