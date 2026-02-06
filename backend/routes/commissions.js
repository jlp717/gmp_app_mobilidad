const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const logger = require('../middleware/logger');
const { getVendorActiveDaysFromCache } = require('../services/laclae');
const { getCurrentDate, LACLAE_SALES_FILTER, buildVendedorFilterLACLAE, getVendorName, calculateDaysPassed } = require('../utils/common');


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
// HELPER FUNCTIONS
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

/**
 * Get B-Sales (Ventas en B)
 * These are secondary channel sales stored in JAVIER.VENTAS_B
 */
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

/**
 * Calculates working days for a specific month based on vendor's active route days.
 * Holidays are excluded.
 */
function calculateWorkingDays(year, month, activeWeekDays) {
    // If no active days specified (e.g. ALL view), assume Tue-Sat (most vendors work these days)
    const effectiveDays = (activeWeekDays && activeWeekDays.length > 0)
        ? activeWeekDays
        : ['VIS_L', 'VIS_M', 'VIS_X', 'VIS_J', 'VIS_V']; // Lunes-Viernes as company standard


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
    if (target <= 0) return { commission: 0, tier: 0, percentOver: 0, increment: 0, compliancePct: 0 };

    // 1. Compliance
    const compliancePct = (actual / target) * 100;
    const increment = actual - target;

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
    } else if (compliancePct > 100.00) { // 100.01 - 103%
        // Use slight buffer 100.001 to avoid float noise if needed, but user wants EXACT.
        // If > 100, we assign Tier 1.
        rate = config.TIER1_PCT; // 1.0%
        tier = 1;
    } else {
        // <= 100%
        rate = 0;
        tier = 0;
    }

    // 3. Calc Amount (Only if positive increment)
    let commissionAmount = 0;
    if (increment > 0 && rate > 0) {
        commissionAmount = increment * (rate / 100);
    }

    return {
        commission: commissionAmount,
        tier: tier,
        rate: rate,
        percentOver: compliancePct - 100,
        increment: increment,
        compliancePct: compliancePct
    };
}

/**
 * Core Logic to Calculate Metrics for ONE Vendor
 */
async function calculateVendorData(vendedorCode, selectedYear, config) {
    const prevYear = selectedYear - 1;
    const isExcluded = EXCLUDED_VENDORS.includes(vendedorCode.trim());

    // C. Get Vendor Route Days (for daily targets)
    const dayMap = {
        'lunes': 'VIS_L', 'martes': 'VIS_M', 'miercoles': 'VIS_X',
        'jueves': 'VIS_J', 'viernes': 'VIS_V', 'sabado': 'VIS_S', 'domingo': 'VIS_D'
    };
    const rawDays = getVendorActiveDaysFromCache(vendedorCode);
    let activeDays = ['VIS_L', 'VIS_M', 'VIS_X', 'VIS_J', 'VIS_V']; // Default to company calendar
    if (rawDays && rawDays.length > 0) {
        activeDays = rawDays.map(d => dayMap[d]).filter(d => d);
        logger.debug(`📅 Vendor ${vendedorCode} using ${activeDays.length} days from LACLAE cache`);
    } else {
        logger.debug(`⚠️ Vendor ${vendedorCode} no cache data, using company calendar (L-V)`);
    }

    // D. Fetch Sales Data (Using LACLAE with LCIMVT = sin IVA)
    const vendedorFilter = buildVendedorFilterLACLAE(vendedorCode, 'L');
    const salesQuery = `
        SELECT 
            L.LCAADC as YEAR,
            LCMMDC as MONTH,
            SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE L.LCAADC IN (${selectedYear}, ${prevYear})
            AND ${LACLAE_SALES_FILTER}
            ${vendedorFilter}
        GROUP BY L.LCAADC, LCMMDC
        ORDER BY YEAR, MONTH
    `;
    const salesRows = await query(salesQuery, false);

    // =====================================================================
    // INHERITED OBJECTIVES: Pre-load inherited sales for new vendors
    // =====================================================================
    let inheritedMonthlySales = {};
    // Check if vendor has any months without data in prevYear
    const monthsWithData = salesRows.filter(r => r.YEAR == prevYear).map(r => r.MONTH);
    const missingMonths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter(m => !monthsWithData.includes(m));

    if (missingMonths.length > 0) {
        // Vendor is "new" or has incomplete history - load inherited sales
        logger.debug(`📊 Vendor ${vendedorCode} has ${missingMonths.length} months without data: [${missingMonths.join(',')}]. Loading inherited targets...`);

        const currentClients = await getVendorCurrentClients(vendedorCode, selectedYear);
        if (currentClients.length > 0) {
            inheritedMonthlySales = await getClientsMonthlySales(currentClients, prevYear);
            logger.debug(`📊 Found ${currentClients.length} clients. Inherited sales map: ${JSON.stringify(inheritedMonthlySales)}`);
        }
    }

    // =====================================================================
    // FIXED TARGETS: Check if vendor has fixed monthly targets from COMMERCIAL_TARGETS
    // =====================================================================
    let fixedCommissionBase = null;
    try {
        const currentMonth = new Date().getMonth() + 1;
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
                logger.debug(`📊 [COMMISSIONS] Vendor ${vendedorCode} has FIXED commission base: ${fixedCommissionBase}€`);
            }
        }
    } catch (err) {
        logger.debug(`📊 [COMMISSIONS] COMMERCIAL_TARGETS lookup error: ${err.message}`);
    }

    // =====================================================================
    // B-SALES: Load B-sales for this vendor (from JAVIER.VENTAS_B)
    // =====================================================================
    const bSalesCurrYear = await getBSales(vendedorCode, selectedYear);
    const bSalesPrevYear = await getBSales(vendedorCode, prevYear);
    const currTotalBSales = Object.values(bSalesCurrYear).reduce((s, v) => s + v, 0);
    const prevTotalBSales = Object.values(bSalesPrevYear).reduce((s, v) => s + v, 0);
    if (currTotalBSales > 0 || prevTotalBSales > 0) {
        logger.debug(`📊 [COMMISSIONS] B-Sales for ${vendedorCode}: ${selectedYear}=${currTotalBSales.toFixed(2)}€, ${prevYear}=${prevTotalBSales.toFixed(2)}€`);
    }

    // E. Build Logic
    const months = [];
    const quarters = [
        { id: 1, name: 'Primer Cuatrimestre', months: [1, 2, 3, 4], target: 0, actual: 0, commission: 0, additionalPayment: 0, complianceCtx: {} },
        { id: 2, name: 'Segundo Cuatrimestre', months: [5, 6, 7, 8], target: 0, actual: 0, commission: 0, additionalPayment: 0, complianceCtx: {} },
        { id: 3, name: 'Tercer Cuatrimestre', months: [9, 10, 11, 12], target: 0, actual: 0, commission: 0, additionalPayment: 0, complianceCtx: {} },
    ];

    let grandTotalCommission = 0;
    const now = new Date(); // To restrict "future coverage"

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
        if (prevSales === 0 && inheritedMonthlySales[m]) {
            prevSales = inheritedMonthlySales[m];
        }

        // Target 2026: 
        // - If vendor has FIXED commission base from COMMERCIAL_TARGETS, use that
        // - Otherwise: prevSales * (1 + IPC)
        let target;
        if (fixedCommissionBase && fixedCommissionBase > 0) {
            target = fixedCommissionBase;
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
    quarters.forEach(q => {
        const result = calculateCommission(q.actual, q.target, config);
        const potentialTotal = isExcluded ? 0 : result.commission;

        const diff = potentialTotal - q.commission;
        if (diff > 0.01) { // tolerance
            q.additionalPayment = diff;
            grandTotalCommission += diff; // Add to overall total
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

    return {
        vendedorCode,
        vendorName: await getVendorName(vendedorCode),
        months,
        quarters,
        grandTotalCommission,
        isExcluded
    };
}


// =============================================================================
// ROUTES
// =============================================================================

router.get('/summary', async (req, res) => {
    try {
        const { vendedorCode, year } = req.query;
        if (!vendedorCode) return res.status(400).json({ success: false, error: 'Falta codigo vendedor' });

        const selectedYear = parseInt(year) || new Date().getFullYear();

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

        if (vendedorCode === 'ALL') {
            // Fetch all distinct active vendors from LACLAE for the current and previous year
            const vendorRows = await query(`
                SELECT DISTINCT TRIM(LCCDVD) as VENDOR_CODE
                FROM DSED.LACLAE
                WHERE LCAADC IN (${selectedYear}, ${selectedYear - 1})
                  AND ${LACLAE_SALES_FILTER}
            `, false);
            const vendorCodes = vendorRows.map(r => r.VENDOR_CODE).filter(c => c && c !== '0');

            logger.info(`[COMMISSIONS] Generating breakdown for ${vendorCodes.length} vendors...`);

            // Parallel execution of calculateVendorData for each vendor
            const promises = vendorCodes.map(code => calculateVendorData(code, selectedYear, config));
            const results = await Promise.all(promises);

            // Sort by total actual sales (descending)
            results.sort((a, b) => {
                const salesA = a.quarters.reduce((s, q) => s + q.actual, 0);
                const salesB = b.quarters.reduce((s, q) => s + q.actual, 0);
                return salesB - salesA;
            });

            // Calculate Global Total Commission
            const globalTotalCommission = results.reduce((sum, r) => sum + r.grandTotalCommission, 0);

            // --- AGGREGATE MONTHLY DATA (TEAM VIEW) ---
            const aggregateMonths = [];
            for (let m = 1; m <= 12; m++) {
                let totalTarget = 0;
                let totalActual = 0;
                let totalCommission = 0;
                let totalDaysPassed = 0; // Average or Max? Usually confusing for team. Let's sum.
                // Actually, for "Ritmo", we need global sums.

                results.forEach(res => {
                    const monthData = res.months.find(rm => rm.month === m);
                    if (monthData) {
                        totalTarget += monthData.target;
                        totalActual += monthData.actual;
                        totalCommission += (monthData.complianceCtx?.commission || 0);
                        // We don't sum workingDays as it is calendar based, but it might vary by vendor? 
                        // Usually constant per month.
                    }
                });

                // Recalc global metrics for this month
                const pct = totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0;
                // Re-evaluate tier based on global %? Or just sum of commissions?
                // User wants "seeing commercial by commercial". The total commission should be the SUM of individual commissions.
                // We should NOT re-calculate commission based on global target/sales because that would ignore individual tiers.

                aggregateMonths.push({
                    month: m,
                    target: totalTarget,
                    actual: totalActual,
                    workingDays: 20, // Dummy, not used in aggregate view mostly
                    daysPassed: 0,
                    isFuture: (selectedYear > new Date().getFullYear()) || (selectedYear === new Date().getFullYear() && m > new Date().getMonth() + 1),
                    complianceCtx: {
                        pct: pct,
                        commission: totalCommission, // Sum of individual commissions
                        tier: 0, // Not applicable globally
                        rate: 0
                    },
                    dailyComplianceCtx: {
                        pct: 0,
                        isGreen: totalActual >= totalTarget, // Simple check
                        provisionalCommission: 0
                    }
                });
            }

            // --- AGGREGATE QUARTERLY DATA ---
            const aggregateQuarters = [1, 2, 3].map(qIdx => {
                // Sum up all vendors' quarter data
                let qTarget = 0;
                let qActual = 0;
                let qCommission = 0;

                results.forEach(res => {
                    const qData = res.quarters[qIdx - 1]; // qIdx is 1-based, array 0-based
                    if (qData) {
                        qTarget += qData.target;
                        qActual += qData.actual;
                        qCommission += ((qData.commission || 0) + (qData.additionalPayment || 0));
                    }
                });

                return {
                    id: qIdx,
                    name: qIdx === 1 ? 'Primer Cuatrimestre' : (qIdx === 2 ? 'Segundo Cuatrimestre' : 'Tercer Cuatrimestre'),
                    target: qTarget,
                    actual: qActual,
                    commission: qCommission,
                    additionalPayment: 0, // Included in commission sum
                    complianceCtx: {
                        pct: qTarget > 0 ? (qActual / qTarget) * 100 : 0
                    }
                };
            });

            return res.json({
                success: true,
                config: config,
                grandTotalCommission: globalTotalCommission,
                breakdown: results,
                months: aggregateMonths,
                quarters: aggregateQuarters
            });

        } else {
            // Single Vendor
            const data = await calculateVendorData(vendedorCode, selectedYear, config);
            return res.json({
                success: true,
                config: config,
                status: data.isExcluded ? 'informative' : 'active',
                vendor: data.vendedorCode,
                months: data.months,
                quarters: data.quarters,
                totals: {
                    commission: data.grandTotalCommission
                }
            });
        }

    } catch (error) {
        logger.error(`Commissions error: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error calculando comisiones', details: error.message });
    }
});

module.exports = router;
