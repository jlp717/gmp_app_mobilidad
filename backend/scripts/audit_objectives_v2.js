const { query } = require('../config/db');
const { LACLAE_SALES_FILTER } = require('../utils/common');
const logger = require('../middleware/logger');

// HELPER: B-SALES LOOKUP 
async function getBSales(vendorCode, year) {
    if (!vendorCode || vendorCode === 'ALL') return {};
    const rawCode = vendorCode.trim();
    const unpaddedCode = rawCode.replace(/^0+/, '');

    try {
        const rows = await query(`
            SELECT MES, IMPORTE
            FROM JAVIER.VENTAS_B
            WHERE (CODIGOVENDEDOR = '${rawCode}' OR CODIGOVENDEDOR = '${unpaddedCode}')
              AND EJERCICIO = ${year}
        `, false, false);

        const monthlyMap = {};
        rows.forEach(r => {
            monthlyMap[r.MES] = (monthlyMap[r.MES] || 0) + (parseFloat(r.IMPORTE) || 0);
        });
        return monthlyMap;
    } catch (e) {
        return {};
    }
}

// HELPER: TARGET CONFIG
async function getVendorTargetConfig(vendorCode) {
    if (!vendorCode) return 10.0;
    try {
        const code = vendorCode.split(',')[0].trim();
        const rows = await query(`
            SELECT TARGET_PERCENTAGE 
            FROM JAVIER.OBJ_CONFIG 
            WHERE CODIGOVENDEDOR = '${code}'
        `, false, false);
        if (rows.length > 0) return parseFloat(rows[0].TARGET_PERCENTAGE) || 10.0;
        return 10.0;
    } catch (e) { return 10.0; }
}

async function main() {
    console.log('Fetching active vendors (LCAADC Mode)...');

    const vendors = await query(`
        SELECT distinct V.CODIGOVENDEDOR, TRIM(V.NOMBREVENDEDOR) as NAME 
        FROM DSEDAC.VDD V
        JOIN DSEDAC.VDC C ON V.CODIGOVENDEDOR = C.CODIGOVENDEDOR
        WHERE C.SUBEMPRESA = 'GMP'
        ORDER BY V.CODIGOVENDEDOR
    `, false);

    console.log('ID|Name|Jan Normal (LCAADC)|Jan B-Sales|Total Base Jan|IPC Target (3%)|Growth %|Proposed Obj (w/ Growth)');
    console.log('--|---|---|---|---|---|---|---');

    for (const v of vendors) {
        const code = v.CODIGOVENDEDOR.trim();
        const name = v.NAME;

        // 1. Get 2025 Full Year Sales using LCAADC (Document Year)
        const rows = await query(`
            SELECT L.LCMMDC as MONTH, SUM(L.LCIMVT) as SALES
            FROM DSED.LACLAE L
            WHERE L.LCAADC = 2025
            AND ${LACLAE_SALES_FILTER}
            AND TRIM(L.LCCDVD) = '${code}'
            GROUP BY L.LCMMDC
        `, false, false);

        const bSalesMap = await getBSales(code, 2025);

        const monthlyTotal = {};
        let annualTotal = 0;

        for (let m = 1; m <= 12; m++) {
            const normal = parseFloat(rows.find(r => r.MONTH == m)?.SALES) || 0;
            const b = bSalesMap[m] || 0;
            const total = normal + b;
            monthlyTotal[m] = total;
            annualTotal += total;
        }

        if (annualTotal === 0) continue;

        // 2. Jan 2025 Base
        const janNormal = parseFloat(rows.find(r => r.MONTH == 1)?.SALES) || 0;
        const janB = bSalesMap[1] || 0;
        const janBase = janNormal + janB;

        // 3. Simple IPC Target
        const ipcTarget = janBase * 1.03;

        // 4. Configured Growth
        const targetPct = await getVendorTargetConfig(code);

        // 5. Full Calculation with Seasonality
        const IPC = 1.03;
        const growthFactor = 1 + (targetPct / 100);
        const annualObjective = annualTotal * IPC * growthFactor;

        const avgMonthly = annualTotal / 12;
        const SEASONAL_AGGRESSIVENESS = 0.5;

        let rawSum = 0;
        let janRawTarget = 0;

        for (let m = 1; m <= 12; m++) {
            const sale = monthlyTotal[m] || 0;
            const deviationRatio = avgMonthly > 0 ? (sale - avgMonthly) / avgMonthly : 0;
            const variableGrowthPct = (targetPct / 100) * (1 + (SEASONAL_AGGRESSIVENESS * deviationRatio));
            const rawTarget = sale * (1 + variableGrowthPct);

            if (m === 1) janRawTarget = rawTarget;
            rawSum += rawTarget;
        }

        const correctionFactor = rawSum > 0 ? annualObjective / rawSum : 1;
        const finalJanObj = janRawTarget * correctionFactor;

        console.log(`${code}|${name}|${janNormal.toFixed(2)}|${janB.toFixed(2)}|${janBase.toFixed(2)}|${ipcTarget.toFixed(2)}|${targetPct}%|${finalJanObj.toFixed(2)}`);
    }

    process.exit();
}

main();
