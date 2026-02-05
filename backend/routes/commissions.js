const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const logger = require('../middleware/logger');
const { getVendorActiveDaysFromCache } = require('../services/laclae');
const { getCurrentDate, LACLAE_SALES_FILTER, buildVendedorFilterLACLAE } = require('../utils/common');


// =============================================================================
// CONFIGURATION & CONSTANTS
// =============================================================================
const EXCLUDED_VENDORS = ['3', '13']; // Vendors who see data but don't earn commissions
const DEFAULT_CONFIG_2026 = {
    ipc: 3.0,
    tiers: [
        { min: 100.01, max: 103.00, pct: 1.0 },
        { min: 103.01, max: 106.00, pct: 1.3 },
        { min: 106.01, max: 110.00, pct: 1.6 },
        { min: 110.01, max: 999.99, pct: 2.0 }
    ]
};

// =============================================================================
// DATABASE INITIALIZATION (JAVIER Schema)
// =============================================================================
async function initCommissionTables() {
    try {
        // 1. Check if table exists (Explicit JAVIER schema)
        // We use a simple select to check existence.
        try {
            await query(`SELECT 1 FROM JAVIER.COMM_CONFIG FETCH FIRST 1 ROWS ONLY`, false, false);
            logger.info('✅ JAVIER.COMM_CONFIG found and ready.');
            return;
        } catch (e) {
            // Table likely not found, proceed to create
            logger.info('⚙️ Initializing JAVIER.COMM_CONFIG table...');
        }

        // 2. Create Table
        // Note: DB2 syntax.
        await query(`
             CREATE TABLE JAVIER.COMM_CONFIG (
                 ID INT NOT NULL,
                 YEAR INT NOT NULL,
                 IPC_PCT DECIMAL(5,2) DEFAULT 3.00,
                 TIER1_MAX DECIMAL(5,2) DEFAULT 103.00,
                 TIER1_PCT DECIMAL(5,2) DEFAULT 1.00,
                 TIER2_MAX DECIMAL(5,2) DEFAULT 106.00,
                 TIER2_PCT DECIMAL(5,2) DEFAULT 1.30,
                 TIER3_MAX DECIMAL(5,2) DEFAULT 110.00,
                 TIER3_PCT DECIMAL(5,2) DEFAULT 1.60,
                 TIER4_PCT DECIMAL(5,2) DEFAULT 2.00,
                 PRIMARY KEY (ID)
             )
        `);
        logger.info('✅ JAVIER.COMM_CONFIG table created.');

        // 3. Seed Data
        await query(`
            INSERT INTO JAVIER.COMM_CONFIG (ID, YEAR, IPC_PCT, TIER1_MAX, TIER1_PCT, TIER2_MAX, TIER2_PCT, TIER3_MAX, TIER3_PCT, TIER4_PCT)
            VALUES (1, 2026, 3.00, 103.00, 1.00, 106.00, 1.30, 110.00, 1.60, 2.00)
        `);
        logger.info('🌱 JAVIER.COMM_CONFIG seeded default values.');

    } catch (error) {
        // If it fails (e.g., race condition or permission), we log but don't crash. 
        // Logic will fall back to DEFAULT_CONFIG_2026.
        logger.warn(`⚠️ DB Init Warning: ${error.message}. Using default memory config.`);
    }
}

// Run initialization on module load
setTimeout(initCommissionTables, 3000);

// =============================================================================
// INHERITED OBJECTIVES LOGIC
// For new vendors who don't have full history, we calculate objectives based
// on the sales of previous vendors who managed their current clients.
// =============================================================================

/**
 * Get all clients currently managed by a vendor (from current year or most recent data)
 */
async function getVendorCurrentClients(vendorCode, currentYear) {
    const rows = await query(`
        SELECT DISTINCT TRIM(L.LCCDCL) as CLIENT_CODE
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDVD) = '${vendorCode}'
          AND L.LCYEAB = ${currentYear}
          AND ${LACLAE_SALES_FILTER}
    `, false);

    // If no clients in current year, try previous year
    if (rows.length === 0) {
        const prevRows = await query(`
            SELECT DISTINCT TRIM(L.LCCDCL) as CLIENT_CODE
            FROM DSED.LACLAE L
            WHERE TRIM(L.LCCDVD) = '${vendorCode}'
              AND L.LCYEAB = ${currentYear - 1}
              AND ${LACLAE_SALES_FILTER}
        `, false);
        return prevRows.map(r => r.CLIENT_CODE);
    }

    return rows.map(r => r.CLIENT_CODE);
}

/**
 * Get monthly sales for a set of clients in a given year (by ALL vendors)
 * This allows us to calculate inherited targets for new vendors
 */
async function getClientsMonthlySales(clientCodes, year) {
    if (!clientCodes || clientCodes.length === 0) return {};

    const clientList = clientCodes.map(c => `'${c}'`).join(',');

    const rows = await query(`
        SELECT 
            L.LCMMDC as MONTH,
            SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDCL) IN (${clientList})
          AND L.LCYEAB = ${year}
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCMMDC
    `, false);

    // Build map: month -> total sales
    const monthlyMap = {};
    rows.forEach(r => {
        monthlyMap[r.MONTH] = parseFloat(r.SALES) || 0;
    });

    return monthlyMap;
}

// =============================================================================
// B-SALES LOOKUP (VENTAS EN B)
// These are secondary channel sales stored in JAVIER.VENTAS_B
// =============================================================================
async function getBSales(vendorCode, year) {
    if (!vendorCode || vendorCode === 'ALL') return {};

    // Normalize code: try to match how it's stored. 
    // Usually '2', but input might be '02'.
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
        // Table may not exist - no B-sales
        logger.debug(`B-sales lookup: ${e.message}`);
        return {};
    }
}


// =============================================================================
// COMPUTATION LOGIC
// =============================================================================

/**
 * Calculates working days for a specific month based on vendor's active route days.
 * Holidays are excluded.
 */
function calculateWorkingDays(year, month, activeWeekDays) {
    // If no active days specified (e.g. ALL view), assume Tue-Sat (most vendors work these days)
    const effectiveDays = (activeWeekDays && activeWeekDays.length > 0)
        ? activeWeekDays
        : ['VIS_M', 'VIS_X', 'VIS_J', 'VIS_V', 'VIS_S']; // martes-sabado = 5 days


    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0); // Last day of month
    let count = 0;

    // JS: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    const jsDayToCol = {
        0: 'VIS_D', 1: 'VIS_L', 2: 'VIS_M', 3: 'VIS_X', 4: 'VIS_J', 5: 'VIS_V', 6: 'VIS_S'
    };

    // Fixed Holidays (Simplification for now, can be extracted to DB later)
    const HOLIDAYS = ['1-1', '1-6', '5-1', '8-15', '10-12', '11-1', '12-6', '12-8', '12-25'];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = `${d.getMonth() + 1}-${d.getDate()}`;
        if (HOLIDAYS.includes(dateStr)) continue;

        const jsDay = d.getDay();
        const colName = jsDayToCol[jsDay];
        if (effectiveDays.includes(colName)) {
            count++;
        }
    }
    return count;
}

/**
 * Core Commission Logic: 
 * 1. Check Compliance % (Actual / Target)
 * 2. If > 100%, determine Tier
 * 3. Calculate Commission = (Actual - Target) * TierRate
 */
function calculateCommission(actual, target, config) {
    if (target <= 0) return { commission: 0, tier: 0, percentOver: 0, increment: 0 };

    // 1. Compliance
    const compliancePct = (actual / target) * 100;

    // If below target, no commission
    // Note: User said "100.01% to 103%"
    if (compliancePct <= 100.009) { // minimal buffer for float precision
        return { commission: 0, tier: 0, percentOver: 0, increment: 0 };
    }

    const increment = actual - target; // "Diferencia en euros"

    // 2. Determine Rate based on Total Compliance
    let rate = 0;
    let tier = 0;

    if (compliancePct > config.TIER3_MAX) { // > 110%
        rate = config.TIER4_PCT; // 2.0%
        tier = 4;
    } else if (compliancePct > config.TIER2_MAX) { // 106.01 - 110%
        rate = config.TIER3_PCT; // 1.6%
        tier = 3;
    } else if (compliancePct > config.TIER1_MAX) { // 103.01 - 106%
        rate = config.TIER2_PCT; // 1.3%
        tier = 2;
    } else { // 100.01 - 103%
        rate = config.TIER1_PCT; // 1.0%
        tier = 1;
    }

    // 3. Calc Amount
    const commissionAmount = increment * (rate / 100);

    return {
        commission: commissionAmount,
        tier: tier,
        rate: rate,
        percentOver: compliancePct - 100,
        increment: increment,
        compliancePct: compliancePct
    };
}

// =============================================================================
// ROUTES
// =============================================================================

router.get('/summary', async (req, res) => {
    try {
        const { vendedorCode, year } = req.query;
        if (!vendedorCode) return res.status(400).json({ error: 'Falta codigo vendedor' });

        const selectedYear = parseInt(year) || 2026;
        const prevYear = selectedYear - 1; // 2025

        // A. Load Config
        let config = DEFAULT_CONFIG_2026;
        try {
            const dbConfig = await query(`SELECT * FROM JAVIER.COMM_CONFIG WHERE YEAR = ${selectedYear} FETCH FIRST 1 ROWS ONLY`, false, false);
            if (dbConfig && dbConfig.length > 0) {
                // Map DB columns to config object
                const row = dbConfig[0];
                config = {
                    ipc: parseFloat(row.IPC_PCT),
                    TIER1_MAX: parseFloat(row.TIER1_MAX),
                    TIER1_PCT: parseFloat(row.TIER1_PCT),
                    TIER2_MAX: parseFloat(row.TIER2_MAX),
                    TIER2_PCT: parseFloat(row.TIER2_PCT),
                    TIER3_MAX: parseFloat(row.TIER3_MAX),
                    TIER3_PCT: parseFloat(row.TIER3_PCT),
                    TIER4_PCT: parseFloat(row.TIER4_PCT)
                };
            } else {
                // Map default to flat structure for easier usage
                config = {
                    ipc: 3.0,
                    TIER1_MAX: 103.00, TIER1_PCT: 1.0,
                    TIER2_MAX: 106.00, TIER2_PCT: 1.3,
                    TIER3_MAX: 110.00, TIER3_PCT: 1.6,
                    TIER4_PCT: 2.0
                };
            }
        } catch (e) {
            console.error('Error loading config, using default', e);
            config = {
                ipc: 3.0,
                TIER1_MAX: 103.00, TIER1_PCT: 1.0,
                TIER2_MAX: 106.00, TIER2_PCT: 1.3,
                TIER3_MAX: 110.00, TIER3_PCT: 1.6,
                TIER4_PCT: 2.0
            };
        }

        // B. Context setup
        const isExcluded = EXCLUDED_VENDORS.includes(vendedorCode.trim());
        const status = isExcluded ? 'informative' : 'active';
        const isAll = (vendedorCode === 'ALL');

        // C. Get Vendor Route Days (for daily targets)
        // - For specific vendor: Use their actual visit days from LACLAE (based on clients they have)
        // - For ALL: Use CALE calendar (Mon-Fri, 20 días en Enero 2026) as company standard
        let activeDays = [];
        if (isAll) {
            // Company calendar standard: Lunes-Viernes (DSEDAC.CALE = 20 days for Jan 2026)
            activeDays = ['VIS_L', 'VIS_M', 'VIS_X', 'VIS_J', 'VIS_V'];
            console.log(`📅 ALL vendors: using company calendar (L-V), 5 days/week`);
        } else {
            const dayMap = {
                'lunes': 'VIS_L', 'martes': 'VIS_M', 'miercoles': 'VIS_X',
                'jueves': 'VIS_J', 'viernes': 'VIS_V', 'sabado': 'VIS_S', 'domingo': 'VIS_D'
            };
            const rawDays = getVendorActiveDaysFromCache(vendedorCode);
            if (rawDays && rawDays.length > 0) {
                activeDays = rawDays.map(d => dayMap[d]).filter(d => d);
                console.log(`📅 Vendor ${vendedorCode} using ${activeDays.length} days from LACLAE cache`);
            } else {
                // Fallback: use company calendar if no cache data
                activeDays = ['VIS_L', 'VIS_M', 'VIS_X', 'VIS_J', 'VIS_V'];
                console.log(`⚠️ Vendor ${vendedorCode} no cache data, using company calendar (L-V)`);
            }
        }


        // D. Fetch Sales Data (Using LACLAE with LCIMVT = sin IVA)
        // OPTIMIZATION: Removed TRIM to allow index usage. 
        // LCCDVD is usually CHAR/VARCHAR. We query both exact and padded matches if needed, 
        // but typically standardizing to what is in database is better.
        // Assuming database stores trimmed or consistent values. 
        // If not, we use LIKE for specific single-vendor queries to be safe but performant.

        let salesQuery = `
            SELECT 
                L.LCYEAB as YEAR,
                LCMMDC as MONTH,
                SUM(L.LCIMVT) as SALES
            FROM DSED.LACLAE L
            WHERE L.LCYEAB IN (${selectedYear}, ${prevYear})
              AND ${LACLAE_SALES_FILTER}
        `;

        // Build vendor filter using helper function with TRIM
        const vendedorFilter = isAll ? '' : buildVendedorFilterLACLAE(vendedorCode, 'L');

        salesQuery += ` ${vendedorFilter} GROUP BY L.LCYEAB, LCMMDC`;

        const salesRows = await query(salesQuery);


        // E. Build Logic
        const months = [];
        const quarters = [
            { id: 1, name: 'Primer Cuatrimestre', months: [1, 2, 3, 4], target: 0, actual: 0, commission: 0, additionalPayment: 0 },
            { id: 2, name: 'Segundo Cuatrimestre', months: [5, 6, 7, 8], target: 0, actual: 0, commission: 0, additionalPayment: 0 },
            { id: 3, name: 'Tercer Cuatrimestre', months: [9, 10, 11, 12], target: 0, actual: 0, commission: 0, additionalPayment: 0 },
        ];

        let grandTotalCommission = 0;
        const now = new Date(); // To restrict "future coverage"

        // =====================================================================
        // INHERITED OBJECTIVES: Pre-load inherited sales for new vendors
        // =====================================================================
        // For vendors with incomplete history (some months with 0 sales in prevYear),
        // we calculate the target based on sales of their current clients by ANY vendor.
        let inheritedMonthlySales = {};
        if (!isAll) {
            // Check if vendor has any months without data in prevYear
            const monthsWithData = salesRows.filter(r => r.YEAR == prevYear).map(r => r.MONTH);
            const missingMonths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter(m => !monthsWithData.includes(m));

            if (missingMonths.length > 0) {
                // Vendor is "new" or has incomplete history - load inherited sales
                console.log(`📊 Vendor ${vendedorCode} has ${missingMonths.length} months without data: [${missingMonths.join(',')}]. Loading inherited targets...`);

                const currentClients = await getVendorCurrentClients(vendedorCode, selectedYear);
                if (currentClients.length > 0) {
                    inheritedMonthlySales = await getClientsMonthlySales(currentClients, prevYear);
                    console.log(`📊 Found ${currentClients.length} clients. Inherited sales map: ${JSON.stringify(inheritedMonthlySales)}`);
                }
            }
        }

        // =====================================================================
        // FIXED TARGETS: Check if vendor has fixed monthly targets from COMMERCIAL_TARGETS
        // For commission, we use IMPORTE_BASE_COMISION (e.g., 22,727€ for vendor 15)
        // =====================================================================
        let fixedCommissionBase = null;
        if (!isAll) {
            try {
                const currentMonth = now.getMonth() + 1;
                const fixedRows = await query(`
                    SELECT IMPORTE_BASE_COMISION
                    FROM JAVIER.COMMERCIAL_TARGETS
                    WHERE CODIGOVENDEDOR = '${vendedorCode}'
                      AND ANIO = ${selectedYear}
                      AND (MES = ${currentMonth} OR MES IS NULL)
                      AND ACTIVO = 1
                    ORDER BY MES DESC
                    FETCH FIRST 1 ROWS ONLY
                `, false);

                if (fixedRows && fixedRows.length > 0) {
                    fixedCommissionBase = parseFloat(fixedRows[0].IMPORTE_BASE_COMISION) || null;
                    if (fixedCommissionBase) {
                        console.log(`📊 [COMMISSIONS] Vendor ${vendedorCode} has FIXED commission base: ${fixedCommissionBase}€`);
                    }
                }
            } catch (err) {
                // Table might not exist - continue with percentage-based
                console.log(`📊 [COMMISSIONS] COMMERCIAL_TARGETS: ${err.message}`);
            }
        }

        // =====================================================================
        // B-SALES: Load B-sales for this vendor (from JAVIER.VENTAS_B)
        // These get ADDED to both current year sales and previous year sales
        // =====================================================================
        let bSalesCurrYear = {};
        let bSalesPrevYear = {};
        if (!isAll) {
            bSalesCurrYear = await getBSales(vendedorCode, selectedYear);
            bSalesPrevYear = await getBSales(vendedorCode, prevYear);
            const currTotal = Object.values(bSalesCurrYear).reduce((s, v) => s + v, 0);
            const prevTotal = Object.values(bSalesPrevYear).reduce((s, v) => s + v, 0);
            if (currTotal > 0 || prevTotal > 0) {
                console.log(`📊 [COMMISSIONS] B-Sales for ${vendedorCode}: ${selectedYear}=${currTotal.toFixed(2)}€, ${prevYear}=${prevTotal.toFixed(2)}€`);
            }
        }

        for (let m = 1; m <= 12; m++) {
            const prevRow = salesRows.find(r => r.YEAR == prevYear && r.MONTH == m);
            const currRow = salesRows.find(r => r.YEAR == selectedYear && r.MONTH == m);

            // Base sales from LACLAE
            let prevSales = prevRow ? parseFloat(prevRow.SALES) : 0;
            let currentSales = currRow ? parseFloat(currRow.SALES) : 0;

            // ADD B-SALES to both totals
            prevSales += (bSalesPrevYear[m] || 0);
            currentSales += (bSalesCurrYear[m] || 0);

            // INHERITED OBJECTIVES: Use inherited sales when vendor has no own sales for this month
            let targetSource = 'own';
            if (prevSales === 0 && inheritedMonthlySales[m]) {
                prevSales = inheritedMonthlySales[m];
                targetSource = 'inherited';
            }

            // Target 2026: 
            // - If vendor has FIXED commission base from COMMERCIAL_TARGETS, use that
            // - Otherwise: prevSales * (1 + IPC)
            let target;
            if (fixedCommissionBase && fixedCommissionBase > 0) {
                // Fixed commission base applies to commission calculations
                target = fixedCommissionBase;
                targetSource = 'fixed';
            } else {
                target = prevSales * (1 + (config.ipc / 100));
            }

            // Commission for this month
            const result = calculateCommission(currentSales, target, config);
            const commValue = isExcluded ? 0 : result.commission;

            // Add to totals
            grandTotalCommission += commValue;

            // Add to Quarter
            const qIdx = Math.floor((m - 1) / 4);
            quarters[qIdx].target += target;
            quarters[qIdx].actual += currentSales;
            if (!isExcluded) quarters[qIdx].commission += commValue;

            // Daily Logic
            const workingDays = calculateWorkingDays(selectedYear, m, activeDays);

            // Determine if this is a future month first
            const isFuture = (selectedYear > now.getFullYear()) || (selectedYear === now.getFullYear() && m > now.getMonth() + 1);
            const isCurrentMonth = (selectedYear === now.getFullYear() && m === (now.getMonth() + 1));

            // Calculate days passed for current month
            let daysPassed = 0;
            if (isCurrentMonth) {
                // Current month - calculate actual days worked so far
                const { calculateDaysPassed } = require('../utils/common');
                daysPassed = calculateDaysPassed(selectedYear, m, activeDays);
            } else if (isFuture) {
                daysPassed = 0;
            } else {
                // Past month - all days passed
                daysPassed = workingDays;
            }

            // Pro-rated target based on days passed (for current month)
            const proRatedTarget = workingDays > 0 ? (target / workingDays) * daysPassed : 0;

            // Daily calculations
            const dailyTarget = workingDays > 0 ? target / workingDays : 0;
            const dailyActual = daysPassed > 0 ? currentSales / daysPassed : 0;

            // Daily Flag: "Green if accumulated sales >= pro-rated target"
            const isOnTrack = currentSales >= proRatedTarget;

            // Calculate provisional / actual commission on current accumulated amount
            const provisionalResult = calculateCommission(currentSales, proRatedTarget, config);
            const provisionalCommission = isExcluded ? 0 : provisionalResult.commission;

            months.push({
                month: m,
                prevSales: prevSales,
                target: target,
                actual: currentSales,
                workingDays: workingDays,
                daysPassed: daysPassed,
                proRatedTarget: proRatedTarget,
                dailyTarget: dailyTarget,
                dailyActual: dailyActual,
                isFuture: isFuture,
                complianceCtx: {
                    pct: (target > 0) ? (currentSales / target) * 100 : 0,
                    increment: result.increment,
                    tier: result.tier,
                    rate: result.rate,
                    commission: commValue,
                    isExcluded: isExcluded
                },
                dailyComplianceCtx: {
                    pct: (proRatedTarget > 0) ? (currentSales / proRatedTarget) * 100 : 0,
                    tier: provisionalResult.tier,
                    rate: provisionalResult.rate,
                    isGreen: isOnTrack,
                    provisionalCommission: provisionalCommission,
                    increment: provisionalResult.increment
                }
            });
        }


        // F. Calculate Quarterly Catch-up
        // "Total € de comisión pagada vs. Total € real acumulado... para decidir pagos adicionales"
        quarters.forEach(q => {
            const result = calculateCommission(q.actual, q.target, config);
            const potentialTotal = isExcluded ? 0 : result.commission;
            // The user earns the MAX of (Sum(Monthly commissions), Quarterly_Aggregated_Commission).
            // Usually commissions are additive, but if aggregation helps (e.g. one bad month, three amazing months push avg up?),
            // Wait, usually aggregation SMOOTHS OUT spikes, which might LOWER commission if bands are progressive?
            // BUT: if User has one month -5000 and one month +10000. Total +5000.
            // Month 1: 0 comm. Month 2: Comm on 10k.
            // Aggregated: Comm on 5k.
            // Aggregated might be LOWER.
            // However, usually "Quarterly Bonus" implies checking if extended targets are met.
            // Let's implement POSITIVE difference only.

            const diff = potentialTotal - q.commission;
            if (diff > 0.01) { // tolerance
                q.additionalPayment = diff;
            } else {
                q.additionalPayment = 0;
            }

            q.complianceCtx = {
                pct: (q.target > 0) ? (q.actual / q.target) * 100 : 0,
                increment: result.increment,
                tier: result.tier,
                rate: result.rate
            };
        });

        res.json({
            config: config,
            status: status,
            vendor: vendedorCode,
            months: months,
            quarters: quarters,
            totals: {
                commission: grandTotalCommission + quarters.reduce((sum, q) => sum + q.additionalPayment, 0)
            }
        });

    } catch (error) {
        logger.error(`Commissions error: ${error.message}`);
        res.status(500).json({ error: 'Error calculando comisiones', details: error.message });
    }
});

module.exports = router;
