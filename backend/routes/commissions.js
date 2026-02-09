const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const logger = require('../middleware/logger');
const { getVendorActiveDaysFromCache } = require('../services/laclae');
const { getCurrentDate, LACLAE_SALES_FILTER, buildVendedorFilterLACLAE, getVendorName, calculateDaysPassed } = require('../utils/common');


// =============================================================================
// CONFIGURATION & CONSTANTS
// =============================================================================
// FIX #1: Dynamic excluded vendors - loaded from DB with safety fallback
const DEFAULT_EXCLUDED = ['3', '13', '93', '80'];
let EXCLUDED_VENDORS = [...DEFAULT_EXCLUDED];
let _excludedVendorsLastLoad = 0;
const EXCLUDED_CACHE_TTL = 5 * 60 * 1000; // Reload every 5 min

async function loadExcludedVendors() {
    try {
        const rows = await query(`
            SELECT TRIM(CODIGOVENDEDOR) as CODE
            FROM JAVIER.COMMISSION_EXCEPTIONS
            WHERE EXCLUIDO_COMISIONES = 'Y'
        `, false, false);

        if (rows && rows.length > 0) {
            // Keep original code from DB ('03') AND normalized version ('3') to be safe
            const dbCodes = rows.map(r => r.CODE);
            const normalizedCodes = rows.map(r => (r.CODE || '').replace(/^0+/, ''));

            // Merge unique with hardcoded safety list
            EXCLUDED_VENDORS = [...new Set([...DEFAULT_EXCLUDED, ...dbCodes, ...normalizedCodes])];

            console.log(`[COMMISSIONS] Loaded ${rows.length} excluded rules. Effective list: [${EXCLUDED_VENDORS.join(', ')}]`);
        } else {
            EXCLUDED_VENDORS = [...DEFAULT_EXCLUDED];
            console.log(`[COMMISSIONS] No excluded vendors found in DB. Using fallback: [${EXCLUDED_VENDORS.join(', ')}]`);
        }
        _excludedVendorsLastLoad = Date.now();
    } catch (e) {
        console.log(`[COMMISSIONS] Error loading excluded vendors: ${e.message}. Keeping current list: [${EXCLUDED_VENDORS.join(', ')}]`);
    }
}

async function ensureExcludedVendorsLoaded() {
    if (Date.now() - _excludedVendorsLastLoad > EXCLUDED_CACHE_TTL || EXCLUDED_VENDORS.length === 0) {
        await loadExcludedVendors();
    }
}
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

    // FIX #1: Ensure EXCLUIDO_COMISIONES column exists in COMMISSION_EXCEPTIONS
    try {
        await query(`SELECT EXCLUIDO_COMISIONES FROM JAVIER.COMMISSION_EXCEPTIONS FETCH FIRST 1 ROWS ONLY`, false, false);
        logger.info('✅ EXCLUIDO_COMISIONES column exists.');
    } catch (colErr) {
        logger.info('⚙️ Adding EXCLUIDO_COMISIONES column to COMMISSION_EXCEPTIONS...');
        try {
            await query(`ALTER TABLE JAVIER.COMMISSION_EXCEPTIONS ADD COLUMN EXCLUIDO_COMISIONES CHAR(1) DEFAULT 'N'`);
            logger.info('✅ EXCLUIDO_COMISIONES column added.');
        } catch (alterErr) {
            logger.warn(`⚠️ Could not add column (may already exist): ${alterErr.message}`);
        }
    }

    // Seed default excluded vendors - ONLY if table is empty to avoid overriding user changes
    try {
        const count = await query(`SELECT COUNT(*) as CNT FROM JAVIER.COMMISSION_EXCEPTIONS`, false, false);
        if (count && count[0].CNT == 0) {
            const defaultExcluded = ['03', '13', '93', '80']; // Use '03' to match typical DB format
            for (const code of defaultExcluded) {
                await query(`INSERT INTO JAVIER.COMMISSION_EXCEPTIONS (CODIGOVENDEDOR, HIDE_COMMISSIONS, EXCLUIDO_COMISIONES) VALUES ('${code}', 'N', 'Y')`);
            }
            logger.info(`🌱 Seeded default excluded vendors [${defaultExcluded.join(',')}] into empty table.`);
        }
    } catch (seedErr) {
        logger.debug(`Seed check error: ${seedErr.message}`);
    }

    // FIX #4: Create COMMISSION_PAYMENTS table if not exists
    try {
        await query(`SELECT 1 FROM JAVIER.COMMISSION_PAYMENTS FETCH FIRST 1 ROWS ONLY`, false, false);
        logger.info('✅ JAVIER.COMMISSION_PAYMENTS table exists.');
    } catch (e) {
        logger.info('⚙️ Creating JAVIER.COMMISSION_PAYMENTS table...');
        try {
            await query(`
                CREATE TABLE JAVIER.COMMISSION_PAYMENTS (
                    ID INT NOT NULL,
                    CODIGOVENDEDOR VARCHAR(10) NOT NULL,
                    ANIO INT NOT NULL,
                    CUATRIMESTRE INT DEFAULT 0,
                    MES INT DEFAULT 0,
                    IMPORTE_PAGADO DECIMAL(12,2) DEFAULT 0,
                    FECHA_PAGO DATE,
                    CONCEPTO VARCHAR(100),
                    PRIMARY KEY (ID)
                )
            `);
            logger.info('✅ JAVIER.COMMISSION_PAYMENTS table created.');
        } catch (createErr) {
            logger.warn(`⚠️ Could not create COMMISSION_PAYMENTS: ${createErr.message}`);
        }
    }

    // FIX FASE 2: Add IMPORTE_GENERADO column for snapshot support
    try {
        await query(`SELECT IMPORTE_GENERADO FROM JAVIER.COMMISSION_PAYMENTS FETCH FIRST 1 ROWS ONLY`, false, false);
    } catch (colErr) {
        logger.info('⚙️ Adding IMPORTE_GENERADO column to COMMISSION_PAYMENTS...');
        try {
            await query(`ALTER TABLE JAVIER.COMMISSION_PAYMENTS ADD COLUMN IMPORTE_GENERADO DECIMAL(12,2) DEFAULT 0`);
            logger.info('✅ IMPORTE_GENERADO column added.');
        } catch (alterErr) {
            logger.warn(`⚠️ Could not add snapshot column: ${alterErr.message}`);
        }
    }

    // Load excluded vendors into memory
    await loadExcludedVendors();
    logger.info(`✅ Commission system initialized. Excluded vendors: [${EXCLUDED_VENDORS.join(', ')}]`);
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
 * FIX #4: Get payment records for a vendor in a given year
 */
async function getVendorPayments(vendorCode, year) {
    try {
        // Query safely. If table doesn't exist, this throws.
        // We catch it and return 0s so the main flow continues.
        const rows = await query(`
            SELECT CUATRIMESTRE, MES, IMPORTE_PAGADO, FECHA_PAGO
            FROM JAVIER.COMMISSION_PAYMENTS
            WHERE TRIM(CODIGOVENDEDOR) = '${vendorCode.trim()}'
              AND ANIO = ${year}
            ORDER BY MES, CUATRIMESTRE
        `, false, false);

        const payments = { monthly: {}, quarterly: {}, total: 0 };
        if (rows && rows.length > 0) {
            for (const r of rows) {
                const amount = parseFloat(r.IMPORTE_PAGADO) || 0;
                if (r.MES && r.MES > 0) {
                    payments.monthly[r.MES] = (payments.monthly[r.MES] || 0) + amount;
                }
                if (r.CUATRIMESTRE && r.CUATRIMESTRE > 0) {
                    payments.quarterly[r.CUATRIMESTRE] = (payments.quarterly[r.CUATRIMESTRE] || 0) + amount;
                }
                payments.total += amount;
            }
        }
        return payments;
    } catch (e) {
        // Table likely missing or SQL error. Return empty to allow app to function.
        // Only log verbose if needed, otherwise keep it clean.
        // console.log(`[COMMISSIONS] Payments lookup warning for ${vendorCode}: ${e.message}`);
        return { monthly: {}, quarterly: {}, total: 0 };
    }
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
    const normalizedCode = vendedorCode.trim().replace(/^0+/, '') || vendedorCode.trim();
    // FIX #1: Use dynamic excluded list (refreshed from DB)
    const isExcluded = EXCLUDED_VENDORS.includes(normalizedCode);
    console.log(`[COMMISSIONS] calculateVendorData: vendor=${vendedorCode} (normalized=${normalizedCode}), year=${selectedYear}, isExcluded=${isExcluded}`);

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

    // FIX #4: Load payment data
    const payments = await getVendorPayments(vendedorCode, selectedYear);

    console.log(`[COMMISSIONS] Result for ${vendedorCode}: grandTotal=${grandTotalCommission.toFixed(2)}, totalPaid=${payments.total.toFixed(2)}, excluded=${isExcluded}`);

    return {
        vendedorCode,
        vendorName: await getVendorName(vendedorCode),
        months,
        quarters,
        grandTotalCommission,
        isExcluded,
        payments
    };
}


// =============================================================================
// ROUTES
// =============================================================================

router.get('/summary', async (req, res) => {
    try {
        const { vendedorCode, year } = req.query;
        if (!vendedorCode) return res.status(400).json({ success: false, error: 'Falta codigo vendedor' });

        // FIX #1: Refresh excluded vendors from DB (with TTL cache)
        await ensureExcludedVendorsLoaded();
        console.log(`[COMMISSIONS] /summary request: vendedorCode=${vendedorCode}, year=${year}, excludedVendors=[${EXCLUDED_VENDORS.join(',')}]`);

        // Parse Years (Multi-Select)
        const currentYear = new Date().getFullYear();
        const yearParam = year ? year.toString() : currentYear.toString();
        const years = yearParam.split(',').map(y => parseInt(y.trim())).filter(n => !isNaN(n));

        // If no valid year, use current
        if (years.length === 0) years.push(currentYear);

        const selectedYear = years[0]; // Primary year for reference (Config loading)

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


        logger.info(`[COMMISSIONS] Requested Summary for ${vendedorCode} in years: ${years.join(',')}`);

        // Helper to sum results
        const sumResults = (resA, resB) => {
            // Merges two 'breakdown' or 'data' objects
            // This is complex for deep structures. 
            // Simplified: We return a structure that mimics a single year response but with summed values.
            return {
                success: true,
                config: resA.config, // Use first
                isExcluded: resA.isExcluded || resB.isExcluded, // Retain exclusion flag
                grandTotalCommission: (resA.grandTotalCommission || 0) + (resB.grandTotalCommission || 0),
                breakdown: mergeBreakdowns(resA.breakdown, resB.breakdown),
                months: mergeTimeUnits(resA.months, resB.months),
                quarters: mergeTimeUnits(resA.quarters, resB.quarters),
                totals: {
                    commission: (resA.totals?.commission || 0) + (resB.totals?.commission || 0)
                },
                payments: mergePayments(resA.payments, resB.payments) // FIX: Merge payments
            };
        };

        const mergeBreakdowns = (listA, listB) => {
            // Merge by vendorCode
            if (!listA) return listB;
            if (!listB) return listA;

            const map = new Map();
            [...listA, ...listB].forEach(item => {
                if (!map.has(item.vendedorCode)) {
                    map.set(item.vendedorCode, { ...item }); // Clone
                } else {
                    const existing = map.get(item.vendedorCode);
                    existing.grandTotalCommission += item.grandTotalCommission;
                    existing.months = mergeTimeUnits(existing.months, item.months);
                    existing.quarters = mergeTimeUnits(existing.quarters, item.quarters);
                    // Don't sum targets usually? Yes, if multi-year, Target 2024 + Target 2025 = Total Target.
                    // But 'item' structure matches 'calculateVendorData' output.
                }
            });
            return Array.from(map.values());
        };

        const mergeTimeUnits = (listA, listB) => {
            // Merge by month index or quarter id
            if (!listA) return listB || [];
            if (!listB) return listA || [];

            const merged = [];
            // Assuming lists are 1-12 or 1-4.
            // We just map by ID.
            const maxId = Math.max(
                ...listA.map(i => i.month || i.id || 0),
                ...listB.map(i => i.month || i.id || 0)
            );

            for (let i = 1; i <= maxId; i++) {
                const dA = listA.find(x => (x.month || x.id) === i);
                const dB = listB.find(x => (x.month || x.id) === i);

                if (!dA && !dB) continue;

                const base = dA ? { ...dA } : { ...dB };
                if (dA && dB) {
                    base.target = (dA.target || 0) + (dB.target || 0);
                    base.actual = (dA.actual || 0) + (dB.actual || 0);
                    // Commission
                    const commA = (dA.complianceCtx?.commission || 0) + (dA.commission || 0);
                    const commB = (dB.complianceCtx?.commission || 0) + (dB.commission || 0);

                    // Helper to set comm
                    if (base.complianceCtx) base.complianceCtx.commission = commA + commB;
                    else base.commission = commA + commB;
                }
                merged.push(base);
            }
            return merged;
        };

        const mergePayments = (pA, pB) => {
            if (!pA) return pB || { monthly: {}, quarterly: {}, total: 0 };
            if (!pB) return pA || { monthly: {}, quarterly: {}, total: 0 };

            const merged = {
                monthly: { ...pA.monthly },
                quarterly: { ...pA.quarterly },
                total: (pA.total || 0) + (pB.total || 0)
            };

            // Merge Monthly
            Object.keys(pB.monthly || {}).forEach(m => {
                merged.monthly[m] = (merged.monthly[m] || 0) + (pB.monthly[m] || 0);
            });

            // Merge Quarterly
            Object.keys(pB.quarterly || {}).forEach(q => {
                merged.quarterly[q] = (merged.quarterly[q] || 0) + (pB.quarterly[q] || 0);
            });

            return merged;
        };

        // Execution
        let aggregatedResult = null;

        for (const yr of years) {
            // Process Year
            let yearResult;

            if (vendedorCode === 'ALL') {
                // Use R1_T8CDVD (same source as /rutero/vendedores dropdown) for consistent vendor list
                const vendorRows = await query(`
                    SELECT DISTINCT TRIM(L.R1_T8CDVD) as VENDOR_CODE
                    FROM DSED.LACLAE L
                    WHERE L.LCAADC IN (${yr}, ${yr - 1})
                      AND L.R1_T8CDVD IS NOT NULL
                      AND TRIM(L.R1_T8CDVD) <> ''
                `, false);
                const vendorCodes = vendorRows.map(r => r.VENDOR_CODE).filter(c => c && c !== '0');
                const promises = vendorCodes.map(code => calculateVendorData(code, yr, config));
                const results = await Promise.all(promises);

                results.sort((a, b) => b.grandTotalCommission - a.grandTotalCommission); // Sort by comm or sales?
                const globalTotal = results.reduce((s, r) => s + r.grandTotalCommission, 0);

                // Aggregate Months/Quarters for this year (Team View)
                const aggMonths = [];
                for (let m = 1; m <= 12; m++) {
                    let tT = 0, tA = 0, tC = 0;
                    results.forEach(r => {
                        const md = r.months.find(x => x.month === m);
                        if (md) { tT += md.target; tA += md.actual; tC += (md.complianceCtx?.commission || 0); }
                    });
                    aggMonths.push({
                        month: m, target: tT, actual: tA,
                        complianceCtx: { commission: tC }
                    });
                }

                // Aggregate Quarters
                const aggQuarters = [1, 2, 3].map(q => {
                    let tT = 0, tA = 0, tC = 0;
                    results.forEach(r => {
                        const qd = r.quarters.find(x => x.id === q);
                        if (qd) { tT += qd.target; tA += qd.actual; tC += ((qd.commission || 0) + (qd.additionalPayment || 0)); }
                    });
                    return { id: q, target: tT, actual: tA, commission: tC };
                });

                yearResult = {
                    config: config,
                    grandTotalCommission: globalTotal,
                    breakdown: results,
                    months: aggMonths,
                    quarters: aggQuarters
                };

            } else {
                // Single Vendor
                const data = await calculateVendorData(vendedorCode, yr, config);
                yearResult = {
                    config: config,
                    grandTotalCommission: data.grandTotalCommission,
                    totals: { commission: data.grandTotalCommission },
                    months: data.months,
                    quarters: data.quarters,
                    vendor: data.vendedorCode,
                    breakdown: [], // No breakdown for single
                    isExcluded: data.isExcluded, // FIX: Pass exclusion flag
                    payments: data.payments      // FIX: Pass payments data
                };
            }

            if (!aggregatedResult) {
                aggregatedResult = yearResult;
            } else {
                aggregatedResult = sumResults(aggregatedResult, yearResult);
            }
        }

        return res.json({
            success: true,
            ...aggregatedResult
        });

    } catch (error) {
        logger.error(`Commissions error: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error calculando comisiones', details: error.message });
    }
});

// FIX #5: Endpoint to register a payment (Restricted to Diego 9322)
router.post('/pay', async (req, res) => {
    const { vendedorCode, year, month, quarter, amount, generatedAmount, concept, adminCode } = req.body;

    // Security check: Only Diego (9322) can pay
    if (adminCode !== '9322') {
        logger.warn(`[COMMISSIONS] Unauthorized payment attempt by user: ${adminCode}`);
        return res.status(403).json({ success: false, error: 'Solo el administrador (Diego) puede registrar pagos.' });
    }

    if (!vendedorCode || !year || !amount) {
        return res.status(400).json({ success: false, error: 'Faltan datos obligatorios (Comercial, Año, Importe)' });
    }

    try {
        // We use a simplified insert. Note: ID is generated always as identity in the creation script.
        // FASE 2: Now including IMPORTE_GENERADO for snapshot accuracy
        await query(`
            INSERT INTO JAVIER.COMMISSION_PAYMENTS 
            (CODIGOVENDEDOR, ANIO, MES, CUATRIMESTRE, IMPORTE_PAGADO, IMPORTE_GENERADO, FECHA_PAGO, CONCEPTO)
            VALUES (
                '${vendedorCode.trim()}', 
                ${year}, 
                ${month || 0}, 
                ${quarter || 0}, 
                ${amount}, 
                ${generatedAmount || 0},
                CURRENT DATE, 
                '${(concept || 'Pago Comisiones').substring(0, 100)}'
            )
        `, true);

        logger.info(`[COMMISSIONS] Payment registered for ${vendedorCode}: ${amount}€ (vs ${generatedAmount}€ gen) by ${adminCode}`);
        res.json({ success: true, message: 'Pago registrado correctamente' });
    } catch (e) {
        logger.error(`[COMMISSIONS] Payment error: ${e.message}`);
        res.status(500).json({ success: false, error: 'Error al registrar el pago en DB', details: e.message });
    }
});

// FIX #1: Route to get excluded vendor codes (for frontend dynamic loading)
router.get('/excluded-vendors', async (req, res) => {
    try {
        await loadExcludedVendors(); // Force fresh load
        console.log(`[COMMISSIONS] /excluded-vendors returning: [${EXCLUDED_VENDORS.join(', ')}]`);
        res.json({ success: true, excludedVendors: EXCLUDED_VENDORS });
    } catch (e) {
        console.log(`[COMMISSIONS] /excluded-vendors error: ${e.message}`);
        res.json({ success: true, excludedVendors: DEFAULT_EXCLUDED }); // Fallback
    }
});

module.exports = router;
