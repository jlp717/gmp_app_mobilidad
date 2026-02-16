const { query } = require('../config/db');
const { LACLAE_SALES_FILTER } = require('../utils/common');

// Copy of helper from objectives.js
async function getVendorTargetConfig(vendorCode) {
    if (!vendorCode || vendorCode === 'ALL') return 10.0;
    try {
        const code = vendorCode.split(',')[0].trim();
        const rows = await query(`
            SELECT TARGET_PERCENTAGE 
            FROM JAVIER.OBJ_CONFIG 
            WHERE CODIGOVENDEDOR = '${code}'
        `, false);
        if (rows.length > 0) return parseFloat(rows[0].TARGET_PERCENTAGE) || 10.0;
        return 10.0;
    } catch (e) { return 10.0; }
}

async function main() {
    const VENDOR = '02'; // Bartolo
    const YEAR = 2026;
    const PREV_YEAR = 2025;

    console.log(`=== DEBUGGING BARTOLO (02) SEASONALITY ===`);

    // 1. Get Config
    const targetPct = await getVendorTargetConfig(VENDOR);
    console.log(`Target Growth %: ${targetPct}%`);

    // 2. Get All Monthly Sales for 2025 (Normal + B)
    // Normal Sales
    const rows = await query(`
        SELECT L.LCMMDC as MONTH, SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE L.LCYEAB = ${PREV_YEAR}
          AND ${LACLAE_SALES_FILTER}
          AND TRIM(L.LCCDVD) = '${VENDOR}'
        GROUP BY L.LCMMDC
        ORDER BY L.LCMMDC
    `, false);

    // B-Sales with Robust Key Check
    const unpaddedVendor = VENDOR.replace(/^0+/, '');
    const bSalesRows = await query(`
        SELECT MES, IMPORTE 
        FROM JAVIER.VENTAS_B 
        WHERE (CODIGOVENDEDOR = '${VENDOR}' OR CODIGOVENDEDOR = '${unpaddedVendor}')
          AND EJERCICIO = ${PREV_YEAR}
    `, false);

    const monthlySales = {};
    let totalAnnual2025 = 0;

    console.log('\n--- 2025 SALES ---');
    for (let m = 1; m <= 12; m++) {
        const normal = parseFloat(rows.find(r => r.MONTH == m)?.SALES) || 0;
        const b = parseFloat(bSalesRows.find(r => r.MES == m)?.IMPORTE) || 0;
        const total = normal + b;
        monthlySales[m] = total;
        totalAnnual2025 += total;
        console.log(`Month ${m}: ${total.toFixed(2)}€ (Normal: ${normal.toFixed(2)} + B: ${b.toFixed(2)})`);
    }
    console.log(`TOTAL 2025: ${totalAnnual2025.toFixed(2)}€`);

    // 3. Calculate Annual Objective 2026
    const IPC = 1.03;
    const growthFactor = 1 + (targetPct / 100);
    const totalMultiplier = IPC * growthFactor;

    const annualObjective = totalAnnual2025 * totalMultiplier;
    console.log(`\n--- ANNUAL OBJECTIVE 2026 ---`);
    console.log(`Formula: Total 2025 (${totalAnnual2025.toFixed(2)}) * IPC (1.03) * Growth (1.${targetPct})`);
    console.log(`Total 2026: ${annualObjective.toFixed(2)}€`);

    // 4. Calculate Seasonal Distribution
    const avgMonthly = totalAnnual2025 / 12;
    console.log(`Average Monthly 2025: ${avgMonthly.toFixed(2)}€`);

    const SEASONAL_AGGRESSIVENESS = 0.5;
    let rawSum = 0;
    const tempTargets = {};

    console.log('\n--- SEASONAL CALCULATION ---');
    console.log(`Month | Sales 2025 | Deviation | Var. Growth | Raw Target`);
    for (let m = 1; m <= 12; m++) {
        const sale = monthlySales[m];
        const deviationRatio = avgMonthly > 0 ? (sale - avgMonthly) / avgMonthly : 0;

        // This variable growth pct applies to the *shape*, implicitly 
        // the code in objectives.js applies it to the sale 
        // effectively calculating a weighted shape.
        // Let's match the code exactly:
        // const variableGrowthPct = (targetPct / 100) * (1 + (SEASONAL_AGGRESSIVENESS * deviationRatio));
        // const rawTarget = sale * (1 + variableGrowthPct);

        const variableGrowthPct = (targetPct / 100) * (1 + (SEASONAL_AGGRESSIVENESS * deviationRatio));
        const rawTarget = sale * (1 + variableGrowthPct);

        tempTargets[m] = rawTarget;
        rawSum += rawTarget;

        if (m === 1) {
            console.log(`${m.toString().padStart(2)}    | ${sale.toFixed(2)}   | ${(deviationRatio * 100).toFixed(1)}%    | ${(variableGrowthPct * 100).toFixed(2)}%      | ${rawTarget.toFixed(2)}`);
        }
    }

    // 5. Normalize
    const correctionFactor = rawSum > 0 ? annualObjective / rawSum : 1;
    console.log(`\nRaw Sum: ${rawSum.toFixed(2)}`);
    console.log(`Correction Factor (Objective / RawSum): ${correctionFactor.toFixed(6)}`);

    const finalJan = tempTargets[1] * correctionFactor;
    console.log(`\n>>> FINAL JAN 2026 OBJECTIVE: ${finalJan.toFixed(2)}€ <<<`);

    process.exit(0);
}

main();
