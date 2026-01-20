const { initDb, query } = require('../config/db');

// CONFIG
const YEAR = 2026;
const VENDORS_TO_TEST = ['02', '15', '03'];

async function runDebug() {
    try {
        await initDb();
        console.log("🔍 INSPECTING SEASONAL TARGET LOGIC\n");

        for (const code of VENDORS_TO_TEST) {
            console.log(`\n--- ANALYZING VENDOR ${code} ---`);

            // 1. Check Config
            const config = await query(`SELECT TARGET_PERCENTAGE FROM JAVIER.OBJ_CONFIG WHERE CODIGOVENDEDOR = '${code}'`, false);
            const targetPct = config.length > 0 ? parseFloat(config[0].TARGET_PERCENTAGE) : 10.0;
            console.log(`[1] Configuration: ${targetPct}% (Default is 10%)`);

            // 2. Check Previous Year Total (2025)
            const prevYear = await query(`
                SELECT SUM(IMPORTEVENTA) as TOTAL 
                FROM DSEDAC.LAC 
                WHERE ANODOCUMENTO = ${YEAR - 1} AND CODIGOVENDEDOR = '${code}'
            `, false);
            const totalPrev = prevYear[0] ? parseFloat(prevYear[0].TOTAL) : 0;
            console.log(`[2] Total Sales ${YEAR - 1}: ${totalPrev.toFixed(2)}€`);

            if (totalPrev === 0) {
                console.log("    (Skipping seasonality check due to no history)");
                continue;
            }

            // 3. Inspect a High Month vs Low Month (Simulation)
            const montlySales = await query(`
                SELECT MESDOCUMENTO as MONTH, SUM(IMPORTEVENTA) as SALES
                FROM DSEDAC.LAC
                WHERE ANODOCUMENTO = ${YEAR - 1} AND CODIGOVENDEDOR = '${code}'
                GROUP BY MESDOCUMENTO
                ORDER BY MESDOCUMENTO
            `, false);

            const avg = totalPrev / 12;
            console.log(`[3] Monthly Avg: ${avg.toFixed(2)}€`);

            // Pick max and min month
            let maxM = null, minM = null;
            let maxS = -1, minS = 999999999;

            montlySales.forEach(r => {
                const s = parseFloat(r.SALES);
                if (s > maxS) { maxS = s; maxM = r; }
                if (s < minS) { minS = s; minM = r; }
            });

            const seasonalFactor = 0.5; // From codebase

            if (maxM) {
                const dev = (maxS - avg) / avg;
                const dynamicGrowth = targetPct * (1 + seasonalFactor * dev);
                console.log(`    HIGH Comp (Month ${maxM.MONTH}): Sales ${maxS.toFixed(0)}€ (Dev ${(dev * 100).toFixed(0)}%) -> Target Growth: ${dynamicGrowth.toFixed(2)}%`);
            }
            if (minM) {
                const dev = (minS - avg) / avg;
                const dynamicGrowth = targetPct * (1 + seasonalFactor * dev);
                console.log(`    LOW Comp  (Month ${minM.MONTH}): Sales ${minS.toFixed(0)}€ (Dev ${(dev * 100).toFixed(0)}%) -> Target Growth: ${dynamicGrowth.toFixed(2)}%`);
            }
        }

    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}

runDebug();
