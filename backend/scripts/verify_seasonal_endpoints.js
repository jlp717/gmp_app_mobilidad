const { initDb } = require('../config/db');
const request = require('supertest');
const express = require('express');
const objectivesRouter = require('../routes/objectives.js');

// Mock Express App
const app = express();
app.use(express.json());
app.use('/api/objectives', objectivesRouter);

async function verify() {
    try {
        await initDb();
        console.log("🔍 Verifying Live Seasonality Endpoints...");

        // 1. Verify Summary Endpoint for Vendor 02
        // We expect Target to be != LastYear * 1.10
        // We expect it to be higher if it's a high month.
        // Let's use Month 5 (May) which in simulation was high.

        const res = await request(app).get('/api/objectives?vendedorCodes=02&year=2026&month=5');

        if (res.status !== 200) {
            console.error("❌ Summary Endpoint Failed:", res.body);
        } else {
            const data = res.body.objectives.sales;
            const pct = res.body.targetPercentage;
            const impliedGrowth = ((data.target - data.lastYear) / data.lastYear) * 100;

            console.log(`\n📊 SUMMARY (2026-05) for 02:`);
            console.log(`   Configured Growth: ${pct}%`);
            console.log(`   Last Year Sales: ${data.lastYear}€`);
            console.log(`   Target This Year: ${data.target.toFixed(2)}€`);
            console.log(`   Implied Seasonal Growth: ${impliedGrowth.toFixed(2)}%`);

            if (Math.abs(impliedGrowth - pct) > 1) {
                console.log(`   ✅ Seasonality Active! (Growth ${impliedGrowth.toFixed(2)}% != Base ${pct}%)`);
            } else {
                console.log(`   ⚠️ Warning: Growth seems flat. Is month 5 average?`);
            }
        }

        // 2. Verify Evolution Endpoint (Annual Check)
        const resEv = await request(app).get('/api/objectives/evolution?vendedorCodes=02&years=2026');
        if (resEv.status !== 200) {
            console.error("❌ Evolution Endpoint Failed:", resEv.body);
        } else {
            const yearData = resEv.body.yearlyData['2026'];
            const totalTarget = resEv.body.yearTotals['2026'].annualObjective;

            console.log(`\n📊 EVOLUTION (2026) for 02:`);
            console.log(`   Total Annual Target: ${totalTarget.toFixed(2)}€`);

            let sumMonthly = 0;
            console.log("   M  | Last Year | Target    | Growth %");
            yearData.forEach((m, idx) => {
                // Evolution returns sales (which is current year, 0 for 2026) 
                // and objective. We don't easily see last year sales in response directly 
                // unless we iterate 2025. 
                // But we can check implied monthly variation.
                sumMonthly += m.objective;
                console.log(`   ${m.month.toString().padEnd(2)} | ?         | ${m.objective.toFixed(0).padEnd(9)} | -`);
            });

            const diff = Math.abs(sumMonthly - totalTarget);
            console.log(`   Sum of Monthly Targets: ${sumMonthly.toFixed(2)}€`);

            if (diff < 1.0) {
                console.log(`   ✅ Normalization Exact (Diff: ${diff.toFixed(2)})`);
            } else {
                console.log(`   ❌ Normalization Mismatch (Diff: ${diff.toFixed(2)})`);
            }
        }

    } catch (e) {
        console.error("❌ Error:", e);
    } finally {
        process.exit();
    }
}

verify();
