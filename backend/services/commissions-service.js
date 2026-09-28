'use strict';

/**
 * Commissions service — reglas de negocio + acceso DB2 leaf de comisiones.
 *
 * Funciones movidas verbatim desde backend/routes/commissions.js (sin cambios
 * de comportamiento). La ruta conserva la orquestacion de handlers y las
 * funciones pinnadas por tests de arquitectura (calculateVendorData,
 * batchFetch*, fetchSingle*, getCommissionSalesRows*, summary/pay/pdf).
 *
 * TODO(DIP): recibir query/queryWithParams/cache por parametros en vez de
 * requires directos (patron actual del repo por tiempo).
 */

const logger = require('../middleware/logger');
const { comercialErpTable } = require('../utils/comercial-erp-tables');
const {
    getCurrentDate,
    LACLAE_SALES_FILTER,
    SNAPSHOT_UNTIL_MONTH,
    getCommissionVendorColumnExpr,
    getCommissionActualVendorColumnExprForMonth,
    calculateDaysPassed,
    getBSales,
} = require('../utils/common');
const { resolveCommissionTarget } = require('../utils/commission-snapshot');
const { redisCache, TTL, invalidateCachePattern } = require('./redis-cache');
const repo = require('../repositories/commissions-repository');

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
function aggregateScopedTeamMonths(vendorResults, selectedYear, config) {
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
    const safeYear = parseInt(currentYear);
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
    `, [...safeCodes, parseInt(year)], false);

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
            const mes = parseInt(r.MES);
            if (!Number.isNaN(mes)) monthsWithData.add(mes);
        });

        rows.forEach((r) => {
            const rawCode = (r.VENDEDOR_CODIGO || '').trim();
            // Normalize: strip leading zeros so '02' === '2'. Keep both forms as keys
            // to handle whatever format the rest of the code uses.
            const normalizedCode = rawCode.replace(/^0+/, '') || rawCode;
            const mes = parseInt(r.MES);

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

async function getMonthPaymentSnapshotFromDb(vendedorCode, year, month) {
    const codeVariants = getCodeVariants(vendedorCode);
    if (codeVariants.length === 0) return null;
    const vendorPlaceholders = codeVariants.map(() => '?').join(',');
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
    const safeYearNum = parseInt(year);
    const safeMonthNum = parseInt(month);
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

async function insertCommissionPayment({
    vendorCode, year, month, ventaComision, objetivoMes, ventasSobreObjetivo,
    comisionGenerada, importePagado, observaciones, creadoPor,
}) {
    return repo.insertCommissionPayment({
        vendorCode, year, month, ventaComision, objetivoMes, ventasSobreObjetivo,
        comisionGenerada, importePagado, observaciones, creadoPor,
    });
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
};
