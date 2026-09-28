'use strict';

/**
 * Objectives service — reglas de negocio + acceso DB2 leaf de objetivos.
 *
 * Funciones movidas verbatim desde backend/routes/objectives.js (sin cambios
 * de comportamiento ni de shapes JSON). La ruta conserva la orquestacion de
 * handlers y las funciones pinnadas por tests de arquitectura
 * (fetchObjectiveEvolutionRows*, overlayOpenMonthFromLiveLaclae, evolution
 * builder, matrix, by-client, populations).
 *
 * TODO(DIP): recibir query/queryWithParams por parametros en vez de requires
 * directos (patron actual del repo por tiempo).
 */

const logger = require('../middleware/logger');
const {
    getCurrentDate,
    buildBoundVendorFilter,
    buildBoundLaclaeVendorFilter,
    getVendorColumn,
    getBSalesByVendor,
    aggregateBSalesByMonth,
    sanitizeForSQL,
} = require('../utils/common');
const {
    isCommercial80User,
    resolveAllModeVendorCodesString,
} = require('./team-commission.service');
const {
    applyHybridMonthlyObjectives,
    computeSeasonalWeightTargets,
    applyMonthlyObjectiveRebalances,
    hasObjectiveMonthlyRebalances,
    getAnnualObjectiveAdjustment,
    sumMonthlyObjectives,
} = require('../routes/objectives-hybrid-helpers');
const {
    DEFAULT_PORCENTAJE_MEJORA,
    getAlignedVendorSalesForObjectives,
    resolveObjectiveSalesTarget,
} = require('../utils/objectives-source');
const repo = require('../repositories/objectives-repository');

const BY_CLIENT_DEFAULT_LIMIT = 100;
const BY_CLIENT_MAX_LIMIT = 250;

function clampByClientLimit(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return BY_CLIENT_DEFAULT_LIMIT;
    return Math.min(BY_CLIENT_MAX_LIMIT, parsed);
}

function chunkArray(values, size) {
    const chunks = [];
    for (let i = 0; i < values.length; i += size) {
        chunks.push(values.slice(i, i + size));
    }
    return chunks;
}

async function mapChunksWithConcurrency(chunks, concurrency, mapper) {
    const results = new Array(chunks.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, async () => {
        while (next < chunks.length) {
            const index = next++;
            results[index] = await mapper(chunks[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}

// =============================================================================
// INHERITED OBJECTIVES LOGIC
// For new vendors who don't have full history, we calculate objectives based
// on the sales of previous vendors who managed their current clients.
// =============================================================================

/**
 * Get all clients currently managed by a vendor (from current year or most recent data)
 */
async function getVendorCurrentClients(vendorCode, currentYear) {
    // Uses getVendorColumn(year) for date-aware column (LCCDVD before March 2026, R1_T8CDVD after)
    const safeVendorCode = sanitizeForSQL(vendorCode);
    const col = getVendorColumn(currentYear);
    const rows = await repo.fetchObjectiveVendorClients(safeVendorCode, col, currentYear);

    // If no clients in current year, try previous year
    if (rows.length === 0) {
        const prevCol = getVendorColumn(currentYear - 1);
        const prevRows = await repo.fetchObjectiveVendorClients(safeVendorCode, prevCol, currentYear - 1);
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

    const safeCodes = clientCodes.map((c) => sanitizeForSQL(c));

    const rows = await repo.fetchClientsMonthlySales(safeCodes, year);

    // Build map: month -> {sales, cost, clients}
    const monthlyMap = {};
    rows.forEach((r) => {
        monthlyMap[r.MONTH] = {
            sales: parseFloat(r.SALES) || 0,
            cost: parseFloat(r.COST) || 0,
            clients: parseInt(r.CLIENTS, 10) || 0,
        };
    });

    return monthlyMap;
}


const SEASONAL_AGGRESSIVENESS = 0.5; // Tuning parameter for seasonality (0.0=flat, 1.0=high)
const IPC = 1.03; // 3% inflation factor

// Month number -> COFC quota column mapping
const MONTH_QUOTA_MAP = {
    1: 'CUOTAENERO', 2: 'CUOTAFEBRERO', 3: 'CUOTAMARZO', 4: 'CUOTAABRIL',
    5: 'CUOTAMAYO', 6: 'CUOTAJUNIO', 7: 'CUOTAJULIO', 8: 'CUOTAAGOSTO',
    9: 'CUOTASEPTIEMBRE', 10: 'CUOTAOCTUBRE', 11: 'CUOTANOVIEMBRE', 12: 'CUOTADICIEMBRE',
};

/**
 * Get target percentage configuration for a vendor
 * Defaults to 10% if not configured
 */
async function getVendorTargetConfig(vendorCode) {
    if (!vendorCode || vendorCode === 'ALL') return 10.0;
    try {
        const code = vendorCode.split(',')[0].trim();
        const codeVariants = getVendorCodeVariants(code);
        if (codeVariants.length === 0) return 10.0;

        const explicitRows = await repo.fetchObjConfigExplicit(codeVariants);

        if (explicitRows.length > 0) {
            return parseFloat(explicitRows[0].TARGET_PERCENTAGE) || 10.0;
        }

        const vendorRows = await repo.fetchObjConfigVendor(codeVariants);

        if (vendorRows.length > 0) {
            return parseFloat(vendorRows[0].TARGET_PERCENTAGE) || 10.0;
        }

        const globalRows = await repo.fetchObjConfigGlobal();

        if (globalRows.length > 0) {
            return parseFloat(globalRows[0].TARGET_PERCENTAGE) || 10.0;
        }
        return 10.0;
    } catch (e) {
        logger.warn(`Could not fetch OBJ_CONFIG: ${e.message}`);
        return 10.0;
    }
}

function getVendorCodeVariants(vendorCode) {
    const raw = String(vendorCode || '').trim();
    if (!raw) return [];
    const unpadded = raw.replace(/^0+/, '') || raw;
    const padded = /^[0-9]+$/.test(unpadded) ? unpadded.padStart(2, '0') : raw;
    return [...new Set([raw, unpadded, padded])];
}

function parseVendorCodes(vendedorCodes) {
    if (!vendedorCodes || vendedorCodes === 'ALL') return [];
    return vendedorCodes
        .split(',')
        .map((v) => v.replace(/[^a-zA-Z0-9]/g, '').trim().toUpperCase())
        .filter((code) => code !== 'UNK' && code.length <= 2)
        .filter(Boolean);
}

/** Commercial 80 "Todos" → aggregate 72,73,81,83 only (not global ALL). */
function scopeVendorCodesForUser(userCode, vendedorCodes) {
    if ((!vendedorCodes || vendedorCodes === 'ALL') && isCommercial80User(userCode)) {
        return resolveAllModeVendorCodesString(userCode);
    }
    return vendedorCodes;
}

async function addBSalesToRows(rows, vendorCodesArray, uniqueYears) {
    const scopedVendorCodes = vendorCodesArray || [];

    // Years are independent VENTAS_B lookups — fetch in parallel instead of
    // serially paying each year's roundtrip (up to 6 years before).
    const bSalesResults = await Promise.all(
        uniqueYears.map((yr) => getBSalesByVendor(yr, scopedVendorCodes)),
    );

    // Index rows once by (year, month) so the merge below is O(rows), not a
    // find() scan per month per year.
    const rowsByYearMonth = new Map();
    for (const row of rows) {
        rowsByYearMonth.set(`${row.YEAR}:${row.MONTH}`, row);
    }

    uniqueYears.forEach((yr, index) => {
        const bSalesByMonth = aggregateBSalesByMonth(bSalesResults[index]);
        for (const [month, amount] of Object.entries(bSalesByMonth)) {
            const value = parseFloat(amount) || 0;
            if (value === 0) continue;

            const m = parseInt(month, 10);
            const existingRow = rowsByYearMonth.get(`${yr}:${m}`);
            if (existingRow) {
                existingRow.SALES = (parseFloat(existingRow.SALES) || 0) + value;
            } else {
                const newRow = { YEAR: yr, MONTH: m, SALES: value, COST: 0, CLIENTS: 0 };
                rowsByYearMonth.set(`${yr}:${m}`, newRow);
                rows.push(newRow);
            }
        }
    });
}

function aggregateObjectiveRows(rows) {
    const byMonth = new Map();
    (rows || []).forEach((row) => {
        const year = parseInt(row.YEAR, 10);
        const month = parseInt(row.MONTH, 10);
        if (!year || !month) return;

        const key = `${year}:${month}`;
        const current = byMonth.get(key) || {
            YEAR: year,
            MONTH: month,
            SALES: 0,
            COST: 0,
            CLIENTS: 0,
        };
        current.SALES += parseFloat(row.SALES) || 0;
        current.COST += parseFloat(row.COST) || 0;
        current.CLIENTS += parseInt(row.CLIENTS, 10) || 0;
        byMonth.set(key, current);
    });
    return Array.from(byMonth.values()).sort((a, b) => (a.YEAR - b.YEAR) || (a.MONTH - b.MONTH));
}

async function getFixedMonthlyObjectiveTarget(vendorCode, year, month) {
    const codeVariants = getVendorCodeVariants(vendorCode);
    if (codeVariants.length === 0) return null;

    try {
        const fixedRows = await repo.fetchFixedMonthlyTarget(codeVariants, year, month);

        if (!fixedRows || fixedRows.length === 0) return null;
        const fixedMonthlyTarget = parseFloat(fixedRows[0].IMPORTE_OBJETIVO) || null;
        return fixedMonthlyTarget && fixedMonthlyTarget > 0 ? fixedMonthlyTarget : null;
    } catch (err) {
        logger.debug(`[OBJECTIVES] COMMERCIAL_TARGETS: ${err.message}`);
        return null;
    }
}

/**
 * Get exact monthly targets (no pastRecent fallback).
 * Used by the hybrid override logic to only override explicitly set months.
 */
async function getExactMonthlyTargets(vendorCode, year) {
    const codeVariants = getVendorCodeVariants(vendorCode);
    if (codeVariants.length === 0) return {};

    try {
        const rows = await repo.fetchExactMonthlyTargets(codeVariants, year);

        const targets = {};
        (rows || []).forEach((row) => {
            const mes = parseInt(row.MES, 10);
            const val = parseFloat(row.IMPORTE_OBJETIVO) || 0;
            if (mes > 0 && val > 0) targets[mes] = val;
        });
        return targets;
    } catch (err) {
        logger.debug(`[OBJECTIVES] getExactMonthlyTargets error: ${err.message}`);
        return {};
    }
}

/**
 * Global pinned months (JEFE / ALL): sum objectives only for months where
 * multiple comerciales have COMMERCIAL_TARGETS (e.g. May global 1.41M).
 */
async function getGlobalPinnedMonthlyTargets(year) {
    try {
        const aggregated = await repo.fetchGlobalPinnedMonthlyTargets(year);

        const targets = {};
        (aggregated || []).forEach((r) => {
            const mes = parseInt(r.MES, 10);
            const val = parseFloat(r.TOTAL) || 0;
            if (mes > 0 && val > 0) targets[mes] = val;
        });
        return targets;
    } catch (err) {
        logger.debug(`[OBJECTIVES] getGlobalPinnedMonthlyTargets error: ${err.message}`);
        return {};
    }
}

async function getScopedPinnedMonthlyTargets(year, vendorCodes) {
    const allVariants = [...new Set(
        vendorCodes.flatMap((code) => getVendorCodeVariants(code)),
    )];
    if (allVariants.length === 0) return {};

    try {
        const aggregated = await repo.fetchScopedPinnedMonthlyTargets(year, allVariants);

        const targets = {};
        (aggregated || []).forEach((r) => {
            const mes = parseInt(r.MES, 10);
            const val = parseFloat(r.TOTAL) || 0;
            if (mes > 0 && val > 0) targets[mes] = val;
        });
        return targets;
    } catch (err) {
        logger.debug(`[OBJECTIVES] getScopedPinnedMonthlyTargets error: ${err.message}`);
        return {};
    }
}

async function getFixedMonthlyObjectiveTargets(vendorCode, year) {
    const codeVariants = getVendorCodeVariants(vendorCode);
    if (codeVariants.length === 0) return {};

    try {
        const rows = await repo.fetchFixedMonthlyObjectiveTargets(codeVariants, year);

        const fixedRows = (rows || [])
            .map((row) => ({
                mes: row.MES != null ? parseInt(row.MES, 10) : null,
                importe: parseFloat(row.IMPORTE_OBJETIVO) || 0,
            }))
            .filter((row) => row.importe > 0)
            .sort((a, b) => (b.mes ?? 0) - (a.mes ?? 0));

        const targets = {};
        for (let m = 1; m <= 12; m++) {
            const exact = fixedRows.find((row) => row.mes === m);
            const annual = fixedRows.find((row) => row.mes === null);
            const pastRecent = fixedRows.find((row) => row.mes !== null && row.mes < m);
            const resolved = exact?.importe || annual?.importe || pastRecent?.importe || 0;
            if (resolved > 0) targets[m] = resolved;
        }
        return targets;
    } catch (err) {
        logger.debug(`[OBJECTIVES] COMMERCIAL_TARGETS monthly lookup: ${err.message}`);
        return {};
    }
}

const _globalObjectiveBaselineCache = new Map();

async function getGlobalObjectiveBaselineMonthly(year) {
    const safeYear = parseInt(year, 10);
    if (!safeYear) return {};

    const cacheKey = String(safeYear);
    if (_globalObjectiveBaselineCache.has(cacheKey)) {
        return _globalObjectiveBaselineCache.get(cacheKey);
    }

    const prevYear = safeYear - 1;
    const rows = await repo.fetchGlobalBaselinePrevYear(prevYear);

    await addBSalesToRows(rows, [], [prevYear]);

    const prevYearMonthlySales = {};
    let combinedPrevTotal = 0;
    for (let m = 1; m <= 12; m++) {
        const row = rows.find((r) => Number(r.YEAR) === prevYear && Number(r.MONTH) === m);
        const sales = row ? parseFloat(row.SALES) || 0 : 0;
        prevYearMonthlySales[m] = sales;
        combinedPrevTotal += sales;
    }

    const targetPct = await getVendorTargetConfig('ALL');
    const fixedTargetsForYear = await getGlobalPinnedMonthlyTargets(safeYear);
    const annualAdjustment = getAnnualObjectiveAdjustment(safeYear);
    const monthly = Object.keys(fixedTargetsForYear).length > 0 && combinedPrevTotal > 0
        ? applyHybridMonthlyObjectives(
            prevYearMonthlySales,
            combinedPrevTotal,
            targetPct,
            fixedTargetsForYear,
            { annualAdjustment },
        ).monthly
        : (() => {
            const weights = computeSeasonalWeightTargets(
                prevYearMonthlySales,
                combinedPrevTotal,
                targetPct,
            );
            if (!annualAdjustment) return weights;
            const seasonalAnnual = Object.values(weights).reduce((s, v) => s + v, 0);
            if (seasonalAnnual <= 0) return weights;
            const targetAnnual = Math.max(0, seasonalAnnual + annualAdjustment);
            const factor = targetAnnual / seasonalAnnual;
            const scaled = {};
            for (let m = 1; m <= 12; m++) scaled[m] = (weights[m] || 0) * factor;
            return scaled;
        })();

    _globalObjectiveBaselineCache.set(cacheKey, monthly);
    return monthly;
}

function buildObjectiveRebalanceAllocationFactors(monthlyTargets, globalMonthlyTargets) {
    const factors = {};
    for (let m = 1; m <= 12; m++) {
        const globalValue = parseFloat(globalMonthlyTargets?.[m]) || 0;
        const localValue = parseFloat(monthlyTargets?.[m]) || 0;
        factors[m] = globalValue > 0 ? localValue / globalValue : 0;
    }
    return factors;
}

async function applyConfiguredObjectiveRebalances(year, monthlyTargets, vendorCode = null) {
    if (!hasObjectiveMonthlyRebalances(year)) return monthlyTargets;

    let allocationFactorsByMonth = null;
    if (vendorCode) {
        const globalBaseline = await getGlobalObjectiveBaselineMonthly(year);
        allocationFactorsByMonth = buildObjectiveRebalanceAllocationFactors(
            monthlyTargets,
            globalBaseline,
        );
    }

    return applyMonthlyObjectiveRebalances(monthlyTargets, year, { allocationFactorsByMonth });
}

async function buildVendorObjectiveTargets(vendorCode, yearsArray) {
    const currentYear = Math.max(...yearsArray);
    const uniqueYears = [...new Set([...yearsArray, ...yearsArray.map((y) => y - 1)])];
    const vendedorFilter = buildBoundLaclaeVendorFilter(vendorCode, 'L');

    const rows = await repo.fetchVendorEvolutionRows(uniqueYears, vendedorFilter.clause, vendedorFilter.params);

    await addBSalesToRows(rows, [vendorCode], uniqueYears);

    let inheritedMonthlySales = {};
    const prevYear = currentYear - 1;
    const monthsWithData = rows.filter((r) => Number(r.YEAR) === prevYear).map((r) => Number(r.MONTH));
    const missingMonths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((m) => !monthsWithData.includes(m));

    if (missingMonths.length > 0) {
        const currentClients = await getVendorCurrentClients(vendorCode, currentYear);
        if (currentClients.length > 0) {
            inheritedMonthlySales = await getClientsMonthlySales(currentClients, prevYear);
        }
    }

    const targetPct = await getVendorTargetConfig(vendorCode);
    const monthlyObjectiveByYear = {};
    const annualObjectiveByYear = {};

    for (const year of yearsArray) {
        let prevYearTotal = 0;
        let inheritedTotal = 0;
        let currentYearTotalSoFar = 0;
        const prevYearMonthlySales = {};

        for (let m = 1; m <= 12; m++) {
            const row = rows.find((r) => Number(r.YEAR) === year && Number(r.MONTH) === m);
            const prevRow = rows.find((r) => Number(r.YEAR) === (year - 1) && Number(r.MONTH) === m);
            const ownPrevSales = prevRow ? parseFloat(prevRow.SALES) || 0 : 0;

            if (ownPrevSales === 0 && inheritedMonthlySales[m]) {
                inheritedTotal += inheritedMonthlySales[m].sales;
                prevYearMonthlySales[m] = inheritedMonthlySales[m].sales;
            } else {
                prevYearTotal += ownPrevSales;
                prevYearMonthlySales[m] = ownPrevSales;
            }

            if (row) currentYearTotalSoFar += parseFloat(row.SALES) || 0;
        }

        const combinedPrevTotal = prevYearTotal + inheritedTotal;
        const exactFixedByMonth = await getExactMonthlyTargets(vendorCode, year);
        const hasPinnedMonths = Object.keys(exactFixedByMonth).length > 0;

        let annualObjective;
        let seasonalTargets = {};

        if (hasPinnedMonths && combinedPrevTotal > 0) {
            const hybrid = applyHybridMonthlyObjectives(
                prevYearMonthlySales,
                combinedPrevTotal,
                targetPct,
                exactFixedByMonth,
            );
            seasonalTargets = hybrid.monthly;
            annualObjective = hybrid.annual;
        } else if (combinedPrevTotal > 0) {
            seasonalTargets = computeSeasonalWeightTargets(
                prevYearMonthlySales,
                combinedPrevTotal,
                targetPct,
            );
            annualObjective = Object.values(seasonalTargets).reduce((s, v) => s + v, 0);
        } else {
            const growthFactor = 1 + (targetPct / 100);
            annualObjective = currentYearTotalSoFar > 0
                ? currentYearTotalSoFar * growthFactor
                : 0;
            for (let m = 1; m <= 12; m++) seasonalTargets[m] = annualObjective / 12;
        }

        seasonalTargets = await applyConfiguredObjectiveRebalances(year, seasonalTargets, vendorCode);
        annualObjective = sumMonthlyObjectives(seasonalTargets);
        monthlyObjectiveByYear[year] = seasonalTargets;
        annualObjectiveByYear[year] = annualObjective;
    }

    return { monthlyObjectiveByYear, annualObjectiveByYear };
}

function mergeVendorObjectiveTargets(targetSets, yearsArray) {
    const monthlyObjectiveByYear = {};
    const annualObjectiveByYear = {};

    for (const year of yearsArray) {
        monthlyObjectiveByYear[year] = {};
        annualObjectiveByYear[year] = 0;

        for (let m = 1; m <= 12; m++) {
            monthlyObjectiveByYear[year][m] = targetSets.reduce((sum, set) => (
                sum + (set.monthlyObjectiveByYear[year]?.[m] || 0)
            ), 0);
        }

        annualObjectiveByYear[year] = targetSets.reduce((sum, set) => (
            sum + (set.annualObjectiveByYear[year] || 0)
        ), 0);
    }

    return { monthlyObjectiveByYear, annualObjectiveByYear };
}

// =============================================================================
// OBJECTIVES SUMMARY (Quota vs Actual) — cuerpo del handler GET /
// =============================================================================
async function getObjectivesSummary({ vendedorCodes, year, month }) {
    const now = getCurrentDate();
    const targetYear = parseInt(year, 10) || now.getFullYear();
    const targetMonth = parseInt(month, 10) || (now.getMonth() + 1);
    const vendedorFilter = buildBoundVendorFilter(vendedorCodes, 'CODIGOVENDEDOR');

    // 1. Get Target Configuration (Global % increase)
    const targetPct = await getVendorTargetConfig(vendedorCodes);

    // Intentar obtener objetivos desde COFC (cuotas mensuales)
    let salesObjective = 0;
    let marginObjective = 0;
    let objectiveSource = 'calculated'; // 'database' o 'calculated'

    try {
        // Obtener cuota del mes desde COFC (puede estar vinculada a vendedor o global)
        // Nota: Si hay filtro de vendedor, quizás deberíamos filtrar la cuota también
        // Por ahora mantenemos lógica global si no es específica
        const quotaField = MONTH_QUOTA_MAP[targetMonth];
        if (quotaField) {
            // Si hay vendedor específico, intentar filtrar COFC si tiene columna vendedor (o usar CMV)
            // Por ahora mantenemos lógica global si no es específica
            const quotaResult = await repo.fetchCofcQuota(quotaField);

            if (quotaResult[0] && parseFloat(quotaResult[0].QUOTA) > 0) {
                salesObjective = parseFloat(quotaResult[0].QUOTA);
                objectiveSource = 'database';
            }
        }
    } catch (e) {
        logger.warn(`COFC query failed, using calculated objectives: ${e.message}`);
    }

    // Intentar obtener objetivo de CMV (por vendedor) si no hay cuota global y se pide un vendedor
    if (salesObjective === 0 && vendedorCodes && vendedorCodes !== 'ALL') {
        try {
            const code = vendedorCodes.split(',')[0].trim();
            const cmvResult = await repo.fetchCmvObjective(code);

            if (cmvResult[0]) {
                const cmvObjective = parseFloat(cmvResult[0].OBJETIVO) || 0;
                // If CMV has explicit amount, use it (highest priority)
                if (cmvObjective > 0) {
                    salesObjective = cmvObjective;
                    objectiveSource = 'database';
                }
                // Note: We ignore cmvPercentage here and use our new JAVIER.OBJ_CONFIG logic
                // unless you strictly want to fallback to CMV percentage.
                // User requested "dynamic" from their new table, so we prioritize that flow below.
            }
        } catch (e) {
            logger.warn(`CMV query failed: ${e.message}`);
        }
    }

    const [alignedCurrent, currentMetrics, lastYearSales] = await Promise.all([
        getAlignedVendorSalesForObjectives(vendedorCodes, targetYear, targetMonth),
        repo.fetchLacMonthMargin(targetYear, targetMonth, vendedorFilter.clause, vendedorFilter.params),
        repo.fetchLacMonthSales(targetYear - 1, targetMonth, vendedorFilter.clause, vendedorFilter.params),
    ]);

    const curr = currentMetrics[0] || {};
    const last = lastYearSales[0] || {};

    const salesCurrent = parseFloat(alignedCurrent.sales) || 0;
    const salesLast = parseFloat(last.SALES) || 0;

    if (salesObjective === 0) {
        salesObjective = resolveObjectiveSalesTarget(
            salesCurrent,
            alignedCurrent.rawTarget,
            DEFAULT_PORCENTAJE_MEJORA,
        );
        objectiveSource = alignedCurrent.rawTarget != null && alignedCurrent.rawTarget > 0
            ? 'commercial_targets'
            : 'calculated';
    }

    const salesProgress = salesObjective > 0 ? (salesCurrent / salesObjective) * 100 : 0;

    const marginCurrent = parseFloat(curr.MARGIN) || 0;
    const marginLast = parseFloat(last.MARGIN) || 0;
    // Si no hay marginObjective global, usar histórico + target%
    marginObjective = marginObjective || (marginLast * (1 + targetPct / 100));
    const marginProgress = marginObjective > 0 ? (marginCurrent / marginObjective) * 100 : 0;

    const clientsCurrent = parseInt(curr.CLIENTS, 10) || 0;
    const clientsLast = parseInt(last.CLIENTS, 10) || 0;
    const clientsObjective = Math.ceil(clientsLast * 1.05); // Clients usually fixed 5% or similar
    const clientsProgress = clientsObjective > 0 ? (clientsCurrent / clientsObjective) * 100 : 0;

    // Alertas
    const alerts = [];
    if (salesProgress < 80) alerts.push({ type: 'warning', message: `Ventas al ${salesProgress.toFixed(0)}% del objetivo` });
    if (salesProgress < 50) alerts.push({ type: 'danger', message: 'Ventas muy por debajo del objetivo' });
    if (marginProgress < 70) alerts.push({ type: 'warning', message: 'Margen por debajo del esperado' });

    return {
        period: { year: targetYear, month: targetMonth },
        objectiveSource,
        targetPercentage: targetPct, // Return for debug/ui
        objectives: {
            sales: {
                target: salesObjective,
                current: salesCurrent,
                lastYear: salesLast,
                progress: Math.round(salesProgress * 10) / 10,
                variation: salesLast > 0 ? Math.round(((salesCurrent - salesLast) / salesLast) * 1000) / 10 : 0,
            },
            margin: {
                target: marginObjective,
                current: marginCurrent,
                lastYear: marginLast,
                progress: Math.round(marginProgress * 10) / 10,
            },
            clients: {
                target: clientsObjective,
                current: clientsCurrent,
                lastYear: clientsLast,
                progress: Math.round(clientsProgress * 10) / 10,
            },
        },
        alerts,
    };
}

module.exports = {
    BY_CLIENT_DEFAULT_LIMIT,
    BY_CLIENT_MAX_LIMIT,
    SEASONAL_AGGRESSIVENESS,
    IPC,
    MONTH_QUOTA_MAP,
    clampByClientLimit,
    chunkArray,
    mapChunksWithConcurrency,
    getVendorCurrentClients,
    getClientsMonthlySales,
    getVendorTargetConfig,
    getVendorCodeVariants,
    parseVendorCodes,
    scopeVendorCodesForUser,
    addBSalesToRows,
    aggregateObjectiveRows,
    getFixedMonthlyObjectiveTarget,
    getExactMonthlyTargets,
    getGlobalPinnedMonthlyTargets,
    getScopedPinnedMonthlyTargets,
    getFixedMonthlyObjectiveTargets,
    getGlobalObjectiveBaselineMonthly,
    buildObjectiveRebalanceAllocationFactors,
    applyConfiguredObjectiveRebalances,
    buildVendorObjectiveTargets,
    mergeVendorObjectiveTargets,
    getObjectivesSummary,
};
