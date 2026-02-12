const express = require('express');
const router = express.Router();
const { query, queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');
const { getVendorActiveDaysFromCache } = require('../services/laclae');
const { getCurrentDate, LACLAE_SALES_FILTER, buildVendedorFilterLACLAE, getVendorName, calculateDaysPassed, getBSales } = require('../utils/common');


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

            logger.info(`[COMMISSIONS] Loaded ${rows.length} excluded rules. Effective list: [${EXCLUDED_VENDORS.join(', ')}]`);
        } else {
            EXCLUDED_VENDORS = [...DEFAULT_EXCLUDED];
            logger.info(`[COMMISSIONS] No excluded vendors found in DB. Using fallback: [${EXCLUDED_VENDORS.join(', ')}]`);
        }
        _excludedVendorsLastLoad = Date.now();
    } catch (e) {
        logger.warn(`[COMMISSIONS] Error loading excluded vendors: ${e.message}. Keeping current list: [${EXCLUDED_VENDORS.join(', ')}]`);
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
    // 1. Initialize COMM_CONFIG table
    try {
        let commConfigExists = false;
        try {
            await query(`SELECT 1 FROM JAVIER.COMM_CONFIG FETCH FIRST 1 ROWS ONLY`, false, false);
            commConfigExists = true;
            logger.info('✅ JAVIER.COMM_CONFIG found and ready.');
        } catch (e) {
            // Table likely not found, proceed to create
            logger.info('⚙️ Initializing JAVIER.COMM_CONFIG table...');
        }

        if (!commConfigExists) {
            // 2. Create Table (DB2 syntax)
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
        }
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
                    ID INT NOT NULL GENERATED ALWAYS AS IDENTITY,
                    VENDEDOR_CODIGO VARCHAR(10) NOT NULL,
                    ANIO INT NOT NULL,
                    MES INT NOT NULL,
                    VENTAS_REAL DECIMAL(14,2) NOT NULL DEFAULT 0,
                    OBJETIVO_MES DECIMAL(14,2) NOT NULL DEFAULT 0,
                    VENTAS_SOBRE_OBJETIVO DECIMAL(14,2) NOT NULL DEFAULT 0,
                    COMISION_GENERADA DECIMAL(12,2) NOT NULL DEFAULT 0,
                    IMPORTE_PAGADO DECIMAL(12,2) NOT NULL DEFAULT 0,
                    FECHA_PAGO TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    OBSERVACIONES VARCHAR(1000) NOT NULL DEFAULT '',
                    CREADO_POR VARCHAR(50) NOT NULL DEFAULT 'unknown',
                    FECHA_CREACION TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (ID)
                )
            `);
            logger.info('✅ JAVIER.COMMISSION_PAYMENTS table created.');
        } catch (createErr) {
            logger.warn(`⚠️ Could not create COMMISSION_PAYMENTS: ${createErr.message}`);
        }
    }

    // Add OBJETIVO_MES column for snapshot (idempotent - skipped if exists)
    try {
        await query(`SELECT OBJETIVO_MES FROM JAVIER.COMMISSION_PAYMENTS FETCH FIRST 1 ROWS ONLY`, false, false);
    } catch (colErr) {
        logger.info('⚙️ Adding OBJETIVO_MES column to COMMISSION_PAYMENTS...');
        try {
            await query(`ALTER TABLE JAVIER.COMMISSION_PAYMENTS ADD COLUMN OBJETIVO_MES DECIMAL(12,2) DEFAULT 0`);
            logger.info('✅ OBJETIVO_MES column added.');
        } catch (alterErr) {
            logger.warn(`⚠️ Could not add OBJETIVO_MES column: ${alterErr.message}`);
        }
    }

    // Add VENTAS_SOBRE_OBJETIVO column for snapshot
    try {
        await query(`SELECT VENTAS_SOBRE_OBJETIVO FROM JAVIER.COMMISSION_PAYMENTS FETCH FIRST 1 ROWS ONLY`, false, false);
    } catch (colErr) {
        logger.info('⚙️ Adding VENTAS_SOBRE_OBJETIVO column to COMMISSION_PAYMENTS...');
        try {
            await query(`ALTER TABLE JAVIER.COMMISSION_PAYMENTS ADD COLUMN VENTAS_SOBRE_OBJETIVO DECIMAL(12,2) DEFAULT 0`);
            logger.info('✅ VENTAS_SOBRE_OBJETIVO column added.');
        } catch (alterErr) {
            logger.warn(`⚠️ Could not add VENTAS_SOBRE_OBJETIVO column: ${alterErr.message}`);
        }
    }

    // Performance index for payment lookups
    try {
        await query(`CREATE INDEX IDX_CP_VENDOR_YEAR ON JAVIER.COMMISSION_PAYMENTS(VENDEDOR_CODIGO, ANIO)`, false, false);
        logger.info('✅ Index IDX_CP_VENDOR_YEAR created.');
    } catch (idxErr) {
        // Index may already exist - expected after first run
        logger.debug(`Index creation note: ${idxErr.message}`);
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
    const safeCode = vendorCode.replace(/[^a-zA-Z0-9]/g, '');
    const safeYear = parseInt(currentYear);
    const rows = await query(`
        SELECT DISTINCT TRIM(L.LCCDCL) as CLIENT_CODE
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDVD) = '${safeCode}'
          AND L.LCYEAB = ${safeYear}
          AND ${LACLAE_SALES_FILTER}
    `, false);

    // If no clients in current year, try previous year
    if (rows.length === 0) {
        const prevRows = await query(`
            SELECT DISTINCT TRIM(L.LCCDCL) as CLIENT_CODE
            FROM DSED.LACLAE L
            WHERE TRIM(L.LCCDVD) = '${safeCode}'
              AND L.LCYEAB = ${safeYear - 1}
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

    // Build safe IN-clause with sanitized values
    const safeInClause = clientCodes.map(c => `'${String(c).replace(/[^a-zA-Z0-9]/g, '')}'`).join(',');

    const rows = await query(`
        SELECT 
            L.LCMMDC as MONTH,
            SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDCL) IN (${safeInClause})
          AND L.LCYEAB = ${parseInt(year)}
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

// getBSales is now imported from ../utils/common.js

/**
 * Get aggregated payments for a vendor in a given year
 * NEW: Now includes details per payment (observaciones, venta_comision)
 */
async function getVendorPayments(vendorCode, year) {
    const payments = {
        monthly: {},
        quarterly: {},
        total: 0,
        details: {} // NEW: Store payment details by month
    };

    if (!vendorCode) return payments;

    const normalizedCode = vendorCode.trim().replace(/^0+/, '') || vendorCode.trim();

    try {
        // Get all payment records with new columns
        const safeVCode = vendorCode.trim().replace(/[^a-zA-Z0-9]/g, '');
        const safeNCode = normalizedCode.replace(/[^a-zA-Z0-9]/g, '');
        const rows = await query(`
            SELECT
                MES,
                IMPORTE_PAGADO,
                COMISION_GENERADA,
                VENTAS_REAL,
                OBJETIVO_MES,
                OBSERVACIONES,
                FECHA_PAGO
            FROM JAVIER.COMMISSION_PAYMENTS
            WHERE (VENDEDOR_CODIGO = '${safeVCode}' OR VENDEDOR_CODIGO = '${safeNCode}')
              AND ANIO = ${parseInt(year)}
            ORDER BY MES, FECHA_PAGO
        `, false, false);

        rows.forEach(r => {
            const amount = parseFloat(r.IMPORTE_PAGADO) || 0;
            const mes = r.MES;

            payments.total += amount;

            if (mes > 0) {
                payments.monthly[mes] = (payments.monthly[mes] || 0) + amount;

                if (!payments.details[mes]) {
                    payments.details[mes] = {
                        totalPaid: 0,
                        ventaComision: parseFloat(r.VENTAS_REAL) || 0,
                        objetivoReal: parseFloat(r.OBJETIVO_MES) || 0,
                        observaciones: [],
                        ultimaFecha: r.FECHA_PAGO
                    };
                }
                payments.details[mes].totalPaid += amount;
                if (r.OBSERVACIONES && r.OBSERVACIONES.trim()) {
                    payments.details[mes].observaciones.push(r.OBSERVACIONES.trim());
                }
                if (r.FECHA_PAGO && new Date(r.FECHA_PAGO) > new Date(payments.details[mes].ultimaFecha || 0)) {
                    payments.details[mes].ultimaFecha = r.FECHA_PAGO;
                }
            }
        });
    } catch (e) {
        logger.debug(`Payment lookup error for ${vendorCode}: ${e.message}`);
    }

    return payments;
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

// REMOVED: Duplicate function - using the enhanced version above (line ~275)

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
    logger.debug(`[COMMISSIONS] calculateVendorData: vendor=${vendedorCode} (normalized=${normalizedCode}), year=${selectedYear}, isExcluded=${isExcluded}`);

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
        const safeVendor = vendedorCode.replace(/[^a-zA-Z0-9]/g, '');
        const fixedRows = await query(`
            SELECT IMPORTE_BASE_COMISION
            FROM JAVIER.COMMERCIAL_TARGETS
            WHERE CODIGOVENDEDOR = '${safeVendor}'
              AND ANIO = ${parseInt(selectedYear)}
              AND (MES = ${parseInt(currentMonth)} OR MES IS NULL)
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

    logger.debug(`[COMMISSIONS] Result for ${vendedorCode}: grandTotal=${grandTotalCommission.toFixed(2)}, totalPaid=${payments.total.toFixed(2)}, excluded=${isExcluded}`);

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

        // Input sanitization — prevent injection via query params
        const safeVendorCode = vendedorCode.toString().replace(/[^a-zA-Z0-9,]/g, '').substring(0, 50);
        if (!safeVendorCode) return res.status(400).json({ success: false, error: 'Código vendedor inválido' });

        // FIX #1: Refresh excluded vendors from DB (with TTL cache)
        await ensureExcludedVendorsLoaded();
        logger.info(`[COMMISSIONS] /summary request: vendedorCode=${safeVendorCode}, year=${year}`);

        // Parse Years (Multi-Select) with bounds validation
        const currentYear = new Date().getFullYear();
        const yearParam = year ? year.toString().replace(/[^0-9,]/g, '') : currentYear.toString();
        const years = yearParam.split(',')
            .map(y => parseInt(y.trim()))
            .filter(n => !isNaN(n) && n >= 2020 && n <= currentYear + 1);

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
            logger.error('Error loading commissions config, using default', e);
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

            if (safeVendorCode === 'ALL') {
                // FIX: Use LCCDVD (same column used by calculateVendorData for filtering)
                // Previously used R1_T8CDVD which missed vendors like '95' that only exist in LCCDVD
                const safeYr = parseInt(yr);
                const vendorRows = await query(`
                    SELECT DISTINCT TRIM(L.LCCDVD) as VENDOR_CODE
                    FROM DSED.LACLAE L
                    WHERE L.LCAADC IN (${safeYr}, ${safeYr - 1})
                      AND L.LCCDVD IS NOT NULL
                      AND TRIM(L.LCCDVD) <> ''
                `, false);
                const vendorCodes = vendorRows.map(r => r.VENDOR_CODE).filter(c => c && c !== '0');
                const promises = vendorCodes.map(code => calculateVendorData(code, yr, config));
                const settled = await Promise.allSettled(promises);
                const results = settled
                    .filter(r => r.status === 'fulfilled')
                    .map(r => r.value);

                // Log failed vendors for debugging (does not break the page)
                const failed = settled.filter(r => r.status === 'rejected');
                if (failed.length > 0) {
                    logger.warn(`[COMMISSIONS] ${failed.length} vendor(s) failed in ALL mode: ${failed.map(f => f.reason?.message || f.reason).join('; ')}`);
                }

                results.sort((a, b) => {
                    const valA = a.grandTotalCommission || 0;
                    const valB = b.grandTotalCommission || 0;
                    return valB - valA;
                });
                const globalTotal = results.reduce((s, r) => s + (r.grandTotalCommission || 0), 0);
                const totalPaid = results.reduce((s, r) => s + (r.payments?.total || 0), 0);

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
                    totals: { commission: globalTotal },
                    breakdown: results,
                    months: aggMonths,
                    quarters: aggQuarters,
                    payments: { total: totalPaid, monthly: {}, quarterly: {} }
                };

            } else {
                // Single Vendor
                const data = await calculateVendorData(safeVendorCode, yr, config);
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

// FIX #5: Endpoint to register a payment (Restricted to ADMIN users via TIPOVENDEDOR lookup)
// NEW: Validates observaciones requirement and captures venta_comision snapshot
// Pagos son solo INSERT – no UPDATE. Snapshot histórico intencional.
router.post('/pay', async (req, res) => {
    const { vendedorCode, year, month, quarter, amount, generatedAmount, concept, adminCode, observaciones, objetivoMes, ventasSobreObjetivo } = req.body;

    // Security check: Verify that the user has TIPOVENDEDOR = 'ADMIN' or is specifically authorized (code 98 = DIEGO)
    try {
        const trimmedAdmin = adminCode ? adminCode.trim() : '';
        const adminRows = await query(`
            SELECT TIPOVENDEDOR
            FROM DSEDAC.VDC
            WHERE TRIM(CODIGOVENDEDOR) = '${trimmedAdmin.replace(/[^a-zA-Z0-9]/g, '')}'
              AND SUBEMPRESA = 'GMP'
            FETCH FIRST 1 ROWS ONLY
        `, false);

        const adminTipo = (adminRows && adminRows.length > 0)
            ? (adminRows[0].TIPOVENDEDOR || '').trim()
            : '';

        // Only ADMIN or specifically authorized user code 98 (DIEGO)
        const normalizedCode = trimmedAdmin.replace(/^0+/, '') || trimmedAdmin;
        const isAuthorized = adminTipo === 'ADMIN' || normalizedCode === '98';

        if (!isAuthorized) {
            logger.warn(`[COMMISSIONS] Unauthorized payment attempt by user: ${adminCode} (tipoVendedor: ${adminTipo})`);
            return res.status(403).json({ success: false, error: 'No tienes permisos para registrar pagos.' });
        }
    } catch (authErr) {
        logger.error(`[COMMISSIONS] Admin validation DB error: ${authErr.message}`);
        return res.status(500).json({ success: false, error: 'Error validando permisos de administrador.' });
    }

    if (!vendedorCode || !year || !amount) {
        return res.status(400).json({ success: false, error: 'Faltan datos obligatorios (Comercial, Año, Importe)' });
    }

    // NEW: Validate observaciones if paying less than generated amount
    const amountNum = parseFloat(amount);
    const generatedNum = parseFloat(generatedAmount) || 0;
    if (amountNum < generatedNum && (!observaciones || observaciones.trim() === '')) {
        logger.warn(`[COMMISSIONS] Payment validation failed: Missing observaciones for partial payment ${vendedorCode}`);
        return res.status(400).json({
            success: false,
            error: 'Debes indicar una observación explicando por qué se paga menos de lo correspondiente'
        });
    }

    try {
        // NEW: Get venta_comision (snapshot of sales for the specific month)
        let ventaComision = 0;
        if (month && month > 0) {
            try {
                const vendedorFilter = buildVendedorFilterLACLAE(vendedorCode, 'L');
                const salesQuery = `
                    SELECT SUM(L.LCIMVT) as SALES
                    FROM DSED.LACLAE L
                    WHERE L.LCAADC = ${year}
                      AND L.LCMMDC = ${month}
                      AND ${LACLAE_SALES_FILTER}
                      ${vendedorFilter}
                `;
                const salesRows = await query(salesQuery, false, false);
                if (salesRows && salesRows.length > 0) {
                    ventaComision = parseFloat(salesRows[0].SALES) || 0;
                }

                // Add B-Sales if exist
                const bSales = await getBSales(vendedorCode, year);
                ventaComision += (bSales[month] || 0);

                logger.info(`[COMMISSIONS] Captured venta_comision for ${vendedorCode} ${year}/${month}: ${ventaComision.toFixed(2)}€`);
            } catch (salesErr) {
                logger.warn(`[COMMISSIONS] Could not capture venta_comision: ${salesErr.message}`);
            }
        }

        // Snapshot fields from request
        const objetivoMesNum = parseFloat(objetivoMes) || 0;
        const ventasSobreObjetivoNum = parseFloat(ventasSobreObjetivo) || 0;

        // Pagos son solo INSERT – no UPDATE. Snapshot histórico intencional.
        const safePayVendor = vendedorCode.trim().replace(/'/g, "''").replace(/[^a-zA-Z0-9']/g, '');
        const safePayObs = (observaciones || '').substring(0, 1000).replace(/'/g, "''");
        const safePayAdmin = (adminCode || 'unknown').substring(0, 50).replace(/'/g, "''");
        await query(`
            INSERT INTO JAVIER.COMMISSION_PAYMENTS
            (VENDEDOR_CODIGO, ANIO, MES, VENTAS_REAL, OBJETIVO_MES, VENTAS_SOBRE_OBJETIVO, COMISION_GENERADA, IMPORTE_PAGADO, FECHA_PAGO, OBSERVACIONES, CREADO_POR)
            VALUES ('${safePayVendor}', ${parseInt(year)}, ${parseInt(month) || 0}, ${parseFloat(ventaComision) || 0}, ${parseFloat(objetivoMesNum) || 0}, ${parseFloat(ventasSobreObjetivoNum) || 0}, ${parseFloat(generatedNum) || 0}, ${parseFloat(amountNum) || 0}, CURRENT_TIMESTAMP, '${safePayObs}', '${safePayAdmin}')
        `, false);

        logger.info(`[COMMISSIONS] Payment registered for ${vendedorCode}: ${amount}€ (vs ${generatedNum}€ gen, venta: ${ventaComision.toFixed(2)}€) by ${adminCode}${observaciones ? ' [with observaciones]' : ''}`);
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
        logger.debug(`[COMMISSIONS] /excluded-vendors returning: [${EXCLUDED_VENDORS.join(', ')}]`);
        res.json({ success: true, excludedVendors: EXCLUDED_VENDORS });
    } catch (e) {
        logger.warn(`[COMMISSIONS] /excluded-vendors error: ${e.message}`);
        res.json({ success: true, excludedVendors: DEFAULT_EXCLUDED }); // Fallback
    }
});

module.exports = router;
