'use strict';

/**
 * Commissions service — reglas de negocio + acceso DB2 leaf de comisiones.
 *
 * Funciones movidas verbatim desde backend/routes/commissions.js (sin cambios
 * de comportamiento): batch layer completo (client-scope sales rows,
 * single-vendor fallback, batchFetch chunked, calculateVendorData,
 * discoverVendorCodesForYear, grouped summary, merges multi-anio y
 * buildPdfSummaryVendors). La ruta conserva solo validacion/delegacion HTTP,
 * initCommissionTables (DDL test-gated intencional) y re-export _private por
 * compatibilidad (ddd-adapters, scripts).
 *
 * TODO(DIP): recibir query/queryWithParams/cache por parametros en vez de
 * requires directos (patron actual del repo por tiempo).
 */

const crypto = require('crypto');
const logger = require('../middleware/logger');
const { queryWithParams } = require('../middleware/db-timing');
const { comercialErpTable } = require('../utils/comercial-erp-tables');
const {
    getCurrentDate,
    LACLAE_SALES_FILTER,
    SNAPSHOT_UNTIL_MONTH,
    getCommissionVendorColumnExpr,
    getCommissionActualVendorColumnExprForYear,
    getCommissionActualVendorColumnExprForMonth,
    getVendorName,
    calculateDaysPassed,
    getBSales,
} = require('../utils/common');
const {
    resolveCommissionTarget,
    resolveHistoricalCommissionMonth,
    resolvePaymentSnapshotMonth,
} = require('../utils/commission-snapshot');
const { getClientCodesFromCache, getVendorActiveDaysFromCache } = require('./laclae');
const { redisCache, TTL, invalidateCachePattern } = require('./redis-cache');
const { historicalYearsCacheMeta } = require('../src/services/dashboard.service.js');
const { resolveAllModeVendorCodes, allModeCacheScope } = require('./team-commission.service');
const repo = require('../repositories/commissions-repository');

function getCommissionVendorColumnExprForYear(selectedYear, tableAlias = 'L') {
    return getCommissionActualVendorColumnExprForYear(selectedYear, tableAlias);
}

// FIX #1: Dynamic excluded vendors - loaded from DB with safety fallback
const DEFAULT_EXCLUDED = ['3', '13', '93'];
let EXCLUDED_VENDORS = [...DEFAULT_EXCLUDED];
let _excludedVendorsLastLoad = 0;
const EXCLUDED_CACHE_TTL = 5 * 60 * 1000; // Reload every 5 min

async function loadExcludedVendors() {
    try {
        const rows = await repo.fetchExcludedVendorCodes();

        if (rows && rows.length > 0) {
            // Keep original code from DB ('03') AND normalized version ('3') to be safe.
            // 80 is commissionable; only the commercial-80 login is hidden from commission views.
            const dbCodes = rows
                .map((r) => r.CODE)
                .filter((code) => code && ((code || '').replace(/^0+/, '') || code) !== '80');
            const normalizedCodes = dbCodes.map((code) => (code || '').replace(/^0+/, ''));

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

function isVendorExcluded(normalizedCode) {
    return EXCLUDED_VENDORS.includes(normalizedCode);
}

function getExcludedVendors() {
    return [...EXCLUDED_VENDORS];
}

const DEFAULT_CONFIG_2026 = {
    ipc: 3.0,
    tiers: [
        { min: 100.01, max: 103.00, pct: 1.0 },
        { min: 103.01, max: 106.00, pct: 1.3 },
        { min: 106.01, max: 110.00, pct: 1.6 },
        { min: 110.01, max: 999.99, pct: 2.0 },
    ],
};
const COMM_CONFIG_SELECT_SQL = repo.COMM_CONFIG_SELECT_SQL;
const COMMISSIONS_CACHE_VERSION = 'v20260714-payment-record-pdf';

/**
 * Merge monthly commission rows for scoped team ALL (72+73+81+83).
 * Keeps proRatedTarget / workingDays so OBJ. ACUM. and rhythm columns work in Flutter.
 */
function aggregateScopedTeamMonths(vendorResults, selectedYear, _config) {
    const now = getCurrentDate();
    const months = [];
    for (let m = 1; m <= 12; m++) {
        let target = 0;
        let actual = 0;
        let lacSales = 0;
        let bSales = 0;
        let commission = 0;
        let provisionalCommission = 0;
        let workingDays = 0;
        let daysPassed = 0;

        vendorResults.forEach((r) => {
            const md = (r.months || []).find((x) => x.month === m);
            if (!md) return;
            target += md.target || 0;
            actual += md.actual || 0;
            bSales += md.bSales || 0;
            lacSales += md.lacSales ?? Math.max((md.actual || 0) - (md.bSales || 0), 0);
            commission += md.complianceCtx?.commission || 0;
            provisionalCommission += md.dailyComplianceCtx?.provisionalCommission
                ?? md.complianceCtx?.commission
                ?? 0;
            workingDays = Math.max(workingDays, md.workingDays || 0);
            daysPassed = Math.max(daysPassed, md.daysPassed || 0);
        });

        const isFuture = (selectedYear > now.getFullYear())
            || (selectedYear === now.getFullYear() && m > now.getMonth() + 1);
        const isCurrentMonth = (selectedYear === now.getFullYear() && m === (now.getMonth() + 1));

        if (isCurrentMonth && workingDays === 0) {
            workingDays = calculateWorkingDays(selectedYear, m, []);
            daysPassed = calculateDaysPassed(selectedYear, m, []);
        } else if (!isFuture && !isCurrentMonth && workingDays > 0) {
            daysPassed = workingDays;
        }

        const proRatedTarget = workingDays > 0 ? (target / workingDays) * daysPassed : 0;
        const dailyTarget = workingDays > 0 ? target / workingDays : 0;
        const dailyActual = daysPassed > 0 ? actual / daysPassed : 0;
        const isOnTrack = actual >= proRatedTarget;
        const pct = target > 0 ? (actual / target) * 100 : 0;
        const rhythmPct = proRatedTarget > 0 ? (actual / proRatedTarget) * 100 : 0;

        months.push({
            month: m,
            target,
            actual,
            lacSales,
            bSales,
            totalSales: actual,
            workingDays,
            daysPassed,
            proRatedTarget,
            dailyTarget,
            dailyActual,
            isFuture,
            complianceCtx: {
                pct,
                commission,
            },
            dailyComplianceCtx: {
                pct: rhythmPct,
                isGreen: isOnTrack,
                provisionalCommission,
            },
        });
    }
    return months;
}

function getCodeVariants(code) {
    const safe = String(code || '').trim().replace(/[^a-zA-Z0-9]/g, '');
    if (!safe) return [];
    const unpadded = safe.replace(/^0+/, '') || safe;
    const padded = /^\d{1,2}$/.test(unpadded) ? unpadded.padStart(2, '0') : unpadded;
    return [...new Set([safe, unpadded, padded].filter(Boolean))];
}

function appendPaymentDetailRow(detail, row) {
    const amount = parseFloat(row.IMPORTE_PAGADO) || 0;
    const rowDate = row.FECHA_PAGO ? new Date(row.FECHA_PAGO) : null;
    if (!detail.entries) detail.entries = [];
    detail.entries.push({
        amount: roundMoney(amount),
        fecha: row.FECHA_PAGO || null,
        observaciones: (row.OBSERVACIONES || '').trim(),
    });
    detail.totalPaid = roundMoney((detail.totalPaid || 0) + amount);
    detail.comisionGenerada = roundMoney((detail.comisionGenerada || 0) + (parseFloat(row.COMISION_GENERADA) || 0));
    if (row.OBSERVACIONES && row.OBSERVACIONES.trim()) {
        detail.observaciones.push(row.OBSERVACIONES.trim());
    }
    if (!detail.ultimaFecha || (rowDate && rowDate >= new Date(detail.ultimaFecha || 0))) {
        detail.ventaComision = parseFloat(row.VENTAS_REAL) || 0;
        detail.objetivoReal = parseFloat(row.OBJETIVO_MES) || 0;
        detail.comisionGeneradaSnapshot = parseFloat(row.COMISION_GENERADA) || 0;
        detail.ultimaFecha = row.FECHA_PAGO;
    }
}

async function deleteMonthCommissionPayments(vendorCode, year, month) {
    const codeVariants = getCodeVariants(vendorCode);
    if (codeVariants.length === 0) return 0;
    const result = await repo.deleteMonthPayments(
        parseInt(year, 10),
        parseInt(month, 10),
        codeVariants,
    );
    return result?.length || 0;
}

/**
 * Invalidate commission *summary/PDF* caches after payment mutations.
 * Sales caches (LACLAE client-scope / DB2 fallback) stay warm: a payment
 * does not change ventas, only paid totals. Nuking sales keys was forcing
 * a 15s+ LACLAE rescan on the next ALL summary.
 */
async function invalidateCommissionPaymentCaches(vendorCode, year) {
    const safeVendor = String(vendorCode || '').trim().replace(/[^a-zA-Z0-9]/g, '');
    const safeYear = String(year || '').trim();
    const codeVariants = getCodeVariants(safeVendor);

    const patterns = [
        'route:comm:summary:*',
        'route:comm:pdf:*',
        `route:comm:summary:${COMMISSIONS_CACHE_VERSION}:GROUP:*`,
        `route:comm:summary:${COMMISSIONS_CACHE_VERSION}:ALL:*`,
        `route:comm:summary:${COMMISSIONS_CACHE_VERSION}:TEAM80:*`,
    ];

    for (const variant of codeVariants) {
        patterns.push(`route:comm:summary:${COMMISSIONS_CACHE_VERSION}:SINGLE:${variant}:*`);
    }
    if (safeVendor && safeYear) {
        patterns.push(`route:comm:summary:${safeVendor}:${safeYear}`);
    }

    await Promise.all([...new Set(patterns)].map((pattern) => invalidateCachePattern(pattern)));
}

/**
 * Get all clients currently managed by a vendor (from current year or most recent data)
 */
async function getVendorCurrentClients(vendorCode, currentYear) {
    const safeCode = vendorCode.replace(/[^a-zA-Z0-9]/g, '');
    const safeYear = parseInt(currentYear, 10);
    const col = getCommissionVendorColumnExpr('L', 'objective');
    const codeVariants = getCodeVariants(safeCode);
    const placeholders = codeVariants.map(() => '?').join(',');
    const { queryWithParams } = require('../middleware/db-timing');
    const rows = await queryWithParams(`
        SELECT DISTINCT TRIM(L.LCCDCL) as CLIENT_CODE
        FROM ${comercialErpTable('LACLAE')} L
        WHERE TRIM(${col}) IN (${placeholders})
          AND L.LCAADC = ?
          AND ${LACLAE_SALES_FILTER}
    `, [...codeVariants, safeYear], false);

    if (rows.length === 0) {
        const prevRows = await queryWithParams(`
            SELECT DISTINCT TRIM(L.LCCDCL) as CLIENT_CODE
            FROM ${comercialErpTable('LACLAE')} L
            WHERE TRIM(${col}) IN (${placeholders})
              AND L.LCAADC = ?
              AND ${LACLAE_SALES_FILTER}
        `, [...codeVariants, safeYear - 1], false);
        return prevRows.map((r) => r.CLIENT_CODE);
    }

    return rows.map((r) => r.CLIENT_CODE);
}

/**
 * Get monthly sales for a set of clients in a given year (by ALL vendors)
 * This allows us to calculate inherited targets for new vendors
 */
async function getClientsMonthlySales(clientCodes, year) {
    if (!clientCodes || clientCodes.length === 0) return {};

    const placeholders = clientCodes.map(() => '?').join(',');
    const safeCodes = clientCodes.map((c) => String(c).replace(/[^a-zA-Z0-9]/g, ''));
    const { queryWithParams } = require('../middleware/db-timing');

    const rows = await queryWithParams(`
        SELECT 
            L.LCMMDC as MONTH,
            SUM(L.LCIMVT) as SALES
        FROM ${comercialErpTable('LACLAE')} L
        WHERE L.LCCDCL IN (${placeholders})
          AND L.LCAADC = ?
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCMMDC
    `, [...safeCodes, parseInt(year, 10)], false);

    // Build map: month -> total sales
    const monthlyMap = {};
    rows.forEach((r) => {
        monthlyMap[r.MONTH] = parseFloat(r.SALES) || 0;
    });

    return monthlyMap;
}

function aggregateCommissionSalesRows(rows) {
    const byMonth = new Map();
    (rows || []).forEach((row) => {
        const year = parseInt(row.YEAR, 10);
        const month = parseInt(row.MONTH, 10);
        if (!year || !month) return;
        const key = `${year}:${month}`;
        const current = byMonth.get(key) || { YEAR: year, MONTH: month, SALES: 0 };
        current.SALES += parseFloat(row.SALES) || 0;
        byMonth.set(key, current);
    });
    return Array.from(byMonth.values()).sort((a, b) => (a.YEAR - b.YEAR) || (a.MONTH - b.MONTH));
}

function aggregateVendorCommissionSalesRows(rows) {
    const byVendorMonth = new Map();
    (rows || []).forEach((row) => {
        const vendorCode = String(row.VENDOR_CODE || '').trim();
        const year = parseInt(row.YEAR, 10);
        const month = parseInt(row.MONTH, 10);
        if (!vendorCode || !year || !month) return;
        const key = `${vendorCode}:${year}:${month}`;
        const current = byVendorMonth.get(key) || {
            VENDOR_CODE: vendorCode,
            YEAR: year,
            MONTH: month,
            SALES: 0,
        };
        current.SALES += parseFloat(row.SALES) || 0;
        byVendorMonth.set(key, current);
    });
    return Array.from(byVendorMonth.values()).sort((a, b) => String(a.VENDOR_CODE).localeCompare(String(b.VENDOR_CODE))
        || (a.YEAR - b.YEAR)
        || (a.MONTH - b.MONTH));
}

/**
 * Get aggregated payments for a vendor in a given year
 * NEW: Now includes details per payment (observaciones, venta_comision)
 */
async function getVendorPayments(vendorCode, year) {
    const payments = {
        monthly: {},
        quarterly: {},
        total: 0,
        details: {}, // NEW: Store payment details by month
    };

    if (!vendorCode) return payments;

    const normalizedCode = vendorCode.trim().replace(/^0+/, '') || vendorCode.trim();

    try {
        const safeVCode = vendorCode.trim().replace(/[^a-zA-Z0-9]/g, '');
        const safeNCode = normalizedCode.replace(/[^a-zA-Z0-9]/g, '');
        const rows = await repo.fetchVendorPaymentRows(safeVCode, safeNCode, year);

        rows.forEach((r) => {
            const amount = parseFloat(r.IMPORTE_PAGADO) || 0;
            const mes = r.MES;

            payments.total += amount;

            if (mes > 0) {
                payments.monthly[mes] = roundMoney((payments.monthly[mes] || 0) + amount);

                if (!payments.details[mes]) {
                    payments.details[mes] = {
                        totalPaid: 0,
                        comisionGenerada: 0,
                        comisionGeneradaSnapshot: 0,
                        ventaComision: 0,
                        objetivoReal: 0,
                        observaciones: [],
                        entries: [],
                        ultimaFecha: null,
                    };
                }
                appendPaymentDetailRow(payments.details[mes], r);
            }
        });
    } catch (e) {
        logger.debug(`Payment lookup error for ${vendorCode}: ${e.message}`);
    }

    return payments;
}

/**
 * Read the immutable sales snapshot for pre-transition months (Jan/Feb 2026).
 * Returns { snapshotMap, monthsWithData } where:
 *   snapshotMap: { [normalizedVendorCode]: { [month]: { ventasTotales, objetivo, comisionGenerada } } }
 *   monthsWithData: Set<number> of months for which the snapshot table has at least one row.
 *
 * Uses JAVIER.COMMISSION_SNAPSHOT_2026_0102 (existing table with VENTAS_REAL = LAC + CONDOR combined).
 * No LAC/CONDOR split is available — ventasTotales carries the full amount.
 *
 * Only queries if year === 2026 and SNAPSHOT_UNTIL_MONTH > 0.
 *
 * @param {string[]} vendorCodes - Vendor codes to fetch (empty → fetch all)
 * @param {number} year - Year to fetch
 * @returns {{ snapshotMap: Object, monthsWithData: Set<number> }}
 */
async function getVendorSalesSnapshot(vendorCodes, year) {
    if (year !== 2026 || SNAPSHOT_UNTIL_MONTH <= 0) return { snapshotMap: {}, monthsWithData: new Set() };

    try {
        const monthList = Array.from({ length: SNAPSHOT_UNTIL_MONTH }, (_, i) => i + 1);

        let rows;
        let coverageRows;
        if (!vendorCodes || vendorCodes.length === 0) {
            // Fetch all vendors (ALL mode) — no vendor filter
            rows = await repo.fetchSnapshotAll(year, monthList);
            coverageRows = rows;
        } else {
            const safeCodes = [...new Set(vendorCodes.flatMap((c) => {
                const safe = String(c || '').replace(/[^a-zA-Z0-9]/g, '');
                if (!safe) return [];
                const unpadded = safe.replace(/^0+/, '') || safe;
                const padded = /^\d{1,2}$/.test(unpadded) ? unpadded.padStart(2, '0') : unpadded;
                return [safe, unpadded, padded];
            }).filter(Boolean))];
            if (safeCodes.length === 0) return { snapshotMap: {}, monthsWithData: new Set() };
            rows = await repo.fetchSnapshotScoped(year, monthList, safeCodes);
            coverageRows = await repo.fetchSnapshotCoverage(year, monthList);
        }

        // Track which months have at least one row — used to distinguish
        // "table empty for this month" from "vendor not present this month".
        const monthsWithData = new Set();
        const snapshotMap = {};

        (coverageRows || rows).forEach((r) => {
            const mes = parseInt(r.MES, 10);
            if (!Number.isNaN(mes)) monthsWithData.add(mes);
        });

        rows.forEach((r) => {
            const rawCode = (r.VENDEDOR_CODIGO || '').trim();
            // Normalize: strip leading zeros so '02' === '2'. Keep both forms as keys
            // to handle whatever format the rest of the code uses.
            const normalizedCode = rawCode.replace(/^0+/, '') || rawCode;
            const mes = parseInt(r.MES, 10);

            const entry = {
                ventasTotales: parseFloat(r.VENTAS_REAL) || 0,
                objetivo: parseFloat(r.OBJETIVO_MES) || 0,
                comisionGenerada: parseFloat(r.COMISION_GENERADA) || 0,
            };

            // Store under both the raw padded code ('02') and normalized ('2')
            // so lookups succeed regardless of which format callers use.
            for (const key of [rawCode, normalizedCode]) {
                if (!snapshotMap[key]) snapshotMap[key] = {};
                snapshotMap[key][mes] = entry;
            }
        });

        logger.info(`[COMMISSIONS] Snapshot loaded from COMMISSION_SNAPSHOT_2026_0102: ${rows.length} rows, ${Object.keys(snapshotMap).length / 2} vendors, months [${[...monthsWithData].join(',')}] of ${year}`);
        return { snapshotMap, monthsWithData };
    } catch (e) {
        logger.warn(`[COMMISSIONS] getVendorSalesSnapshot failed: ${e.message}`);
        return { snapshotMap: {}, monthsWithData: new Set() };
    }
}

/**
 * Calculates working days for a specific month based on vendor's active route days.
 * Holidays are excluded.
 */
function calculateWorkingDays(year, month, activeWeekDays) {
    // The company calendar defaults to Monday through Saturday.
    const effectiveDays = (activeWeekDays && activeWeekDays.length > 0)
        ? activeWeekDays
        : ['VIS_L', 'VIS_M', 'VIS_X', 'VIS_J', 'VIS_V', 'VIS_S']; // Lunes-Sabado as company standard


    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0); // Last day of month
    let count = 0;

    // JS: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    const jsDayToCol = {
        0: 'VIS_D', 1: 'VIS_L', 2: 'VIS_M', 3: 'VIS_X', 4: 'VIS_J', 5: 'VIS_V', 6: 'VIS_S',
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
        tier,
        rate,
        percentOver: compliancePct - 100,
        increment,
        compliancePct,
    };
}

function roundMoney(value) {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.round(parsed * 100) / 100;
}

async function loadCommissionConfig(year) {
    try {
        const dbConfig = await repo.fetchCommissionConfig(year);
        if (dbConfig && dbConfig.length > 0) {
            const row = dbConfig[0];
            return {
                ipc: parseFloat(row.IPC_PCT),
                TIER1_MAX: parseFloat(row.TIER1_MAX),
                TIER1_PCT: parseFloat(row.TIER1_PCT),
                TIER2_MAX: parseFloat(row.TIER2_MAX),
                TIER2_PCT: parseFloat(row.TIER2_PCT),
                TIER3_MAX: parseFloat(row.TIER3_MAX),
                TIER3_PCT: parseFloat(row.TIER3_PCT),
                TIER4_PCT: parseFloat(row.TIER4_PCT),
            };
        }
    } catch (e) {
        logger.warn(`[COMMISSIONS] COMM_CONFIG lookup failed for ${year}: ${e.message}. Using defaults.`);
    }

    return {
        ipc: 3.0,
        TIER1_MAX: 103.00, TIER1_PCT: 1.0,
        TIER2_MAX: 106.00, TIER2_PCT: 1.3,
        TIER3_MAX: 110.00, TIER3_PCT: 1.6,
        TIER4_PCT: 2.0,
    };
}

/**
 * Core Logic to Calculate Metrics for ONE Vendor
 */
async function calculateVendorData(vendedorCode, selectedYear, config, preloadedData = null) {
    const prevYear = selectedYear - 1;
    const normalizedCode = vendedorCode.trim().replace(/^0+/, '') || vendedorCode.trim();
    // FIX #1: Use dynamic excluded list (refreshed from DB)
    const isExcluded = isVendorExcluded(normalizedCode);
    logger.debug(`[COMMISSIONS] calculateVendorData: vendor=${vendedorCode} (normalized=${normalizedCode}), year=${selectedYear}, isExcluded=${isExcluded}`);

    // C. Get Vendor Route Days (for daily targets)
    const dayMap = {
        'lunes': 'VIS_L', 'martes': 'VIS_M', 'miercoles': 'VIS_X',
        'jueves': 'VIS_J', 'viernes': 'VIS_V', 'sabado': 'VIS_S', 'domingo': 'VIS_D'
    };
    const rawDays = getVendorActiveDaysFromCache(vendedorCode);
    let activeDays = ['VIS_L', 'VIS_M', 'VIS_X', 'VIS_J', 'VIS_V', 'VIS_S']; // Default to company calendar
    if (rawDays && rawDays.length > 0) {
        activeDays = rawDays.map(d => dayMap[d]).filter(d => d);
        logger.debug(`📅 Vendor ${vendedorCode} using ${activeDays.length} days from LACLAE cache`);
    } else {
        logger.debug(`⚠️ Vendor ${vendedorCode} no cache data, using company calendar (L-V)`);
    }

    // D. Fetch Sales Data — use preloaded or query DB
    let salesRows, bSalesCurrYear, bSalesPrevYear, fixedCommissionBase, fixedTargets, payments;
    let usedClientScopeSalesRows = false;

    if (preloadedData) {
        // Use batch-fetched data (no DB queries)
        salesRows = preloadedData.salesRows;
        bSalesCurrYear = preloadedData.bSalesCurr;
        bSalesPrevYear = preloadedData.bSalesPrev;
        // fixedCommissionBase is resolved per-month inside the month loop (see below)
        fixedCommissionBase = null; // Will be overridden per-month
        fixedTargets = preloadedData.fixedTargets || [];
        payments = preloadedData.payments;
    } else {
        // Original per-vendor queries (single vendor mode)
        const safeYear = parseInt(selectedYear, 10);
        const safePrevYear = parseInt(prevYear, 10);
        const safeVendorCodes = getCodeVariants(vendedorCode);
        const fallbackCacheKey = `commissions:${COMMISSIONS_CACHE_VERSION}:sales-db2-fallback:${vendedorCode}:${safeYear}`;
        salesRows = null;
        if (vendedorCode && vendedorCode.indexOf(',') === -1) {
            const clientScopeSalesRows = await getCommissionSalesRowsFromClientCache(vendedorCode, safeYear, safePrevYear);
            if (clientScopeSalesRows) {
                salesRows = clientScopeSalesRows;
                usedClientScopeSalesRows = true;
            }
        }
        if (!salesRows) {
            salesRows = await redisCache.get('route', fallbackCacheKey);
        }
        if (!salesRows) {
            salesRows = safeVendorCodes.length > 0
                ? await fetchSingleVendorCommissionSalesRows(safeVendorCodes, safeYear, safePrevYear)
                : [];
            if (salesRows.length > 0) {
                redisCache.set('route', fallbackCacheKey, salesRows, TTL.SHORT).catch(() => {});
            }
        }

        // Fire independent queries in parallel: inherited clients, fixed targets, B-sales
        const [_currentClients, fixedCommissionRows, bSalesCurr, bSalesPrev] = await Promise.all([
            Promise.resolve([]), // Skip inherited clients in single mode (rarely needed)
            (async () => {
                try {
                    if (!vendedorCode || vendedorCode.indexOf(',') !== -1) return [];
                    const safeVendor = vendedorCode.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
                    if (!safeVendor) return [];
                    const fixedTargetCacheKey = `commissions:${COMMISSIONS_CACHE_VERSION}:fixedTarget:${safeVendor}:${safeYear}`;
                    let rows = await redisCache.get('route', fixedTargetCacheKey);
                    if (!rows) {
                        // Query with both padded ('05') and unpadded ('5') vendor codes
                        // to tolerate code format differences between LACLAE and COMMERCIAL_TARGETS.
                        const safeUnpadded = safeVendor.replace(/^0+/, '') || safeVendor;
                        rows = await queryWithParams(`
                            SELECT IMPORTE_BASE_COMISION, MES
                            FROM JAVIER.COMMERCIAL_TARGETS
                            WHERE (CODIGOVENDEDOR = ? OR CODIGOVENDEDOR = ?)
                              AND ANIO = ?
                              AND ACTIVO = 1
                            ORDER BY MES DESC
                        `, [safeVendor, safeUnpadded, safeYear], false);
                        if (rows.length > 0) {
                            redisCache.set('route', fixedTargetCacheKey, rows, TTL.MEDIUM).catch(() => {});
                        }
                    }
                    return rows;
                } catch (err) {
                    logger.debug(`📊 [COMMISSIONS] COMMERCIAL_TARGETS lookup error: ${err.message}`);
                    return [];
                }
            })(),
            getBSales(vendedorCode, selectedYear),
            getBSales(vendedorCode, prevYear)
        ]);

        bSalesCurrYear = bSalesCurr;
        bSalesPrevYear = bSalesPrev;
        fixedTargets = (fixedCommissionRows || [])
            .map(r => ({
                mes: r.MES != null ? parseInt(r.MES, 10) : null,
                importe: parseFloat(r.IMPORTE_BASE_COMISION) || 0,
            }))
            .filter(r => r.importe > 0)
            .sort((a, b) => (b.mes ?? 0) - (a.mes ?? 0));
        fixedCommissionBase = null;
        payments = await getVendorPayments(vendedorCode, selectedYear);
    }

    // =====================================================================
    // INHERITED OBJECTIVES: Pre-load inherited sales for new vendors
    // =====================================================================
    let inheritedMonthlySales = {};
    const monthsWithData = salesRows.filter(r => Number(r.YEAR) === prevYear).map(r => r.MONTH);
    const missingMonths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter(m => !monthsWithData.includes(m));

    if (!preloadedData && !usedClientScopeSalesRows && missingMonths.length > 0) {
        const currentClients = await getVendorCurrentClients(vendedorCode, selectedYear);
        if (currentClients.length > 0) {
            inheritedMonthlySales = await getClientsMonthlySales(currentClients, prevYear);
            logger.debug(`📊 Found ${currentClients.length} clients. Inherited sales map: ${JSON.stringify(inheritedMonthlySales)}`);
        }
    }

    // =====================================================================
    // FIXED TARGETS: Already resolved from preloadedData or queried above
    // =====================================================================

    // E. Build Logic
    const months = [];
    const quarters = [
        { id: 1, name: 'Primer Cuatrimestre', months: [1, 2, 3, 4], target: 0, actual: 0, commission: 0, additionalPayment: 0, complianceCtx: {} },
        { id: 2, name: 'Segundo Cuatrimestre', months: [5, 6, 7, 8], target: 0, actual: 0, commission: 0, additionalPayment: 0, complianceCtx: {} },
        { id: 3, name: 'Tercer Cuatrimestre', months: [9, 10, 11, 12], target: 0, actual: 0, commission: 0, additionalPayment: 0, complianceCtx: {} },
    ];

    let grandTotalCommission = 0;
    const now = new Date(); // To restrict "future coverage"

    // =====================================================================
    // SALES SNAPSHOT: Load authoritative data for pre-transition months.
    // This covers ALL comerciales including those with 0 commission (e.g. vendor 05).
    // When snapshot exists for a month, it overrides live LACLAE calculations.
    // In batch mode, salesSnapshotData is pre-loaded by the caller (1 query for all).
    // In single mode, query the snapshot table directly.
    // =====================================================================
    // salesSnapshot shape: { snapshotMap, monthsWithData }
    // snapshotForVendor: month → { ventasTotales, objetivo, comisionGenerada }
    let snapshotForVendor = {};
    let snapshotMonthsWithData = new Set();

    if (preloadedData && preloadedData.salesSnapshotData) {
        // Batch mode: snapshot already loaded — preloadedData carries the vendor slice + Set
        snapshotForVendor = preloadedData.salesSnapshotData;
        snapshotMonthsWithData = preloadedData.snapshotMonthsWithData || new Set();
    } else {
        // Single vendor mode: query now
        const salesSnapshot = await getVendorSalesSnapshot([vendedorCode], selectedYear);
        snapshotForVendor = salesSnapshot.snapshotMap[vendedorCode.trim()]
            || salesSnapshot.snapshotMap[normalizedCode]
            || {};
        snapshotMonthsWithData = salesSnapshot.monthsWithData;
    }

    // Pre-index salesRows by (year, month) once instead of O(rows) find() calls
    // inside the 12-month loop below (24 scans per vendor before, O(1) now).
    const salesRowsByYearMonth = new Map();
    for (const row of salesRows) {
        salesRowsByYearMonth.set(`${row.YEAR}:${row.MONTH}`, row);
    }

    for (let m = 1; m <= 12; m++) {
        const prevRow = salesRowsByYearMonth.get(`${prevYear}:${m}`);
        const currRow = salesRowsByYearMonth.get(`${selectedYear}:${m}`);

        // Base sales from LACLAE
        let prevSales = prevRow ? parseFloat(prevRow.SALES) : 0;
        prevSales += (bSalesPrevYear[m] || 0); // Include prev-year B-channel sales in objective baseline
        let currentLacSales = currRow ? parseFloat(currRow.SALES) : 0;
        let currentSales = currentLacSales;

        // ADD B-SALES to current sales.
        const currentBSales = bSalesCurrYear[m] || 0;
        currentSales += currentBSales;

        // INHERITED OBJECTIVES: Use inherited sales when vendor has no own sales for this month
        if (prevSales === 0 && inheritedMonthlySales[m]) {
            prevSales = inheritedMonthlySales[m];
        }

        // Resolve commission base for THIS exact month.
        // COMMERCIAL_TARGETS rows are month pins, not rolling rules: May must
        // not become the target for Jun/Jul/Aug just because those months lack
        // explicit rows.
        const targetResolution = resolveCommissionTarget({
            month: m,
            fixedTargets,
            fallbackFixedBase: fixedCommissionBase,
            prevSales,
            ipc: config.ipc,
        });
        let target = targetResolution.target;
        let targetSource = targetResolution.source;

        // Commission for this month (live calculation as baseline)
        let result = calculateCommission(currentSales, target, config);
        let commValue = isExcluded ? 0 : result.commission;

        // =====================================================================
        // Jan/Feb 2026 are closed commission months. The historical table only
        // stores vendors that generated commission; absence means zero generated
        // commission, while sales/target stay calculated with the historical
        // vendor column so the figures remain explainable.
        const snap = snapshotForVendor[m] || null;
        const historicalMonth = resolveHistoricalCommissionMonth({
            year: selectedYear,
            month: m,
            snapshotUntilMonth: SNAPSHOT_UNTIL_MONTH,
            monthsWithSnapshotData: snapshotMonthsWithData,
            snapshotEntry: snap,
            liveMetrics: {
                actual: currentSales,
                target,
                commission: result.commission,
            },
            isExcluded,
        });
        const liveBeforeHistoricalSnapshot = {
            currentSales,
            target,
            commValue,
            currentLacSales,
            result,
            targetSource,
            snapshotSource: null,
        };

        const isSnapshotMonth = (selectedYear === 2026 && m <= SNAPSHOT_UNTIL_MONTH && SNAPSHOT_UNTIL_MONTH > 0);
        let snapshotApplied = historicalMonth.isHistoricalSnapshot;
        let snapshotSource = historicalMonth.snapshotSource;

        if (snapshotApplied) {
            if (historicalMonth.status === 'recorded') {
                // Vendor present in snapshot → authoritative values
                currentSales = historicalMonth.actual;
                target = historicalMonth.target;
                commValue = historicalMonth.commission;
                snapshotSource = historicalMonth.snapshotSource;
                targetSource = 'historical_snapshot';
                currentLacSales = Math.max(currentSales - currentBSales, 0);
                logger.debug(`[COMMISSIONS] SNAPSHOT month ${m}/2026 for ${vendedorCode}: total=${snap.ventasTotales.toFixed(2)} obj=${snap.objetivo.toFixed(2)} comm=${snap.comisionGenerada.toFixed(2)} (live was ${result.commission.toFixed(2)})`);
            } else {
                // Month has snapshot data globally but this vendor has NO row →
                // vendor was not commissioning that month → force commission = 0.
                // Do not keep live sales here; this month is closed historically.
                currentSales = historicalMonth.actual;
                target = historicalMonth.target;
                commValue = historicalMonth.commission;
                snapshotSource = historicalMonth.snapshotSource;
                targetSource = 'historical_snapshot';
                currentLacSales = Math.max(currentSales - currentBSales, 0);
                logger.debug(`[COMMISSIONS] SNAPSHOT month ${m}/2026: vendor ${vendedorCode} not in snapshot → commission forced to 0`);
            }
            result = calculateCommission(currentSales, target, config);
        } else if (isSnapshotMonth) {
            // Snapshot month but table has NO rows for this month at all → fall back to live.
            logger.warn(`[COMMISSIONS] No snapshot data found for month ${m}/2026 — using live calc (table may be empty for this month).`);
        }

        const liveMetrics = {
            actual: liveBeforeHistoricalSnapshot.currentSales,
            target: liveBeforeHistoricalSnapshot.target,
            commission: liveBeforeHistoricalSnapshot.commValue,
            lacSales: liveBeforeHistoricalSnapshot.currentLacSales,
            bSales: currentBSales,
            totalSales: liveBeforeHistoricalSnapshot.currentSales,
            targetSource: liveBeforeHistoricalSnapshot.targetSource,
            snapshotSource: null,
        };

        const historicalSnapshot = historicalMonth.isHistoricalSnapshot ? {
            status: historicalMonth.status,
            actual: historicalMonth.actual,
            target: historicalMonth.target,
            commission: historicalMonth.commission,
            source: historicalMonth.snapshotSource,
        } : null;

        const paymentDetail = payments?.details?.[m] || payments?.details?.[String(m)] || null;
        const paymentSnapshot = resolvePaymentSnapshotMonth({
            paymentDetail,
            liveMetrics: {
                actual: currentSales,
                target,
                commission: commValue,
            },
            isExcluded,
        });

        let paymentSnapshotInfo = null;
        if (paymentSnapshot.isPaymentSnapshot) {
            paymentSnapshotInfo = {
                status: paymentSnapshot.status,
                actual: paymentSnapshot.actual,
                target: paymentSnapshot.target,
                commission: paymentSnapshot.commission,
                source: paymentSnapshot.snapshotSource,
            };
            currentSales = paymentSnapshot.actual;
            target = paymentSnapshot.target;
            commValue = paymentSnapshot.commission;
            snapshotApplied = true;
            snapshotSource = paymentSnapshot.snapshotSource;
            targetSource = 'payment_snapshot';
            currentLacSales = Math.max(currentSales - currentBSales, 0);
            result = calculateCommission(currentSales, target, config);
            logger.debug(`[COMMISSIONS] PAYMENT SNAPSHOT month ${m}/${selectedYear} for ${vendedorCode}: venta=${currentSales.toFixed(2)} obj=${target.toFixed(2)} comm=${commValue.toFixed(2)}`);
        }
        const paymentSnapshotApplied = Boolean(paymentSnapshotInfo);

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

        // Calculate provisional commission on current accumulated amount
        const provisionalResult = calculateCommission(currentSales, proRatedTarget, config);
        // For snapshot months, provisional = confirmed commission (month is closed)
        let provisionalCommission = isExcluded ? 0 : provisionalResult.commission;
        if (snapshotApplied) {
            provisionalCommission = commValue;
        }

        months.push({
            month: m,
            prevSales,
            target,
            actual: currentSales,
            lacSales: currentLacSales,
            bSales: currentBSales,
            totalSales: currentSales,
            workingDays,
            daysPassed,
            proRatedTarget,
            dailyTarget,
            dailyActual,
            isFuture,
            snapshotApplied,
            snapshotSource,
            targetSource,
            liveMetrics,
            historicalSnapshot,
            paymentSnapshot: paymentSnapshotInfo,
            snapshotRecorded: Boolean(historicalSnapshot || paymentSnapshotInfo),
            paymentSnapshotApplied,
            paymentSnapshotRecorded: Boolean(paymentSnapshotInfo),
            complianceCtx: {
                pct: (target > 0) ? (currentSales / target) * 100 : 0,
                increment: result.increment,
                tier: result.tier,
                rate: result.rate,
                commission: commValue,
                isExcluded,
                snapshotApplied,
                snapshotSource,
                snapshotRecorded: Boolean(historicalSnapshot || paymentSnapshotInfo),
                paymentSnapshotRecorded: Boolean(paymentSnapshotInfo),
                paymentSnapshotApplied,
                targetSource
            },
            dailyComplianceCtx: {
                pct: (proRatedTarget > 0) ? (currentSales / proRatedTarget) * 100 : 0,
                tier: snapshotApplied ? result.tier : provisionalResult.tier,
                rate: snapshotApplied ? result.rate : provisionalResult.rate,
                isGreen: isOnTrack,
                provisionalCommission,
                increment: snapshotApplied ? result.increment : provisionalResult.increment
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

    logger.debug(`[COMMISSIONS] Result for ${vendedorCode}: grandTotal=${grandTotalCommission.toFixed(2)}, totalPaid=${payments.total.toFixed(2)}, excluded=${isExcluded}`);

    const resolvedVendorName = preloadedData?.vendorName || await getVendorName(vendedorCode);

    return {
        vendedorCode,
        vendorName: resolvedVendorName,
        months,
        quarters,
        grandTotalCommission,
        isExcluded,
        payments
    };
}

function monthSnapshotFromVendorRecord(record, month) {
    if (!record) return null;
    const months = Array.isArray(record.months) ? record.months : [];
    const monthData = months.find((item) => parseInt(item.month, 10) === month);
    if (!monthData) return null;
    const actual = roundMoney(monthData.actual);
    const target = roundMoney(monthData.target);
    const generated = roundMoney(
        monthData.complianceCtx?.commission || monthData.commission || 0
    );
    return {
        ventaComision: actual,
        objetivoMes: target,
        ventasSobreObjetivo: roundMoney(actual - target),
        generatedAmount: generated,
        source: 'cache',
    };
}

function findVendorRecordInSummary(cached, vendedorCode) {
    if (!cached || typeof cached !== 'object') return null;
    const variants = new Set(getCodeVariants(vendedorCode));
    const matches = (code) => {
        const trimmed = String(code || '').trim();
        if (!trimmed) return false;
        return variants.has(trimmed) || getCodeVariants(trimmed).some((item) => variants.has(item));
    };
    if (matches(cached.vendor) || matches(cached.vendedorCode)) {
        return cached;
    }
    const breakdown = Array.isArray(cached.breakdown) ? cached.breakdown : [];
    return breakdown.find((row) => matches(row?.vendedorCode) || matches(row?.vendor)) || null;
}

async function getCachedPaymentSnapshot(vendedorCode, year, month) {
    const yearKey = String(year);
    const bucket = summaryCacheBucketForYear(year);
    const variants = getCodeVariants(vendedorCode);
    const keys = [];
    for (const variant of variants) {
        keys.push(`comm:summary:${COMMISSIONS_CACHE_VERSION}:SINGLE:${variant}:${yearKey}:${bucket}`);
    }
    keys.push(
        `comm:summary:${COMMISSIONS_CACHE_VERSION}:ALL:${yearKey}:${bucket}`,
        `comm:summary:${COMMISSIONS_CACHE_VERSION}:TEAM80:${yearKey}:${bucket}`,
    );

    const lookups = await Promise.all(keys.map(async (key) => {
        const cached = await redisCache.get('route', key);
        if (!cached) return null;
        const isSingleKey = String(key).includes(':SINGLE:');
        const record = findVendorRecordInSummary(cached, vendedorCode)
            || (isSingleKey && Array.isArray(cached.months) ? cached : null);
        return monthSnapshotFromVendorRecord(record, month);
    }));
    return lookups.find((snapshot) => snapshot) || null;
}

async function getCurrentPaymentSnapshot(vendedorCode, year, month) {
    const safeYear = parseInt(year, 10);
    const safeMonth = parseInt(month, 10);
    if (!vendedorCode || !safeYear || !safeMonth || safeMonth < 1 || safeMonth > 12) {
        return null;
    }

    const cached = await getCachedPaymentSnapshot(vendedorCode, safeYear, safeMonth);
    if (cached) return cached;

    try {
        const monthSnapshot = await getMonthPaymentSnapshotFromDb(vendedorCode, safeYear, safeMonth);
        if (monthSnapshot) return monthSnapshot;
    } catch (err) {
        logger.warn(`[COMMISSIONS] Month snapshot failed for ${vendedorCode} ${safeYear}/${safeMonth}: ${err.message}`);
    }

    const config = await loadCommissionConfig(safeYear);
    await ensureExcludedVendorsLoaded();
    const data = await calculateVendorData(vendedorCode, safeYear, config);
    const monthData = data.months.find(item => parseInt(item.month, 10) === safeMonth);
    if (!monthData) return null;

    const actual = roundMoney(monthData.actual);
    const target = roundMoney(monthData.target);
    const generated = roundMoney(monthData.complianceCtx?.commission || 0);

    return {
        ventaComision: actual,
        objetivoMes: target,
        ventasSobreObjetivo: roundMoney(actual - target),
        generatedAmount: generated,
        source: 'recalc',
    };
}

async function getMonthPaymentSnapshotFromDb(vendedorCode, year, month) {
    const codeVariants = getCodeVariants(vendedorCode);
    if (codeVariants.length === 0) return null;
    const salesVendorExpr = getCommissionActualVendorColumnExprForMonth(year, month, 'L');
    const prevVendorExpr = getCommissionActualVendorColumnExprForMonth(year - 1, month, 'L');
    const safeVendor = String(vendedorCode || '').replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
    const safeUnpadded = safeVendor.replace(/^0+/, '') || safeVendor;

    // Tier-1 listados sin limite: los SUM() devuelven 1 fila agregada, asi que
    // FETCH FIRST 1 ROWS ONLY es no-op funcional pero acota el scan para el
    // gate estatico; COMMERCIAL_TARGETS por vendor/anio son <=12 filas/mes,
    // FETCH FIRST 60 ROWS ONLY es margen 5x documentado.
    const [config, salesRows, prevRows, bSales, bSalesPrev, targetRows] = await Promise.all([
        loadCommissionConfig(year),
        repo.fetchMonthLacSales(year, month, salesVendorExpr, codeVariants),
        repo.fetchMonthLacSales(year - 1, month, prevVendorExpr, codeVariants),
        getBSales(vendedorCode, year),
        getBSales(vendedorCode, year - 1),
        safeVendor
            ? repo.fetchMonthCommercialTargets(safeVendor, safeUnpadded, year).catch(() => [])
            : Promise.resolve([]),
    ]);

    const currentLac = parseFloat(salesRows?.[0]?.SALES) || 0;
    const prevLac = parseFloat(prevRows?.[0]?.SALES) || 0;
    const actual = roundMoney(currentLac + (bSales?.[month] || 0));
    const prevSales = prevLac + (bSalesPrev?.[month] || 0);
    const fixedTargets = (targetRows || []).map((row) => ({
        mes: row.MES != null ? parseInt(row.MES, 10) : null,
        importe: parseFloat(row.IMPORTE_BASE_COMISION) || 0,
    }));
    const targetInfo = resolveCommissionTarget({
        month,
        fixedTargets,
        prevSales,
        ipc: config.ipc,
    });
    const generated = roundMoney(calculateCommission(actual, targetInfo.target, config).commission || 0);
    return {
        ventaComision: actual,
        objetivoMes: roundMoney(targetInfo.target),
        ventasSobreObjetivo: roundMoney(actual - targetInfo.target),
        generatedAmount: generated,
        source: 'month',
    };
}

/**
 * Fallback de /pay cuando el snapshot de resumen no trae ventas: venta del mes
 * por columna vendor historica + B-sales. Movido verbatim del handler.
 */
async function capturePayFallbackSales(vendedorCode, year, month) {
    const safeYearNum = parseInt(year, 10);
    const safeMonthNum = parseInt(month, 10);
    const salesVendorExpr = getCommissionActualVendorColumnExprForMonth(safeYearNum, safeMonthNum, 'L');
    const codeVariants = getCodeVariants(vendedorCode);
    const vendorPlaceholders = codeVariants.map(() => '?').join(',');
    const vendedorFilter = codeVariants.length > 0
        ? `AND TRIM(${salesVendorExpr}) IN (${vendorPlaceholders})`
        : 'AND 1=0';
    let ventaComision = 0;
    try {
        const salesRows = await repo.fetchPayFallbackSales(safeYearNum, safeMonthNum, vendedorFilter, codeVariants);
        if (salesRows && salesRows.length > 0) {
            ventaComision = parseFloat(salesRows[0].SALES) || 0;
        }

        // Add B-Sales if exist
        const bSales = await getBSales(vendedorCode, year);
        ventaComision += (bSales[safeMonthNum] || 0);

        logger.info(`[COMMISSIONS] Captured venta_comision for ${vendedorCode} ${year}/${month}: ${ventaComision.toFixed(2)}€`);
    } catch (salesErr) {
        logger.warn(`[COMMISSIONS] Could not capture venta_comision: ${salesErr.message}`);
    }
    return ventaComision;
}

function insertCommissionPayment({
    vendorCode, year, month, ventaComision, objetivoMes, ventasSobreObjetivo,
    comisionGenerada, importePagado, observaciones, creadoPor,
}) {
    return repo.insertCommissionPayment({
        vendorCode, year, month, ventaComision, objetivoMes, ventasSobreObjetivo,
        comisionGenerada, importePagado, observaciones, creadoPor,
    });
}

async function getCommissionSalesRowsFromClientCache(vendedorCode, selectedYear, prevYear) {
    const cachedCodes = getClientCodesFromCache(vendedorCode);
    if (!Array.isArray(cachedCodes) || cachedCodes.length === 0) return null;

    const safeClientCodes = [...new Set(
        cachedCodes
            .map(code => String(code || '').trim().replace(/[^a-zA-Z0-9]/g, '').substring(0, 10))
            .filter(Boolean)
    )].sort();
    const maxCodes = Math.max(1, Math.min(parseInt(process.env.COMMISSION_CLIENT_SCOPE_MAX_CODES || '2000', 10), 5000));
    if (safeClientCodes.length === 0 || safeClientCodes.length > maxCodes) return null;

    const clientHash = crypto
        .createHash('sha1')
        .update(safeClientCodes.join(','))
        .digest('hex')
        .substring(0, 12);
    const cacheKey = `commissions:${COMMISSIONS_CACHE_VERSION}:sales-by-client-scope:${vendedorCode}:${selectedYear}:${clientHash}:${safeClientCodes.length}`;
    const cachedRows = await redisCache.get('route', cacheKey);
    if (cachedRows) return cachedRows;

    const chunkSize = 250;
    const chunks = [];
    for (let index = 0; index < safeClientCodes.length; index += chunkSize) {
        chunks.push(safeClientCodes.slice(index, index + chunkSize));
    }

    const chunkRows = await Promise.all(chunks.map((chunk) => {
        const placeholders = chunk.map(() => '?').join(',');
        return queryWithParams(`
            SELECT L.LCAADC as YEAR,
                   L.LCMMDC as MONTH,
                   SUM(L.LCIMVT) as SALES
            FROM ${comercialErpTable('LACLAE')} L
            WHERE L.LCAADC IN (?, ?)
              AND ${LACLAE_SALES_FILTER}
              AND L.LCCDCL IN (${placeholders})
            GROUP BY L.LCAADC, L.LCMMDC
        `, [selectedYear, prevYear, ...chunk], false);
    }));

    const rows = aggregateCommissionSalesRows(chunkRows.flat());
    await redisCache.set('route', cacheKey, rows, TTL.SHORT).catch(() => {});
    return rows;
}

async function getCommissionSalesRowsByClientScopeForVendors(vendorCodes, selectedYear, prevYear) {
    const clientToVendors = new Map();
    for (const vendorCode of vendorCodes || []) {
        const cachedCodes = getClientCodesFromCache(vendorCode);
        if (!Array.isArray(cachedCodes) || cachedCodes.length === 0) continue;

        const normalizedVendor = String(vendorCode || '').trim().replace(/^0+/, '') || String(vendorCode || '').trim();
        cachedCodes
            .map(code => String(code || '').trim().replace(/[^a-zA-Z0-9]/g, '').substring(0, 10))
            .filter(Boolean)
            .forEach(clientCode => {
                if (!clientToVendors.has(clientCode)) clientToVendors.set(clientCode, new Set());
                clientToVendors.get(clientCode).add(normalizedVendor);
            });
    }

    const safeClientCodes = Array.from(clientToVendors.keys()).sort();
    const maxCodes = Math.max(1, Math.min(parseInt(process.env.COMMISSION_CLIENT_SCOPE_MAX_CODES || '5000', 10), 5000));
    if (safeClientCodes.length === 0 || safeClientCodes.length > maxCodes) return [];

    const scopeHash = crypto
        .createHash('sha1')
        .update(JSON.stringify({
            vendors: (vendorCodes || []).map(code => String(code || '').trim()).sort(),
            clients: safeClientCodes,
        }))
        .digest('hex')
        .substring(0, 12);
    const cacheKey = `commissions:${COMMISSIONS_CACHE_VERSION}:sales-by-client-scope:GROUP:${scopeHash}:${selectedYear}:${safeClientCodes.length}`;
    const cachedRows = await redisCache.get('route', cacheKey);
    if (cachedRows) return cachedRows;

    const chunkSize = 250;
    const chunks = [];
    for (let index = 0; index < safeClientCodes.length; index += chunkSize) {
        chunks.push(safeClientCodes.slice(index, index + chunkSize));
    }

    const chunkRows = await Promise.all(chunks.map((chunk) => {
        const placeholders = chunk.map(() => '?').join(',');
        return queryWithParams(`
            SELECT TRIM(L.LCCDCL) as CLIENT_CODE,
                   L.LCAADC as YEAR,
                   L.LCMMDC as MONTH,
                   SUM(L.LCIMVT) as SALES
            FROM ${comercialErpTable('LACLAE')} L
            WHERE L.LCAADC IN (?, ?)
              AND ${LACLAE_SALES_FILTER}
              AND L.LCCDCL IN (${placeholders})
            GROUP BY TRIM(L.LCCDCL), L.LCAADC, L.LCMMDC
        `, [selectedYear, prevYear, ...chunk], false);
    }));

    const expandedRows = [];
    chunkRows.flat().forEach(row => {
        const vendors = clientToVendors.get(String(row.CLIENT_CODE || '').trim());
        if (!vendors) return;
        vendors.forEach(vendorCode => {
            expandedRows.push({
                VENDOR_CODE: vendorCode,
                YEAR: row.YEAR,
                MONTH: row.MONTH,
                SALES: row.SALES,
            });
        });
    });

    const rows = aggregateVendorCommissionSalesRows(expandedRows);
    await redisCache.set('route', cacheKey, rows, TTL.SHORT).catch(() => {});
    return rows;
}

async function fetchSingleVendorCommissionSalesRows(safeVendorCodes, selectedYear, prevYear) {
    if (!Array.isArray(safeVendorCodes) || safeVendorCodes.length === 0) return [];

    const vendorPlaceholders = safeVendorCodes.map(() => '?').join(',');
    const currentSalesVendorCol = getCommissionVendorColumnExpr('L', 'sales');
    const previousJanFebVendorCol = getCommissionVendorColumnExpr('L', 'sales');
    const previousMarDecVendorCol = getCommissionVendorColumnExpr('L', 'objective');

    const [currentRows, previousJanFebRows, previousMarDecRows] = await Promise.all([
        queryWithParams(`
            SELECT L.LCAADC as YEAR,
                   L.LCMMDC as MONTH,
                   SUM(L.LCIMVT) as SALES
            FROM ${comercialErpTable('LACLAE')} L
            WHERE L.LCAADC = ?
              AND ${LACLAE_SALES_FILTER}
              AND ${currentSalesVendorCol} IN (${vendorPlaceholders})
            GROUP BY L.LCAADC, L.LCMMDC
        `, [selectedYear, ...safeVendorCodes], false),
        queryWithParams(`
            SELECT L.LCAADC as YEAR,
                   L.LCMMDC as MONTH,
                   SUM(L.LCIMVT) as SALES
            FROM ${comercialErpTable('LACLAE')} L
            WHERE L.LCAADC = ?
              AND L.LCMMDC < 3
              AND ${LACLAE_SALES_FILTER}
              AND ${previousJanFebVendorCol} IN (${vendorPlaceholders})
            GROUP BY L.LCAADC, L.LCMMDC
        `, [prevYear, ...safeVendorCodes], false),
        queryWithParams(`
            SELECT L.LCAADC as YEAR,
                   L.LCMMDC as MONTH,
                   SUM(L.LCIMVT) as SALES
            FROM ${comercialErpTable('LACLAE')} L
            WHERE L.LCAADC = ?
              AND L.LCMMDC >= 3
              AND ${LACLAE_SALES_FILTER}
              AND ${previousMarDecVendorCol} IN (${vendorPlaceholders})
            GROUP BY L.LCAADC, L.LCMMDC
        `, [prevYear, ...safeVendorCodes], false),
    ]);

    return aggregateCommissionSalesRows([
        ...currentRows,
        ...previousJanFebRows,
        ...previousMarDecRows,
    ]);
}

/**
 * BATCH FETCH: Load all vendor data in parallel queries instead of N×7 sequential.
 * Reduces 145+ queries → 5 queries for ALL mode.
 */
async function batchFetchAllVendorData(vendorCodes, year) {
    // Use CASE expression to handle commission sources per row:
    // current-year sales use LCC seller logic; previous-year baselines use the
    // historical transition (Jan/Feb LCC, Mar+ R1 assignment).
    const currentSalesVendorCol = getCommissionVendorColumnExpr('L', 'sales');
    const previousJanFebVendorCol = getCommissionVendorColumnExpr('L', 'sales');
    const previousMarDecVendorCol = getCommissionVendorColumnExpr('L', 'objective');
    const safeCodes = (vendorCodes || [])
        .map(c => String(c || '').replace(/[^a-zA-Z0-9]/g, ''))
        .filter(Boolean);
    if (safeCodes.length === 0) {
        logger.warn(`[COMMISSIONS] batchFetchAllVendorData called without vendor codes for ${year}`);
        return {};
    }
    // Build code variants (both padded "05" and unpadded "5") for VENTAS_B and COMMISSION_PAYMENTS.
    // These tables may store vendor codes in a different format than LACLAE.
    // getBSales (single-vendor mode) uses OR clause for both formats — replicate that here.
    const codeVariants = [...new Set(safeCodes.flatMap(c => {
        const unpadded = c.replace(/^0+/, '') || c;
        const padded = /^\d{1,2}$/.test(unpadded) ? unpadded.padStart(2, '0') : unpadded;
        return [c, unpadded, padded];
    }))];
    const variantPlaceholders = codeVariants.map(() => '?').join(',');

    const clientScopeSalesRows = await getCommissionSalesRowsByClientScopeForVendors(safeCodes, year, year - 1);
    const clientScopedVendors = new Set(
        clientScopeSalesRows.map(row => (String(row.VENDOR_CODE || '').trim().replace(/^0+/, '') || String(row.VENDOR_CODE || '').trim()))
    );
    const fallbackCodes = safeCodes.filter(code => {
        const normalized = String(code || '').trim().replace(/^0+/, '') || String(code || '').trim();
        return !clientScopedVendors.has(normalized);
    });
    const fallbackPlaceholders = fallbackCodes.map(() => '?').join(',');

    const salesFallbackPromise = fallbackCodes.length > 0
        ? Promise.all([
            // Current-year and previous-year document-vendor sales are fallback
            // only. Normal commission/objective views must use client scope.
            queryWithParams(`
                SELECT TRIM(${currentSalesVendorCol}) as VENDOR_CODE,
                       L.LCAADC as YEAR,
                       L.LCMMDC as MONTH,
                       SUM(L.LCIMVT) as SALES
                FROM ${comercialErpTable('LACLAE')} L
                WHERE L.LCAADC = ?
                  AND ${LACLAE_SALES_FILTER}
                  AND TRIM(${currentSalesVendorCol}) IN (${fallbackPlaceholders})
                GROUP BY TRIM(${currentSalesVendorCol}), L.LCAADC, L.LCMMDC
            `, [year, ...fallbackCodes], false),

            queryWithParams(`
                SELECT TRIM(${previousJanFebVendorCol}) as VENDOR_CODE,
                       L.LCAADC as YEAR,
                       L.LCMMDC as MONTH,
                       SUM(L.LCIMVT) as SALES
                FROM ${comercialErpTable('LACLAE')} L
                WHERE L.LCAADC = ?
                  AND L.LCMMDC < 3
                  AND ${LACLAE_SALES_FILTER}
                  AND TRIM(${previousJanFebVendorCol}) IN (${fallbackPlaceholders})
                GROUP BY TRIM(${previousJanFebVendorCol}), L.LCAADC, L.LCMMDC
            `, [year - 1, ...fallbackCodes], false),

            queryWithParams(`
                SELECT TRIM(${previousMarDecVendorCol}) as VENDOR_CODE,
                       L.LCAADC as YEAR,
                       L.LCMMDC as MONTH,
                       SUM(L.LCIMVT) as SALES
                FROM ${comercialErpTable('LACLAE')} L
                WHERE L.LCAADC = ?
                  AND L.LCMMDC >= 3
                  AND ${LACLAE_SALES_FILTER}
                  AND TRIM(${previousMarDecVendorCol}) IN (${fallbackPlaceholders})
                GROUP BY TRIM(${previousMarDecVendorCol}), L.LCAADC, L.LCMMDC
            `, [year - 1, ...fallbackCodes], false),
        ])
        : Promise.resolve([[], [], []]);

    const [
        [currentSalesRows, previousJanFebSalesRows, previousMarDecSalesRows],
        allBSalesRows,
        allPaymentsRows,
        allFixedTargets,
        allVendorNames,
    ] = await Promise.all([
        salesFallbackPromise,

        // 2. B-Sales for ALL vendors (current + prev year) from JAVIER.VENTAS_B
        // Use codeVariants (both padded + unpadded) to match however codes are stored in VENTAS_B.
        queryWithParams(`
            SELECT TRIM(CODIGOVENDEDOR) as VENDOR_CODE, MES, IMPORTE as SALES, EJERCICIO as YEAR
            FROM JAVIER.VENTAS_B
            WHERE EJERCICIO IN (?, ?)
              AND TRIM(CODIGOVENDEDOR) IN (${variantPlaceholders})
        `, [year, year - 1, ...codeVariants], false),

        // 3. Payments for ALL vendors
        // Use codeVariants (both padded + unpadded) to match however codes are stored in COMMISSION_PAYMENTS.
        queryWithParams(`
            SELECT VENDEDOR_CODIGO as VENDOR_CODE, MES, IMPORTE_PAGADO, COMISION_GENERADA,
                   VENTAS_REAL, OBJETIVO_MES, OBSERVACIONES, FECHA_PAGO
            FROM JAVIER.COMMISSION_PAYMENTS
            WHERE ANIO = ?
              AND VENDEDOR_CODIGO IN (${variantPlaceholders})
            ORDER BY VENDEDOR_CODIGO, MES, FECHA_PAGO
        `, [year, ...codeVariants], false),

        // 4. Fixed targets for ALL vendors
        // Use codeVariants (both '05' and '5') because COMMERCIAL_TARGETS may store
        // vendor codes in a different format than the LACLAE CASE expression returns.
        queryWithParams(`
            SELECT CODIGOVENDEDOR as VENDOR_CODE, IMPORTE_BASE_COMISION, MES
            FROM JAVIER.COMMERCIAL_TARGETS
            WHERE ANIO = ?
              AND CODIGOVENDEDOR IN (${variantPlaceholders})
              AND ACTIVO = 1
        `, [year, ...codeVariants], false),

        // 5. Vendor names for ALL vendors (also use variants for code format tolerance)
        queryWithParams(`
            SELECT TRIM(CODIGOVENDEDOR) as VENDOR_CODE, TRIM(NOMBREVENDEDOR) as VENDOR_NAME
            FROM ${comercialErpTable('VDD')}
            WHERE TRIM(CODIGOVENDEDOR) IN (${variantPlaceholders})
        `, [...codeVariants], false),
    ]);
    const db2SalesRows = aggregateVendorCommissionSalesRows([
        ...currentSalesRows,
        ...previousJanFebSalesRows,
        ...previousMarDecSalesRows,
    ]);
    const allSalesRows = aggregateVendorCommissionSalesRows([
        ...clientScopeSalesRows,
        ...db2SalesRows.filter(row => {
            const normalized = String(row.VENDOR_CODE || '').trim().replace(/^0+/, '') || String(row.VENDOR_CODE || '').trim();
            return !clientScopedVendors.has(normalized);
        }),
    ]);

    // Partition data by vendor in memory (single O(N) pass per dataset instead of
    // O(V×N) filter/find scans per vendor — with ALL vendors and large datasets the
    // previous approach blocked the event loop).
    const vendorKey = (raw) => {
        const value = String(raw || '').trim();
        return value.replace(/^0+/, '') || value;
    };
    const partitionByVendor = (rows) => {
        const map = new Map();
        for (const row of rows) {
            const key = vendorKey(row.VENDOR_CODE);
            const bucket = map.get(key);
            if (bucket) bucket.push(row);
            else map.set(key, [row]);
        }
        return map;
    };
    const salesByVendor = partitionByVendor(allSalesRows);
    const bSalesByVendor = partitionByVendor(allBSalesRows);
    const paymentsByVendor = partitionByVendor(allPaymentsRows);
    const fixedByVendor = partitionByVendor(allFixedTargets);
    const vendorNamesByVendor = partitionByVendor(allVendorNames);

    const dataByVendor = {};
    for (const code of vendorCodes) {
        const normalized = vendorKey(code);
        const salesRows = salesByVendor.get(normalized) || [];
        const bSalesRows = bSalesByVendor.get(normalized) || [];
        const paymentRows = paymentsByVendor.get(normalized) || [];
        const fixedRows = fixedByVendor.get(normalized) || [];
        const vendorName = (vendorNamesByVendor.get(normalized) || [])[0];

        // Build B-sales maps
        const bSalesCurr = {};
        const bSalesPrev = {};
        bSalesRows.forEach(r => {
            const m = r.MES;
            const s = parseFloat(r.SALES) || 0;
            const yr = parseInt(r.YEAR, 10);
            if (yr === year) {
                bSalesCurr[m] = (bSalesCurr[m] || 0) + s;
            } else {
                bSalesPrev[m] = (bSalesPrev[m] || 0) + s;
            }
        });

        // Build payments structure
        const payments = { monthly: {}, quarterly: {}, total: 0, details: {} };
        paymentRows.forEach(r => {
            const m = r.MES;
            if (!payments.details[m]) {
                payments.details[m] = {
                    totalPaid: 0,
                    comisionGenerada: 0,
                    comisionGeneradaSnapshot: 0,
                    observaciones: [],
                    ventaComision: 0,
                    objetivoReal: 0,
                    entries: [],
                    ultimaFecha: null
                };
            }
            appendPaymentDetailRow(payments.details[m], r);
            payments.monthly[m] = roundMoney(payments.details[m].totalPaid);
            payments.total += parseFloat(r.IMPORTE_PAGADO) || 0;
        });

        // Build fixed target map: keep ALL rows so the month loop can pick the
        // most appropriate entry per month (month-specific > annual > most recent past).
        // Sorting by MES desc (treating null as 0 so annual entries sort last).
        const sortedFixed = fixedRows
            .map(r => ({
                mes: r.MES != null ? parseInt(r.MES, 10) : null,
                importe: parseFloat(r.IMPORTE_BASE_COMISION) || 0,
            }))
            .filter(r => r.importe > 0)
            .sort((a, b) => (b.mes ?? 0) - (a.mes ?? 0));

        dataByVendor[code] = {
            salesRows,
            bSalesCurr,
            bSalesPrev,
            payments,
            fixedTargets: sortedFixed,   // per-month lookup (replaces fixedCommissionBase)
            vendorName: vendorName?.VENDOR_NAME || '',
        };
    }

    logger.info(`[COMMISSIONS] Batch fetch: ${vendorCodes.length} vendors, ${allSalesRows.length} sales rows, ${allBSalesRows.length} B-sales rows in 5 queries`);
    return dataByVendor;
}

function chunkArray(items, size) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

function getCommissionBatchChunkSize() {
    const configured = parseInt(process.env.COMMISSION_ALL_VENDOR_CHUNK_SIZE || '8', 10);
    if (!Number.isFinite(configured)) return 8;
    return Math.max(8, Math.min(configured, 40));
}

function getCommissionChunkConcurrency(chunkCount) {
    const configured = parseInt(process.env.COMMISSION_ALL_VENDOR_CHUNK_CONCURRENCY || '3', 10);
    const parsed = Number.isFinite(configured) ? Math.max(1, Math.min(configured, 4)) : 3;
    return Math.min(parsed, chunkCount);
}

async function runChunksWithConcurrency(chunks, concurrency, worker) {
    const results = new Array(chunks.length);
    let next = 0;
    const runners = Array.from({ length: concurrency }, async () => {
        while (next < chunks.length) {
            const index = next++;
            results[index] = await worker(chunks[index], index);
        }
    });
    await Promise.all(runners);
    return results;
}

async function batchFetchVendorDataChunked(vendorCodes, year) {
    const safeCodes = [...new Set((vendorCodes || [])
        .map(code => String(code || '').trim().replace(/[^a-zA-Z0-9]/g, ''))
        .filter(Boolean))];

    if (safeCodes.length === 0) return {};

    const chunkSize = getCommissionBatchChunkSize();
    if (safeCodes.length <= chunkSize) {
        return batchFetchAllVendorData(safeCodes, year);
    }

    const chunks = chunkArray(safeCodes, chunkSize);
    const concurrency = getCommissionChunkConcurrency(chunks.length);
    logger.info(`[COMMISSIONS] Chunked batch fetch: ${safeCodes.length} vendors in ${chunks.length} chunk(s) of ${chunkSize}, concurrency ${concurrency}`);

    const startedAt = Date.now();
    const partials = await runChunksWithConcurrency(chunks, concurrency, (chunk) => batchFetchAllVendorData(chunk, year));
    const merged = {};
    for (const partial of partials) {
        if (partial) Object.assign(merged, partial);
    }
    logger.info(`[COMMISSIONS] Chunks loaded ${safeCodes.length} vendors in ${Date.now() - startedAt}ms`);

    return merged;
}

function buildAggregatedYearResult(results, config) {
    const sortedResults = [...(results || [])].sort((a, b) => {
        const valA = a.grandTotalCommission || 0;
        const valB = b.grandTotalCommission || 0;
        return valB - valA;
    });

    const globalTotal = sortedResults.reduce((sum, item) => sum + (item.grandTotalCommission || 0), 0);
    const totalPaid = sortedResults.reduce((sum, item) => sum + (item.payments?.total || 0), 0);

    const aggMonths = [];
    for (let month = 1; month <= 12; month++) {
        let target = 0;
        let actual = 0;
        let lacSales = 0;
        let bSales = 0;
        let commission = 0;

        sortedResults.forEach((result) => {
            const monthData = result.months.find((x) => x.month === month);
            if (monthData) {
                target += monthData.target;
                actual += monthData.actual;
                bSales += monthData.bSales || 0;
                lacSales += monthData.lacSales ?? Math.max((monthData.actual || 0) - (monthData.bSales || 0), 0);
                commission += (monthData.complianceCtx?.commission || 0);
            }
        });

        aggMonths.push({
            month,
            target,
            actual,
            lacSales,
            bSales,
            totalSales: actual,
            complianceCtx: { commission },
        });
    }

    const aggQuarters = [1, 2, 3].map((quarterId) => {
        let target = 0;
        let actual = 0;
        let commission = 0;

        sortedResults.forEach((result) => {
            const quarterData = result.quarters.find((x) => x.id === quarterId);
            if (quarterData) {
                target += quarterData.target;
                actual += quarterData.actual;
                commission += ((quarterData.commission || 0) + (quarterData.additionalPayment || 0));
            }
        });

        return { id: quarterId, target, actual, commission };
    });

    return {
        config,
        grandTotalCommission: globalTotal,
        totals: { commission: globalTotal },
        breakdown: sortedResults,
        months: aggMonths,
        quarters: aggQuarters,
        payments: { total: totalPaid, monthly: {}, quarterly: {} },
    };
}

async function discoverVendorCodesForYear(year) {
    const safeYr = parseInt(year, 10);
    const cacheKey = `comm:${COMMISSIONS_CACHE_VERSION}:vendorCodes:${safeYr}`;

    const cachedCodes = await redisCache.get('route', cacheKey);
    if (cachedCodes) {
        return cachedCodes;
    }

    const colExpr = getCommissionVendorColumnExprForYear(safeYr, 'L');
    const vendorRows = await queryWithParams(`
        SELECT DISTINCT RTRIM(${colExpr}) as VENDOR_CODE
        FROM ${comercialErpTable('LACLAE')} L
        WHERE L.LCAADC IN (?, ?)
          AND ${colExpr} IS NOT NULL
          AND ${colExpr} <> ''
    `, [safeYr, safeYr - 1], false);

    // Deduplicate by normalizing leading zeros: '05' and '5' are the same vendor.
    // Sales and objective columns may return the same vendor with padded/unpadded
    // formats; keep one row per normalized code.
    const seenNormalized = new Set();
    const codes = vendorRows
        .map(r => (r.VENDOR_CODE || '').trim())
        .filter(code => {
            if (!code || code === '0') return false;
            const normalized = code.replace(/^0+/, '') || code;
            if (seenNormalized.has(normalized)) return false;
            seenNormalized.add(normalized);
            return true;
        });

    await redisCache.set('route', cacheKey, codes, TTL.LONG);
    return codes;
}

async function calculateGroupedVendorSummary(vendorCodes, year, config) {
    const safeCodes = [...new Set((vendorCodes || [])
        .map(code => String(code || '').trim())
        .filter(code => /^[a-zA-Z0-9]+$/.test(code))
        .filter(code => code !== '0'))];

    if (safeCodes.length === 0) {
        return buildAggregatedYearResult([], config);
    }

    const settled = await Promise.allSettled(
        safeCodes.map(code => calculateVendorData(code, year, config))
    );

    const results = settled
        .filter(result => result.status === 'fulfilled')
        .map(result => result.value);

    const failed = settled.filter(result => result.status === 'rejected');
    if (failed.length > 0) {
        logger.warn(
            `[COMMISSIONS] ${failed.length} vendor(s) failed in grouped mode: ` +
            failed.map(f => f.reason?.message || f.reason).join('; ')
        );
    }

    return buildAggregatedYearResult(results, config);
}

function mergeBreakdowns(listA, listB) {
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
}

function mergeTimeUnits(listA, listB) {
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
}

function mergePayments(pA, pB) {
    if (!pA) return pB || { monthly: {}, quarterly: {}, details: {}, total: 0 };
    if (!pB) return pA || { monthly: {}, quarterly: {}, details: {}, total: 0 };

    const merged = {
        monthly: { ...pA.monthly },
        quarterly: { ...pA.quarterly },
        details: {},
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

    const mergeDetails = (details = {}) => {
        Object.entries(details).forEach(([month, detail]) => {
            if (!merged.details[month]) {
                merged.details[month] = {
                    totalPaid: 0,
                    comisionGenerada: 0,
                    observaciones: [],
                    ventaComision: 0,
                    objetivoReal: 0,
                    ultimaFecha: null,
                };
            }
            const target = merged.details[month];
            target.totalPaid += parseFloat(detail?.totalPaid) || 0;
            target.comisionGenerada += parseFloat(detail?.comisionGenerada) || 0;
            target.ventaComision += parseFloat(detail?.ventaComision) || 0;
            target.objetivoReal += parseFloat(detail?.objetivoReal) || 0;
            if (Array.isArray(detail?.observaciones)) {
                target.observaciones.push(...detail.observaciones.filter(Boolean));
            }
            const detailDate = detail?.ultimaFecha ? new Date(detail.ultimaFecha) : null;
            const targetDate = target.ultimaFecha ? new Date(target.ultimaFecha) : null;
            if (detailDate && (!targetDate || detailDate >= targetDate)) {
                target.ultimaFecha = detail.ultimaFecha;
            }
        });
    };

    mergeDetails(pA.details);
    mergeDetails(pB.details);

    return merged;
}

function sumResults(resA, resB) {
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
}

function loadCommissionConfigForPdf(year) {
    // Identico a loadCommissionConfig del service (compat _private).
    return loadCommissionConfig(year);
}

function summaryCacheBucketForYear(year) {
    return historicalYearsCacheMeta([year], getCurrentDate()).bucket;
}

function buildGroupedSummaryCacheKeyForPdf(safeVendorCode, requestedVendorCodes, userCode, year) {
    const bucket = summaryCacheBucketForYear(year);
    if (safeVendorCode === 'ALL') {
        const allScope = allModeCacheScope(userCode, safeVendorCode) || 'ALL';
        return `comm:summary:${COMMISSIONS_CACHE_VERSION}:${allScope}:${year}:${bucket}`;
    }
    if (requestedVendorCodes.length > 1) {
        const groupHash = crypto
            .createHash('md5')
            .update(requestedVendorCodes.slice().sort().join(','))
            .digest('hex')
            .substring(0, 12);
        return `comm:summary:${COMMISSIONS_CACHE_VERSION}:GROUP:${groupHash}:${year}:${bucket}`;
    }
    return null;
}

async function getCachedPdfSummaryVendors(safeVendorCode, requestedVendorCodes, userCode, year) {
    const cacheKey = buildGroupedSummaryCacheKeyForPdf(safeVendorCode, requestedVendorCodes, userCode, year);
    if (!cacheKey) return null;

    try {
        const cachedSummary = await redisCache.get('route', cacheKey);
        if (cachedSummary?.breakdown?.length) {
            logger.info(`[PDF] Reusing grouped summary cache for PDF (${cacheKey})`);
            return cachedSummary.breakdown;
        }
    } catch (e) {
        logger.warn(`[PDF] Grouped summary cache lookup failed: ${e.message}`);
    }
    return null;
}

async function buildPdfSummaryVendors(vendorCode, year, config, userCode = '') {
    const safeVendorCode = (vendorCode || 'ALL').toString().replace(/[^a-zA-Z0-9,]/g, '').substring(0, 50) || 'ALL';
    const requestedVendorCodes = safeVendorCode === 'ALL'
        ? []
        : [...new Set(
            safeVendorCode
                .split(',')
                .map(code => code.trim())
                .filter(code => /^[a-zA-Z0-9]+$/.test(code))
        )];
    const isGroupedRequest = safeVendorCode === 'ALL' || requestedVendorCodes.length > 1;

    if (!isGroupedRequest) {
        return [await calculateVendorData(safeVendorCode, year, config)];
    }

    // PDF must always reflect latest COMMISSION_PAYMENTS — never reuse UI summary cache.

    const resolvedVendorCodes = safeVendorCode === 'ALL'
        ? await resolveAllModeVendorCodes(userCode, year, discoverVendorCodesForYear)
        : requestedVendorCodes;
    const vendorCodes = [...new Set(
        (resolvedVendorCodes || [])
            .map(code => String(code || '').trim().replace(/[^a-zA-Z0-9]/g, ''))
            .filter(Boolean)
    )];

    if (vendorCodes.length === 0) {
        logger.warn(`[PDF] No vendor codes resolved for PDF request vendorCode=${safeVendorCode}, year=${year}, user=${userCode || 'unknown'}`);
        return [];
    }

    const batchStart = Date.now();
    const [allVendorData, allSnapshotResult] = await Promise.all([
        batchFetchVendorDataChunked(vendorCodes, year),
        getVendorSalesSnapshot(vendorCodes, year)
    ]);

    const { snapshotMap, monthsWithData } = allSnapshotResult;
    for (const code of vendorCodes) {
        if (allVendorData[code]) {
            const trimmed = code.trim();
            const normalized = trimmed.replace(/^0+/, '') || trimmed;
            allVendorData[code].salesSnapshotData = snapshotMap[trimmed] || snapshotMap[normalized] || {};
            allVendorData[code].snapshotMonthsWithData = monthsWithData;
        }
    }

    const settled = await Promise.allSettled(
        vendorCodes.map(code => calculateVendorData(code, year, config, allVendorData[code]))
    );
    const failed = settled.filter(result => result.status === 'rejected');
    if (failed.length > 0) {
        logger.warn(`[PDF] ${failed.length} vendor(s) failed building PDF summary: ${failed.map(f => f.reason?.message || f.reason).join('; ')}`);
    }

    const vendors = settled
        .filter(result => result.status === 'fulfilled')
        .map(result => result.value);
    logger.info(`[PDF] Built grouped vendor summary in ${Date.now() - batchStart}ms for ${vendors.length}/${vendorCodes.length} vendors`);
    return vendors;
}

function normalizeVendorCodeForPdf(code) {
    const raw = String(code || '').trim();
    return raw.replace(/^0+/, '') || raw;
}

module.exports = {
    DEFAULT_EXCLUDED,
    EXCLUDED_CACHE_TTL,
    loadExcludedVendors,
    ensureExcludedVendorsLoaded,
    isVendorExcluded,
    getExcludedVendors,
    DEFAULT_CONFIG_2026,
    COMM_CONFIG_SELECT_SQL,
    COMMISSIONS_CACHE_VERSION,
    aggregateScopedTeamMonths,
    getCodeVariants,
    appendPaymentDetailRow,
    deleteMonthCommissionPayments,
    invalidateCommissionPaymentCaches,
    getVendorCurrentClients,
    getClientsMonthlySales,
    aggregateCommissionSalesRows,
    aggregateVendorCommissionSalesRows,
    getVendorPayments,
    getVendorSalesSnapshot,
    calculateWorkingDays,
    calculateCommission,
    roundMoney,
    loadCommissionConfig,
    getMonthPaymentSnapshotFromDb,
    capturePayFallbackSales,
    insertCommissionPayment,
    buildAggregatedYearResult,
    getCommissionSalesRowsFromClientCache,
    getCommissionSalesRowsByClientScopeForVendors,
    fetchSingleVendorCommissionSalesRows,
    batchFetchAllVendorData,
    chunkArray,
    getCommissionBatchChunkSize,
    getCommissionChunkConcurrency,
    runChunksWithConcurrency,
    batchFetchVendorDataChunked,
    calculateVendorData,
    monthSnapshotFromVendorRecord,
    findVendorRecordInSummary,
    getCachedPaymentSnapshot,
    getCurrentPaymentSnapshot,
    discoverVendorCodesForYear,
    calculateGroupedVendorSummary,
    mergeBreakdowns,
    mergeTimeUnits,
    mergePayments,
    sumResults,
    loadCommissionConfigForPdf,
    summaryCacheBucketForYear,
    buildGroupedSummaryCacheKeyForPdf,
    getCachedPdfSummaryVendors,
    buildPdfSummaryVendors,
    normalizeVendorCodeForPdf,
};
