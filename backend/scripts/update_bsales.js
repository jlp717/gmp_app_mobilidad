/**
 * Update B-Sales for vendor 13 in January 2026
 * and verify objective calculations
 */
const { query } = require('../config/db');

async function main() {
    console.log('=== UPDATING B-SALES FOR VENDOR 13 ===\n');

    // 1. Update vendor 13's January 2026 B-sales to 17,673.93€
    console.log('1. Updating JAVIER.VENTAS_B for vendor 13, Jan 2026...');
    await query(`
        UPDATE JAVIER.VENTAS_B
        SET IMPORTE = 17673.93
        WHERE CODIGOVENDEDOR = '13'
          AND EJERCICIO = 2026
          AND MES = 1
    `);
    console.log('   ✅ Updated: 12,075.15€ → 17,673.93€\n');

    // 2. Verify all B-sales data
    console.log('2. Current B-Sales in JAVIER.VENTAS_B:');
    const bSales = await query(`
        SELECT CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE
        FROM JAVIER.VENTAS_B
        ORDER BY EJERCICIO, MES, CODIGOVENDEDOR
    `, false);
    console.table(bSales.map(r => ({
        Vendor: r.CODIGOVENDEDOR,
        Year: r.EJERCICIO,
        Month: r.MES,
        Amount: parseFloat(r.IMPORTE).toFixed(2) + '€'
    })));

    // 3. Calculate January 2026 objectives for BARTOLO (02)
    console.log('\n3. BARTOLO (02) - January 2026 Objective Calculation:');

    // Get 2025 normal sales for BARTOLO
    const bartolo2025 = await query(`
        SELECT SUM(LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE L.LCYEAB = 2025 AND L.LCMMDC = 1
          AND L.TPDC = 'LAC'
          AND L.LCTPVT IN ('CC', 'VC') 
          AND L.LCCLLN IN ('AB', 'VT') 
          AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
          AND TRIM(L.LCCDVD) = '2'
    `, false);
    const bartoloNormalSales = parseFloat(bartolo2025[0]?.SALES) || 0;

    // Get 2025 B-sales for BARTOLO
    const bartoloBSales = await query(`
        SELECT COALESCE(IMPORTE, 0) as BSALES
        FROM JAVIER.VENTAS_B
        WHERE CODIGOVENDEDOR = '2' AND EJERCICIO = 2025 AND MES = 1
    `, false);
    const bartoloBSalesAmount = parseFloat(bartoloBSales[0]?.BSALES) || 0;

    const bartoloTotal2025 = bartoloNormalSales + bartoloBSalesAmount;
    const bartoloObjective2026 = bartoloTotal2025 * 1.03; // 3% IPC

    console.log(`   Normal Sales 2025 (Jan): ${bartoloNormalSales.toFixed(2)}€`);
    console.log(`   B-Sales 2025 (Jan):      ${bartoloBSalesAmount.toFixed(2)}€`);
    console.log(`   Total 2025:              ${bartoloTotal2025.toFixed(2)}€`);
    console.log(`   + 3% IPC:                ${bartoloObjective2026.toFixed(2)}€ ← OBJETIVO ENERO 2026`);

    // 4. Calculate January 2026 objectives for BAYONAS (13)
    console.log('\n4. BAYONAS (13) - January 2026 Objective Calculation:');

    // Get 2025 normal sales for BAYONAS
    const bayonas2025 = await query(`
        SELECT SUM(LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE L.LCYEAB = 2025 AND L.LCMMDC = 1
          AND L.TPDC = 'LAC'
          AND L.LCTPVT IN ('CC', 'VC') 
          AND L.LCCLLN IN ('AB', 'VT') 
          AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
          AND TRIM(L.LCCDVD) = '13'
    `, false);
    const bayonasNormalSales = parseFloat(bayonas2025[0]?.SALES) || 0;

    // Get 2025 B-sales for BAYONAS
    const bayonasBSales = await query(`
        SELECT COALESCE(SUM(IMPORTE), 0) as BSALES
        FROM JAVIER.VENTAS_B
        WHERE CODIGOVENDEDOR = '13' AND EJERCICIO = 2025 AND MES = 1
    `, false);
    const bayonasBSalesAmount = parseFloat(bayonasBSales[0]?.BSALES) || 0;

    const bayonasTotal2025 = bayonasNormalSales + bayonasBSalesAmount;
    const bayonasObjective2026 = bayonasTotal2025 * 1.03; // 3% IPC

    console.log(`   Normal Sales 2025 (Jan): ${bayonasNormalSales.toFixed(2)}€`);
    console.log(`   B-Sales 2025 (Jan):      ${bayonasBSalesAmount.toFixed(2)}€`);
    console.log(`   Total 2025:              ${bayonasTotal2025.toFixed(2)}€`);
    console.log(`   + 3% IPC:                ${bayonasObjective2026.toFixed(2)}€ ← OBJETIVO ENERO 2026`);

    // 5. Show what BAYONAS should show in 2026
    console.log('\n5. BAYONAS (13) - January 2026 ACTUAL Sales:');
    const bayonas2026Normal = await query(`
        SELECT SUM(LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE L.LCYEAB = 2026 AND L.LCMMDC = 1
          AND L.TPDC = 'LAC'
          AND L.LCTPVT IN ('CC', 'VC') 
          AND L.LCCLLN IN ('AB', 'VT') 
          AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
          AND TRIM(L.LCCDVD) = '13'
    `, false);
    const bayonas2026NormalSales = parseFloat(bayonas2026Normal[0]?.SALES) || 0;

    const bayonas2026BSales = await query(`
        SELECT COALESCE(IMPORTE, 0) as BSALES
        FROM JAVIER.VENTAS_B
        WHERE CODIGOVENDEDOR = '13' AND EJERCICIO = 2026 AND MES = 1
    `, false);
    const bayonas2026BSalesAmount = parseFloat(bayonas2026BSales[0]?.BSALES) || 0;

    console.log(`   Normal Sales 2026 (Jan): ${bayonas2026NormalSales.toFixed(2)}€`);
    console.log(`   B-Sales 2026 (Jan):      ${bayonas2026BSalesAmount.toFixed(2)}€`);
    console.log(`   TOTAL 2026 (Jan):        ${(bayonas2026NormalSales + bayonas2026BSalesAmount).toFixed(2)}€`);

    console.log('\n✅ Done!');
    process.exit(0);
}

main().catch(e => {
    console.error('Error:', e);
    process.exit(1);
});
