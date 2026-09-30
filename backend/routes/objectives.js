const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireVendorQueryScope, resolveVendorScope, normalizeCode } = require('../middleware/vendor-scope');
const logger = require('../middleware/logger');
const { queryWithParams } = require('../middleware/db-timing');
const {
    getCurrentDate,
    MIN_YEAR,
    LACLAE_SALES_FILTER,
    lookupClientAssignedVendorCodes,
    sanitizeForSQL,
    handleRouteError
} = require('../utils/common');
const { getClientCodesFromCache } = require('../services/laclae');
const { comercialErpTable } = require('../utils/comercial-erp-tables');
const { redisCache } = require('../services/redis-cache');
const { isCacheBypassRequest } = require('../middleware/http-cache');
const { beginRouteFill, endRouteFill, sendFillBusy } = require('../services/route-cache-stampede');
const {
    applyHybridMonthlyObjectives,
    computeSeasonalWeightTargets,
    getAnnualObjectiveAdjustment,
    sumMonthlyObjectives,
} = require('./objectives-hybrid-helpers');
const objectivesService = require('../services/objectives-service');
// Reglas leaf movidas al service (misma identidad de funcion); los bloques
// pinnados por tests de arquitectura y la orquestacion siguen en este fichero.
const {
    clampByClientLimit,
    chunkArray,
    mapChunksWithConcurrency,
    getVendorCurrentClients,
    getClientsMonthlySales,
    getVendorTargetConfig,
    parseVendorCodes,
    scopeVendorCodesForUser,
    addBSalesToRows,
    aggregateObjectiveRows,
    getExactMonthlyTargets,
    getGlobalPinnedMonthlyTargets,
    getScopedPinnedMonthlyTargets,
    applyConfiguredObjectiveRebalances,
    getObjectivesSummary,
    // Tanda 2 (DIP): queries de matrix/populations/by-client en service+repo.
    getMatrixContactAndNotes,
    getMatrixProductRows,
    getMatrixFamilyAndFiNames,
    getPopulations,
    buildByClientPayload,
} = objectivesService;
// (metadataCache + assertIdentifier + buildMonthFilterParameterized viven en
// services/objectives-service.js + repositories/objectives-repository.js.)
const { CircuitBreaker } = require('../services/circuit-breaker');

const OBJECTIVES_CACHE_VERSION = 'v20260921-live-all-months';
const { historicalYearsCacheMeta } = require('../src/services/dashboard.service.js');

function byClientHistoricalCache(effectiveVendorCodes, years, months, rowsLimit, now) {
    const yearsArray = years
        ? String(years).split(',').map((token) => parseInt(token.trim(), 10)).filter((year) => year >= MIN_YEAR)
        : [now.getFullYear()];
    const meta = historicalYearsCacheMeta(yearsArray, now);
    return {
        key: `obj:byclient:${OBJECTIVES_CACHE_VERSION}:${effectiveVendorCodes || 'ALL'}:${years || 'default'}:${months || 'all'}:${rowsLimit}:${meta.bucket}`,
        ttl: meta.ttl,
    };
}
const objectivesByClientBreaker = new CircuitBreaker({
    name: 'objectives-by-client',
    failureThreshold: 2,
    successThreshold: 1,
    timeout: 35000
});
const BY_CLIENT_DEFAULT_LIMIT = 100;
const BY_CLIENT_MAX_LIMIT = 250;

// (Implementacion movida a services/objectives-service.js: clampByClientLimit,
// chunkArray, mapChunksWithConcurrency. Las cotas quedan pinnadas aqui por
// contrato de ruta: objectives_by_client_contracts.)

// =============================================================================
// INHERITED OBJECTIVES LOGIC
// For new vendors who don't have full history, we calculate objectives based
// on the sales of previous vendors who managed their current clients.
// =============================================================================

// (Movidos a services/objectives-service.js: getVendorCurrentClients,
// getClientsMonthlySales.)


// (Movidos a services/objectives-service.js: SEASONAL_AGGRESSIVENESS, IPC,
// MONTH_QUOTA_MAP, getVendorTargetConfig, getVendorCodeVariants,
// parseVendorCodes, scopeVendorCodesForUser, addBSalesToRows,
// aggregateObjectiveRows.)

async function fetchObjectiveEvolutionRowsByClientScope(vendorCode, uniqueYears) {
    const normalizedVendor = String(vendorCode || '').trim().toUpperCase();
    if (!normalizedVendor || normalizedVendor === 'UNK' || normalizedVendor.length > 2) return null;
    const cachedClientCodes = getClientCodesFromCache(vendorCode);
    if (!Array.isArray(cachedClientCodes) || cachedClientCodes.length === 0) return null;

    const safeClientCodes = [...new Set(
        cachedClientCodes
            .map(code => sanitizeForSQL(code))
            .filter(Boolean)
    )].sort();
    const maxCodes = Math.max(1, Math.min(parseInt(process.env.COMMISSION_CLIENT_SCOPE_MAX_CODES || '5000', 10), 5000));
    if (safeClientCodes.length === 0 || safeClientCodes.length > maxCodes) return null;

    const yearPlaceholders = uniqueYears.map(() => '?').join(',');
    const chunkSize = 250;
    const chunks = chunkArray(safeClientCodes, chunkSize);
    const chunkRows = await mapChunksWithConcurrency(chunks, 3, (chunk) => {
        const clientPlaceholders = chunk.map(() => '?').join(',');
        return queryWithParams(`
            SELECT
                L.LCAADC as YEAR,
                L.LCMMDC as MONTH,
                SUM(L.LCIMVT) as SALES,
                SUM(L.LCIMCT) as COST,
                COUNT(DISTINCT L.LCCDCL) as CLIENTS
            FROM ${comercialErpTable('LACLAE')} L
            WHERE L.LCAADC IN (${yearPlaceholders})
              AND ${LACLAE_SALES_FILTER}
              AND L.LCCDCL IN (${clientPlaceholders})
            GROUP BY L.LCAADC, L.LCMMDC
        `, [...uniqueYears, ...chunk], false);
    });

    return aggregateObjectiveRows(chunkRows.flat());
}

// (Movido a services/objectives-service.js: getFixedMonthlyObjectiveTarget.)

// (Movidos a services/objectives-service.js: getExactMonthlyTargets,
// getGlobalPinnedMonthlyTargets, getScopedPinnedMonthlyTargets,
// getFixedMonthlyObjectiveTargets.)

// (Movidos a services/objectives-service.js:
// getGlobalObjectiveBaselineMonthly,
// buildObjectiveRebalanceAllocationFactors,
// applyConfiguredObjectiveRebalances.)

// (Movidos a services/objectives-service.js: buildVendorObjectiveTargets,
// mergeVendorObjectiveTargets.)

function evolutionRowYear(row) {
    return parseInt(row?.YEAR ?? row?.year, 10);
}

function evolutionRowMonth(row) {
    return parseInt(row?.MONTH ?? row?.month, 10);
}

/**
 * Refresh the open month from the same live ERP source used by Panel.
 * Kept for callers that explicitly refresh a monthly result.
 * Optional vendorCodes: when empty/absent → ALL vendors (no VENDEDOR='ALL').
 */
async function overlayOpenMonthFromLiveLaclae(rows, now = getCurrentDate(), vendorCodes = null) {
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const safeVendorCodes = Array.isArray(vendorCodes)
        ? [...new Set(vendorCodes.map((c) => sanitizeForSQL(c).trim().toUpperCase()).filter((c) => c && c.length <= 2))]
        : [];
    let live;
    if (safeVendorCodes.length === 0) {
        live = await queryWithParams(`
            SELECT
                L.LCAADC as YEAR,
                L.LCMMDC as MONTH,
                SUM(L.LCIMVT) as SALES,
                SUM(L.LCIMCT) as COST,
                COUNT(DISTINCT L.LCCDCL) as CLIENTS
            FROM ${comercialErpTable('LACLAE')} L
            WHERE L.LCAADC = ?
              AND L.LCMMDC = ?
              AND ${LACLAE_SALES_FILTER}
            GROUP BY L.LCAADC, L.LCMMDC
        `, [year, month]);
    } else {
        const vendorPlaceholders = safeVendorCodes.map(() => '?').join(',');
        live = await queryWithParams(`
            SELECT
                L.LCAADC as YEAR,
                L.LCMMDC as MONTH,
                SUM(L.LCIMVT) as SALES,
                SUM(L.LCIMCT) as COST,
                COUNT(DISTINCT L.LCCDCL) as CLIENTS
            FROM ${comercialErpTable('LACLAE')} L
            WHERE L.LCAADC = ?
              AND L.LCMMDC = ?
              AND ${LACLAE_SALES_FILTER}
              AND ((L.LCMMDC < 3 AND TRIM(L.LCCDVD) IN (${vendorPlaceholders}))
                OR (L.LCMMDC >= 3 AND TRIM(L.R1_T8CDVD) IN (${vendorPlaceholders})))
            GROUP BY L.LCAADC, L.LCMMDC
        `, [year, month, ...safeVendorCodes, ...safeVendorCodes]);
    }
    const liveRow = live?.[0];
    if (!liveRow) return rows || [];

    const patched = {
        YEAR: year,
        MONTH: month,
        SALES: parseFloat(liveRow.SALES ?? liveRow.sales) || 0,
        COST: parseFloat(liveRow.COST ?? liveRow.cost) || 0,
        CLIENTS: parseInt(liveRow.CLIENTS ?? liveRow.clients, 10) || 0,
    };
    const next = Array.isArray(rows) ? rows.slice() : [];
    const idx = next.findIndex((row) => evolutionRowYear(row) === year && evolutionRowMonth(row) === month);
    if (idx >= 0) {
        next[idx] = { ...next[idx], ...patched };
    } else {
        next.push(patched);
    }
    return next;
}

async function fetchObjectiveEvolutionRows(effectiveVendorCodes, vendorCodesArray, uniqueYears, options = {}) {
    const forceRefresh = options.forceRefresh === true;
    const now = options.now || getCurrentDate();
    const yearPlaceholders = uniqueYears.map(() => '?').join(',');
    const safeVendorCodes = [...new Set((vendorCodesArray || [])
        .map(code => sanitizeForSQL(code).trim().toUpperCase())
        .filter(code => code !== 'UNK' && code.length <= 2)
        .filter(Boolean))];

    if (!effectiveVendorCodes || effectiveVendorCodes === 'ALL') {
        const rowsKey = `obj:evolution:rows:${OBJECTIVES_CACHE_VERSION}:ALL:${uniqueYears.join(',')}`;
        if (!forceRefresh) {
            const cachedRows = await redisCache.get('route', rowsKey);
            if (cachedRows) return cachedRows;
        }
        const liveRows = await queryWithParams(`
                SELECT
                    L.LCAADC as YEAR,
                    L.LCMMDC as MONTH,
                    SUM(L.LCIMVT) as SALES,
                    SUM(L.LCIMCT) as COST,
                    COUNT(DISTINCT L.LCCDCL) as CLIENTS
                FROM ${comercialErpTable('LACLAE')} L
                WHERE L.LCAADC IN (${yearPlaceholders})
                  AND ${LACLAE_SALES_FILTER}
                GROUP BY L.LCAADC, L.LCMMDC
                ORDER BY YEAR, MONTH
            `, uniqueYears);
        const rows = await overlayOpenMonthFromLiveLaclae(liveRows, now, null);
        await redisCache.set('route', rowsKey, rows, 600).catch(() => {});
        return rows;
    }

    if (safeVendorCodes.length === 0) {
        logger.warn(`[OBJECTIVES] Ignoring evolution request with no valid vendor codes: ${effectiveVendorCodes}`);
        return [];
    }

    if (safeVendorCodes.length === 1) {
        const clientScopeRows = await fetchObjectiveEvolutionRowsByClientScope(safeVendorCodes[0], uniqueYears);
        if (clientScopeRows) return clientScopeRows;
    }

    const rowsKey = `obj:evolution:rows:${OBJECTIVES_CACHE_VERSION}:${safeVendorCodes.slice().sort().join(',')}:${uniqueYears.join(',')}`;
    if (!forceRefresh) {
        const cachedRows = await redisCache.get('route', rowsKey);
        if (cachedRows) return cachedRows;
    }

    // scoped aggregate query avoids per-vendor LACLAE scans for multi-vendor scopes.
    const vendorPlaceholders = safeVendorCodes.map(() => '?').join(',');
    const liveRows = await queryWithParams(`
            SELECT L.LCAADC as YEAR, L.LCMMDC as MONTH,
                   SUM(L.LCIMVT) as SALES, SUM(L.LCIMCT) as COST,
                   COUNT(DISTINCT L.LCCDCL) as CLIENTS
              FROM ${comercialErpTable('LACLAE')} L
             WHERE L.LCAADC IN (${yearPlaceholders})
               AND ${LACLAE_SALES_FILTER}
               AND ((L.LCMMDC < 3 AND TRIM(L.LCCDVD) IN (${vendorPlaceholders}))
                 OR (L.LCMMDC >= 3 AND TRIM(L.R1_T8CDVD) IN (${vendorPlaceholders})))
             GROUP BY L.LCAADC, L.LCMMDC
             ORDER BY YEAR, MONTH
        `, [...uniqueYears, ...safeVendorCodes, ...safeVendorCodes]);
    const rows = await overlayOpenMonthFromLiveLaclae(liveRows, now, safeVendorCodes);
    await redisCache.set('route', rowsKey, rows, 600).catch(() => {});
    return rows;
}

// =============================================================================
// OBJECTIVES SUMMARY (Quota vs Actual)
// =============================================================================
router.get('/', verifyToken, requireVendorQueryScope, async (req, res) => {
    try {
        const { vendedorCodes, year, month } = req.query;
        res.json(await getObjectivesSummary({ vendedorCodes, year, month }));

    } catch (error) {
        handleRouteError(error, res, 'Error obteniendo objetivos', 500, { code: 'OBJECTIVES_LIST_ERROR' });
    }
});

function buildEvolutionRouteCacheKey(effectiveVendorCodes, years, now = getCurrentDate()) {
    const yearsArrayPreview = years
        ? String(years).split(',').map((token) => parseInt(token.trim(), 10)).filter((year) => year >= MIN_YEAR)
        : [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];
    const evolutionMeta = historicalYearsCacheMeta(yearsArrayPreview, now);
    return {
        key: `obj:evolution:${OBJECTIVES_CACHE_VERSION}:${effectiveVendorCodes || 'ALL'}:${years || 'default'}:${evolutionMeta.bucket}`,
        ttl: evolutionMeta.ttl,
        yearsArray: yearsArrayPreview,
        bucket: evolutionMeta.bucket,
    };
}

// =============================================================================
// OBJECTIVES EVOLUTION
// =============================================================================
async function buildObjectivesEvolutionResponse({ effectiveVendorCodes, yearsArray, forceRefresh, now }) {
    const { calculateWorkingDays, calculateDaysPassed } = require('../utils/common');
    const { getVendorActiveDaysFromCache } = require('../services/laclae');


        // Include previous years for dynamic objective calculation
        const allYears = [...yearsArray, ...yearsArray.map(y => y - 1)];
        const uniqueYears = [...new Set(allYears)];
        const vendorCodesArray = parseVendorCodes(effectiveVendorCodes);

        // Get Active Days for calculating pace
        // Logic: if multiple vendors selected, we might average or select first?
        // User is usually viewing ONE vendor or ALL.
        // If ALL, standard days. If specific, specific days.
        let activeWeekDays = [];
        if (vendorCodesArray.length === 1) {
            const firstCode = vendorCodesArray[0];
            const rawDays = getVendorActiveDaysFromCache(firstCode);
            if (rawDays) {
                const dayMap = {
                    'lunes': 'VIS_L', 'martes': 'VIS_M', 'miercoles': 'VIS_X',
                    'jueves': 'VIS_J', 'viernes': 'VIS_V', 'sabado': 'VIS_S', 'domingo': 'VIS_D'
                };
                activeWeekDays = rawDays.map(d => dayMap[d]).filter(d => d);
            }
        }

        // Single optimized query - get monthly totals per year
        // Using DSED.LACLAE with LCIMVT for sales WITHOUT VAT (matches 15,220,182.87€ for 2025)
        const rows = await fetchObjectiveEvolutionRows(
            effectiveVendorCodes,
            vendorCodesArray,
            uniqueYears,
            { forceRefresh, now },
        );

        // =====================================================================
        // B-SALES: Add secondary channel sales from JAVIER.VENTAS_B
        // Ensures consistency with commissions endpoint
        // =====================================================================
        await addBSalesToRows(rows, vendorCodesArray, uniqueYears);

        // Organize by year
        const yearlyData = {};
        const yearTotals = {};

        // =====================================================================
        // INHERITED OBJECTIVES: Pre-load inherited sales for new vendors
        // =====================================================================
        // For vendors with incomplete history (some months with 0 sales in prevYear),
        // we calculate the target based on sales of their current clients by ANY vendor.
        let inheritedMonthlySales = {};
        const isAll = !effectiveVendorCodes || effectiveVendorCodes === 'ALL';

        // Multi-vendor evolution is intentionally calculated from the scoped aggregate
        // query above. Building targets per vendor triggered N+1 full LACLAE scans and
        // saturated DB2 under jefe/commercial-team dashboards.
        const multiVendorTargets = null;

        if (!isAll && vendorCodesArray.length === 1) {
            // Check if vendor has any months without data in previous year (for current year objectives)
            const currentYear = Math.max(...yearsArray);
            const prevYear = currentYear - 1;

            const monthsWithData = rows.filter((r) => Number(r.YEAR) === prevYear).map((r) => r.MONTH);
            const missingMonths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter(m => !monthsWithData.includes(m));

            if (missingMonths.length > 0) {
                // Vendor is "new" or has incomplete history - load inherited sales
                logger.info(`[OBJECTIVES] Vendor ${effectiveVendorCodes} has ${missingMonths.length} months without data: [${missingMonths.join(',')}]. Loading inherited targets...`);

                const firstCode = vendorCodesArray[0];
                const currentClients = await getVendorCurrentClients(firstCode, currentYear);
                if (currentClients.length > 0) {
                    inheritedMonthlySales = await getClientsMonthlySales(currentClients, prevYear);
                    logger.info(`[OBJECTIVES] Found ${currentClients.length} clients. Loaded inherited sales for ${Object.keys(inheritedMonthlySales).length} months.`);
                }
            }
        }

        // ==========================================================================
        // FIXED TARGETS from COMMERCIAL_TARGETS
        // - Single vendor: exact month rows → hybrid per commercial
        // - JEFE ALL: months with 2+ vendors (global May 1.41M) → hybrid on aggregate
        // - Multi-vendor scope (e.g. 80 team): sum pinned months in scope
        // ==========================================================================
        const fixedTargetsByYear = {};
        if (vendorCodesArray.length === 1) {
            const firstCode = vendorCodesArray[0];
            // One COMMERCIAL_TARGETS lookup per year — independent, fetch in parallel.
            const targetsByYear = await Promise.all(
                yearsArray.map(year => getExactMonthlyTargets(firstCode, year))
            );
            yearsArray.forEach((year, index) => {
                fixedTargetsByYear[year] = targetsByYear[index];
            });
            if (Object.values(fixedTargetsByYear).some(targets => Object.keys(targets).length > 0)) {
                logger.info(`[OBJECTIVES] Vendor ${firstCode} has fixed monthly targets in COMMERCIAL_TARGETS`);
            }
        } else if (isAll) {
            const targetsByYear = await Promise.all(
                yearsArray.map(year => getGlobalPinnedMonthlyTargets(year))
            );
            yearsArray.forEach((year, index) => {
                const targets = targetsByYear[index];
                if (Object.keys(targets).length > 0) {
                    fixedTargetsByYear[year] = targets;
                }
            });
            if (Object.keys(fixedTargetsByYear).length > 0) {
                logger.info('[OBJECTIVES] JEFE ALL: loaded global pinned months from COMMERCIAL_TARGETS');
            }
        } else if (vendorCodesArray.length > 1) {
            const targetsByYear = await Promise.all(
                yearsArray.map(year => getScopedPinnedMonthlyTargets(year, vendorCodesArray))
            );
            yearsArray.forEach((year, index) => {
                const targets = targetsByYear[index];
                if (Object.keys(targets).length > 0) {
                    fixedTargetsByYear[year] = targets;
                }
            });
        }

        // 1. Get Target Config
        const targetPct = await getVendorTargetConfig(
            vendorCodesArray.length > 1 ? 'ALL' : effectiveVendorCodes
        );

        for (const year of yearsArray) {
            // Calculate Annual Objective first
            let prevYearTotal = 0;
            let inheritedTotal = 0;
            let currentYearTotalSoFar = 0;

            // Collect Previous Year Data for Seasonality Calculation
            const prevYearMonthlySales = {};

            for (let m = 1; m <= 12; m++) {
                const row = rows.find((r) => Number(r.YEAR) === year && Number(r.MONTH) === m);
                const prevRow = rows.find((r) => Number(r.YEAR) === (year - 1) && Number(r.MONTH) === m);

                const ownPrevSales = prevRow ? parseFloat(prevRow.SALES) || 0 : 0;

                // Use inherited sales when vendor has no own sales for this month
                if (ownPrevSales === 0 && inheritedMonthlySales[m]) {
                    inheritedTotal += inheritedMonthlySales[m].sales;
                    prevYearMonthlySales[m] = inheritedMonthlySales[m].sales;
                } else {
                    prevYearTotal += ownPrevSales;
                    prevYearMonthlySales[m] = ownPrevSales;
                }

                if (row) currentYearTotalSoFar += parseFloat(row.SALES) || 0;
            }

            // Combined: own sales + inherited sales from clients
            const combinedPrevTotal = prevYearTotal + inheritedTotal;

            // FIXED TARGET OVERRIDE: Use fixed target if available, otherwise calculate from previous year
            let annualObjective;

            const fixedTargetsForYear = fixedTargetsByYear[year] || {};
            const hasFixedTargetsForYear = Object.keys(fixedTargetsForYear).length > 0;

            let seasonalTargets = {};

            if (multiVendorTargets) {
                annualObjective = multiVendorTargets.annualObjectiveByYear[year] || 0;
            } else if (hasFixedTargetsForYear && combinedPrevTotal > 0) {
                // Hybrid: pinned months (e.g. May 1.41M) + remainder on other months.
                // JEFE ALL applies the 2026 -100k general cut; single-vendor pins do not.
                const annualAdjustment = isAll ? getAnnualObjectiveAdjustment(year) : 0;
                const hybrid = applyHybridMonthlyObjectives(
                    prevYearMonthlySales,
                    combinedPrevTotal,
                    targetPct,
                    fixedTargetsForYear,
                    { annualAdjustment },
                );
                seasonalTargets = hybrid.monthly;
                annualObjective = hybrid.annual;
            } else {
                const growthFactor = 1 + (targetPct / 100);
                let rawAnnual = combinedPrevTotal > 0
                    ? combinedPrevTotal * growthFactor
                    : (currentYearTotalSoFar > 0 ? currentYearTotalSoFar * growthFactor : 0);
                if (isAll) {
                    rawAnnual = Math.max(0, rawAnnual + getAnnualObjectiveAdjustment(year));
                }
                annualObjective = rawAnnual;
            }

            // Seasonal weights (skipped when hybrid/multi already set seasonalTargets)
            if (combinedPrevTotal > 0 && Object.keys(seasonalTargets).length === 0) {
                seasonalTargets = computeSeasonalWeightTargets(
                    prevYearMonthlySales,
                    combinedPrevTotal,
                    targetPct,
                );
                if (!multiVendorTargets && !hasFixedTargetsForYear) {
                    let seasonalAnnual = Object.values(seasonalTargets).reduce((s, v) => s + v, 0);
                    if (isAll) {
                        const annualAdjustment = getAnnualObjectiveAdjustment(year);
                        if (annualAdjustment && seasonalAnnual > 0) {
                            const targetAnnual = Math.max(0, seasonalAnnual + annualAdjustment);
                            const factor = targetAnnual / seasonalAnnual;
                            for (let m = 1; m <= 12; m++) {
                                seasonalTargets[m] = (seasonalTargets[m] || 0) * factor;
                            }
                            seasonalAnnual = targetAnnual;
                        }
                    }
                    annualObjective = seasonalAnnual;
                }
            }

            if (!multiVendorTargets && Object.keys(seasonalTargets).length > 0) {
                const allocationVendorCode = vendorCodesArray.length === 1 ? vendorCodesArray[0] : null;
                seasonalTargets = await applyConfiguredObjectiveRebalances(
                    year,
                    seasonalTargets,
                    allocationVendorCode,
                );
                annualObjective = sumMonthlyObjectives(seasonalTargets);
            }

            yearlyData[year] = [];

            for (let m = 1; m <= 12; m++) {
                const row = rows.find((r) => Number(r.YEAR) === year && Number(r.MONTH) === m);

                const sales = row ? parseFloat(row.SALES) || 0 : 0;
                const cost = row ? parseFloat(row.COST) || 0 : 0;
                const clients = row ? parseInt(row.CLIENTS, 10) || 0 : 0;

                // SEASONAL OBJECTIVE with INHERITED support:
                let seasonalObjective = 0;

                if (multiVendorTargets) {
                    seasonalObjective = multiVendorTargets.monthlyObjectiveByYear[year]?.[m] || 0;
                    if (!seasonalObjective && combinedPrevTotal > 0) {
                        seasonalObjective = seasonalTargets[m]
                            || (prevYearMonthlySales[m] * (1 + targetPct / 100))
                            || 0;
                    }
                } else if (seasonalTargets[m] > 0) {
                    seasonalObjective = seasonalTargets[m];
                } else if (combinedPrevTotal > 0) {
                    // Use calculated seasonal target (Dynamic)
                    seasonalObjective = seasonalTargets[m] || (prevYearMonthlySales[m] * 1.10);
                } else if (annualObjective > 0) {
                    // No history at all. Fallback to linear.
                    seasonalObjective = annualObjective / 12;
                }

                // --- WORKING DAYS & PACING ---
                const totalWorkingDays = calculateWorkingDays(year, m, activeWeekDays);
                const daysPassed = calculateDaysPassed(year, m, activeWeekDays);

                yearlyData[year].push({
                    month: m,
                    sales,
                    cost,
                    margin: sales - cost,
                    clients,
                    objective: seasonalObjective,
                    workingDays: totalWorkingDays,
                    daysPassed
                });
            }

            const data = yearlyData[year];
            yearTotals[year] = {
                totalSales: data.reduce((sum, m) => sum + m.sales, 0),
                totalCost: data.reduce((sum, m) => sum + m.cost, 0),
                totalMargin: data.reduce((sum, m) => sum + m.margin, 0),
                annualObjective
            };
        }

        const responseData = {
            years: yearsArray,
            yearlyData,
            yearTotals,
            monthNames: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
        };

    return responseData;
}

async function getObjectivesEvolutionCached({ effectiveVendorCodes, years, forceRefresh = false, now = getCurrentDate() }) {
    const cache = buildEvolutionRouteCacheKey(effectiveVendorCodes, years, now);
    if (!forceRefresh) {
        const cached = await redisCache.get('route', cache.key);
        if (cached) return { kind: 'data', data: cached };
    }
    const stampede = await beginRouteFill(cache.key);
    if (!forceRefresh && stampede.hit) return { kind: 'data', data: stampede.hit };
    if (!forceRefresh && stampede.busy) return { kind: 'busy' };
    try {
        const data = await buildObjectivesEvolutionResponse({
            effectiveVendorCodes, yearsArray: cache.yearsArray, forceRefresh, now,
        });
        await redisCache.set('route', cache.key, data, cache.ttl);
        return { kind: 'data', data };
    } finally {
        await endRouteFill(cache.key, stampede.lock);
    }
}

router.get('/evolution', verifyToken, requireVendorQueryScope, async (req, res) => {
    try {
        const result = await getObjectivesEvolutionCached({
            effectiveVendorCodes: scopeVendorCodesForUser(req.user?.code, req.query.vendedorCodes),
            years: req.query.years,
            forceRefresh: isCacheBypassRequest(req),
        });
        if (result.kind === 'busy') return sendFillBusy(res);
        return res.json(result.data);
    } catch (error) {
        handleRouteError(error, res, 'Error obteniendo evolución de objetivos', 500, { code: 'OBJECTIVES_EVOLUTION_ERROR' });
    }
});

// =============================================================================
// OBJECTIVES MATRIX
// =============================================================================
router.get('/matrix', verifyToken, requireVendorQueryScope, async (req, res) => {
    try {
        const {
            clientCode, years, startMonth = '1', endMonth = '12',
            productCode, productName, familyCode, subfamilyCode,
            // NEW: FI filters
            fi1, fi2, fi3, fi4, fi5,
        } = req.query;

        if (!clientCode) {
            return res.status(400).json({ error: 'clientCode is required' });
        }

        // Authorize the client before reading contact details, notes or sales.
        // requireVendorQueryScope has already restricted the requested vendors.
        const clientScope = scopeVendorCodesForUser(req.user?.code, req.query.vendedorCodes);
        const resolvedScope = resolveVendorScope(req.user, clientScope);
        const signedVisible = [...(req.user?.vendorCodes || []), ...(req.user?.vendedorCodes || [])];
        if (!resolvedScope.ok || (resolvedScope.literalAll && signedVisible.length === 0)) {
            return res.status(403).json({ success: false, code: 'FORBIDDEN_CLIENT_VENDOR', error: 'Alcance comercial no disponible' });
        }
        if (!resolvedScope.literalAll) {
            const visible = resolvedScope.codes.map(normalizeCode);
            const assigned = await lookupClientAssignedVendorCodes(clientCode, visible);
            if (!visible.length || !assigned.some(code => visible.includes(normalizeCode(code)))) {
                return res.status(403).json({ success: false, code: 'FORBIDDEN_CLIENT_VENDOR', error: 'Cliente fuera del alcance comercial' });
            }
        }

        // Parse years and range
        const yearsArray = years ? years.split(',').map((y) => parseInt(y.trim(), 10)).filter((y) => y >= 2015) : [new Date().getFullYear()];
        const monthStart = parseInt(startMonth, 10);
        const monthEnd = parseInt(endMonth, 10);

        // Determine years to fetch (include previous year for YoY if needed)
        const allYearsToFetch = new Set(yearsArray);
        yearsArray.forEach((y) => allYearsToFetch.add(y - 1));
        const uniqueYears = Array.from(allYearsToFetch);

        // --- NEW: Client Contact & Observations (service+repo; queries verbatim) ---
        const { contactInfo, editableNotes } = await getMatrixContactAndNotes(clientCode);
        // -------------------------------------------

        let filterConditions = '';
        const filterParams = [];
        if (productCode && productCode.trim()) {
            const safeProdCode = `%${sanitizeForSQL(productCode.trim()).toUpperCase()}%`;
            filterConditions += ` AND UPPER(L.LCCDRF) LIKE ?`;
            filterParams.push(safeProdCode);
        }
        if (productName && productName.trim()) {
            const safeProdName = `%${sanitizeForSQL(productName.trim()).toUpperCase()}%`;
            filterConditions += ` AND (UPPER(A.DESCRIPCIONARTICULO) LIKE ? OR UPPER(L.LCDESC) LIKE ?)`;
            filterParams.push(safeProdName, safeProdName);
        }
        if (familyCode && familyCode.trim()) {
            filterConditions += ` AND A.CODIGOFAMILIA = ?`;
            filterParams.push(familyCode.trim());
        }
        if (subfamilyCode && subfamilyCode.trim()) {
            filterConditions += ` AND A.CODIGOSUBFAMILIA = ?`;
            filterParams.push(subfamilyCode.trim());
        }

        if (fi1 && fi1.trim()) {
            filterConditions += ` AND TRIM(AX.FILTRO01) = ?`;
            filterParams.push(fi1.trim());
        }
        if (fi2 && fi2.trim()) {
            filterConditions += ` AND TRIM(AX.FILTRO02) = ?`;
            filterParams.push(fi2.trim());
        }
        if (fi3 && fi3.trim()) {
            filterConditions += ` AND TRIM(AX.FILTRO03) = ?`;
            filterParams.push(fi3.trim());
        }
        if (fi4 && fi4.trim()) {
            filterConditions += ` AND TRIM(AX.FILTRO04) = ?`;
            filterParams.push(fi4.trim());
        }
        if (fi5 && fi5.trim()) {
            filterConditions += ` AND TRIM(A.CODIGOSECCIONLARGA) = ?`;
            filterParams.push(fi5.trim());
        }

        // Get product purchases for this client - USING DSED.LACLAE (which has data for all clients including PUA)
        // Query verbatim en services/objectives-service.js + repositories/objectives-repository.js.
        const rows = await getMatrixProductRows(clientCode, uniqueYears, monthStart, monthEnd, filterConditions, filterParams);

        // Get family names and available filters properly
        const familyNames = {};
        const subfamilyNames = {};

        // Logic to build distinct filter lists based on ACTUAL data found
        const availableFamiliesMap = new Map();
        const availableSubfamiliesMap = new Map();
        // FI filter maps for all 5 levels
        const availableFi1Map = new Map();
        const availableFi2Map = new Map();
        const availableFi3Map = new Map();
        const availableFi4Map = new Map();
        const availableFi5Map = new Map();

        // Load FI descriptions for all levels (service+repo; cache o fallback DB verbatim).
        const matrixNames = await getMatrixFamilyAndFiNames();
        Object.assign(familyNames, matrixNames.familyNames || {});
        const fi1Names = matrixNames.fi1Names || {};
        const fi2Names = matrixNames.fi2Names || {};
        const fi3Names = matrixNames.fi3Names || {};
        const fi4Names = matrixNames.fi4Names || {};
        const fi5Names = matrixNames.fi5Names || {};

        // Build hierarchy: Family -> Subfamily -> Product (legacy)
        const familyMap = new Map();

        // NEW: Build 5-level FI hierarchy: FI1 -> FI2 -> FI3 -> FI4 -> Products
        const fiHierarchyMap = new Map();

        let grandTotalSales = 0, grandTotalCost = 0, grandTotalUnits = 0;
        let grandTotalPrevSales = 0, grandTotalPrevCost = 0, grandTotalPrevUnits = 0;
        const productSet = new Set();
        const prevProductSet = new Set(); // Products from previous year
        const createYearStats = () => {
            const stats = {};
            yearsArray.forEach(year => {
                stats[year] = { sales: 0, cost: 0, units: 0 };
            });
            return stats;
        };
        const grandTotalsByYear = createYearStats();
        const productSetsByYear = {};
        yearsArray.forEach(year => { productSetsByYear[year] = new Set(); });

        // Monthly YoY Calculation
        const monthlyStats = new Map();
        for (let m = 1; m <= 12; m++) monthlyStats.set(m, { currentSales: 0, prevSales: 0, currentUnits: 0, byYear: createYearStats() });

        const isSelectedYear = (y) => yearsArray.includes(y);
        const isPrevYear = (y) => yearsArray.some(selected => selected - 1 === y);
        const round2 = (value) => parseFloat((value || 0).toFixed(2));
        const round1 = (value) => parseFloat((value || 0).toFixed(1));
        const addToYearStats = (stats, year, sales, cost, units) => {
            if (!isSelectedYear(year)) return;
            if (!stats[year]) stats[year] = { sales: 0, cost: 0, units: 0 };
            stats[year].sales += sales;
            stats[year].cost += cost;
            stats[year].units += units;
        };
        const formatYearStats = (stats, productSets = null) => {
            const output = {};
            yearsArray.forEach(year => {
                const data = stats?.[year] || { sales: 0, cost: 0, units: 0 };
                const margin = (data.sales || 0) - (data.cost || 0);
                output[year] = {
                    sales: round2(data.sales),
                    cost: round2(data.cost),
                    units: round2(data.units),
                    margin: round2(margin),
                    marginPercent: data.sales > 0 ? round1((margin / data.sales) * 100) : 0,
                    avgUnitPrice: data.units > 0 ? round2(data.sales / data.units) : 0,
                    avgUnitCost: data.units > 0 ? round2(data.cost / data.units) : 0,
                    marginPerUnit: data.units > 0 ? round2(margin / data.units) : 0
                };
                if (productSets?.[year]) output[year].productCount = productSets[year].size;
            });
            return output;
        };
        const formatByYearFromMonthly = (monthlyData) => {
            const stats = createYearStats();
            Object.keys(monthlyData || {}).forEach((yearStr) => {
                const year = parseInt(yearStr, 10);
                if (!isSelectedYear(year)) return;
                Object.values(monthlyData[yearStr] || {}).forEach(mData => {
                    addToYearStats(stats, year, mData.sales || 0, mData.cost || 0, mData.units || 0);
                });
            });
            return formatYearStats(stats);
        };

        const sortedYearsDesc = [...yearsArray].sort((a, b) => b - a);
        const referenceYear = sortedYearsDesc[0] || new Date().getFullYear();
        const comparisonYears = sortedYearsDesc
            .filter(year => year < referenceYear)
            .slice(0, 2);
        const COMPARISON_THRESHOLD_PCT = 0.5;
        const yearMetricValue = (byYear, year, metric = 'sales') => {
            const data = byYear?.[year] || byYear?.[String(year)] || {};
            return round2(Number(data?.[metric]) || 0);
        };
        const comparisonEntry = (referenceValue, yearValue, year) => {
            const delta = round2(referenceValue - yearValue);
            if (Math.abs(yearValue) < 0.01) {
                if (Math.abs(referenceValue) < 0.01) {
                    return { year, value: 0, delta: 0, percent: 0, trend: 'flat', color: 'blue', label: '0%' };
                }
                return { year, value: 0, delta, percent: null, trend: 'new', color: 'blue', label: 'Nuevo' };
            }
            const percent = round1((delta / yearValue) * 100);
            if (referenceValue < 0.01 && yearValue > 0) {
                return { year, value: yearValue, delta, percent: -100, trend: 'lost', color: 'red', label: '-100%' };
            }
            if (percent > COMPARISON_THRESHOLD_PCT) {
                return { year, value: yearValue, delta, percent, trend: 'up', color: 'green', label: `+${percent}%` };
            }
            if (percent < -COMPARISON_THRESHOLD_PCT) {
                return { year, value: yearValue, delta, percent, trend: 'down', color: 'red', label: `${percent}%` };
            }
            return { year, value: yearValue, delta, percent, trend: 'flat', color: 'blue', label: '0%' };
        };
        const buildYearComparison = (byYear, metric = 'sales') => {
            const referenceValue = yearMetricValue(byYear, referenceYear, metric);
            const comparisons = comparisonYears.map(year =>
                comparisonEntry(referenceValue, yearMetricValue(byYear, year, metric), year)
            );
            const primary = comparisons[0] || { trend: 'no-data', color: 'blue', label: '—' };
            return {
                metric,
                referenceYear,
                referenceValue,
                comparisonYears,
                thresholdPct: COMPARISON_THRESHOLD_PCT,
                trend: primary.trend,
                color: primary.color,
                label: primary.label,
                comparisons,
            };
        };

        rows.forEach(row => {
            const famCode = row.FAMILY_CODE?.trim() || 'SIN_FAM';
            const subfamCode = row.SUBFAMILY_CODE?.trim() || 'General';
            const prodCode = row.PRODUCT_CODE?.trim() || '';
            const prodName = row.PRODUCT_NAME?.trim() || 'Sin nombre';
            const unitType = row.UNIT_TYPE?.trim() || 'UDS';
            const year = parseInt(row.YEAR, 10);
            const month = parseInt(row.MONTH, 10);
            const sales = parseFloat(row.SALES) || 0;
            const cost = parseFloat(row.COST) || 0;
            const units = parseFloat(row.UNITS) || 0;

            const hasSpecialPrice = parseInt(row.HAS_SPECIAL_PRICE, 10) > 0;
            const hasDiscount = parseInt(row.HAS_DISCOUNT, 10) > 0;
            const avgDiscountPct = parseFloat(row.AVG_DISCOUNT_PCT) || 0;
            const avgDiscountEur = parseFloat(row.AVG_DISCOUNT_EUR) || 0;

            const avgClientTariff = parseFloat(row.AVG_CLIENT_TARIFF) || 0;
            const avgBaseTariff = parseFloat(row.AVG_BASE_TARIFF) || 0;

            // FI codes from row - all 5 levels
            const fi1Code = row.FI1_CODE?.trim() || '';
            const fi2Code = row.FI2_CODE?.trim() || '';
            const fi3Code = row.FI3_CODE?.trim() || '';
            const fi4Code = row.FI4_CODE?.trim() || '';
            const fi5Code = row.FI5_CODE?.trim() || '';

            // Populate Distinct Filter Maps (legacy)
            if (!availableFamiliesMap.has(famCode)) {
                availableFamiliesMap.set(famCode, {
                    code: famCode,
                    name: familyNames[famCode] ? `${famCode} - ${familyNames[famCode]}` : famCode
                });
            }
            if (!availableSubfamiliesMap.has(subfamCode)) {
                availableSubfamiliesMap.set(subfamCode, {
                    code: subfamCode,
                    name: subfamilyNames[subfamCode] ? `${subfamCode} - ${subfamilyNames[subfamCode]}` : subfamCode
                });
            }

            // Populate FI Filter Maps - all 5 levels
            if (fi1Code && !availableFi1Map.has(fi1Code)) {
                availableFi1Map.set(fi1Code, {
                    code: fi1Code,
                    name: fi1Names[fi1Code] ? `${fi1Code} - ${fi1Names[fi1Code]}` : fi1Code
                });
            }
            if (fi2Code && !availableFi2Map.has(fi2Code)) {
                availableFi2Map.set(fi2Code, {
                    code: fi2Code,
                    name: fi2Names[fi2Code] ? `${fi2Code} - ${fi2Names[fi2Code]}` : fi2Code
                });
            }
            if (fi3Code && !availableFi3Map.has(fi3Code)) {
                availableFi3Map.set(fi3Code, {
                    code: fi3Code,
                    name: fi3Names[fi3Code] ? `${fi3Code} - ${fi3Names[fi3Code]}` : fi3Code
                });
            }
            if (fi4Code && !availableFi4Map.has(fi4Code)) {
                availableFi4Map.set(fi4Code, {
                    code: fi4Code,
                    name: fi4Names[fi4Code] ? `${fi4Code} - ${fi4Names[fi4Code]}` : fi4Code
                });
            }
            if (fi5Code && !availableFi5Map.has(fi5Code)) {
                availableFi5Map.set(fi5Code, {
                    code: fi5Code,
                    name: fi5Names[fi5Code] ? `${fi5Code} - ${fi5Names[fi5Code]}` : fi5Code
                });
            }

            // Update Monthly Stats
            const mStat = monthlyStats.get(month);
            if (isSelectedYear(year)) {
                mStat.currentSales += sales;
                mStat.currentUnits += units;
                addToYearStats(mStat.byYear, year, sales, cost, units);
            } else if (isPrevYear(year)) {
                mStat.prevSales += sales;
            }

            // Only add to Grand Totals if it's a Selected Year
            if (isSelectedYear(year)) {
                grandTotalSales += sales;
                grandTotalCost += cost;
                grandTotalUnits += units;
                productSet.add(prodCode);
                addToYearStats(grandTotalsByYear, year, sales, cost, units);
                productSetsByYear[year]?.add(prodCode);
            } else if (isPrevYear(year)) {
                grandTotalPrevSales += sales;
                grandTotalPrevCost += cost;
                grandTotalPrevUnits += units;
                prevProductSet.add(prodCode);
            }

            // Add to hierarchy
            if (isSelectedYear(year) || isPrevYear(year)) {
                // Family
                if (!familyMap.has(famCode)) {
                    familyMap.set(famCode, {
                        familyCode: famCode,
                        familyName: familyNames[famCode] ? `${famCode} - ${familyNames[famCode]}` : famCode,
                        totalSales: 0, totalCost: 0, totalUnits: 0,
                        yearStats: createYearStats(),
                        subfamilies: new Map()
                    });
                }
                const family = familyMap.get(famCode);

                if (isSelectedYear(year)) {
                    family.totalSales += sales;
                    family.totalCost += cost;
                    family.totalUnits += units;
                    addToYearStats(family.yearStats, year, sales, cost, units);
                }

                // Subfamily
                const subfamName = subfamilyNames[subfamCode] ? `${subfamCode} - ${subfamilyNames[subfamCode]}` : subfamCode;
                if (!family.subfamilies.has(subfamCode)) {
                    family.subfamilies.set(subfamCode, {
                        subfamilyCode: subfamCode,
                        subfamilyName: subfamName,
                        totalSales: 0, totalCost: 0, totalUnits: 0,
                        yearStats: createYearStats(),
                        products: new Map()
                    });
                }
                const subfamily = family.subfamilies.get(subfamCode);

                if (isSelectedYear(year)) {
                    subfamily.totalSales += sales;
                    subfamily.totalCost += cost;
                    subfamily.totalUnits += units;
                    addToYearStats(subfamily.yearStats, year, sales, cost, units);
                }

                // Product
                if (!subfamily.products.has(prodCode)) {
                    subfamily.products.set(prodCode, {
                        productCode: prodCode,
                        productName: prodName,
                        unitType,
                        totalSales: 0, totalCost: 0, totalUnits: 0,
                        prevYearSales: 0, prevYearCost: 0, prevYearUnits: 0,
                        hasDiscount: false, hasSpecialPrice: false,
                        avgDiscountPct: 0, avgDiscountEur: 0,
                        avgClientTariff: 0, avgBaseTariff: 0,
                        monthlyData: {}
                    });
                }
                const product = subfamily.products.get(prodCode);

                if (isSelectedYear(year)) {
                    product.totalSales += sales;
                    product.totalCost += cost;
                    product.totalUnits += units;

                    if (hasDiscount) product.hasDiscount = true;
                    if (avgDiscountPct > 0) product.avgDiscountPct = avgDiscountPct;
                    if (avgDiscountEur > 0) product.avgDiscountEur = avgDiscountEur;

                    if (hasSpecialPrice) product.hasSpecialPrice = true;
                    if (avgClientTariff > 0) product.avgClientTariff = avgClientTariff;
                    if (avgBaseTariff > 0) product.avgBaseTariff = avgBaseTariff;
                } else if (isPrevYear(year)) {
                    product.prevYearSales += sales;
                    product.prevYearCost += cost;
                    product.prevYearUnits += units;
                }

                // Product Monthly Data
                if (!product.monthlyData[year]) product.monthlyData[year] = {};
                if (!product.monthlyData[year][month]) product.monthlyData[year][month] = {
                    sales: 0, cost: 0, units: 0, avgDiscountPct: 0, avgDiscountEur: 0
                };
                product.monthlyData[year][month].sales += sales;
                product.monthlyData[year][month].cost += cost;
                product.monthlyData[year][month].units += units;
                if (avgDiscountPct > 0) product.monthlyData[year][month].avgDiscountPct = avgDiscountPct;
                if (avgDiscountEur > 0) product.monthlyData[year][month].avgDiscountEur = avgDiscountEur;

                // ===== BUILD 5-LEVEL FI HIERARCHY (FI1 > FI2 > FI3 > FI4 > Products) =====
                const fi1Key = fi1Code || 'SIN_CAT';
                const fi2Key = fi2Code || 'General';
                const fi3Key = fi3Code || '';
                const fi4Key = fi4Code || '';

                // FI1 Level (Categoría)
                if (!fiHierarchyMap.has(fi1Key)) {
                    fiHierarchyMap.set(fi1Key, {
                        code: fi1Key,
                        name: fi1Names[fi1Key] ? `${fi1Key} - ${fi1Names[fi1Key]}` : (fi1Key === 'SIN_CAT' ? 'Sin Categoría' : fi1Key),
                        level: 1,
                        totalSales: 0, totalCost: 0, totalUnits: 0,
                        prevYearSales: 0, prevYearCost: 0, prevYearUnits: 0,
                        monthlyData: {},
                        children: new Map()
                    });
                }
                const fi1Level = fiHierarchyMap.get(fi1Key);
                if (isSelectedYear(year)) {
                    fi1Level.totalSales += sales;
                    fi1Level.totalCost += cost;
                    fi1Level.totalUnits += units;
                } else if (isPrevYear(year)) {
                    fi1Level.prevYearSales += sales;
                    fi1Level.prevYearCost += cost;
                    fi1Level.prevYearUnits += units;
                }
                // Monthly data for FI1
                if (!fi1Level.monthlyData[year]) fi1Level.monthlyData[year] = {};
                if (!fi1Level.monthlyData[year][month]) fi1Level.monthlyData[year][month] = { sales: 0, cost: 0, units: 0 };
                fi1Level.monthlyData[year][month].sales += sales;
                fi1Level.monthlyData[year][month].cost += cost;
                fi1Level.monthlyData[year][month].units += units;

                // FI2 Level (Subcategoría)
                if (!fi1Level.children.has(fi2Key)) {
                    fi1Level.children.set(fi2Key, {
                        code: fi2Key,
                        name: fi2Names[fi2Key] ? `${fi2Key} - ${fi2Names[fi2Key]}` : (fi2Key === 'General' ? 'General' : fi2Key),
                        level: 2,
                        totalSales: 0, totalCost: 0, totalUnits: 0,
                        prevYearSales: 0, prevYearCost: 0, prevYearUnits: 0,
                        monthlyData: {},
                        children: new Map()
                    });
                }
                const fi2Level = fi1Level.children.get(fi2Key);
                if (isSelectedYear(year)) {
                    fi2Level.totalSales += sales;
                    fi2Level.totalCost += cost;
                    fi2Level.totalUnits += units;
                } else if (isPrevYear(year)) {
                    fi2Level.prevYearSales += sales;
                    fi2Level.prevYearCost += cost;
                    fi2Level.prevYearUnits += units;
                }
                // Monthly data for FI2
                if (!fi2Level.monthlyData[year]) fi2Level.monthlyData[year] = {};
                if (!fi2Level.monthlyData[year][month]) fi2Level.monthlyData[year][month] = { sales: 0, cost: 0, units: 0 };
                fi2Level.monthlyData[year][month].sales += sales;
                fi2Level.monthlyData[year][month].cost += cost;
                fi2Level.monthlyData[year][month].units += units;

                // FI3 Level (Detalle) - Solo si hay código FI3
                const fi3Display = fi3Key || 'General';
                if (!fi2Level.children.has(fi3Display)) {
                    fi2Level.children.set(fi3Display, {
                        code: fi3Display,
                        name: fi3Names[fi3Key] ? `${fi3Key} - ${fi3Names[fi3Key]}` : (fi3Display === 'General' ? 'General' : fi3Display),
                        level: 3,
                        totalSales: 0, totalCost: 0, totalUnits: 0,
                        prevYearSales: 0, prevYearCost: 0, prevYearUnits: 0,
                        monthlyData: {},
                        children: new Map()
                    });
                }
                const fi3Level = fi2Level.children.get(fi3Display);
                if (isSelectedYear(year)) {
                    fi3Level.totalSales += sales;
                    fi3Level.totalCost += cost;
                    fi3Level.totalUnits += units;
                } else if (isPrevYear(year)) {
                    fi3Level.prevYearSales += sales;
                    fi3Level.prevYearCost += cost;
                    fi3Level.prevYearUnits += units;
                }
                // Monthly data for FI3
                if (!fi3Level.monthlyData[year]) fi3Level.monthlyData[year] = {};
                if (!fi3Level.monthlyData[year][month]) fi3Level.monthlyData[year][month] = { sales: 0, cost: 0, units: 0 };
                fi3Level.monthlyData[year][month].sales += sales;
                fi3Level.monthlyData[year][month].cost += cost;
                fi3Level.monthlyData[year][month].units += units;

                // FI4 Level (Especial) - Solo si hay código FI4
                const fi4Display = fi4Key || 'General';
                if (!fi3Level.children.has(fi4Display)) {
                    fi3Level.children.set(fi4Display, {
                        code: fi4Display,
                        name: fi4Names[fi4Key] ? `${fi4Key} - ${fi4Names[fi4Key]}` : (fi4Display === 'General' ? 'General' : fi4Display),
                        level: 4,
                        totalSales: 0, totalCost: 0, totalUnits: 0,
                        prevYearSales: 0, prevYearCost: 0, prevYearUnits: 0,
                        monthlyData: {},
                        products: new Map()
                    });
                }
                const fi4Level = fi3Level.children.get(fi4Display);
                if (isSelectedYear(year)) {
                    fi4Level.totalSales += sales;
                    fi4Level.totalCost += cost;
                    fi4Level.totalUnits += units;
                } else if (isPrevYear(year)) {
                    fi4Level.prevYearSales += sales;
                    fi4Level.prevYearCost += cost;
                    fi4Level.prevYearUnits += units;
                }
                // Monthly data for FI4
                if (!fi4Level.monthlyData[year]) fi4Level.monthlyData[year] = {};
                if (!fi4Level.monthlyData[year][month]) fi4Level.monthlyData[year][month] = { sales: 0, cost: 0, units: 0 };
                fi4Level.monthlyData[year][month].sales += sales;
                fi4Level.monthlyData[year][month].cost += cost;
                fi4Level.monthlyData[year][month].units += units;

                // Product level within FI4
                if (!fi4Level.products.has(prodCode)) {
                    fi4Level.products.set(prodCode, {
                        code: prodCode,
                        name: prodName,
                        unitType,
                        fi5Code,
                        fi5Name: fi5Names[fi5Code] || fi5Code,
                        totalSales: 0, totalCost: 0, totalUnits: 0,
                        prevYearSales: 0, prevYearCost: 0, prevYearUnits: 0,
                        hasDiscount: false, hasSpecialPrice: false,
                        avgDiscountPct: 0, avgDiscountEur: 0,
                        monthlyData: {}
                    });
                }
                const fiProduct = fi4Level.products.get(prodCode);
                if (isSelectedYear(year)) {
                    fiProduct.totalSales += sales;
                    fiProduct.totalCost += cost;
                    fiProduct.totalUnits += units;
                    if (hasDiscount) fiProduct.hasDiscount = true;
                    if (hasSpecialPrice) fiProduct.hasSpecialPrice = true;
                    if (avgDiscountPct > 0) fiProduct.avgDiscountPct = avgDiscountPct;
                    if (avgDiscountEur > 0) fiProduct.avgDiscountEur = avgDiscountEur;
                } else if (isPrevYear(year)) {
                    fiProduct.prevYearSales += sales;
                    fiProduct.prevYearCost += cost;
                    fiProduct.prevYearUnits += units;
                }
                // Monthly data for FI product
                if (!fiProduct.monthlyData[year]) fiProduct.monthlyData[year] = {};
                if (!fiProduct.monthlyData[year][month]) fiProduct.monthlyData[year][month] = { sales: 0, cost: 0, units: 0 };
                fiProduct.monthlyData[year][month].sales += sales;
                fiProduct.monthlyData[year][month].cost += cost;
                fiProduct.monthlyData[year][month].units += units;
            }
        });

        // Helper
        const getSalesForKey = (keyCode, filterFn) => {
            let total = 0;
            rows.forEach(r => {
                if (filterFn(r) && isPrevYear(parseInt(r.YEAR, 10))) {
                    total += (parseFloat(r.SALES) || 0);
                }
            });
            return total;
        };

        // Construct Flat Monthly Totals Response
        const flatMonthlyTotals = {};
        monthlyStats.forEach((val, month) => {
            const variation = val.prevSales > 0 ? ((val.currentSales - val.prevSales) / val.prevSales) * 100 : null;
            let yoyTrend = 'neutral';
            if (val.prevSales > 0) {
                if (val.currentSales > val.prevSales) yoyTrend = 'up';
                else if (val.currentSales < val.prevSales) yoyTrend = 'down';
            } else if (val.currentSales > 0) {
                yoyTrend = 'up'; // Mark as positive trend if it's NEW sales
            }

            flatMonthlyTotals[month] = {
                sales: val.currentSales,
                units: val.currentUnits,
                prevSales: val.prevSales,
                yoyVariation: variation !== null ? parseFloat(variation.toFixed(1)) : null,
                yoyTrend,
                byYear: formatYearStats(val.byYear)
            };
        });

        // Finalize Structure
        const families = Array.from(familyMap.values()).map(f => {
            const subfamilies = Array.from(f.subfamilies.values()).map(s => {
                const products = Array.from(s.products.values()).map(p => {
                    const prevSales = getSalesForKey(p.productCode, r => r.PRODUCT_CODE === p.productCode);
                    const variation = prevSales > 0 ? ((p.totalSales - prevSales) / prevSales) * 100 : 0;

                    let yoyTrend = 'neutral';
                    if (variation > 5) yoyTrend = 'up';
                    if (variation < -5) yoyTrend = 'down';

                    const margin = p.totalSales - p.totalCost;
                    const marginPercent = p.totalSales > 0 ? (margin / p.totalSales) * 100 : 0;
                    const avgPrice = p.totalUnits > 0 ? (p.totalSales / p.totalUnits) : 0;
                    const avgCost = p.totalUnits > 0 ? (p.totalCost / p.totalUnits) : 0;
                    const marginPerUnit = avgPrice - avgCost;
                    const prevAvgPrice = p.prevYearUnits > 0 ? p.prevYearSales / p.prevYearUnits : 0;

                    // Flatten Monthly Data
                    const flatMonthly = {};
                    for (let m = 1; m <= 12; m++) {
                        flatMonthly[m.toString()] = { selectedSales: 0, selectedUnits: 0, selectedCost: 0, prevSales: 0, prevUnits: 0, prevCost: 0, byYear: createYearStats() };
                    }
                    Object.keys(p.monthlyData).forEach((yearStr) => {
                        const y = parseInt(yearStr, 10);
                        const mData = p.monthlyData[yearStr];
                        Object.keys(mData).forEach(mStr => {
                            if (isSelectedYear(y)) {
                                flatMonthly[mStr].selectedSales += mData[mStr].sales || 0;
                                flatMonthly[mStr].selectedUnits += mData[mStr].units || 0;
                                flatMonthly[mStr].selectedCost += mData[mStr].cost || 0;
                                addToYearStats(flatMonthly[mStr].byYear, y, mData[mStr].sales || 0, mData[mStr].cost || 0, mData[mStr].units || 0);
                            } else if (isPrevYear(y)) {
                                flatMonthly[mStr].prevSales += mData[mStr].sales || 0;
                                flatMonthly[mStr].prevUnits += mData[mStr].units || 0;
                                flatMonthly[mStr].prevCost += mData[mStr].cost || 0;
                            }
                        });
                    });

                    const monthlyOutput = {};
                    Object.keys(flatMonthly).forEach(mStr => {
                        const d = flatMonthly[mStr];
                        let mTrend = 'neutral';
                        let mVar = 0;
                        if (d.prevSales > 0) {
                            mVar = ((d.selectedSales - d.prevSales) / d.prevSales) * 100;
                            if (mVar > 5) mTrend = 'up'; else if (mVar < -5) mTrend = 'down';
                        } else if (d.selectedSales > 0) mTrend = 'up';

                        monthlyOutput[mStr] = {
                            sales: d.selectedSales,
                            cost: d.selectedCost,
                            prevSales: d.prevSales, // Added for frontend context
                            prevCost: d.prevCost,
                            yoyTrend: mTrend,
                            yoyVariation: mVar,
                            byYear: formatYearStats(d.byYear)
                        };
                    });

                    const productByYear = formatByYearFromMonthly(p.monthlyData || {});
                    const productComparison = buildYearComparison(productByYear);

                    return {
                        code: p.productCode,
                        name: p.productName,
                        unitType: p.unitType || 'UDS',
                        totalSales: parseFloat(p.totalSales.toFixed(2)),
                        totalUnits: parseFloat(p.totalUnits.toFixed(2)),
                        totalCost: parseFloat(p.totalCost.toFixed(2)),
                        totalMarginPercent: parseFloat(marginPercent.toFixed(1)),
                        avgUnitPrice: parseFloat(avgPrice.toFixed(2)),
                        avgUnitCost: parseFloat(avgCost.toFixed(2)),
                        marginPerUnit: parseFloat(marginPerUnit.toFixed(2)),
                        prevYearSales: parseFloat(p.prevYearSales.toFixed(2)),
                        prevYearUnits: parseFloat(p.prevYearUnits.toFixed(2)),
                        prevYearAvgPrice: parseFloat(prevAvgPrice.toFixed(2)),
                        hasDiscount: p.hasDiscount,
                        hasSpecialPrice: p.hasSpecialPrice,
                        avgDiscountPct: p.avgDiscountPct,
                        avgDiscountEur: p.avgDiscountEur,
                        byYear: productByYear,
                        comparison: productComparison,
                        monthlyData: monthlyOutput,
                        yoyTrend,
                        yoyVariation: parseFloat(variation.toFixed(1))
                    };
                }).sort((a, b) => b.totalSales - a.totalSales);

                const margin = s.totalSales - s.totalCost;
                const marginPercent = s.totalSales > 0 ? (margin / s.totalSales) * 100 : 0;
                const subfamilyByYear = formatYearStats(s.yearStats);
                const subfamilyComparison = buildYearComparison(subfamilyByYear);
                return {
                    subfamilyCode: s.subfamilyCode,
                    subfamilyName: s.subfamilyName,
                    totalSales: parseFloat(s.totalSales.toFixed(2)),
                    totalUnits: s.totalUnits,
                    totalMarginPercent: parseFloat(marginPercent.toFixed(1)),
                    byYear: subfamilyByYear,
                    comparison: subfamilyComparison,
                    yoyTrend: subfamilyComparison.trend,
                    yoyVariation: subfamilyComparison.comparisons?.[0]?.percent ?? null,
                    products
                };
            }).sort((a, b) => b.totalSales - a.totalSales);

            const margin = f.totalSales - f.totalCost;
            const marginPercent = f.totalSales > 0 ? (margin / f.totalSales) * 100 : 0;
            const familyByYear = formatYearStats(f.yearStats);
            const familyComparison = buildYearComparison(familyByYear);
            return {
                familyCode: f.familyCode,
                familyName: f.familyName,
                totalSales: parseFloat(f.totalSales.toFixed(2)),
                totalUnits: f.totalUnits,
                totalMarginPercent: parseFloat(marginPercent.toFixed(1)),
                byYear: familyByYear,
                comparison: familyComparison,
                yoyTrend: familyComparison.trend,
                yoyVariation: familyComparison.comparisons?.[0]?.percent ?? null,
                subfamilies
            };
        }).sort((a, b) => b.totalSales - a.totalSales);

        // ===== FINALIZE 5-LEVEL FI HIERARCHY =====
        // Helper to format monthly data for FI levels
        const formatLevelMonthly = (monthlyData) => {
            const flatMonthly = {};
            for (let m = 1; m <= 12; m++) {
                flatMonthly[m.toString()] = { selectedSales: 0, selectedUnits: 0, selectedCost: 0, prevSales: 0, prevUnits: 0, prevCost: 0, byYear: createYearStats() };
            }
            Object.keys(monthlyData).forEach((yearStr) => {
                const y = parseInt(yearStr, 10);
                const mData = monthlyData[yearStr];
                Object.keys(mData).forEach(mStr => {
                    if (isSelectedYear(y)) {
                        flatMonthly[mStr].selectedSales += mData[mStr].sales || 0;
                        flatMonthly[mStr].selectedUnits += mData[mStr].units || 0;
                        flatMonthly[mStr].selectedCost += mData[mStr].cost || 0;
                        addToYearStats(flatMonthly[mStr].byYear, y, mData[mStr].sales || 0, mData[mStr].cost || 0, mData[mStr].units || 0);
                    } else if (isPrevYear(y)) {
                        flatMonthly[mStr].prevSales += mData[mStr].sales || 0;
                        flatMonthly[mStr].prevUnits += mData[mStr].units || 0;
                        flatMonthly[mStr].prevCost += mData[mStr].cost || 0;
                    }
                });
            });
            const output = {};
            Object.keys(flatMonthly).forEach(mStr => {
                const d = flatMonthly[mStr];
                let mTrend = 'neutral';
                let mVar = 0;
                if (d.prevSales > 0) {
                    mVar = ((d.selectedSales - d.prevSales) / d.prevSales) * 100;
                    if (mVar > 5) mTrend = 'up'; else if (mVar < -5) mTrend = 'down';
                } else if (d.selectedSales > 0) {
                    mTrend = 'new'; // New sales this year
                }
                output[mStr] = {
                    sales: parseFloat(d.selectedSales.toFixed(2)),
                    cost: parseFloat(d.selectedCost.toFixed(2)),
                    units: parseFloat(d.selectedUnits.toFixed(2)),
                    prevSales: parseFloat(d.prevSales.toFixed(2)),
                    prevCost: parseFloat(d.prevCost.toFixed(2)),
                    yoyTrend: mTrend,
                    yoyVariation: parseFloat(mVar.toFixed(1)),
                    byYear: formatYearStats(d.byYear)
                };
            });
            return output;
        };

        // Helper to format FI product with calculations
        const formatFiProduct = (p) => {
            const margin = p.totalSales - p.totalCost;
            const marginPercent = p.totalSales > 0 ? (margin / p.totalSales) * 100 : 0;
            const prevMargin = p.prevYearSales - p.prevYearCost;
            const prevMarginPercent = p.prevYearSales > 0 ? (prevMargin / p.prevYearSales) * 100 : 0;
            const avgPrice = p.totalUnits > 0 ? p.totalSales / p.totalUnits : 0;
            const avgCost = p.totalUnits > 0 ? p.totalCost / p.totalUnits : 0;
            const prevAvgPrice = p.prevYearUnits > 0 ? p.prevYearSales / p.prevYearUnits : 0;
            const prevAvgCost = p.prevYearUnits > 0 ? p.prevYearCost / p.prevYearUnits : 0;
            const variation = p.prevYearSales > 0 ? ((p.totalSales - p.prevYearSales) / p.prevYearSales) * 100 : 0;
            let yoyTrend = 'neutral';
            if (p.prevYearSales === 0 && p.totalSales > 0) yoyTrend = 'new';
            else if (variation > 5) yoyTrend = 'up';
            else if (variation < -5) yoyTrend = 'down';

            // Format product monthly data
            const productMonthly = formatLevelMonthly(p.monthlyData || {});
            const productByYear = formatByYearFromMonthly(p.monthlyData || {});
            const productComparison = buildYearComparison(productByYear);

            return {
                code: p.code,
                name: p.name,
                unitType: p.unitType || 'UDS',
                fi5Code: p.fi5Code || '',
                fi5Name: p.fi5Name || '',
                totalSales: parseFloat(p.totalSales.toFixed(2)),
                totalUnits: parseFloat(p.totalUnits.toFixed(2)),
                totalCost: parseFloat(p.totalCost.toFixed(2)),
                totalMargin: parseFloat(margin.toFixed(2)),
                totalMarginPercent: parseFloat(marginPercent.toFixed(1)),
                avgUnitPrice: parseFloat(avgPrice.toFixed(2)),
                avgUnitCost: parseFloat(avgCost.toFixed(2)),
                prevYearSales: parseFloat(p.prevYearSales.toFixed(2)),
                prevYearUnits: parseFloat(p.prevYearUnits.toFixed(2)),
                prevYearCost: parseFloat(p.prevYearCost.toFixed(2)),
                prevYearMargin: parseFloat(prevMargin.toFixed(2)),
                prevYearMarginPercent: parseFloat(prevMarginPercent.toFixed(1)),
                prevYearAvgPrice: parseFloat(prevAvgPrice.toFixed(2)),
                prevYearAvgCost: parseFloat(prevAvgCost.toFixed(2)),
                hasDiscount: p.hasDiscount,
                hasSpecialPrice: p.hasSpecialPrice,
                avgDiscountPct: p.avgDiscountPct || 0,
                avgDiscountEur: p.avgDiscountEur || 0,
                byYear: productByYear,
                comparison: productComparison,
                monthlyData: productMonthly,
                yoyTrend,
                yoyVariation: parseFloat(variation.toFixed(1))
            };
        };

        // Build FI hierarchy array
        const fiHierarchy = Array.from(fiHierarchyMap.values()).map(fi1 => {
            const margin1 = fi1.totalSales - fi1.totalCost;
            const marginPercent1 = fi1.totalSales > 0 ? (margin1 / fi1.totalSales) * 100 : 0;

            const children1 = Array.from(fi1.children.values()).map(fi2 => {
                const margin2 = fi2.totalSales - fi2.totalCost;
                const marginPercent2 = fi2.totalSales > 0 ? (margin2 / fi2.totalSales) * 100 : 0;
                const prevMargin2 = fi2.prevYearSales - fi2.prevYearCost;
                const variation2 = fi2.prevYearSales > 0 ? ((fi2.totalSales - fi2.prevYearSales) / fi2.prevYearSales) * 100 : 0;

                const children2 = Array.from(fi2.children.values()).map(fi3 => {
                    const margin3 = fi3.totalSales - fi3.totalCost;
                    const marginPercent3 = fi3.totalSales > 0 ? (margin3 / fi3.totalSales) * 100 : 0;
                    const prevMargin3 = fi3.prevYearSales - fi3.prevYearCost;
                    const variation3 = fi3.prevYearSales > 0 ? ((fi3.totalSales - fi3.prevYearSales) / fi3.prevYearSales) * 100 : 0;

                    const children3 = Array.from(fi3.children.values()).map(fi4 => {
                        const margin4 = fi4.totalSales - fi4.totalCost;
                        const marginPercent4 = fi4.totalSales > 0 ? (margin4 / fi4.totalSales) * 100 : 0;
                        const prevMargin4 = fi4.prevYearSales - fi4.prevYearCost;
                        const variation4 = fi4.prevYearSales > 0 ? ((fi4.totalSales - fi4.prevYearSales) / fi4.prevYearSales) * 100 : 0;

                        const products = Array.from(fi4.products.values())
                            .map(formatFiProduct)
                            .sort((a, b) => b.totalSales - a.totalSales);
                        const byYear4 = formatByYearFromMonthly(fi4.monthlyData || {});
                        const comparison4 = buildYearComparison(byYear4);

                        return {
                            code: fi4.code,
                            name: fi4.name,
                            level: 4,
                            totalSales: parseFloat(fi4.totalSales.toFixed(2)),
                            totalUnits: parseFloat(fi4.totalUnits.toFixed(2)),
                            totalCost: parseFloat(fi4.totalCost.toFixed(2)),
                            totalMargin: parseFloat(margin4.toFixed(2)),
                            totalMarginPercent: parseFloat(marginPercent4.toFixed(1)),
                            prevYearSales: parseFloat(fi4.prevYearSales.toFixed(2)),
                            prevYearUnits: parseFloat(fi4.prevYearUnits.toFixed(2)),
                            prevYearCost: parseFloat(fi4.prevYearCost.toFixed(2)),
                            prevYearMargin: parseFloat(prevMargin4.toFixed(2)),
                            yoyTrend: comparison4.trend,
                            yoyVariation: comparison4.comparisons?.[0]?.percent ?? parseFloat(variation4.toFixed(1)),
                            byYear: byYear4,
                            comparison: comparison4,
                            monthlyData: formatLevelMonthly(fi4.monthlyData || {}),
                            productCount: products.length,
                            products
                        };
                    }).filter(f => f.totalSales > 0 || f.productCount > 0).sort((a, b) => b.totalSales - a.totalSales);
                    const byYear3 = formatByYearFromMonthly(fi3.monthlyData || {});
                    const comparison3 = buildYearComparison(byYear3);

                    return {
                        code: fi3.code,
                        name: fi3.name,
                        level: 3,
                        totalSales: parseFloat(fi3.totalSales.toFixed(2)),
                        totalUnits: parseFloat(fi3.totalUnits.toFixed(2)),
                        totalCost: parseFloat(fi3.totalCost.toFixed(2)),
                        totalMargin: parseFloat(margin3.toFixed(2)),
                        totalMarginPercent: parseFloat(marginPercent3.toFixed(1)),
                        prevYearSales: parseFloat(fi3.prevYearSales.toFixed(2)),
                        prevYearUnits: parseFloat(fi3.prevYearUnits.toFixed(2)),
                        prevYearCost: parseFloat(fi3.prevYearCost.toFixed(2)),
                        prevYearMargin: parseFloat(prevMargin3.toFixed(2)),
                        yoyTrend: comparison3.trend,
                        yoyVariation: comparison3.comparisons?.[0]?.percent ?? parseFloat(variation3.toFixed(1)),
                        byYear: byYear3,
                        comparison: comparison3,
                        monthlyData: formatLevelMonthly(fi3.monthlyData || {}),
                        childCount: children3.length,
                        children: children3
                    };
                }).filter(f => f.totalSales > 0 || f.childCount > 0).sort((a, b) => b.totalSales - a.totalSales);
                const byYear2 = formatByYearFromMonthly(fi2.monthlyData || {});
                const comparison2 = buildYearComparison(byYear2);

                return {
                    code: fi2.code,
                    name: fi2.name,
                    level: 2,
                    totalSales: parseFloat(fi2.totalSales.toFixed(2)),
                    totalUnits: parseFloat(fi2.totalUnits.toFixed(2)),
                    totalCost: parseFloat(fi2.totalCost.toFixed(2)),
                    totalMargin: parseFloat(margin2.toFixed(2)),
                    totalMarginPercent: parseFloat(marginPercent2.toFixed(1)),
                    prevYearSales: parseFloat(fi2.prevYearSales.toFixed(2)),
                    prevYearUnits: parseFloat(fi2.prevYearUnits.toFixed(2)),
                    prevYearCost: parseFloat(fi2.prevYearCost.toFixed(2)),
                    prevYearMargin: parseFloat(prevMargin2.toFixed(2)),
                    yoyTrend: comparison2.trend,
                    yoyVariation: comparison2.comparisons?.[0]?.percent ?? parseFloat(variation2.toFixed(1)),
                    byYear: byYear2,
                    comparison: comparison2,
                    monthlyData: formatLevelMonthly(fi2.monthlyData || {}),
                    childCount: children2.length,
                    children: children2
                };
            }).filter(f => f.totalSales > 0 || f.childCount > 0).sort((a, b) => b.totalSales - a.totalSales);

            const prevMargin1 = fi1.prevYearSales - fi1.prevYearCost;
            const variation1 = fi1.prevYearSales > 0 ? ((fi1.totalSales - fi1.prevYearSales) / fi1.prevYearSales) * 100 : 0;
            const byYear1 = formatByYearFromMonthly(fi1.monthlyData || {});
            const comparison1 = buildYearComparison(byYear1);

            return {
                code: fi1.code,
                name: fi1.name,
                level: 1,
                totalSales: parseFloat(fi1.totalSales.toFixed(2)),
                totalUnits: parseFloat(fi1.totalUnits.toFixed(2)),
                totalCost: parseFloat(fi1.totalCost.toFixed(2)),
                totalMargin: parseFloat((fi1.totalSales - fi1.totalCost).toFixed(2)),
                totalMarginPercent: parseFloat(marginPercent1.toFixed(1)),
                prevYearSales: parseFloat(fi1.prevYearSales.toFixed(2)),
                prevYearUnits: parseFloat(fi1.prevYearUnits.toFixed(2)),
                prevYearCost: parseFloat(fi1.prevYearCost.toFixed(2)),
                prevYearMargin: parseFloat(prevMargin1.toFixed(2)),
                yoyTrend: comparison1.trend,
                yoyVariation: comparison1.comparisons?.[0]?.percent ?? parseFloat(variation1.toFixed(1)),
                byYear: byYear1,
                comparison: comparison1,
                monthlyData: formatLevelMonthly(fi1.monthlyData || {}),
                childCount: children1.length,
                children: children1
            };
        }).filter(f => f.totalSales > 0 || f.childCount > 0).sort((a, b) => b.totalSales - a.totalSales);

        // Calculate Aggregated Summary
        const grandTotalMargin = grandTotalSales - grandTotalCost;
        const grandTotalPrevMargin = grandTotalPrevSales - grandTotalPrevCost;

        const salesGrowth = grandTotalPrevSales > 0 ? ((grandTotalSales - grandTotalPrevSales) / grandTotalPrevSales) * 100 : 0;
        const marginGrowth = grandTotalPrevMargin > 0 ? ((grandTotalMargin - grandTotalPrevMargin) / grandTotalPrevMargin) * 100 : 0;
        const unitsGrowth = grandTotalPrevUnits > 0 ? ((grandTotalUnits - grandTotalPrevUnits) / grandTotalPrevUnits) * 100 : 0;

        // Determine if client is NEW (no sales in entire previous year)
        const isNewClient = grandTotalPrevSales < 0.01 && grandTotalSales > 0;
        const productGrowth = prevProductSet.size > 0
            ? ((productSet.size - prevProductSet.size) / prevProductSet.size) * 100
            : (productSet.size > 0 ? 100 : 0);
        const byYearTotals = formatYearStats(grandTotalsByYear, productSetsByYear);
        const totalComparison = buildYearComparison(byYearTotals);

        const summary = {
            isNewClient,
            byYear: byYearTotals,
            comparison: totalComparison,
            current: {
                label: yearsArray.join(', '),
                sales: grandTotalSales,
                margin: grandTotalMargin,
                units: grandTotalUnits,
                productCount: productSet.size
            },
            previous: {
                label: yearsArray.map(y => y - 1).join(', '),
                sales: grandTotalPrevSales,
                margin: grandTotalPrevMargin,
                units: grandTotalPrevUnits,
                productCount: prevProductSet.size
            },
            growth: {
                sales: salesGrowth,
                margin: marginGrowth,
                units: unitsGrowth,
                productCount: productGrowth
            },
            breakdown: []
        };

        res.json({
            clientCode,
            contactInfo,
            editableNotes,
            summary,
            comparisonConfig: {
                referenceYear,
                comparisonYears,
                thresholdPct: COMPARISON_THRESHOLD_PCT
            },
            grandTotal: {
                sales: grandTotalSales,
                cost: grandTotalCost,
                margin: grandTotalMargin,
                units: grandTotalUnits,
                products: productSet.size,
                byYear: byYearTotals,
                comparison: totalComparison
            },
            monthlyTotals: flatMonthlyTotals,
            availableFilters: {
                families: Array.from(availableFamiliesMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
                subfamilies: Array.from(availableSubfamiliesMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
                // FI hierarchical filters - all 5 levels
                fi1: Array.from(availableFi1Map.values()).sort((a, b) => a.name.localeCompare(b.name)),
                fi2: Array.from(availableFi2Map.values()).sort((a, b) => a.name.localeCompare(b.name)),
                fi3: Array.from(availableFi3Map.values()).sort((a, b) => a.name.localeCompare(b.name)),
                fi4: Array.from(availableFi4Map.values()).sort((a, b) => a.name.localeCompare(b.name)),
                fi5: Array.from(availableFi5Map.values()).sort((a, b) => a.name.localeCompare(b.name))
            },
            families, // Legacy: familia > subfamilia > productos
            fiHierarchy, // NEW: FI1 > FI2 > FI3 > FI4 > productos (5 niveles)
            years: yearsArray,
            months: { start: monthStart, end: monthEnd }
        });

    } catch (error) {
        if (error?.matrixSql) logger.error(`[MATRIX SQL] ${error.matrixSql}`);
        const odbcState = (error?.odbcErrors || []).map((entry) => entry.state).find(Boolean);
        const code = odbcState === '22003'
            ? 'OBJECTIVES_MATRIX_NUMERIC_OVERFLOW'
            : 'OBJECTIVES_MATRIX_ERROR';
        handleRouteError(error, res, 'Error obteniendo matriz de cliente', 500, { code });
    }
});

// =============================================================================
// POPULATIONS (For dropdown filters)
// =============================================================================
router.get('/populations', verifyToken, async (req, res) => {
    try {
        res.json(await getPopulations());
    } catch (error) {
        logger.error(`Error getting populations: ${error.message}`);
        res.status(500).json([]);
    }
});

// =============================================================================
// OBJECTIVES BY CLIENT
// =============================================================================
router.get('/by-client', verifyToken, requireVendorQueryScope, async (req, res, next) => {
    try {
        await objectivesByClientBreaker.execute(
            () => handleByClientRequest(req, res),
            async () => {
                if (res.headersSent) return null;
                const effectiveVendorCodes = scopeVendorCodesForUser(req.user?.code, req.query.vendedorCodes);
                const rowsLimit = clampByClientLimit(req.query.limit);
                const hasFilters = req.query.city || req.query.code || req.query.nif || req.query.name;
                const cache = byClientHistoricalCache(
                    effectiveVendorCodes,
                    req.query.years,
                    req.query.months,
                    rowsLimit,
                    getCurrentDate(),
                );
                const cacheKey = cache.key;
                const cachedResult = !hasFilters ? await redisCache.get('route', cacheKey) : null;
                if (cachedResult) {
                    return res.json({ ...cachedResult, stale: true, warning: 'Objetivos por cliente servidos desde cache por timeout DB2' });
                }
                return res.status(503).json({
                    success: false,
                    error: 'Objetivos por cliente no disponibles dentro del timeout seguro',
                    clients: [],
                    count: 0,
                    limit: rowsLimit,
                });
            }
        );
    } catch (error) {
        if (res.headersSent) return;
        next(error);
    }
});

async function handleByClientRequest(req, res) {
    let cacheKey;
    try {
        const { vendedorCodes, years, months, city, code, nif, name, limit } = req.query;
        const effectiveVendorCodes = scopeVendorCodesForUser(req.user?.code, vendedorCodes);
        const now = getCurrentDate();

        // PERF: Route-level cache for by-client (only when no search filters)
        const hasFilters = city || code || nif || name;
        const rowsLimit = clampByClientLimit(limit);
        const byClientCache = byClientHistoricalCache(effectiveVendorCodes, years, months, rowsLimit, now);
        cacheKey = byClientCache.key;
        if (!hasFilters) {
            const cachedResult = await redisCache.get('route', cacheKey);
            if (cachedResult) {
                logger.info(`[OBJECTIVES] ⚡ Cache HIT for by-client (${cacheKey})`);
                if (!res.headersSent) return res.json(cachedResult);
                return;
            }
            const stampede = await beginRouteFill(cacheKey);
            if (stampede.hit) {
                logger.info(`[OBJECTIVES] ⚡ Cache HIT for by-client after wait (${cacheKey})`);
                if (!res.headersSent) return res.json(stampede.hit);
                return;
            }
            if (stampede.busy) {
                return sendFillBusy(res);
            }
            req._byClientFillLock = stampede.lock;
        }

        // Datos en services/objectives-service.js (buildByClientPayload) + repo.
        const responseData = await buildByClientPayload({ effectiveVendorCodes, years, months, city, code, nif, name, limit });
        // (cuerpo movido a buildByClientPayload en services/objectives-service.js)
        // (construccion de responseData movida a buildByClientPayload)

        // PERF: Cache result if no search filters (5 min)
        if (!hasFilters) {
            await redisCache.set('route', cacheKey, responseData, byClientCache.ttl);
            logger.info(`[OBJECTIVES] 💾 Cached by-client (${cacheKey})`);
        }

        if (!res.headersSent) {
            res.json(responseData);
        }

    } catch (error) {
        logger.error(`Objectives by-client error: ${error.message}`);
        if (!res.headersSent) {
            handleRouteError(error, res, 'Error obteniendo objetivos por cliente', 500, { code: 'OBJECTIVES_BY_CLIENT_ERROR' });
        }
    } finally {
        if (req._byClientFillLock && cacheKey) {
            await endRouteFill(cacheKey, req._byClientFillLock);
            req._byClientFillLock = null;
        }
    }
}

async function fillEvolutionRouteCacheForAll(now = getCurrentDate()) {
    const years = String(now.getFullYear());
    const cache = buildEvolutionRouteCacheKey('ALL', years, now);
    const existing = await redisCache.get('route', cache.key);
    if (existing) {
        return { skipped: true, cacheKey: cache.key, assembled: true };
    }

    const layer = router.stack.find((item) => item.route && item.route.path === '/evolution');
    const handlers = layer?.route?.stack?.map((item) => item.handle) || [];
    const handler = handlers[handlers.length - 1];
    if (typeof handler !== 'function') {
        throw new Error('objectives /evolution handler not found');
    }

    return new Promise((resolve, reject) => {
        const req = {
            method: 'GET',
            url: `/evolution?vendedorCodes=ALL&years=${years}`,
            query: { vendedorCodes: 'ALL', years },
            params: {},
            user: { code: '98', role: 'JEFE_VENTAS', isJefeVentas: true },
            headers: {},
            get: () => undefined,
        };
        const res = {
            headersSent: false,
            statusCode: 200,
            setHeader() {},
            set() { return this; },
            status(code) {
                this.statusCode = code;
                return this;
            },
            json() {
                this.headersSent = true;
                resolve({
                    skipped: false,
                    cacheKey: cache.key,
                    assembled: this.statusCode === 200,
                    status: this.statusCode,
                });
                return this;
            },
        };
        Promise.resolve(handler(req, res)).then(() => {
            if (!res.headersSent) {
                resolve({
                    skipped: false,
                    cacheKey: cache.key,
                    assembled: false,
                    status: res.statusCode,
                });
            }
        }).catch(reject);
    });
}

module.exports = router;
module.exports.buildEvolutionRouteCacheKey = buildEvolutionRouteCacheKey;
module.exports.fillEvolutionRouteCacheForAll = fillEvolutionRouteCacheForAll;
module.exports.OBJECTIVES_CACHE_VERSION = OBJECTIVES_CACHE_VERSION;
module.exports.overlayOpenMonthFromLiveLaclae = overlayOpenMonthFromLiveLaclae;
// Cotas by-client pinnadas por contrato de ruta (objectives_by_client_contracts);
// la implementacion vive en services/objectives-service.js (clampByClientLimit).
module.exports.BY_CLIENT_ROUTE_LIMITS = {
    BY_CLIENT_DEFAULT_LIMIT,
    BY_CLIENT_MAX_LIMIT,
};

module.exports.getObjectivesEvolutionCached = getObjectivesEvolutionCached;
