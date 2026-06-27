const express = require('express');
const crypto = require('crypto');
const { query, queryWithParams, getPool } = require('../config/db');
const { cachedQuery } = require('../services/query-optimizer');
const logger = require('../middleware/logger');
const { auditDataAccess } = require('../middleware/audit');
const { getVendorActiveDaysFromCache } = require('../services/laclae');
const { getCurrentDate, LACLAE_SALES_FILTER, SNAPSHOT_UNTIL_MONTH, getCommissionVendorColumnExpr, getCommissionActualVendorColumnExprForYear, getCommissionActualVendorColumnExprForMonth, getVendorName, calculateDaysPassed, getBSales, sanitizeForSQL, handleRouteError } = require('../utils/common');
const {
    resolveCommissionTarget,
    resolveHistoricalCommissionMonth,
    resolvePaymentSnapshotMonth,
} = require('../utils/commission-snapshot');
const { verifyToken } = require('../middleware/auth');
const { redisCache, TTL, invalidateCachePattern } = require('../services/redis-cache');
const {
    isTeamLeader,
    getTeamCommission,
    buildTeamLeadSummaryPayload,
    isScopedTeamAllRequest,
    resolveAllModeVendorCodes,
    allModeCacheScope,
    isCommercial80User,
} = require('../services/team-commission.service');

const router = express.Router();

// =============================================================================
// ROUTES & HELPER FUNCTIONS
// =============================================================================
// FIX #1: Dynamic excluded vendors - loaded from DB with safety fallback
const DEFAULT_EXCLUDED = ['3', '13', '93'];
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
            // Keep original code from DB ('03') AND normalized version ('3') to be safe.
            // 80 is commissionable; only the commercial-80 login is hidden from commission views.
            const dbCodes = rows
                .map(r => r.CODE)
                .filter(code => code && ((code || '').replace(/^0+/, '') || code) !== '80');
            const normalizedCodes = dbCodes.map(code => (code || '').replace(/^0+/, ''));

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
const COMM_CONFIG_SELECT_SQL = [
    'SELECT IPC_PCT, TIER1_MAX, TIER1_PCT, TIER2_MAX, TIER2_PCT, TIER3_MAX, TIER3_PCT, TIER4_PCT',
    'FROM JAVIER.COMM_CONFIG',
    'WHERE YEAR = ?',
    'FETCH FIRST 1 ROWS ONLY',
].join(' ');
const COMMISSIONS_CACHE_VERSION = 'v20260604-final-commission-sources';

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

        vendorResults.forEach(r => {
            const md = (r.months || []).find(x => x.month === m);
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

// =============================================================================
// DATABASE INITIALIZATION (JAVIER Schema)
// Uses DIRECT pool connections to avoid query() retry/pool-recreation logic.
// =============================================================================
async function initCommissionTables() {
    const pool = getPool();
    if (!pool) { logger.warn('⚠️ Commission init: no DB pool'); return; }
    let conn;
    try {
        conn = await pool.connect();

        // 1. COMM_CONFIG table
        try {
            await conn.query(`SELECT 1 FROM JAVIER.COMM_CONFIG FETCH FIRST 1 ROWS ONLY`);
            logger.info('✅ JAVIER.COMM_CONFIG found and ready.');
        } catch (e) {
            // Close dirty connection, get fresh one
            if (conn) try { await conn.close(); } catch (_) { }
            conn = await pool.connect();
            logger.info('⚙️ Initializing JAVIER.COMM_CONFIG table...');
            try {
                await conn.query(`
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
                await conn.query(`
                    INSERT INTO JAVIER.COMM_CONFIG (ID, YEAR, IPC_PCT, TIER1_MAX, TIER1_PCT, TIER2_MAX, TIER2_PCT, TIER3_MAX, TIER3_PCT, TIER4_PCT)
                    VALUES (1, 2026, 3.00, 103.00, 1.00, 106.00, 1.30, 110.00, 1.60, 2.00)
                `);
                logger.info('🌱 JAVIER.COMM_CONFIG seeded default values.');
            } catch (createErr) {
                logger.warn(`⚠️ COMM_CONFIG init: ${createErr.message}`);
            }
        }

        // 2. EXCLUIDO_COMISIONES column
        try {
            await conn.query(`SELECT EXCLUIDO_COMISIONES FROM JAVIER.COMMISSION_EXCEPTIONS FETCH FIRST 1 ROWS ONLY`);
            logger.info('✅ EXCLUIDO_COMISIONES column exists.');
        } catch (colErr) {
            if (conn) try { await conn.close(); } catch (_) { }
            conn = await pool.connect();
            try {
                await conn.query(`ALTER TABLE JAVIER.COMMISSION_EXCEPTIONS ADD COLUMN EXCLUIDO_COMISIONES CHAR(1) DEFAULT 'N'`);
                logger.info('✅ EXCLUIDO_COMISIONES column added.');
            } catch (alterErr) {
                // may already exist
            }
        }

        // 3. Seed default excluded vendors
        try {
            const count = await conn.query(`SELECT COUNT(*) as CNT FROM JAVIER.COMMISSION_EXCEPTIONS`);
            if (count && count[0].CNT == 0) {
                const defaultExcluded = ['03', '13', '93'];
                for (const code of defaultExcluded) {
                    await conn.query(`INSERT INTO JAVIER.COMMISSION_EXCEPTIONS (CODIGOVENDEDOR, HIDE_COMMISSIONS, EXCLUIDO_COMISIONES) VALUES (?, 'N', 'Y')`, [code]);
                }
                logger.info(`🌱 Seeded default excluded vendors.`);
            }
        } catch (seedErr) {
            logger.debug(`Seed check: ${seedErr.message}`);
        }

        // 4. COMMISSION_PAYMENTS table
        try {
            await conn.query(`SELECT 1 FROM JAVIER.COMMISSION_PAYMENTS FETCH FIRST 1 ROWS ONLY`);
            logger.info('✅ JAVIER.COMMISSION_PAYMENTS table exists.');
        } catch (e) {
            // Close dirty connection, get fresh one
            if (conn) try { await conn.close(); } catch (_) { }
            conn = await pool.connect();
            try {
                await conn.query(`
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
                        FECHA_PAGO TIMESTAMP NOT NULL DEFAULT CURRENT TIMESTAMP,
                        OBSERVACIONES VARCHAR(1000) NOT NULL DEFAULT '',
                        CREADO_POR VARCHAR(50) NOT NULL DEFAULT 'unknown',
                        FECHA_CREACION TIMESTAMP NOT NULL DEFAULT CURRENT TIMESTAMP,
                        PRIMARY KEY (ID)
                    )
                `);
                logger.info('✅ JAVIER.COMMISSION_PAYMENTS table created.');
            } catch (createErr) {
                logger.warn(`⚠️ COMMISSION_PAYMENTS: ${createErr.message}`);
            }
        }

        // 5. Columns idempotent additions (fresh connection after any potential failures)
        try { await conn.query(`SELECT OBJETIVO_MES FROM JAVIER.COMMISSION_PAYMENTS FETCH FIRST 1 ROWS ONLY`); } catch (e) {
            if (conn) try { await conn.close(); } catch (_) { }
            conn = await pool.connect();
            try { await conn.query(`ALTER TABLE JAVIER.COMMISSION_PAYMENTS ADD COLUMN OBJETIVO_MES DECIMAL(12,2) DEFAULT 0`); } catch (_) { }
        }
        try { await conn.query(`SELECT VENTAS_SOBRE_OBJETIVO FROM JAVIER.COMMISSION_PAYMENTS FETCH FIRST 1 ROWS ONLY`); } catch (e) {
            if (conn) try { await conn.close(); } catch (_) { }
            conn = await pool.connect();
            try { await conn.query(`ALTER TABLE JAVIER.COMMISSION_PAYMENTS ADD COLUMN VENTAS_SOBRE_OBJETIVO DECIMAL(12,2) DEFAULT 0`); } catch (_) { }
        }

        // 6. Index
        try { await conn.query(`CREATE INDEX IDX_CP_VENDOR_YEAR ON JAVIER.COMMISSION_PAYMENTS(VENDEDOR_CODIGO, ANIO)`); } catch (_) { }

    } catch (error) {
        logger.warn(`⚠️ Commission tables init error: ${error.message}`);
    } finally {
        if (conn) try { await conn.close(); } catch (_) { }
    }

    // Load excluded vendors into memory (uses query() which is fine here — pool is stable)
    await loadExcludedVendors();
    logger.info(`✅ Commission system initialized. Excluded vendors: [${EXCLUDED_VENDORS.join(', ')}]`);
}

// Exported for server.js to call during startup sequence (no more fire-and-forget setTimeout)

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getCommissionVendorColumnExprForYear(selectedYear, tableAlias = 'L') {
    return getCommissionActualVendorColumnExprForYear(selectedYear, tableAlias);
}

function getCodeVariants(code) {
    const safe = String(code || '').trim().replace(/[^a-zA-Z0-9]/g, '');
    if (!safe) return [];
    const unpadded = safe.replace(/^0+/, '') || safe;
    const padded = /^\d{1,2}$/.test(unpadded) ? unpadded.padStart(2, '0') : unpadded;
    return [...new Set([safe, unpadded, padded].filter(Boolean))];
}

function buildCommissionVendorFilter(vendedorCodes, selectedYear, tableAlias = 'L') {
    if (!vendedorCodes || vendedorCodes === 'ALL') return '';

    const vendorColumnExpr = getCommissionVendorColumnExprForYear(selectedYear, tableAlias);
    const validCodes = [...new Set(
        String(vendedorCodes)
            .split(',')
            .flatMap(getCodeVariants)
            .filter(Boolean)
    )]
        .map(code => `'${code}'`)
        .join(',');

    if (!validCodes) return 'AND 1=0';
    return `AND TRIM(${vendorColumnExpr}) IN (${validCodes})`;
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
    const rows = await queryWithParams(`
        SELECT DISTINCT TRIM(L.LCCDCL) as CLIENT_CODE
        FROM DSED.LACLAE L
        WHERE TRIM(${col}) IN (${placeholders})
          AND L.LCAADC = ?
          AND ${LACLAE_SALES_FILTER}
    `, [...codeVariants, safeYear], false);

    if (rows.length === 0) {
        const prevRows = await queryWithParams(`
            SELECT DISTINCT TRIM(L.LCCDCL) as CLIENT_CODE
            FROM DSED.LACLAE L
            WHERE TRIM(${col}) IN (${placeholders})
              AND L.LCAADC = ?
              AND ${LACLAE_SALES_FILTER}
        `, [...codeVariants, safeYear - 1], false);
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

    const placeholders = clientCodes.map(() => '?').join(',');
    const safeCodes = clientCodes.map(c => String(c).replace(/[^a-zA-Z0-9]/g, ''));

    const rows = await queryWithParams(`
        SELECT 
            L.LCMMDC as MONTH,
            SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE L.LCCDCL IN (${placeholders})
          AND L.LCAADC = ?
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCMMDC
    `, [...safeCodes, parseInt(year)], false);

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
        const safeVCode = vendorCode.trim().replace(/[^a-zA-Z0-9]/g, '');
        const safeNCode = normalizedCode.replace(/[^a-zA-Z0-9]/g, '');
        const rows = await queryWithParams(`
            SELECT
                MES,
                IMPORTE_PAGADO,
                COMISION_GENERADA,
                VENTAS_REAL,
                OBJETIVO_MES,
                OBSERVACIONES,
                FECHA_PAGO
            FROM JAVIER.COMMISSION_PAYMENTS
            WHERE (VENDEDOR_CODIGO = ? OR VENDEDOR_CODIGO = ?)
              AND ANIO = ?
            ORDER BY MES, FECHA_PAGO
        `, [safeVCode, safeNCode, parseInt(year)], false, false);

        rows.forEach(r => {
            const amount = parseFloat(r.IMPORTE_PAGADO) || 0;
            const mes = r.MES;
            const rowDate = r.FECHA_PAGO ? new Date(r.FECHA_PAGO) : null;

            payments.total += amount;

            if (mes > 0) {
                payments.monthly[mes] = (payments.monthly[mes] || 0) + amount;

                if (!payments.details[mes]) {
                    payments.details[mes] = {
                        totalPaid: 0,
                        comisionGenerada: 0,
                        comisionGeneradaSnapshot: 0,
                        ventaComision: 0,
                        objetivoReal: 0,
                        observaciones: [],
                        ultimaFecha: null
                    };
                }
                payments.details[mes].totalPaid += amount;
                payments.details[mes].comisionGenerada += parseFloat(r.COMISION_GENERADA) || 0;
                if (r.OBSERVACIONES && r.OBSERVACIONES.trim()) {
                    payments.details[mes].observaciones.push(r.OBSERVACIONES.trim());
                }
                if (!payments.details[mes].ultimaFecha || (rowDate && rowDate >= new Date(payments.details[mes].ultimaFecha || 0))) {
                    payments.details[mes].ventaComision = parseFloat(r.VENTAS_REAL) || 0;
                    payments.details[mes].objetivoReal = parseFloat(r.OBJETIVO_MES) || 0;
                    payments.details[mes].comisionGeneradaSnapshot = parseFloat(r.COMISION_GENERADA) || 0;
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
        const monthPlaceholders = monthList.map(() => '?').join(',');

        let rows;
        let coverageRows;
        if (!vendorCodes || vendorCodes.length === 0) {
            // Fetch all vendors (ALL mode) — no vendor filter
            rows = await queryWithParams(`
                SELECT TRIM(VENDEDOR_CODIGO) as VENDEDOR_CODIGO, MES, VENTAS_REAL,
                       OBJETIVO_MES, COMISION_GENERADA
                FROM JAVIER.COMMISSION_SNAPSHOT_2026_0102
                WHERE ANIO = ?
                  AND MES IN (${monthPlaceholders})
            `, [year, ...monthList], false, false);
            coverageRows = rows;
        } else {
            const safeCodes = [...new Set(vendorCodes.flatMap(c => {
                const safe = String(c || '').replace(/[^a-zA-Z0-9]/g, '');
                if (!safe) return [];
                const unpadded = safe.replace(/^0+/, '') || safe;
                const padded = /^\d{1,2}$/.test(unpadded) ? unpadded.padStart(2, '0') : unpadded;
                return [safe, unpadded, padded];
            }).filter(Boolean))];
            if (safeCodes.length === 0) return { snapshotMap: {}, monthsWithData: new Set() };
            const codePlaceholders = safeCodes.map(() => '?').join(',');
            rows = await queryWithParams(`
                SELECT TRIM(VENDEDOR_CODIGO) as VENDEDOR_CODIGO, MES, VENTAS_REAL,
                       OBJETIVO_MES, COMISION_GENERADA
                FROM JAVIER.COMMISSION_SNAPSHOT_2026_0102
                WHERE ANIO = ?
                  AND MES IN (${monthPlaceholders})
                  AND VENDEDOR_CODIGO IN (${codePlaceholders})
            `, [year, ...monthList, ...safeCodes], false, false);
            coverageRows = await queryWithParams(`
                SELECT DISTINCT MES
                FROM JAVIER.COMMISSION_SNAPSHOT_2026_0102
                WHERE ANIO = ?
                  AND MES IN (${monthPlaceholders})
            `, [year, ...monthList], false, false);
        }

        // Track which months have at least one row — used to distinguish
        // "table empty for this month" from "vendor not present this month".
        const monthsWithData = new Set();
        const snapshotMap = {};

        (coverageRows || rows).forEach(r => {
            const mes = parseInt(r.MES);
            if (!Number.isNaN(mes)) monthsWithData.add(mes);
        });

        rows.forEach(r => {
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
    const safeCodes = vendorCodes.map(c => c.replace(/[^a-zA-Z0-9]/g, '')).filter(Boolean);
    const placeholders = safeCodes.map(() => '?').join(',');

    // Build code variants (both padded "05" and unpadded "5") for VENTAS_B and COMMISSION_PAYMENTS.
    // These tables may store vendor codes in a different format than LACLAE.
    // getBSales (single-vendor mode) uses OR clause for both formats — replicate that here.
    const codeVariants = [...new Set(safeCodes.flatMap(c => {
        const unpadded = c.replace(/^0+/, '') || c;
        const padded = /^\d{1,2}$/.test(unpadded) ? unpadded.padStart(2, '0') : unpadded;
        return [c, unpadded, padded];
    }))];
    const variantPlaceholders = codeVariants.map(() => '?').join(',');

    const [allSalesRows, allBSalesRows, allPaymentsRows, allFixedTargets, allVendorNames] = await Promise.all([
        // 1. LACLAE sales for ALL vendors (current + prev year).
        // Split by direct vendor columns instead of TRIM(CASE...) in the WHERE
        // clause; the CASE predicate caused full scans and 30-40s dashboard loads.
        queryWithParams(`
            SELECT S.VENDOR_CODE as VENDOR_CODE,
                   S.SALES_YEAR as YEAR,
                   S.SALES_MONTH as MONTH,
                   SUM(S.SALES) as SALES
            FROM (
                SELECT TRIM(${currentSalesVendorCol}) as VENDOR_CODE,
                       L.LCAADC as SALES_YEAR,
                       L.LCMMDC as SALES_MONTH,
                       SUM(L.LCIMVT) as SALES
                FROM DSED.LACLAE L
                WHERE L.LCAADC = ?
                  AND ${LACLAE_SALES_FILTER}
                  AND TRIM(${currentSalesVendorCol}) IN (${placeholders})
                GROUP BY TRIM(${currentSalesVendorCol}), L.LCAADC, L.LCMMDC

                UNION ALL

                SELECT TRIM(${previousJanFebVendorCol}) as VENDOR_CODE,
                       L.LCAADC as SALES_YEAR,
                       L.LCMMDC as SALES_MONTH,
                       SUM(L.LCIMVT) as SALES
                FROM DSED.LACLAE L
                WHERE L.LCAADC = ?
                  AND L.LCMMDC < 3
                  AND ${LACLAE_SALES_FILTER}
                  AND TRIM(${previousJanFebVendorCol}) IN (${placeholders})
                GROUP BY TRIM(${previousJanFebVendorCol}), L.LCAADC, L.LCMMDC

                UNION ALL

                SELECT TRIM(${previousMarDecVendorCol}) as VENDOR_CODE,
                       L.LCAADC as SALES_YEAR,
                       L.LCMMDC as SALES_MONTH,
                       SUM(L.LCIMVT) as SALES
                FROM DSED.LACLAE L
                WHERE L.LCAADC = ?
                  AND L.LCMMDC >= 3
                  AND ${LACLAE_SALES_FILTER}
                  AND TRIM(${previousMarDecVendorCol}) IN (${placeholders})
                GROUP BY TRIM(${previousMarDecVendorCol}), L.LCAADC, L.LCMMDC
            ) S
            GROUP BY S.VENDOR_CODE, S.SALES_YEAR, S.SALES_MONTH
        `, [year, ...safeCodes, year - 1, ...safeCodes, year - 1, ...safeCodes], false),

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
            FROM DSEDAC.VDD
            WHERE TRIM(CODIGOVENDEDOR) IN (${variantPlaceholders})
        `, [...codeVariants], false),
    ]);

    // Partition data by vendor in memory
    const dataByVendor = {};
    for (const code of vendorCodes) {
        const normalized = code.trim().replace(/^0+/, '') || code.trim();
        const salesRows = allSalesRows.filter(r => {
            const vc = (r.VENDOR_CODE || '').trim().replace(/^0+/, '') || (r.VENDOR_CODE || '').trim();
            return vc === normalized || vc === code.trim();
        });
        const bSalesRows = allBSalesRows.filter(r => {
            const vc = (r.VENDOR_CODE || '').trim().replace(/^0+/, '') || (r.VENDOR_CODE || '').trim();
            return vc === normalized || vc === code.trim();
        });
        const paymentRows = allPaymentsRows.filter(r => {
            const vc = (r.VENDOR_CODE || '').trim().replace(/^0+/, '') || (r.VENDOR_CODE || '').trim();
            return vc === normalized || vc === code.trim();
        });
        const fixedRows = allFixedTargets.filter(r => {
            const vc = (r.VENDOR_CODE || '').trim().replace(/^0+/, '') || (r.VENDOR_CODE || '').trim();
            return vc === normalized || vc === code.trim();
        });
        const vendorName = allVendorNames.find(r => {
            const vc = (r.VENDOR_CODE || '').trim().replace(/^0+/, '') || (r.VENDOR_CODE || '').trim();
            return vc === normalized || vc === code.trim();
        });

        // Build B-sales maps
        const bSalesCurr = {};
        const bSalesPrev = {};
        bSalesRows.forEach(r => {
            const m = r.MES;
            const s = parseFloat(r.SALES) || 0;
            const yr = parseInt(r.YEAR);
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
            const rowDate = r.FECHA_PAGO ? new Date(r.FECHA_PAGO) : null;
            if (!payments.details[m]) {
                payments.details[m] = {
                    totalPaid: 0,
                    comisionGenerada: 0,
                    comisionGeneradaSnapshot: 0,
                    observaciones: [],
                    ventaComision: 0,
                    objetivoReal: 0,
                    ultimaFecha: null
                };
            }
            payments.details[m].comisionGenerada += parseFloat(r.COMISION_GENERADA) || 0;
            if (r.OBSERVACIONES && r.OBSERVACIONES.trim()) {
                payments.details[m].observaciones.push(r.OBSERVACIONES.trim());
            }
            if (!payments.details[m].ultimaFecha || (rowDate && rowDate >= new Date(payments.details[m].ultimaFecha || 0))) {
                payments.details[m].ventaComision = parseFloat(r.VENTAS_REAL) || 0;
                payments.details[m].objetivoReal = parseFloat(r.OBJETIVO_MES) || 0;
                payments.details[m].comisionGeneradaSnapshot = parseFloat(r.COMISION_GENERADA) || 0;
                payments.details[m].ultimaFecha = r.FECHA_PAGO;
            }
            payments.monthly[m] = (payments.monthly[m] || 0) + (parseFloat(r.IMPORTE_PAGADO) || 0);
            payments.total += parseFloat(r.IMPORTE_PAGADO) || 0;
            payments.details[m].totalPaid += parseFloat(r.IMPORTE_PAGADO) || 0;
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

function roundMoney(value) {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.round(parsed * 100) / 100;
}

async function loadCommissionConfig(year) {
    try {
        const dbConfig = await queryWithParams(
            COMM_CONFIG_SELECT_SQL,
            [parseInt(year)],
            false,
            false
        );
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
                TIER4_PCT: parseFloat(row.TIER4_PCT)
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
        TIER4_PCT: 2.0
    };
}

/**
 * Core Logic to Calculate Metrics for ONE Vendor
 */
async function calculateVendorData(vendedorCode, selectedYear, config, preloadedData = null) {
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

    // D. Fetch Sales Data — use preloaded or query DB
    let salesRows, bSalesCurrYear, bSalesPrevYear, fixedCommissionBase, fixedTargets, payments;

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
        const safeYear = parseInt(selectedYear);
        const safePrevYear = parseInt(prevYear);
        const safeVendorCodes = getCodeVariants(vendedorCode);
        const vendorPlaceholders = safeVendorCodes.map(() => '?').join(',');
        const currentSalesVendorCol = getCommissionVendorColumnExpr('L', 'sales');
        const previousJanFebVendorCol = getCommissionVendorColumnExpr('L', 'sales');
        const previousMarDecVendorCol = getCommissionVendorColumnExpr('L', 'objective');
        const salesQuery = `
            SELECT S.SALES_YEAR as YEAR,
                   S.SALES_MONTH as MONTH,
                   SUM(S.SALES) as SALES
            FROM (
                SELECT L.LCAADC as SALES_YEAR,
                       L.LCMMDC as SALES_MONTH,
                       SUM(L.LCIMVT) as SALES
                FROM DSED.LACLAE L
                WHERE L.LCAADC = ?
                  AND ${LACLAE_SALES_FILTER}
                  AND ${currentSalesVendorCol} IN (${vendorPlaceholders})
                GROUP BY L.LCAADC, L.LCMMDC

                UNION ALL

                SELECT L.LCAADC as SALES_YEAR,
                       L.LCMMDC as SALES_MONTH,
                       SUM(L.LCIMVT) as SALES
                FROM DSED.LACLAE L
                WHERE L.LCAADC = ?
                  AND L.LCMMDC < 3
                  AND ${LACLAE_SALES_FILTER}
                  AND ${previousJanFebVendorCol} IN (${vendorPlaceholders})
                GROUP BY L.LCAADC, L.LCMMDC

                UNION ALL

                SELECT L.LCAADC as SALES_YEAR,
                       L.LCMMDC as SALES_MONTH,
                       SUM(L.LCIMVT) as SALES
                FROM DSED.LACLAE L
                WHERE L.LCAADC = ?
                  AND L.LCMMDC >= 3
                  AND ${LACLAE_SALES_FILTER}
                  AND ${previousMarDecVendorCol} IN (${vendorPlaceholders})
                GROUP BY L.LCAADC, L.LCMMDC
            ) S
            GROUP BY S.SALES_YEAR, S.SALES_MONTH
            ORDER BY YEAR, MONTH
        `;
        const cacheKey = `commissions:${COMMISSIONS_CACHE_VERSION}:sales:${vendedorCode}:${safeYear}`;
        salesRows = await redisCache.get('route', cacheKey);
        if (!salesRows) {
            salesRows = safeVendorCodes.length > 0
                ? await queryWithParams(salesQuery, [
                    safeYear,
                    ...safeVendorCodes,
                    safePrevYear,
                    ...safeVendorCodes,
                    safePrevYear,
                    ...safeVendorCodes
                ], false)
                : [];
            if (salesRows.length > 0) {
                redisCache.set('route', cacheKey, salesRows, TTL.SHORT).catch(() => {});
            }
        }

        // Fire independent queries in parallel: inherited clients, fixed targets, B-sales
        const [currentClients, fixedCommissionRows, bSalesCurr, bSalesPrev] = await Promise.all([
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
    const monthsWithData = salesRows.filter(r => r.YEAR == prevYear).map(r => r.MONTH);
    const missingMonths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter(m => !monthsWithData.includes(m));

    if (!preloadedData && missingMonths.length > 0) {
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

    for (let m = 1; m <= 12; m++) {
        const prevRow = salesRows.find(r => r.YEAR == prevYear && r.MONTH == m);
        const currRow = salesRows.find(r => r.YEAR == selectedYear && r.MONTH == m);

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
                currentLacSales = Math.max(currentSales - currentBSales, 0);
                logger.debug(`[COMMISSIONS] SNAPSHOT month ${m}/2026: vendor ${vendedorCode} not in snapshot → commission forced to 0`);
            }
            result = calculateCommission(currentSales, target, config);
        } else if (isSnapshotMonth) {
            // Snapshot month but table has NO rows for this month at all → fall back to live.
            logger.warn(`[COMMISSIONS] No snapshot data found for month ${m}/2026 — using live calc (table may be empty for this month).`);
        }

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

        if (paymentSnapshot.isPaymentSnapshot) {
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
            prevSales: prevSales,
            target: target,
            actual: currentSales,
            lacSales: currentLacSales,
            bSales: currentBSales,
            totalSales: currentSales,
            workingDays: workingDays,
            daysPassed: daysPassed,
            proRatedTarget: proRatedTarget,
            dailyTarget: dailyTarget,
            dailyActual: dailyActual,
            isFuture: isFuture,
            snapshotApplied: snapshotApplied,
            snapshotSource: snapshotSource,
            targetSource: targetSource,
            paymentSnapshotApplied: snapshotSource === 'JAVIER.COMMISSION_PAYMENTS',
            complianceCtx: {
                pct: (target > 0) ? (currentSales / target) * 100 : 0,
                increment: result.increment,
                tier: result.tier,
                rate: result.rate,
                commission: commValue,
                isExcluded: isExcluded,
                snapshotApplied: snapshotApplied,
                snapshotSource: snapshotSource,
                targetSource: targetSource
            },
            dailyComplianceCtx: {
                pct: (proRatedTarget > 0) ? (currentSales / proRatedTarget) * 100 : 0,
                tier: snapshotApplied ? result.tier : provisionalResult.tier,
                rate: snapshotApplied ? result.rate : provisionalResult.rate,
                isGreen: isOnTrack,
                provisionalCommission: provisionalCommission,
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

async function getCurrentPaymentSnapshot(vendedorCode, year, month) {
    const safeYear = parseInt(year);
    const safeMonth = parseInt(month);
    if (!vendedorCode || !safeYear || !safeMonth || safeMonth < 1 || safeMonth > 12) {
        return null;
    }

    const config = await loadCommissionConfig(safeYear);
    await ensureExcludedVendorsLoaded();
    const data = await calculateVendorData(vendedorCode, safeYear, config);
    const monthData = data.months.find(item => parseInt(item.month) === safeMonth);
    if (!monthData) return null;

    const actual = roundMoney(monthData.actual);
    const target = roundMoney(monthData.target);
    const generated = roundMoney(monthData.complianceCtx?.commission || 0);

    return {
        ventaComision: actual,
        objetivoMes: target,
        ventasSobreObjetivo: roundMoney(actual - target),
        generatedAmount: generated
    };
}

function buildAggregatedYearResult(results, config) {
    const sortedResults = [...(results || [])].sort((a, b) => {
        const valA = a.grandTotalCommission || 0;
        const valB = b.grandTotalCommission || 0;
        return valB - valA;
    });

    const globalTotal = sortedResults.reduce((sum, item) => {
        return sum + (item.grandTotalCommission || 0);
    }, 0);
    const totalPaid = sortedResults.reduce((sum, item) => {
        return sum + (item.payments?.total || 0);
    }, 0);

    const aggMonths = [];
    for (let month = 1; month <= 12; month++) {
        let target = 0;
        let actual = 0;
        let lacSales = 0;
        let bSales = 0;
        let commission = 0;

        sortedResults.forEach(result => {
            const monthData = result.months.find(x => x.month === month);
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
            complianceCtx: { commission }
        });
    }

    const aggQuarters = [1, 2, 3].map(quarterId => {
        let target = 0;
        let actual = 0;
        let commission = 0;

        sortedResults.forEach(result => {
            const quarterData = result.quarters.find(x => x.id === quarterId);
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
        payments: { total: totalPaid, monthly: {}, quarterly: {} }
    };
}

async function discoverVendorCodesForYear(year) {
    const safeYr = parseInt(year);
    const cacheKey = `comm:${COMMISSIONS_CACHE_VERSION}:vendorCodes:${safeYr}`;

    const cachedCodes = await redisCache.get('route', cacheKey);
    if (cachedCodes) {
        return cachedCodes;
    }

    const colExpr = getCommissionVendorColumnExprForYear(safeYr, 'L');
    const vendorRows = await queryWithParams(`
        SELECT DISTINCT RTRIM(${colExpr}) as VENDOR_CODE
        FROM DSED.LACLAE L
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


// =============================================================================
// ROUTES
// =============================================================================

router.get('/summary', verifyToken, async (req, res) => {
    try {
        const { vendedorCode, year, forceRefresh, limit, offset } = req.query;
        if (!vendedorCode) return res.status(400).json({ success: false, error: 'Falta codigo vendedor' });

        const pageLimit = Math.min(Math.max(parseInt(limit) || 0, 0), 1000);
        const pageOffset = Math.max(parseInt(offset) || 0, 0);

        const shouldForceRefresh = forceRefresh === 'true' || forceRefresh === '1';

        // Input sanitization — prevent injection via query params
        const safeVendorCode = vendedorCode.toString().replace(/[^a-zA-Z0-9,]/g, '').substring(0, 50);
        if (!safeVendorCode) return res.status(400).json({ success: false, error: 'Código vendedor inválido' });

        // FIX #1: Refresh excluded vendors from DB (with TTL cache)
        await ensureExcludedVendorsLoaded();
        if (shouldForceRefresh) {
            logger.info(`[COMMISSIONS] 🔄 Force refresh requested for ${safeVendorCode}`);
        }
        logger.info(`[COMMISSIONS] /summary request: vendedorCode=${safeVendorCode}, year=${year}, forceRefresh=${shouldForceRefresh}`);

        // AUDIT: Log exactly what data this user is requesting
        auditDataAccess(req, 'COMMISSIONS_VIEW', {
            requestedVendorCode: safeVendorCode,
            requestedYear: year || new Date().getFullYear(),
            authenticatedUser: req.user?.code || 'anonymous',
        });

        // Parse Years (Multi-Select) with bounds validation
        const currentYear = new Date().getFullYear();
        const yearParam = year ? year.toString().replace(/[^0-9,]/g, '') : currentYear.toString();
        const years = yearParam.split(',')
            .map(y => parseInt(y.trim()))
            .filter(n => !isNaN(n) && n >= 2020 && n <= currentYear + 1);

        // If no valid year, use current
        if (years.length === 0) years.push(currentYear);

        const selectedYear = years[0]; // Primary year for reference (Config loading)
        const requestedVendorCodes = safeVendorCode === 'ALL'
            ? []
            : [...new Set(
                safeVendorCode
                    .split(',')
                    .map(code => code.trim())
                    .filter(code => /^[a-zA-Z0-9]+$/.test(code))
            )];
        const isGroupedRequest = safeVendorCode === 'ALL' || requestedVendorCodes.length > 1;
        const userCode = req.user?.code || '';
        if (isCommercial80User(userCode)) {
            logger.info('[COMMISSIONS] Hidden summary for authenticated commercial 80');
            return res.json({
                success: true,
                status: 'hidden',
                hiddenForCommercial80: true,
                grandTotalCommission: 0,
                totals: { commission: 0 },
                breakdown: [],
                months: [],
                quarters: [],
                payments: { monthly: {}, quarterly: {}, details: {}, total: 0 },
            });
        }
        const scopedTeamAll = isScopedTeamAllRequest(userCode, safeVendorCode);
        const groupHash = requestedVendorCodes.length > 0
            ? crypto.createHash('md5').update(requestedVendorCodes.slice().sort().join(',')).digest('hex').substring(0, 12)
            : 'all';
        const allScope = allModeCacheScope(userCode, safeVendorCode) || 'ALL';
        const aggregatedCacheKey = isGroupedRequest
            ? (safeVendorCode === 'ALL'
                ? `comm:summary:${COMMISSIONS_CACHE_VERSION}:${allScope}:${years.join(',')}`
                : `comm:summary:${COMMISSIONS_CACHE_VERSION}:GROUP:${groupHash}:${years.join(',')}`)
            : null;
        const singleSummaryCacheKey = !isGroupedRequest
            ? `comm:summary:${COMMISSIONS_CACHE_VERSION}:SINGLE:${safeVendorCode}:${years.join(',')}`
            : null;

        if (aggregatedCacheKey && !shouldForceRefresh) {
            const cachedResult = await redisCache.get('route', aggregatedCacheKey);
            if (cachedResult) {
                logger.info(`[COMMISSIONS] ⚡ Cache HIT for grouped summary (${aggregatedCacheKey})`);
                return res.json({ success: true, ...cachedResult });
            }
        }

        if (singleSummaryCacheKey && !shouldForceRefresh) {
            const cachedResult = await redisCache.get('route', singleSummaryCacheKey);
            if (cachedResult) {
                logger.info(`[COMMISSIONS] Cache HIT for vendor summary (${singleSummaryCacheKey})`);
                return res.json({ success: true, ...cachedResult });
            }
        }

        // A. Load Config
        let config = DEFAULT_CONFIG_2026;
        try {
            const dbConfig = await queryWithParams(COMM_CONFIG_SELECT_SQL, [selectedYear], false, false);
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
        };

        // Execution
        let aggregatedResult = null;

        const yearPromises = years.map(async (yr) => {
            // Process Year
            let yearResult;

            if (isGroupedRequest) {
                // PERF: Check route-level cache first for ALL mode (most expensive)
                const allSummaryCacheKey = aggregatedCacheKey;
                const cachedResult = await redisCache.get('route', allSummaryCacheKey);
                if (cachedResult && !shouldForceRefresh) {
                    logger.info(`[COMMISSIONS] ⚡ Route Cache HIT for ALL summary (${allSummaryCacheKey})`);
                    return { success: true, ...cachedResult };
                }
                if (shouldForceRefresh) {
                    logger.info(`[COMMISSIONS] 🔄 Force refresh bypassing grouped cache (${aggregatedCacheKey})`);
                }

                const vendorCodes = safeVendorCode === 'ALL'
                    ? await resolveAllModeVendorCodes(userCode, yr, discoverVendorCodesForYear)
                    : requestedVendorCodes;

                if (scopedTeamAll) {
                    logger.info(`[COMMISSIONS] Scoped team ALL for commercial 80 → [${vendorCodes.join(',')}]`);
                }

                // PERF: Batch fetch ALL vendor data in 5 queries instead of N×7
                const batchStart = Date.now();
                // Also pre-load sales snapshot once for all vendors (1 query instead of N)
                const [allVendorData, allSnapshotResult] = await Promise.all([
                    batchFetchAllVendorData(vendorCodes, yr),
                    getVendorSalesSnapshot(vendorCodes, yr)
                ]);
                // allSnapshotResult = { snapshotMap, monthsWithData }
                const { snapshotMap: allSnapshotMap, monthsWithData: allMonthsWithData } = allSnapshotResult;
                // Attach each vendor's snapshot slice + shared monthsWithData to their preloaded data object
                for (const code of vendorCodes) {
                    if (allVendorData[code]) {
                        const trimmed = code.trim();
                        const normalized = trimmed.replace(/^0+/, '') || trimmed;
                        allVendorData[code].salesSnapshotData = allSnapshotMap[trimmed] || allSnapshotMap[normalized] || {};
                        // Share the same Set — it's read-only in calculateVendorData
                        allVendorData[code].snapshotMonthsWithData = allMonthsWithData;
                    }
                }
                logger.info(`[COMMISSIONS] Batch fetch completed in ${Date.now() - batchStart}ms for ${vendorCodes.length} vendors`);

                // Process each vendor with preloaded data (no DB queries)
                const promises = vendorCodes.map(code =>
                    calculateVendorData(code, yr, config, allVendorData[code])
                );
                const settled = await Promise.allSettled(promises);
                const results = settled
                    .filter(r => r.status === 'fulfilled')
                    .map(r => r.value);

                // Log failed vendors for debugging (does not break the page)
                const failed = settled.filter(r => r.status === 'rejected');
                if (failed.length > 0) {
                    logger.warn(`[COMMISSIONS] ${failed.length} vendor(s) failed in grouped mode: ${failed.map(f => f.reason?.message || f.reason).join('; ')}`);
                }

                results.sort((a, b) => {
                    const valA = a.grandTotalCommission || 0;
                    const valB = b.grandTotalCommission || 0;
                    return valB - valA;
                });
                const globalTotal = results.reduce((s, r) => s + (r.grandTotalCommission || 0), 0);
                const mergedPayments = results.reduce(
                    (acc, r) => mergePayments(acc, r.payments),
                    { monthly: {}, quarterly: {}, details: {}, total: 0 }
                );

                // Aggregate Months/Quarters for this year (scoped team — full month shape for UI table)
                const aggMonths = scopedTeamAll
                    ? aggregateScopedTeamMonths(results, yr, config)
                    : (() => {
                        const simple = [];
                        for (let m = 1; m <= 12; m++) {
                            let tT = 0; let tA = 0; let tC = 0;
                            results.forEach(r => {
                                const md = r.months.find(x => x.month === m);
                                if (md) {
                                    tT += md.target;
                                    tA += md.actual;
                                    tC += (md.complianceCtx?.commission || 0);
                                }
                            });
                            simple.push({
                                month: m, target: tT, actual: tA,
                                complianceCtx: { commission: tC },
                            });
                        }
                        return simple;
                    })();

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
                    breakdown: scopedTeamAll ? [] : results,
                    months: aggMonths,
                    quarters: aggQuarters,
                    payments: mergedPayments,
                    ...(scopedTeamAll ? {
                        isScopedTeamAggregate: true,
                        aggregateLabel: 'Equipo Almería (72+73+81+83)',
                    } : {}),
                };

                // PERF: Cache the ALL result for 15 minutes (expensive computation)
                logger.debug(`[COMMISSIONS] Year result prepared for grouped cache (${allSummaryCacheKey})`);

            } else {
                const singleCode = requestedVendorCodes[0] || safeVendorCode;
                if (isTeamLeader(singleCode)) {
                    const leaderPersonal = await calculateVendorData(singleCode, yr, config);
                    const teamData = await getTeamCommission(
                        singleCode,
                        yr,
                        (code, year, cfg) => calculateVendorData(code, year, cfg),
                        config,
                    );
                    yearResult = buildTeamLeadSummaryPayload(
                        leaderPersonal,
                        teamData,
                        config,
                        leaderPersonal.payments,
                    );
                } else {
                    const data = await calculateVendorData(safeVendorCode, yr, config);
                    yearResult = {
                        config: config,
                        grandTotalCommission: data.grandTotalCommission,
                        totals: { commission: data.grandTotalCommission },
                        months: data.months,
                        quarters: data.quarters,
                        vendor: data.vendedorCode,
                        breakdown: [],
                        isExcluded: data.isExcluded,
                        payments: data.payments,
                    };
                }
            }

            return yearResult;
        });

        const yearResults = await Promise.all(yearPromises);

        for (const yearResult of yearResults) {
            if (!aggregatedResult) {
                aggregatedResult = yearResult;
            } else {
                aggregatedResult = sumResults(aggregatedResult, yearResult);
            }
        }

        if (aggregatedCacheKey && aggregatedResult) {
            await redisCache.set('route', aggregatedCacheKey, aggregatedResult, 900);
            logger.info(`[COMMISSIONS] Cached grouped summary for 15min (${aggregatedCacheKey})`);
        }
        if (singleSummaryCacheKey && aggregatedResult) {
            await redisCache.set('route', singleSummaryCacheKey, aggregatedResult, 300);
            logger.debug(`[COMMISSIONS] Cached vendor summary for 5min (${singleSummaryCacheKey})`);
        }

        // Apply pagination to breakdown when vendor=ALL or grouped request
        let paginatedResult = { ...aggregatedResult };
        if (isGroupedRequest && pageLimit > 0) {
            const totalBreakdown = paginatedResult.breakdown?.length || 0;
            const slicedBreakdown = (paginatedResult.breakdown || []).slice(pageOffset, pageOffset + pageLimit);
            paginatedResult.breakdown = slicedBreakdown;
            paginatedResult.pagination = {
                total: totalBreakdown,
                limit: pageLimit,
                offset: pageOffset,
                hasMore: pageOffset + pageLimit < totalBreakdown
            };
        }

        // AUDIT: Log what data the server actually returned (proof of response)
        const responsePayload = { success: true, ...paginatedResult };
        const responseHash = crypto.createHash('sha256')
            .update(JSON.stringify(responsePayload))
            .digest('hex')
            .substring(0, 16); // Short hash for readability

        auditDataAccess(req, 'COMMISSIONS_RESPONSE', {
            requestedVendorCode: safeVendorCode,
            returnedVendor: aggregatedResult?.vendor || safeVendorCode,
            grandTotalCommission: aggregatedResult?.grandTotalCommission?.toFixed(2) || '0',
            totalPaid: aggregatedResult?.payments?.total?.toFixed(2) || '0',
            responseHash,
        });

        return res.json(responsePayload);

    } catch (error) {
        handleRouteError(error, res, 'Error calculando comisiones', 500, { success: false });
    }
});

// FIX #5: Endpoint to register a payment (Restricted to ADMIN users via TIPOVENDEDOR lookup)
// NEW: Validates observaciones requirement and captures venta_comision snapshot
// Pagos son solo INSERT – no UPDATE. Snapshot histórico intencional.
router.post('/pay', verifyToken, async (req, res) => {
    const { vendedorCode, year, month, quarter, amount, generatedAmount, concept, observaciones, objetivoMes, ventaActual, ventasSobreObjetivo } = req.body;

    const actorCode = String(req.user?.code || req.user?.id || '').trim();
    const actorRole = String(req.user?.role || '').trim().toUpperCase();
    const normalizedActorCode = actorCode.replace(/^0+/, '') || actorCode;
    const isAuthorized = req.user?.isJefeVentas === true
        || actorRole === 'ADMIN'
        || actorRole === 'JEFE_VENTAS'
        || normalizedActorCode === '98';

    if (!actorCode) {
        return res.status(401).json({ success: false, error: 'Autenticación requerida.' });
    }

    if (!isAuthorized) {
        logger.warn(`[COMMISSIONS] Unauthorized payment attempt by authenticated user: ${actorCode} (role: ${actorRole || 'unknown'})`);
        return res.status(403).json({ success: false, error: 'No tienes permisos para registrar pagos.' });
    }

    if (!vendedorCode || !year || !amount) {
        return res.status(400).json({ success: false, error: 'Faltan datos obligatorios (Comercial, Año, Importe)' });
    }

    try {
        const amountNum = parseFloat(amount);
        const safeYearNum = parseInt(year);
        const safeMonthNum = parseInt(month) || 0;
        let generatedNum = parseFloat(generatedAmount) || 0;
        let ventaComision = parseFloat(ventaActual) || 0;
        let objetivoMesNum = parseFloat(objetivoMes) || 0;
        let ventasSobreObjetivoNum = parseFloat(ventasSobreObjetivo) || 0;

        // Prefer the same backend calculation path as /summary for payment snapshots.
        // This keeps the blue columns aligned with snapshots, B-sales, fixed targets,
        // and the LCC/R1 monthly transition.
        if (safeMonthNum > 0) {
            const currentSnapshot = await getCurrentPaymentSnapshot(vendedorCode, safeYearNum, safeMonthNum);
            if (currentSnapshot) {
                ventaComision = currentSnapshot.ventaComision;
                objetivoMesNum = currentSnapshot.objetivoMes;
                ventasSobreObjetivoNum = currentSnapshot.ventasSobreObjetivo;
                generatedNum = currentSnapshot.generatedAmount;
                logger.info(`[COMMISSIONS] Captured backend payment snapshot for ${vendedorCode} ${safeYearNum}/${safeMonthNum}: venta=${ventaComision.toFixed(2)} obj=${objetivoMesNum.toFixed(2)} comm=${generatedNum.toFixed(2)}`);
            }
        }

        // Fallback only if the full summary path could not provide sales.
        if (safeMonthNum > 0 && ventaComision === 0) {
            try {
                const salesVendorExpr = getCommissionActualVendorColumnExprForMonth(safeYearNum, safeMonthNum, 'L');
                const codeVariants = getCodeVariants(vendedorCode);
                const vendorPlaceholders = codeVariants.map(() => '?').join(',');
                const vendedorFilter = codeVariants.length > 0
                    ? `AND TRIM(${salesVendorExpr}) IN (${vendorPlaceholders})`
                    : 'AND 1=0';
                const salesQuery = `
                    SELECT SUM(L.LCIMVT) as SALES
                    FROM DSED.LACLAE L
                    WHERE L.LCAADC = ?
                      AND L.LCMMDC = ?
                      AND ${LACLAE_SALES_FILTER}
                      ${vendedorFilter}
                `;
                const salesRows = await queryWithParams(salesQuery, [safeYearNum, safeMonthNum, ...codeVariants], false);
                if (salesRows && salesRows.length > 0) {
                    ventaComision = parseFloat(salesRows[0].SALES) || 0;
                }

                // Add B-Sales if exist
                const bSales = await getBSales(vendedorCode, year);
                ventaComision += (bSales[safeMonthNum] || 0);
                ventasSobreObjetivoNum = roundMoney(ventaComision - objetivoMesNum);

                logger.info(`[COMMISSIONS] Captured venta_comision for ${vendedorCode} ${year}/${month}: ${ventaComision.toFixed(2)}€`);
            } catch (salesErr) {
                logger.warn(`[COMMISSIONS] Could not capture venta_comision: ${salesErr.message}`);
            }
        }

        // Validate observaciones if paying less than generated amount.
        // Use epsilon tolerance (0.01 EUR = 1 cent) to avoid floating-point false positives.
        if ((generatedNum - amountNum) > 0.01 && (!observaciones || observaciones.trim() === '')) {
            logger.warn(`[COMMISSIONS] Payment validation failed: Missing observaciones for partial payment ${vendedorCode}`);
            return res.status(400).json({
                success: false,
                error: 'Debes indicar una observación explicando por qué se paga menos de lo correspondiente'
            });
        }

        // Pagos son solo INSERT – no UPDATE. Snapshot histórico intencional.
        const safePayVendor = sanitizeForSQL(vendedorCode.trim());
        const safePayObs = sanitizeForSQL((observaciones || '').substring(0, 1000));
        const safePayAdmin = sanitizeForSQL(actorCode.substring(0, 50));
        await queryWithParams(`
            INSERT INTO JAVIER.COMMISSION_PAYMENTS
            (VENDEDOR_CODIGO, ANIO, MES, VENTAS_REAL, OBJETIVO_MES, VENTAS_SOBRE_OBJETIVO, COMISION_GENERADA, IMPORTE_PAGADO, FECHA_PAGO, OBSERVACIONES, CREADO_POR)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
        `, [safePayVendor, safeYearNum, safeMonthNum, roundMoney(ventaComision), roundMoney(objetivoMesNum), roundMoney(ventasSobreObjetivoNum), roundMoney(generatedNum), roundMoney(amountNum), safePayObs, safePayAdmin]);

        // INVALIDATE CACHE: Clear summary cache for this vendor/year so next request fetches fresh data
        try {
            await invalidateCachePattern(`comm:summary:${vendedorCode.trim()}:${year}`);
            await invalidateCachePattern(`comm:summary:${COMMISSIONS_CACHE_VERSION}:SINGLE:${vendedorCode.trim()}:*`);
            await invalidateCachePattern(`comm:summary:${COMMISSIONS_CACHE_VERSION}:ALL:*`);
            await invalidateCachePattern(`comm:summary:${COMMISSIONS_CACHE_VERSION}:GROUP:*`);
            await invalidateCachePattern('comm:summary:ALL:*');
            await invalidateCachePattern('comm:summary:GROUP:*');
            logger.info(`[COMMISSIONS] Cache invalidated for ${vendedorCode}:${year}`);
        } catch (cacheErr) {
            logger.warn(`[COMMISSIONS] Cache invalidation failed: ${cacheErr.message}`);
        }

        logger.info(`[COMMISSIONS] Payment registered for ${vendedorCode}: ${amount}€ (vs ${generatedNum}€ gen, venta: ${ventaComision.toFixed(2)}€) by ${actorCode}${observaciones ? ' [with observaciones]' : ''}`);
        res.json({ success: true, message: 'Pago registrado correctamente' });
    } catch (e) {
        logger.error(`[COMMISSIONS] Payment error: ${e.message}`);
        res.status(500).json({ success: false, error: 'Error al registrar el pago en DB', details: e.message });
    }
});

// =============================================================================
// PDF REPORT — DIEGO ONLY
// =============================================================================

async function loadCommissionConfigForPdf(year) {
    try {
        const dbConfig = await queryWithParams(
            COMM_CONFIG_SELECT_SQL,
            [parseInt(year)],
            false,
            false
        );
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
                TIER4_PCT: parseFloat(row.TIER4_PCT)
            };
        }
    } catch (e) {
        logger.warn(`[PDF] COMM_CONFIG lookup failed: ${e.message}. Using defaults.`);
    }

    return {
        ipc: 3.0,
        TIER1_MAX: 103.00, TIER1_PCT: 1.0,
        TIER2_MAX: 106.00, TIER2_PCT: 1.3,
        TIER3_MAX: 110.00, TIER3_PCT: 1.6,
        TIER4_PCT: 2.0
    };
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

    const vendorCodes = safeVendorCode === 'ALL'
        ? await resolveAllModeVendorCodes(userCode, year, discoverVendorCodesForYear)
        : requestedVendorCodes;

    const [allVendorData, allSnapshotResult] = await Promise.all([
        batchFetchAllVendorData(vendorCodes, year),
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

    return settled
        .filter(result => result.status === 'fulfilled')
        .map(result => result.value);
}

function normalizeVendorCodeForPdf(code) {
    const raw = String(code || '').trim();
    return raw.replace(/^0+/, '') || raw;
}

router.get('/pdf', verifyToken, async (req, res) => {
    try {
        const { year, months, range, vendorCode } = req.query;
        
        // FIX: Use user code (req.user.code) instead of name, as name is not in JWT payload
        // The middleware auth.js sets: req.user = { id, code, role, isJefeVentas }
        const userCode = req.user?.code || '';
        const userId = req.user?.id || '';
        
        logger.info(`[PDF] Request received from user: code=${userCode}, id=${userId}, ip=${req.ip}`);

        // AUTHORIZATION: Only DIEGO (code 98) can access
        const pdfService = require('../services/commissions-pdf.service');
        
        // Check both the code (normalized, without leading zeros) and user ID
        const normalizedCode = userCode.replace(/^0+/, '');
        const isAuthorized = normalizedCode === '98' || userId === 'V98';
        
        if (!isAuthorized) {
            logger.warn(`[PDF] Unauthorized PDF attempt by user code: ${userCode} (${userId}) from IP: ${req.ip}`);
            return res.status(403).json({ 
                success: false, 
                error: 'Solo DIEGO puede generar este informe',
                userCode: userCode
            });
        }
        
        logger.info(`[PDF] Authorization granted for DIEGO (code: ${userCode})`);

        // Parse date range
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;
        const targetYear = year ? parseInt(year) : currentYear;

        let startMonth, endMonth;
        if (range === '1') {
            startMonth = currentMonth;
            endMonth = currentMonth;
        } else if (range === '2') {
            startMonth = Math.max(1, currentMonth - 1);
            endMonth = currentMonth;
        } else if (range === '3') {
            startMonth = Math.max(1, currentMonth - 2);
            endMonth = currentMonth;
        } else if (months) {
            // Specific months (e.g., "1,2,3")
            const monthList = months.split(',').map(m => parseInt(m.trim())).filter(m => !isNaN(m) && m >= 1 && m <= 12);
            if (monthList.length === 0) {
                logger.warn(`[PDF] Invalid months parameter: ${months}`);
                return res.status(400).json({ success: false, error: 'Meses inválidos' });
            }
            startMonth = Math.min(...monthList);
            endMonth = Math.max(...monthList);
        } else {
            // Default: up to current month
            startMonth = 1;
            endMonth = currentMonth;
        }

        logger.info(`[PDF] Generating for DIEGO: year=${targetYear}, months ${startMonth}-${endMonth}`);

        // Fetch data with same calculation path as /summary.
        let vendorData, condorData, pdfConfig;
        try {
            pdfConfig = await loadCommissionConfigForPdf(targetYear);
            [vendorData, condorData] = await Promise.all([
                buildPdfSummaryVendors(vendorCode || 'ALL', targetYear, pdfConfig, userCode),
                pdfService.getCondorSalesData(targetYear, startMonth, endMonth)
            ]);
            
            logger.info(`[PDF] Summary data fetched successfully: ${vendorData.length} vendors, ${condorData.size} B-sales vendors`);
        } catch (dataError) {
            logger.error(`[PDF] Error fetching sales data: ${dataError.message}`);
            return res.status(500).json({ 
                success: false, 
                error: 'Error obteniendo datos de ventas', 
                details: dataError.message 
            });
        }

        let teamCommissionPdf = null;
        const pdfVendorNorm = normalizeVendorCodeForPdf(vendorCode);
        if (isTeamLeader(pdfVendorNorm) || (vendorData || []).some((v) => isTeamLeader(normalizeVendorCodeForPdf(v.vendedorCode)))) {
            try {
                await ensureExcludedVendorsLoaded();
                teamCommissionPdf = await getTeamCommission(
                    '80',
                    targetYear,
                    (code, y, cfg) => calculateVendorData(code, y, cfg),
                    pdfConfig,
                );
            } catch (teamErr) {
                logger.warn(`[PDF] Team commission section skipped: ${teamErr.message}`);
            }
        }

        // Generate PDF with error handling
        let pdfBuffer;
        try {
            pdfBuffer = await pdfService.generateCommissionsPdfFromSummary(
                vendorData,
                condorData,
                targetYear,
                startMonth,
                endMonth,
                teamCommissionPdf,
                pdfConfig,
            );
            logger.info(`[PDF] PDF generated successfully (${(pdfBuffer.length / 1024).toFixed(2)} KB)`);
        } catch (pdfError) {
            logger.error(`[PDF] Error generating PDF: ${pdfError.message}`);
            logger.error(`[PDF] Stack trace: ${pdfError.stack}`);
            return res.status(500).json({ 
                success: false, 
                error: 'Error generando PDF', 
                details: pdfError.message 
            });
        }

        // Send PDF with proper headers
        try {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=comisiones_${targetYear}_${startMonth}-${endMonth}.pdf`);
            res.setHeader('Content-Length', pdfBuffer.length);
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.send(pdfBuffer);

            logger.info(`[PDF] PDF sent successfully for DIEGO (${vendorData.length} vendors)`);
        } catch (sendError) {
            logger.error(`[PDF] Error sending PDF: ${sendError.message}`);
            // Don't throw error here as response may already be partially sent
        }
    } catch (e) {
        logger.error(`[PDF] Unexpected generation error: ${e.message}`);
        logger.error(`[PDF] Stack trace: ${e.stack}`);
        res.status(500).json({ 
            success: false, 
            error: 'Error generando PDF', 
            details: e.message,
            stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
        });
    }
});

// FIX #1: Route to get excluded vendor codes (for frontend dynamic loading)
router.get('/team/:leaderCode', verifyToken, async (req, res) => {
    try {
        const leaderCode = (req.params.leaderCode || '').replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
        const year = parseInt(req.query.year, 10) || new Date().getFullYear();
        if (!leaderCode || !isTeamLeader(leaderCode)) {
            return res.status(400).json({ success: false, error: 'Lider de equipo no valido' });
        }
        if (isCommercial80User(req.user?.code || '')) {
            logger.info('[COMMISSIONS] Hidden team commission for authenticated commercial 80');
            return res.json({
                success: true,
                hiddenForCommercial80: true,
                leaderCode,
                year,
                months: [],
                teamMembers: [],
                annualTotal: 0,
                annualExcess: 0,
                annualTeamMembersExcess: 0,
                annualTeamMembersCommission: 0,
                leaderPersonalCommission: 0,
            });
        }
        await ensureExcludedVendorsLoaded();
        let config = DEFAULT_CONFIG_2026;
        try {
            const dbConfig = await queryWithParams(
                COMM_CONFIG_SELECT_SQL,
                [year],
                false,
                false,
            );
            if (dbConfig?.length) {
                const row = dbConfig[0];
                config = {
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
        } catch (_) { /* default config */ }
        const teamData = await getTeamCommission(
            leaderCode,
            year,
            (code, y, cfg) => calculateVendorData(code, y, cfg),
            config,
        );
        return res.json(teamData);
    } catch (error) {
        return handleRouteError(error, res, 'Error calculando comision de equipo', 500, { success: false });
    }
});

router.get('/excluded-vendors', verifyToken, async (req, res) => {
    try {
        await loadExcludedVendors(); // Force fresh load
        logger.debug(`[COMMISSIONS] /excluded-vendors returning: [${EXCLUDED_VENDORS.join(', ')}]`);
        res.json({ success: true, excludedVendors: EXCLUDED_VENDORS });
    } catch (e) {
        logger.warn(`[COMMISSIONS] /excluded-vendors error: ${e.message}`);
        res.json({ success: true, excludedVendors: DEFAULT_EXCLUDED }); // Fallback
    }
});

module.exports = {
    router,
    initCommissionTables,
    _private: {
        calculateVendorData,
        getCurrentPaymentSnapshot,
        loadCommissionConfig,
        buildPdfSummaryVendors,
        loadCommissionConfigForPdf,
    },
};
