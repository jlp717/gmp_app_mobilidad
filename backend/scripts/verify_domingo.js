const { query, initDb } = require('../config/db');

async function verifyDomingo() {
    try {
        await initDb();

        const VENDOR = '33'; // DOMINGO
        const YEAR_PREV = 2024;
        const YEAR_TARGET = 2025;

        console.log(`🔍 Verifying Objectives for VENDOR ${VENDOR} (DOMINGO)...`);
        console.log(`📅 Base Year: ${YEAR_PREV} | Target Year: ${YEAR_TARGET}`);

        // 1. Get Monthly Sales for 2024
        const sql = `
      SELECT MESDOCUMENTO as MONTH, SUM(IMPORTEVENTA) as SALES
      FROM DSEDAC.LAC
      WHERE ANODOCUMENTO = ${YEAR_PREV}
        AND TRIM(CODIGOVENDEDOR) = '${VENDOR}'
        AND LCTPVT <> 'SC'
        AND LCSRAB NOT IN ('K', 'N', 'O', 'G')
      GROUP BY MESDOCUMENTO
      ORDER BY MESDOCUMENTO
    `;

        const rows = await query(sql);

        let totalSalesPrev = 0;
        let totalObjWeighted = 0;
        let monthlyData = [];

        // Process rows
        for (let m = 1; m <= 12; m++) {
            const row = rows.find(r => r.MONTH == m);
            const sales = row ? parseFloat(row.SALES) : 0;

            const weightedObj = sales * 1.10;

            totalSalesPrev += sales;
            totalObjWeighted += weightedObj;

            monthlyData.push({
                month: m,
                salesPrev: sales,
                objWeighted: weightedObj
            });
        }

        const totalObjLinear = totalSalesPrev * 1.10; // The strictly calculated 10% total
        const monthlyAvg = totalObjLinear / 12;

        console.log('\n📊 DETALLE MENSUAL 2025 - DOMINGO (33)');
        console.log('Mes | Ventas 2024   | Objetivo 2025 | Crecimiento | Peso del Año');
        console.log('----+---------------+---------------+-------------+-------------');

        monthlyData.forEach(d => {
            const growthPct = d.salesPrev > 0 ? ((d.objWeighted - d.salesPrev) / d.salesPrev) * 100 : 0;
            const weightPct = (d.objWeighted / totalObjWeighted) * 100;

            const monthName = new Date(2024, d.month - 1, 1).toLocaleString('es-ES', { month: 'long' });

            console.log(
                `${d.month.toString().padStart(2)}  | ` +
                `${d.salesPrev.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }).padStart(13)} | ` +
                `${d.objWeighted.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }).padStart(13)} | ` +
                `${growthPct.toFixed(1).padStart(9)} % | ` +
                `${weightPct.toFixed(1).padStart(9)} %`
            );
        });

        console.log('----+---------------+---------------+-------------+-------------');
        console.log(`TOT | ${totalSalesPrev.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }).padStart(13)} | ${totalObjWeighted.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }).padStart(13)} |      10.0 % |     100.0 %`);

        console.log('\n✅ VERIFICATION:');
        console.log(`Target Total (sales * 1.10) = ${totalObjLinear.toFixed(2)}`);
        console.log(`Sum of Monthly Objectives   = ${totalObjWeighted.toFixed(2)}`);

        if (Math.abs(totalObjLinear - totalObjWeighted) < 1.0) {
            console.log('🎉 MATCH! The sum of weighted months equals exactly the +10% target.');
        } else {
            console.log('⚠️ MISMATCH (Likely due to floating point, check logic)');
        }

        process.exit(0);

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

verifyDomingo();
