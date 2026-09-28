const express = require('express');
const crypto = require('crypto');
const { getPool } = require('../middleware/db-timing');
const logger = require('../middleware/logger');
const { auditDataAccess } = require('../middleware/audit');
// (laclae + LACLAE_SALES_FILTER + vendor-column exprs viven en services/commissions-service.js.)
const { getCurrentDate, sanitizeForSQL, handleRouteError } = require('../utils/common');
const {
    requiresPartialPaymentObservaciones,
} = require('../utils/commission-snapshot');
const { verifyToken } = require('../middleware/auth');
const { validateQuery, validateBody } = require('../middleware/security');
const { authorizeVendorScope, isFinancialRole } = require('../middleware/vendor-scope');
const { historicalYearsCacheMeta } = require('../src/services/dashboard.service.js');
const { redisCache } = require('../services/redis-cache');
const { beginRouteFill, endRouteFill, sendFillBusy } = require('../services/route-cache-stampede');
const { slimGroupedSummaryForWire } = require('../services/commissions-summary-wire');
const {
    isTeamLeader,
    getTeamCommission,
    buildTeamLeadSummaryPayload,
    isScopedTeamAllRequest,
    resolveAllModeVendorCodes,
    allModeCacheScope,
} = require('../services/team-commission.service');
const commissionsService = require('../services/commissions-service');
// Reglas leaf + acceso DB2 leaf movidos al service (misma identidad de funcion;
// los bloques pinnados por tests de arquitectura siguen en este fichero).
const {
    DEFAULT_EXCLUDED,
    COMMISSIONS_CACHE_VERSION,
    loadExcludedVendors,
    ensureExcludedVendorsLoaded,
    getExcludedVendors,
    aggregateScopedTeamMonths,
    deleteMonthCommissionPayments,
    invalidateCommissionPaymentCaches,
    getVendorPayments,
    getVendorSalesSnapshot,
    calculateWorkingDays,
    roundMoney,
    loadCommissionConfig,
    getMonthPaymentSnapshotFromDb,
    capturePayFallbackSales,
    insertCommissionPayment,
    // Batch layer movido al service (tanda 2): la ruta solo valida/delega.
    batchFetchVendorDataChunked,
    calculateVendorData,
    getCachedPaymentSnapshot,
    getCurrentPaymentSnapshot,
    discoverVendorCodesForYear,
    mergePayments,
    sumResults,
    loadCommissionConfigForPdf,
    buildPdfSummaryVendors,
    normalizeVendorCodeForPdf,
} = commissionsService;

const router = express.Router();

// ASVS V2: esquemas strict — rechazan campos no esperados (anti mass-assignment).
const { z } = require('zod');

const summaryQuerySchema = z.object({
    vendedorCode: z.string().min(1).max(60),
    year: z.string().regex(/^[0-9]+(,[0-9]+)*$/).max(40).optional(),
    forceRefresh: z.enum(['true', 'false', '1', '0']).optional(),
    limit: z.string().regex(/^\d{1,5}$/).optional(),
    offset: z.string().regex(/^\d{1,7}$/).optional(),
}).strict();

const teamQuerySchema = z.object({
    year: z.string().regex(/^\d{4}$/).optional(),
}).strict();

const payBodySchema = z.object({
    vendedorCode: z.string().min(1).max(10),
    year: z.union([z.number().int(), z.string().regex(/^\d{4}$/)]),
    month: z.union([z.number().int(), z.string()]).optional(),
    quarter: z.union([z.number().int(), z.string()]).nullable().optional(),
    amount: z.union([z.number(), z.string()]),
    generatedAmount: z.union([z.number(), z.string()]).optional(),
    // Kept for compatibility with older clients; authorization never trusts it.
    adminCode: z.string().max(50).nullable().optional(),
    concept: z.string().max(200).nullable().optional(),
    observaciones: z.string().max(500).nullable().optional(),
    objetivoMes: z.union([z.number(), z.string()]).optional(),
    ventaActual: z.union([z.number(), z.string()]).optional(),
    ventasSobreObjetivo: z.union([z.number(), z.string()]).optional(),
    setTotal: z.union([z.boolean(), z.number(), z.string()]).optional(),
}).strict();

// (Movido a services/commissions-service.js: lista de excluidos, config,
// COMM_CONFIG_SELECT_SQL y COMMISSIONS_CACHE_VERSION. La ruta los importa.)

// (Movido a services/commissions-service.js: aggregateScopedTeamMonths.)

// =============================================================================
// DATABASE INITIALIZATION (JAVIER Schema)
// Uses DIRECT pool connections to avoid query() retry/pool-recreation logic.
// This helper is intentionally fail-closed: it is never allowed to mutate a
// production or shared schema from a running API process.
// =============================================================================
function assertCommissionInitializationTestOnly(env = process.env) {
    const environment = String(env.REPARTO_ENVIRONMENT || '').trim().toLowerCase();
    const tableSet = String(env.REPARTO_TABLE_SET || '').trim().toLowerCase();
    const approval = String(env.REPARTO_MIGRATION_APPROVAL || '').trim();
    if (!['test', 'staging'].includes(environment)
        || tableSet !== 'isolated_test'
        || approval !== 'TEST_ONLY') {
        const error = new Error('Commission table initialization requires an isolated TEST runtime and explicit TEST_ONLY approval');
        error.code = 'COMMISSION_INIT_TEST_GATE_REQUIRED';
        throw error;
    }
}

async function initCommissionTables() {
    assertCommissionInitializationTestOnly();
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
    logger.info(`✅ Commission system initialized. Excluded vendors: [${getExcludedVendors().join(', ')}]`);
}

// Exported for server.js to call during startup sequence (no more fire-and-forget setTimeout)

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// (getCommissionVendorColumnExprForYear vive en services/commissions-service.js.)

// (Movidos a services/commissions-service.js: getCodeVariants,
// appendPaymentDetailRow, deleteMonthCommissionPayments,
// invalidateCommissionPaymentCaches.)

// (Movidos a services/commissions-service.js: monthSnapshotFromVendorRecord,
// findVendorRecordInSummary, getCachedPaymentSnapshot. La ruta los importa.)

// (Movidos a services/commissions-service.js: getVendorCurrentClients,
// getClientsMonthlySales, aggregateCommissionSalesRows.)

// (Movidos a services/commissions-service.js: getCommissionSalesRowsFromClientCache,
// getCommissionSalesRowsByClientScopeForVendors. La ruta los importa.)

// (Movido a services/commissions-service.js: aggregateVendorCommissionSalesRows.)

// (Movido a services/commissions-service.js: fetchSingleVendorCommissionSalesRows.)

// getBSales is now imported from ../utils/common.js

// (Movido a services/commissions-service.js: getVendorPayments.)

// (Movido a services/commissions-service.js: getVendorSalesSnapshot.)

// (Movidos a services/commissions-service.js: batchFetchAllVendorData,
// chunkArray, getCommissionBatchChunkSize, getCommissionChunkConcurrency,
// runChunksWithConcurrency, batchFetchVendorDataChunked. La ruta los importa.)

// (Movidos a services/commissions-service.js: calculateWorkingDays,
// calculateCommission, roundMoney, loadCommissionConfig.)

// (Movido a services/commissions-service.js: calculateVendorData. La ruta lo importa.)

// (Movido a services/commissions-service.js: getMonthPaymentSnapshotFromDb.)

// (Movido a services/commissions-service.js: getCurrentPaymentSnapshot.)

// (Movido a services/commissions-service.js: buildAggregatedYearResult.)

// (Movidos a services/commissions-service.js: discoverVendorCodesForYear,
// calculateGroupedVendorSummary. La ruta los importa.)

// =============================================================================
// ROUTES
// =============================================================================

router.get('/summary', verifyToken, validateQuery(summaryQuerySchema), async (req, res) => {
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
        // ASVS V8 / BOLA (H-01): solo codigos dentro del alcance firmado del usuario.
        if (safeVendorCode === 'ALL') {
            const allAllowed = isFinancialRole(req.user) || isScopedTeamAllRequest(userCode, 'ALL');
            if (!allAllowed) {
                logger.warn(`[COMMISSIONS] Forbidden ALL summary: user=${userCode || 'unknown'}`);
                return res.status(403).json({ success: false, error: 'Forbidden: ALL requiere rol financiero' });
            }
        } else {
            const scopeCheck = authorizeVendorScope(req, requestedVendorCodes);
            if (!scopeCheck.ok) {
                logger.warn(`[COMMISSIONS] Forbidden summary request: user=${userCode || 'unknown'} denied=${(scopeCheck.denied || []).join(',')}`);
                return res.status(403).json({ success: false, error: 'Forbidden: vendedor fuera de tu alcance', denied: scopeCheck.denied });
            }
        }
        const scopedTeamAll = isScopedTeamAllRequest(userCode, safeVendorCode);
        const groupHash = requestedVendorCodes.length > 0
            ? crypto.createHash('md5').update(requestedVendorCodes.slice().sort().join(',')).digest('hex').substring(0, 12)
            : 'all';
        const allScope = allModeCacheScope(userCode, safeVendorCode) || 'ALL';
        const summaryMeta = historicalYearsCacheMeta(years, getCurrentDate());
        const aggregatedCacheKey = isGroupedRequest
            ? (safeVendorCode === 'ALL'
                ? `comm:summary:${COMMISSIONS_CACHE_VERSION}:${allScope}:${years.join(',')}:${summaryMeta.bucket}`
                : `comm:summary:${COMMISSIONS_CACHE_VERSION}:GROUP:${groupHash}:${years.join(',')}:${summaryMeta.bucket}`)
            : null;
        const singleSummaryCacheKey = !isGroupedRequest
            ? `comm:summary:${COMMISSIONS_CACHE_VERSION}:SINGLE:${safeVendorCode}:${years.join(',')}:${summaryMeta.bucket}`
            : null;

        if (aggregatedCacheKey && !shouldForceRefresh) {
            const cachedResult = await redisCache.get('route', aggregatedCacheKey);
            if (cachedResult) {
                logger.info(`[COMMISSIONS] ⚡ Cache HIT for grouped summary (${aggregatedCacheKey})`);
                return res.json({ success: true, ...slimGroupedSummaryForWire(cachedResult) });
            }
            const stampede = await beginRouteFill(aggregatedCacheKey);
            if (stampede.hit) {
                logger.info(`[COMMISSIONS] ⚡ Cache HIT for grouped summary after wait (${aggregatedCacheKey})`);
                return res.json({ success: true, ...slimGroupedSummaryForWire(stampede.hit) });
            }
            if (stampede.busy) {
                return sendFillBusy(res);
            }
            req._commFillLock = stampede.lock;
            req._commFillKey = aggregatedCacheKey;
        }

        if (singleSummaryCacheKey && !shouldForceRefresh) {
            const cachedResult = await redisCache.get('route', singleSummaryCacheKey);
            if (cachedResult) {
                logger.info(`[COMMISSIONS] Cache HIT for vendor summary (${singleSummaryCacheKey})`);
                return res.json({ success: true, ...cachedResult });
            }
        }

        // A. Load Config (service: COMM_CONFIG con fallback a defaults)
        const config = await loadCommissionConfig(selectedYear);


        logger.info(`[COMMISSIONS] Requested Summary for ${vendedorCode} in years: ${years.join(',')}`);

        // Merges multi-anio en services/commissions-service.js
        // (sumResults/mergeBreakdowns/mergeTimeUnits/mergePayments importados).

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

                // PERF: Batch fetch grouped vendor data in bounded chunks instead of N×7.
                const batchStart = Date.now();
                // Also pre-load sales snapshot once for all vendors (1 query instead of N)
                let allVendorData;
                let allSnapshotResult;
                try {
                    [allVendorData, allSnapshotResult] = await Promise.all([
                        batchFetchVendorDataChunked(vendorCodes, yr),
                        getVendorSalesSnapshot(vendorCodes, yr)
                    ]);
                } catch (fetchError) {
                    if (cachedResult) {
                        logger.warn(`[COMMISSIONS] Grouped refresh failed for ${allSummaryCacheKey}; returning stale cached summary: ${fetchError.message}`);
                        return {
                            ...cachedResult,
                            stale: true,
                            degraded: true,
                            warning: 'Resumen de comisiones servido desde cache por incidencia temporal en DB2.',
                        };
                    }
                    throw fetchError;
                }
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

        if (aggregatedCacheKey && aggregatedResult && !aggregatedResult.degraded) {
            await redisCache.set('route', aggregatedCacheKey, aggregatedResult, summaryMeta.ttl);
            logger.info(`[COMMISSIONS] Cached grouped summary (${summaryMeta.bucket} ${summaryMeta.ttl}s) (${aggregatedCacheKey})`);
        }
        if (singleSummaryCacheKey && aggregatedResult && !aggregatedResult.degraded) {
            await redisCache.set('route', singleSummaryCacheKey, aggregatedResult, summaryMeta.ttl);
            logger.debug(`[COMMISSIONS] Cached vendor summary (${summaryMeta.bucket} ${summaryMeta.ttl}s) (${singleSummaryCacheKey})`);
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
        const wireResult = isGroupedRequest
            ? slimGroupedSummaryForWire(paginatedResult)
            : paginatedResult;
        const responsePayload = { success: true, ...wireResult };
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
    } finally {
        if (req._commFillLock) {
            await endRouteFill(req._commFillKey, req._commFillLock);
            req._commFillLock = null;
        }
    }
});

// FIX #5: Endpoint to register a payment (Restricted to ADMIN users via TIPOVENDEDOR lookup)
// NEW: Validates observaciones requirement and captures venta_comision snapshot
// Pagos son solo INSERT – no UPDATE. Snapshot histórico intencional.
router.post('/pay', verifyToken, validateBody(payBodySchema), async (req, res) => {
    const {
        vendedorCode,
        year,
        month,
        quarter,
        amount,
        generatedAmount,
        concept,
        observaciones,
        objetivoMes,
        ventaActual,
        ventasSobreObjetivo,
        setTotal,
    } = req.body;
    const setTotalMode = setTotal === true || setTotal === 'true' || setTotal === 1 || setTotal === '1';

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

    if (!vendedorCode || !year || amount === undefined || amount === null || amount === '') {
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

        // Prefer Redis summary (same numbers the UI just showed). Fall back to
        // the client snapshot already computed by /summary. Full-year LACLAE
        // recalc is last resort — it was adding 15s+ per payment.
        if (safeMonthNum > 0) {
            const currentSnapshot = await getCurrentPaymentSnapshot(vendedorCode, safeYearNum, safeMonthNum);
            if (currentSnapshot) {
                ventaComision = currentSnapshot.ventaComision;
                objetivoMesNum = currentSnapshot.objetivoMes;
                ventasSobreObjetivoNum = currentSnapshot.ventasSobreObjetivo;
                generatedNum = currentSnapshot.generatedAmount;
                logger.info(`[COMMISSIONS] Captured ${currentSnapshot.source || 'backend'} payment snapshot for ${vendedorCode} ${safeYearNum}/${safeMonthNum}: venta=${ventaComision.toFixed(2)} obj=${objetivoMesNum.toFixed(2)} comm=${generatedNum.toFixed(2)}`);
            }
        }

        // Fallback only if the full summary path could not provide sales.
        if (safeMonthNum > 0 && ventaComision === 0) {
            ventaComision = await capturePayFallbackSales(vendedorCode, year, month);
            ventasSobreObjetivoNum = roundMoney(ventaComision - objetivoMesNum);
        }

        // Validate observaciones against remaining due (supports completing partial months).
        const existingPaid = safeMonthNum > 0
            ? roundMoney((await getVendorPayments(vendedorCode, safeYearNum)).monthly[safeMonthNum] || 0)
            : 0;

        const safePayVendor = sanitizeForSQL(vendedorCode.trim());
        const safePayAdmin = sanitizeForSQL(actorCode.substring(0, 50));

        if (setTotalMode) {
            if (safeMonthNum <= 0) {
                return res.status(400).json({ success: false, error: 'Debes indicar el mes para corregir el importe total' });
            }
            const targetTotal = roundMoney(amountNum);
            if (targetTotal < 0) {
                return res.status(400).json({ success: false, error: 'El importe total no puede ser negativo' });
            }
            if (Math.abs(targetTotal - existingPaid) <= 0.01) {
                return res.json({ success: true, message: 'El importe total ya coincide con el registrado' });
            }
            if (existingPaid > 0.01 && (!observaciones || observaciones.trim() === '')) {
                return res.status(400).json({
                    success: false,
                    error: 'Debes indicar una observación explicando la corrección del importe total'
                });
            }

            await deleteMonthCommissionPayments(vendedorCode, safeYearNum, safeMonthNum);

            if (targetTotal > 0) {
                const correctionPrefix = existingPaid > 0.01
                    ? `Correccion total mes: ${existingPaid.toFixed(2)}€ -> ${targetTotal.toFixed(2)}€. `
                    : '';
                const safePayObs = sanitizeForSQL(
                    `${correctionPrefix}${(observaciones || '').trim()}`.substring(0, 1000)
                );
                await insertCommissionPayment({
                    vendorCode: safePayVendor,
                    year: safeYearNum,
                    month: safeMonthNum,
                    ventaComision: roundMoney(ventaComision),
                    objetivoMes: roundMoney(objetivoMesNum),
                    ventasSobreObjetivo: roundMoney(ventasSobreObjetivoNum),
                    comisionGenerada: roundMoney(generatedNum),
                    importePagado: targetTotal,
                    observaciones: safePayObs,
                    creadoPor: safePayAdmin,
                });
            }

            logger.info(`[COMMISSIONS] Payment total corrected for ${vendedorCode} ${safeYearNum}/${safeMonthNum}: ${existingPaid.toFixed(2)}€ -> ${targetTotal.toFixed(2)}€ by ${actorCode}`);
        } else {
            if (amountNum <= 0) {
                return res.status(400).json({ success: false, error: 'El importe debe ser mayor que 0' });
            }
            if (requiresPartialPaymentObservaciones({
                generatedAmount: generatedNum,
                alreadyPaid: existingPaid,
                paymentAmount: amountNum,
                observaciones,
            })) {
                logger.warn(`[COMMISSIONS] Payment validation failed: Missing observaciones for partial payment ${vendedorCode} (paid=${existingPaid.toFixed(2)}, due=${(generatedNum - existingPaid).toFixed(2)}, amount=${amountNum.toFixed(2)})`);
                return res.status(400).json({
                    success: false,
                    error: 'Debes indicar una observación explicando por qué se paga menos de lo pendiente'
                });
            }

            const safePayObs = sanitizeForSQL((observaciones || '').substring(0, 1000));
            await insertCommissionPayment({
                vendorCode: safePayVendor,
                year: safeYearNum,
                month: safeMonthNum,
                ventaComision: roundMoney(ventaComision),
                objetivoMes: roundMoney(objetivoMesNum),
                ventasSobreObjetivo: roundMoney(ventasSobreObjetivoNum),
                comisionGenerada: roundMoney(generatedNum),
                importePagado: roundMoney(amountNum),
                observaciones: safePayObs,
                creadoPor: safePayAdmin,
            });

            logger.info(`[COMMISSIONS] Payment registered for ${vendedorCode}: ${amount}€ (vs ${generatedNum}€ gen, venta: ${ventaComision.toFixed(2)}€) by ${actorCode}${observaciones ? ' [with observaciones]' : ''}`);
        }

        // INVALIDATE CACHE: bust route-scoped Redis + HTTP commission caches after payment writes.
        try {
            await invalidateCommissionPaymentCaches(vendedorCode, year);
            logger.info(`[COMMISSIONS] Route cache invalidated for ${vendedorCode}:${year}`);
        } catch (cacheErr) {
            logger.warn(`[COMMISSIONS] Cache invalidation failed: ${cacheErr.message}`);
        }

        logger.info(`[COMMISSIONS] Payment ${setTotalMode ? 'total corrected' : 'registered'} for ${vendedorCode}:${year}`);
        res.json({
            success: true,
            message: setTotalMode ? 'Importe total del mes actualizado correctamente' : 'Pago registrado correctamente',
            payment: {
                vendedorCode: safePayVendor,
                year: safeYearNum,
                month: safeMonthNum,
                amount: setTotalMode ? roundMoney(amountNum) : roundMoney(amountNum),
                setTotal: setTotalMode,
                ventaComision: roundMoney(ventaComision),
                objetivoMes: roundMoney(objetivoMesNum),
                generatedAmount: roundMoney(generatedNum),
            },
        });
    } catch (e) {
        // F2b-04: error generico via handler central; detalle solo en log (sin details interno).
        handleRouteError(e, res, 'Error registrando el pago', 500, { code: 'COMMISSIONS_PAY_ERROR' });
    }
});

// =============================================================================
// PDF REPORT — DIEGO ONLY
// =============================================================================

// (Movidos a services/commissions-service.js: loadCommissionConfigForPdf,
// summaryCacheBucketForYear, buildGroupedSummaryCacheKeyForPdf,
// getCachedPdfSummaryVendors, buildPdfSummaryVendors,
// normalizeVendorCodeForPdf. La ruta los importa.)

// Default 0: PDF binary cache caused stale reports (same file hours later). Opt-in via env only.
const PDF_RESULT_CACHE_TTL_SECONDS = (() => {
    const parsed = parseInt(process.env.PDF_RESULT_CACHE_TTL_SECONDS, 10);
    return Number.isFinite(parsed) ? parsed : 0;
})();
const PDF_GENERATION_LOCK_TTL_MS = parseInt(process.env.PDF_GENERATION_LOCK_TTL_MS, 10) || 180000;
const PDF_SINGLE_FLIGHT_WAIT_MS = parseInt(process.env.PDF_SINGLE_FLIGHT_WAIT_MS, 10) || 170000;
const PDF_SINGLE_FLIGHT_POLL_MS = parseInt(process.env.PDF_SINGLE_FLIGHT_POLL_MS, 10) || 1000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizePdfCachePart(value, fallback = 'none') {
    const normalized = String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9,_-]/g, '')
        .substring(0, 120);
    return normalized || fallback;
}

function normalizePdfMonthsPart(months, startMonth, endMonth) {
    if (!months) return `${startMonth}-${endMonth}`;
    const selected = [...new Set(
        String(months)
            .split(',')
            .map(month => parseInt(month.trim(), 10))
            .filter(month => Number.isInteger(month) && month >= 1 && month <= 12)
    )].sort((a, b) => a - b);
    return selected.length ? selected.join(',') : `${startMonth}-${endMonth}`;
}

function buildPdfGenerationCacheKey({ vendorCode, userCode, targetYear, startMonth, endMonth, months, pdfType = 'commissions' }) {
    const scope = normalizePdfCachePart(vendorCode || 'ALL', 'ALL');
    const user = normalizePdfCachePart(userCode || 'unknown', 'unknown');
    const monthsPart = normalizePdfMonthsPart(months, startMonth, endMonth);
    const typePart = normalizePdfCachePart(pdfType || 'commissions', 'commissions');
    return `comm:pdf:${COMMISSIONS_CACHE_VERSION}:${typePart}:${user}:${scope}:${targetYear}:${monthsPart}`;
}

function encodePdfPayload(payload) {
    return {
        pdfBase64: payload.pdfBuffer.toString('base64'),
        vendorCount: payload.vendorCount || 0,
        fileName: payload.fileName || 'comisiones.pdf',
        generatedAt: payload.generatedAt || new Date().toISOString(),
    };
}

function decodePdfPayload(payload) {
    if (!payload?.pdfBase64) return null;
    return {
        pdfBuffer: Buffer.from(payload.pdfBase64, 'base64'),
        vendorCount: payload.vendorCount || 0,
        fileName: payload.fileName || 'comisiones.pdf',
        generatedAt: payload.generatedAt,
        fromCache: true,
    };
}

async function getCachedPdfPayload(cacheKey) {
    try {
        return decodePdfPayload(await redisCache.get('route', cacheKey));
    } catch (e) {
        logger.warn(`[PDF] PDF cache lookup failed: ${e.message}`);
        return null;
    }
}

async function setCachedPdfPayload(cacheKey, payload) {
    try {
        await redisCache.set('route', cacheKey, encodePdfPayload(payload), PDF_RESULT_CACHE_TTL_SECONDS);
    } catch (e) {
        logger.warn(`[PDF] PDF cache store failed: ${e.message}`);
    }
}

function createPdfRouteError(publicError, error, statusCode = 500) {
    const wrapped = new Error(error?.message || publicError);
    wrapped.publicError = publicError;
    wrapped.statusCode = statusCode;
    if (error?.stack) wrapped.stack = error.stack;
    return wrapped;
}

async function getPdfErrorMarker(cacheKey) {
    try {
        const marker = await redisCache.get('route', `${cacheKey}:error`);
        if (!marker?.message) return null;
        return createPdfRouteError(
            marker.publicError || 'Error generando PDF',
            new Error(marker.message),
            marker.statusCode || 500
        );
    } catch (e) {
        logger.warn(`[PDF] PDF error marker lookup failed: ${e.message}`);
        return null;
    }
}

async function setPdfErrorMarker(cacheKey, error) {
    try {
        await redisCache.set('route', `${cacheKey}:error`, {
            publicError: error.publicError || 'Error generando PDF',
            message: error.message,
            statusCode: error.statusCode || 500,
            generatedAt: new Date().toISOString(),
        }, 30);
    } catch (e) {
        logger.warn(`[PDF] PDF error marker store failed: ${e.message}`);
    }
}

async function waitForPdfPayload(cacheKey) {
    const deadline = Date.now() + PDF_SINGLE_FLIGHT_WAIT_MS;
    while (Date.now() < deadline) {
        await sleep(Math.min(PDF_SINGLE_FLIGHT_POLL_MS, Math.max(25, deadline - Date.now())));
        const cached = await getCachedPdfPayload(cacheKey);
        if (cached) return cached;
        const marker = await getPdfErrorMarker(cacheKey);
        if (marker) throw marker;
    }

    throw createPdfRouteError(
        'PDF en curso',
        new Error('Ya hay una generacion de PDF en curso. Reintenta en unos segundos.'),
        503
    );
}

async function getOrGeneratePdfPayload(cacheKey, generator, { skipCache = false } = {}) {
    const cacheEnabled = PDF_RESULT_CACHE_TTL_SECONDS > 0 && !skipCache;
    if (cacheEnabled) {
        const cached = await getCachedPdfPayload(cacheKey);
        if (cached) {
            logger.info(`[PDF] Returning cached PDF result (${cacheKey})`);
            return cached;
        }
    }

    const canCoordinate = redisCache?.isConnected && typeof redisCache.acquireLock === 'function';
    if (!canCoordinate) {
        logger.warn(`[PDF] Redis lock unavailable; generating without cross-worker single-flight (${cacheKey})`);
        const fresh = await generator();
        if (cacheEnabled) await setCachedPdfPayload(cacheKey, fresh);
        return fresh;
    }

    const lockKey = `${cacheKey}:generate`;
    const lockToken = await redisCache.acquireLock('route', lockKey, PDF_GENERATION_LOCK_TTL_MS);
    if (!lockToken) {
        if (!cacheEnabled) {
            logger.warn(`[PDF] Lock busy without PDF cache; retrying generation (${cacheKey})`);
            return generator();
        }
        logger.info(`[PDF] Waiting for in-flight PDF generation (${cacheKey})`);
        return waitForPdfPayload(cacheKey);
    }

    try {
        const fresh = await generator();
        if (cacheEnabled) await setCachedPdfPayload(cacheKey, fresh);
        return fresh;
    } catch (error) {
        await setPdfErrorMarker(cacheKey, error);
        throw error;
    } finally {
        if (typeof redisCache.releaseLock === 'function') {
            await redisCache.releaseLock('route', lockKey, lockToken);
        }
    }
}

router.get('/pdf', verifyToken, async (req, res) => {
    try {
        const { year, months, range, vendorCode, forceRefresh, pdfType: rawPdfType } = req.query;
        const skipPdfCache = forceRefresh === 'true' || forceRefresh === '1';
        const pdfType = String(rawPdfType || 'commissions').trim().toLowerCase() === 'payment_record'
            ? 'payment_record'
            : 'commissions';
        
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

        const selectedMonthsList = months
            ? months.split(',').map(m => parseInt(m.trim(), 10)).filter(m => !isNaN(m) && m >= 1 && m <= 12)
            : Array.from({ length: endMonth - startMonth + 1 }, (_, index) => startMonth + index);

        logger.info(`[PDF] Generating for DIEGO: type=${pdfType}, year=${targetYear}, months ${startMonth}-${endMonth}`);

        if (pdfType === 'payment_record') {
            const safeVendorCode = String(vendorCode || '').trim().replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
            if (!safeVendorCode || safeVendorCode === 'ALL') {
                return res.status(400).json({
                    success: false,
                    error: 'El registro de pagos requiere un comercial concreto (no ALL)',
                });
            }
            if (selectedMonthsList.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Selecciona al menos un mes valido',
                });
            }
        }

        const pdfCacheKey = buildPdfGenerationCacheKey({
            vendorCode: vendorCode || 'ALL',
            userCode,
            targetYear,
            startMonth,
            endMonth,
            months,
            pdfType,
        });

        let pdfPayload;
        try {
            pdfPayload = await getOrGeneratePdfPayload(pdfCacheKey, async () => {
                if (pdfType === 'payment_record') {
                    const safeVendorCode = String(vendorCode || '').trim().replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
                    let paymentRecordData;
                    try {
                        paymentRecordData = await pdfService.fetchPaymentRecordClientRows(
                            safeVendorCode,
                            targetYear,
                            selectedMonthsList,
                        );
                    } catch (dataError) {
                        logger.error(`[PDF] Payment record data error: ${dataError.message}`);
                        throw createPdfRouteError('Error obteniendo ventas por cliente', dataError);
                    }

                    let pdfBuffer;
                    try {
                        pdfBuffer = await pdfService.generatePaymentRecordPdf({
                            vendorCode: safeVendorCode,
                            vendorName: paymentRecordData.vendorName,
                            year: targetYear,
                            months: selectedMonthsList,
                            rows: paymentRecordData.rows,
                        });
                        logger.info(`[PDF] Payment record PDF generated (${(pdfBuffer.length / 1024).toFixed(2)} KB, ${paymentRecordData.rows.length} clients)`);
                    } catch (pdfError) {
                        logger.error(`[PDF] Payment record PDF error: ${pdfError.message}`);
                        throw createPdfRouteError('Error generando registro de pagos', pdfError);
                    }

                    const monthsLabel = selectedMonthsList.length === 1
                        ? `${selectedMonthsList[0]}`
                        : `${Math.min(...selectedMonthsList)}-${Math.max(...selectedMonthsList)}`;

                    return {
                        pdfBuffer,
                        vendorCount: 1,
                        fileName: `registro_pagos_${safeVendorCode}_${targetYear}_${monthsLabel}.pdf`,
                        generatedAt: new Date().toISOString(),
                    };
                }

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
                    throw createPdfRouteError('Error obteniendo datos de ventas', dataError);
                }

                let teamCommissionPdf = null;
                const pdfVendorNorm = normalizeVendorCodeForPdf(vendorCode);
                const pdfVendorDataByCode = new Map();
                (vendorData || []).forEach((vendor) => {
                    const normalized = normalizeVendorCodeForPdf(vendor.vendedorCode || vendor.code);
                    if (normalized) {
                        pdfVendorDataByCode.set(normalized, vendor);
                    }
                });
                const calculateVendorDataForPdf = async (code, y, cfg) => {
                    const normalized = normalizeVendorCodeForPdf(code);
                    if (parseInt(y, 10) === targetYear && pdfVendorDataByCode.has(normalized)) {
                        return pdfVendorDataByCode.get(normalized);
                    }
                    return calculateVendorData(code, y, cfg);
                };
                if (isTeamLeader(pdfVendorNorm) || (vendorData || []).some((v) => isTeamLeader(normalizeVendorCodeForPdf(v.vendedorCode || v.code)))) {
                    try {
                        await ensureExcludedVendorsLoaded();
                        teamCommissionPdf = await getTeamCommission(
                            '80',
                            targetYear,
                            calculateVendorDataForPdf,
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
                    throw createPdfRouteError('Error generando PDF', pdfError);
                }

                return {
                    pdfBuffer,
                    vendorCount: vendorData.length,
                    fileName: `comisiones_${targetYear}_${startMonth}-${endMonth}.pdf`,
                    generatedAt: new Date().toISOString(),
                };
            }, { skipCache: skipPdfCache });
        } catch (pdfError) {
            const statusCode = pdfError.statusCode || 500;
            logger.error(`[PDF] Request failed: ${pdfError.message}`);
            return res.status(statusCode).json({
                success: false,
                error: pdfError.publicError || 'Error generando PDF',
                details: pdfError.message
            });
        }

        const { pdfBuffer, fileName, vendorCount, fromCache } = pdfPayload;
        if (!pdfBuffer?.length) {
            logger.error('[PDF] Empty PDF payload after generation/cache');
            return res.status(500).json({
                success: false,
                error: 'Error generando PDF',
                details: 'El PDF generado esta vacio'
            });
        }

        // Send PDF with proper headers
        try {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
            res.setHeader('Content-Length', pdfBuffer.length);
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.send(pdfBuffer);

            logger.info(`[PDF] PDF sent successfully for DIEGO (${vendorCount} vendors${fromCache ? ', cached' : ''})`);
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
router.get('/team/:leaderCode', verifyToken, validateQuery(teamQuerySchema), async (req, res) => {
    try {
        const leaderCode = (req.params.leaderCode || '').replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
        const year = parseInt(req.query.year, 10) || new Date().getFullYear();
        if (!leaderCode || !isTeamLeader(leaderCode)) {
            return res.status(400).json({ success: false, error: 'Lider de equipo no valido' });
        }
        // ASVS V8 / BOLA (H-02): solo el lider propietario o un rol financiero.
        const actorCode = String(req.user?.code || '').replace(/^0+/, '');
        if (actorCode !== leaderCode.replace(/^0+/, '') && !isFinancialRole(req.user)) {
            logger.warn(`[COMMISSIONS] Forbidden team access: user=${req.user?.code || 'unknown'} leader=${leaderCode}`);
            return res.status(403).json({ success: false, error: 'Forbidden: equipo fuera de tu alcance' });
        }
        await ensureExcludedVendorsLoaded();
        const config = await loadCommissionConfig(year);
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
        const excludedVendors = getExcludedVendors();
        logger.debug(`[COMMISSIONS] /excluded-vendors returning: [${excludedVendors.join(', ')}]`);
        res.json({ success: true, excludedVendors });
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
        calculateWorkingDays,
        getCurrentPaymentSnapshot,
        getCachedPaymentSnapshot,
        getMonthPaymentSnapshotFromDb,
        getVendorPayments,
        invalidateCommissionPaymentCaches,
        loadCommissionConfig,
        buildPdfSummaryVendors,
        loadCommissionConfigForPdf,
        buildPdfGenerationCacheKey,
        decodePdfPayload,
        setCachedPdfPayload,
        getOrGeneratePdfPayload,
    },
};
