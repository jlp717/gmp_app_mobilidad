const { query, initDb } = require('../config/db');

// Simulation Parameters
const VENDOR_CODE = '02'; // Use '02' as test subject
const AGGRESSIVENESS = 0.5; // Tuning parameter: 0.0 = Flat, 1.0 = Highly aggressive

async function simulate() {
    try {
        await initDb();
        console.log(`📊 Simulating Seasonality for Vendor ${VENDOR_CODE}`);

        // 1. Get Global config for Vendor
        const configRows = await query(`SELECT TARGET_PERCENTAGE FROM JAVIER.OBJ_CONFIG WHERE CODIGOVENDEDOR = '${VENDOR_CODE}'`, false);
        const targetPct = configRows.length > 0 ? parseFloat(configRows[0].TARGET_PERCENTAGE) : 10.0;
        console.log(`   Global Target Growth: ${targetPct}%`);

        // 2. Get Last Year's Sales (2025)
        const year = 2025;
        const salesRows = await query(`
            SELECT LCMMDC as MONTH, SUM(LCIMVT) as SALES 
            FROM DSED.LACLAE 
            WHERE LCAADC = ${year} AND LCCDVD = '${VENDOR_CODE}' 
            -- AND LCIMVT > 0  -- Filter returns or keep them? keep for realistic sum
            GROUP BY LCMMDC 
            ORDER BY LCMMDC
        `, false);

        if (salesRows.length === 0) {
            console.log("No sales found for 2025.");
            return;
        }

        // Fill missing months with 0
        const salesMap = {};
        let totalSales = 0;
        salesRows.forEach(r => {
            const m = parseInt(r.MONTH);
            const s = parseFloat(r.SALES);
            salesMap[m] = s;
            totalSales += s;
        });

        const avgMonthlySales = totalSales / 12;
        console.log(`   Total Sales ${year}: ${totalSales.toFixed(2)}€`);
        console.log(`   Avg Monthly Sales: ${avgMonthlySales.toFixed(2)}€`);

        // 3. Calculate Targets
        // Target Total needed
        const requiredTotalTarget = totalSales * (1 + targetPct / 100);
        console.log(`   Required Target ${year + 1}: ${requiredTotalTarget.toFixed(2)}€ (+${targetPct}%)`);

        let rawSum = 0;
        const monthlyResults = [];

        // First Pass: Calculate Weighted Growth
        for (let m = 1; m <= 12; m++) {
            const sale = salesMap[m] || 0;

            // Logic: Growth Factor varies based on deviation from average
            // If Sale == Avg, Growth = TargetPct.
            // If Sale > Avg, Growth > TargetPct.
            // Formula: Multiplier = 1 + (TargetPct/100) * (1 + Aggressiveness * ((Sale - Avg) / Avg))

            // Safety: if avg is 0, avoid div/0
            const deviationRatio = avgMonthlySales > 0 ? (sale - avgMonthlySales) / avgMonthlySales : 0;
            const variableGrowthPct = (targetPct / 100) * (1 + (AGGRESSIVENESS * deviationRatio));

            // Ensure growth doesn't go below checking minimal floor (e.g. half of target) ?
            // User said "months where it costs more... maybe 8%". If target is 12%, 8% is 2/3.

            const rawTarget = sale * (1 + variableGrowthPct);
            rawSum += rawTarget;

            monthlyResults.push({
                month: m,
                sale,
                deviationRatio,
                variableGrowthPct,
                rawTarget
            });
        }

        // 4. Normalize to match exact total
        const correctionFactor = requiredTotalTarget / rawSum;
        console.log(`   Normalization Factor: ${correctionFactor.toFixed(4)}`);

        console.log("\n   Month | Sales 2025 | Deviation | Raw Growth% | Final Growth% | Final Target");
        console.log("   ------+------------+-----------+-------------+---------------+-------------");

        let finalSum = 0;
        monthlyResults.forEach(r => {
            const finalTarget = r.rawTarget * correctionFactor;
            finalSum += finalTarget;

            // Back-calculate the implied growth %
            const implGrowth = r.sale > 0 ? ((finalTarget - r.sale) / r.sale) * 100 : 0;

            console.log(`   ${r.month.toString().padStart(2)}    | ${r.sale.toFixed(0).padStart(10)} | ${r.deviationRatio.toFixed(2).padStart(9)} | ${(r.variableGrowthPct * 100).toFixed(2).padStart(10)}% | ${implGrowth.toFixed(2).padStart(12)}% | ${finalTarget.toFixed(2)}`);
        });

        console.log(`\n   Sum Validated: ${finalSum.toFixed(2)}€ (Diff: ${(finalSum - requiredTotalTarget).toFixed(2)})`);

    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}

simulate();
