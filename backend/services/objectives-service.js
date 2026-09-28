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
    MIN_YEAR,
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
const { getClientCodesFromCache } = require('./laclae');
const { buildMonthFilterParameterized } = require('../src/utils/dashboardFilters');
const {
    getCachedFamilyNames,
    getCachedFi1Names,
    getCachedFi2Names,
    getCachedFi3Names,
    getCachedFi4Names,
    getCachedFi5Names,
    isCacheReady: isMetadataCacheReady,
} = require('./metadataCache');
const repo = require('../repositories/objectives-repository');

const BY_CLIENT_MAX_CLIENT_CODE_IN_PARAMS = 200;
const BY_CLIENT_CODE_BATCH_SIZE = 40;
const BY_CLIENT_BATCH_CONCURRENCY = 4;

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
// MATRIX — queries movidas verbatim desde routes/objectives.js (handler /matrix).
// La ruta conserva validacion de alcance, filtros de entrada y agregacion de
// presentacion; el acceso DB2 vive aqui + repositories/objectives-repository.js.
// =============================================================================

async function getMatrixContactAndNotes(clientCode) {
    const [contactRows, notesRows] = await Promise.all([
        repo.fetchMatrixContact(clientCode).catch(e => { logger.warn(`Could not load contact info: ${e.message}`); return []; }),
        repo.fetchMatrixNotes(clientCode).catch(e => { logger.debug(`Notes table not available: ${e.message}`); return []; })
    ]);

    let contactInfo = { phone: '', phone2: '', email: '', phones: [] };
    let editableNotes = null;
    if (contactRows.length > 0) {
        const c = contactRows[0];
        const phones = [];
        if (c.PHONE?.trim()) phones.push({ type: 'Teléfono 1', number: c.PHONE.trim() });
        if (c.PHONE2?.trim()) phones.push({ type: 'Teléfono 2', number: c.PHONE2.trim() });
        contactInfo = {
            phone: c.PHONE?.trim() || '',
            phone2: c.PHONE2?.trim() || '',
            email: '',
            phones
        };
    }
    if (notesRows.length > 0) {
        editableNotes = {
            text: notesRows[0].OBSERVACIONES,
            modifiedBy: notesRows[0].MODIFIED_BY
        };
    }
    return { contactInfo, editableNotes };
}

function getMatrixProductRows(clientCode, uniqueYears, monthStart, monthEnd, filterConditions, filterParams) {
    return repo.fetchMatrixProductRows(clientCode, uniqueYears, monthStart, monthEnd, filterConditions, filterParams);
}

async function getMatrixFamilyAndFiNames() {
    const familyNames = {};
    let fi1Names = {}, fi2Names = {}, fi3Names = {}, fi4Names = {}, fi5Names = {};

    if (isMetadataCacheReady()) {
        // Use cached data (instant)
        Object.assign(familyNames, getCachedFamilyNames() || {});
        fi1Names = getCachedFi1Names() || {};
        fi2Names = getCachedFi2Names() || {};
        fi3Names = getCachedFi3Names() || {};
        fi4Names = getCachedFi4Names() || {};
        fi5Names = getCachedFi5Names() || {};
    } else {
        // Fallback: load from database (slower)
        try {
            const famRows = await repo.fetchMatrixFamilyNames();
            famRows.forEach(r => { familyNames[r.CODIGOFAMILIA?.trim()] = r.DESCRIPCIONFAMILIA?.trim() || r.CODIGOFAMILIA?.trim(); });

            for (const [level, setter] of [['FI1', (v) => { fi1Names = v; }], ['FI2', (v) => { fi2Names = v; }], ['FI3', (v) => { fi3Names = v; }], ['FI4', (v) => { fi4Names = v; }], ['FI5', (v) => { fi5Names = v; }]]) {
                const rows = await repo.fetchMatrixFiNames(level);
                const names = {};
                rows.forEach(r => {
                    const code = (r.CODIGOFILTRO || '').toString().trim();
                    const name = (r.DESCRIPCIONFILTRO || '').toString().trim();
                    if (code) names[code] = name;
                });
                setter(names);
            }
        } catch (e) {
            logger.warn(`Could not load family/FI names: ${e.message}`);
        }
    }
    return { familyNames, fi1Names, fi2Names, fi3Names, fi4Names, fi5Names };
}

// =============================================================================
// POPULATIONS — movido verbatim desde routes/objectives.js (handler /populations)
// =============================================================================

async function getPopulations() {
    const rows = await repo.fetchPopulations();
    return rows.map(r => r.CITY);
}

// =============================================================================
// BY-CLIENT — cuerpo de handleByClientRequest movido verbatim desde
// routes/objectives.js. Recibe parametros ya validados y devuelve responseData
// (sin tocar res). Cache/stampede/breaker/HTTP quedan en la ruta.
// =============================================================================

async function buildByClientPayload({ effectiveVendorCodes, years, months, city, code, nif, name, limit }) {
    const now = getCurrentDate();

    // Parse years and months - default to full year
    const yearsArray = years ? years.split(',').map(y => parseInt(y.trim(), 10)).filter(y => y >= MIN_YEAR) : [now.getFullYear()];
    const monthsArray = months ? months.split(',').map(m => parseInt(m.trim(), 10)).filter(m => m >= 1 && m <= 12) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const monthPred = buildMonthFilterParameterized(monthsArray.join(','), 'L.LCMMDC');
    const monthPredBare = buildMonthFilterParameterized(monthsArray.join(','), 'LCMMDC');
    const rowsLimit = clampByClientLimit(limit);
    let extraFilters = '';
    const extraFilterParams = [];
    if (city && city.trim()) {
        extraFilters += ` AND UPPER(C.POBLACION) = ?`;
        extraFilterParams.push(city.trim().toUpperCase());
    }
    if (code && code.trim()) {
        extraFilters += ` AND C.CODIGOCLIENTE LIKE ?`;
        extraFilterParams.push(`%${code.trim()}%`);
    }
    if (nif && nif.trim()) {
        extraFilters += ` AND C.NIF LIKE ?`;
        extraFilterParams.push(`%${nif.trim()}%`);
    }
    if (name && name.trim()) {
        const safeName = `%${sanitizeForSQL(name.trim()).toUpperCase()}%`;
        extraFilters += ` AND (UPPER(C.NOMBRECLIENTE) LIKE ? OR UPPER(C.NOMBREALTERNATIVO) LIKE ?)`;
        extraFilterParams.push(safeName, safeName);
    }

    // Main year for objective calculation
    const mainYear = Math.max(...yearsArray);
    const prevYear = mainYear - 1;

    // OPTIMIZATION: Get client codes from cache instead of heavy subquery
    const cachedClientCodes = getClientCodesFromCache(effectiveVendorCodes);

    let totalClientsCount = 0;
    let currentRows = [];

    const cachedClientCodeCount = Array.isArray(cachedClientCodes) ? cachedClientCodes.length : 0;
    const canUseClientCodeSet = cachedClientCodeCount > 0 && cachedClientCodeCount <= BY_CLIENT_MAX_CLIENT_CODE_IN_PARAMS;

    if (cachedClientCodeCount > BY_CLIENT_MAX_CLIENT_CODE_IN_PARAMS) {
        logger.warn(`[OBJECTIVES] by-client cache scope has ${cachedClientCodeCount} clients; using vendor-filter SQL instead of giant IN clause`);
    }

    if (canUseClientCodeSet) {
        const safeClientCodes = cachedClientCodes.map(c => sanitizeForSQL(c));

        // Query 0: Count clients from cache (filtered by extra filters if any)
        if (extraFilters) {
            const countResult = await repo.fetchByClientFilteredCount(safeClientCodes, extraFilters, extraFilterParams);
            totalClientsCount = countResult[0] ? parseInt(countResult[0].TOTAL, 10) : 0;
        } else {
            totalClientsCount = cachedClientCodes.length;
        }

        if (!extraFilters) {
            // Fast path for manager/default views: rank in LACLAE first, then
            // fetch CLI details only for the returned top clients.
            const salesRows = await repo.fetchByClientSalesRank(yearsArray, monthPred.filter, monthPred.params, safeClientCodes, rowsLimit);

            const topCodes = salesRows
                .map(r => (r.CODE || '').toString().trim())
                .filter(Boolean);

            if (topCodes.length > 0) {
                const detailsRows = await repo.fetchByClientDetails(topCodes);

                const detailsMap = new Map();
                detailsRows.forEach(r => {
                    const codeValue = (r.CODE || '').toString().trim();
                    if (codeValue) detailsMap.set(codeValue, r);
                });

                currentRows = salesRows.map(r => {
                    const codeValue = (r.CODE || '').toString().trim();
                    const details = detailsMap.get(codeValue) || {};
                    return {
                        CODE: codeValue,
                        NAME: details.NAME,
                        ADDRESS: details.ADDRESS,
                        POSTALCODE: details.POSTALCODE,
                        CITY: details.CITY,
                        SALES: r.SALES,
                        COST: r.COST
                    };
                }).filter(r => r.NAME);
            } else {
                const fallbackCodes = safeClientCodes.slice(0, rowsLimit);
                const detailsRows = await repo.fetchByClientFallbackDetails(fallbackCodes, rowsLimit);

                currentRows = detailsRows.map(r => ({
                    CODE: (r.CODE || '').toString().trim(),
                    NAME: r.NAME,
                    ADDRESS: r.ADDRESS,
                    POSTALCODE: r.POSTALCODE,
                    CITY: r.CITY,
                    SALES: 0,
                    COST: 0
                }));
            }
        } else {
            // Filtered path keeps the CLI predicates in SQL.
            currentRows = await repo.fetchByClientFilteredJoin(yearsArray, monthPredBare.filter, monthPredBare.params, safeClientCodes, extraFilters, extraFilterParams, rowsLimit);
        }
    } else {
        // Fallback: Use original query with vendedor filter if cache not available
        const vendedorFilterSales = buildBoundLaclaeVendorFilter(effectiveVendorCodes, 'L');

        if (!extraFilters) {
            const salesRows = await repo.fetchByClientVendorSalesRank(yearsArray, monthPred.filter, monthPred.params, vendedorFilterSales.clause, vendedorFilterSales.params, rowsLimit);

            const topCodes = salesRows
                .map(r => (r.CODE || '').toString().trim())
                .filter(Boolean);

            if (topCodes.length > 0) {
                const detailsRows = await repo.fetchByClientDetails(topCodes);

                const detailsMap = new Map();
                detailsRows.forEach(r => {
                    const codeValue = (r.CODE || '').toString().trim();
                    if (codeValue) detailsMap.set(codeValue, r);
                });

                currentRows = salesRows.map(r => {
                    const codeValue = (r.CODE || '').toString().trim();
                    const details = detailsMap.get(codeValue) || {};
                    return {
                        CODE: codeValue,
                        NAME: details.NAME,
                        ADDRESS: details.ADDRESS,
                        POSTALCODE: details.POSTALCODE,
                        CITY: details.CITY,
                        SALES: r.SALES,
                        COST: r.COST
                    };
                }).filter(r => r.NAME);
            }
        } else {
            currentRows = await repo.fetchByClientVendorFilteredJoin(yearsArray, monthPred.filter, monthPred.params, vendedorFilterSales.clause, vendedorFilterSales.params, extraFilters, extraFilterParams, rowsLimit);
        }
        totalClientsCount = cachedClientCodeCount && !extraFilters
            ? cachedClientCodeCount
            : currentRows.length;
    }

    // Query 2: Get previous year data for same period (for objective calculation)
    // Optimization: Only fetch previous data for the clients we actually retrieved in currentRows
    // to avoid huge joins if only showing top 100
    const retrievedCodes = currentRows.map(r => r.CODE);
    const retrievedCodesParams = retrievedCodes.map(c => sanitizeForSQL(c));

    const prevSalesMap = new Map();
    const objectiveConfigMap = new Map();
    const defaultObjectiveData = { percentage: 10 };
    const fixedTargetsMap = new Map();
    const vendorCodesArray = effectiveVendorCodes
        ? effectiveVendorCodes.split(',').map(v => v.replace(/[^a-zA-Z0-9]/g, '').trim()).filter(Boolean)
        : [];
    const shouldLoadFixedTargets = vendorCodesArray.length === 1;

    if (retrievedCodes.length > 0) {
        // Parallelize 3 independent queries: prevSales + OBJ_CONFIG + COMMERCIAL_TARGETS
        const nowInner = getCurrentDate();
        const currentMonth = nowInner.getMonth() + 1;
        const currentYear = nowInner.getFullYear();

        const codeChunks = chunkArray(retrievedCodesParams, BY_CLIENT_CODE_BATCH_SIZE);
        const prevRowsPromise = mapChunksWithConcurrency(
            codeChunks,
            BY_CLIENT_BATCH_CONCURRENCY,
            (chunk) => repo.fetchByClientPrevSalesChunk(prevYear, monthPred.filter, monthPred.params, chunk)
        ).then(results => results.flat());

        const confRowsPromise = (async () => {
            try {
                const chunkRows = await mapChunksWithConcurrency(
                    codeChunks,
                    BY_CLIENT_BATCH_CONCURRENCY,
                    (chunk) => repo.fetchByClientObjConfigChunk(chunk)
                );
                const globalRows = await repo.fetchByClientObjConfigGlobal();
                return [...chunkRows.flat(), ...globalRows];
            } catch (err) {
                logger.warn(`Could not load objective config: ${err.message}`);
                return [];
            }
        })();

        const [prevRows, confRows, fixedRows] = await Promise.all([
            prevRowsPromise,
            confRowsPromise,
            shouldLoadFixedTargets
                ? repo.fetchByClientVendorFixedTarget(vendorCodesArray, currentYear, currentMonth).catch(err => { logger.warn(`Could not load fixed commercial targets: ${err.message}`); return []; })
                : Promise.resolve([])
        ]);

        prevRows.forEach(r => {
            prevSalesMap.set(r.CODE?.trim() || '', parseFloat(r.PREV_SALES) || 0);
        });

        confRows.forEach(r => {
            const codeValue = r.CODIGOCLIENTE?.trim();
            const pct = parseFloat(r.TARGET_PERCENTAGE) || 0;
            if (codeValue === '*') {
                defaultObjectiveData.percentage = pct;
            } else {
                objectiveConfigMap.set(codeValue, pct);
            }
        });

        fixedRows.forEach(r => {
            const vendorCode = r.CODIGOVENDEDOR?.trim();
            if (vendorCode) {
                fixedTargetsMap.set(`VENDOR_${vendorCode}`, {
                    importe: parseFloat(r.IMPORTE_OBJETIVO) || 0,
                    baseComision: parseFloat(r.IMPORTE_BASE_COMISION) || 0,
                    porcentaje: parseFloat(r.PORCENTAJE_MEJORA) || 10
                });
            }
        });

        if (fixedTargetsMap.size > 0) {
            logger.info(`[OBJECTIVES] Loaded ${fixedTargetsMap.size} fixed commercial targets`);
        }
    }

    const clients = currentRows.map(r => {
        const codeValue = r.CODE?.trim() || '';
        const sales = parseFloat(r.SALES) || 0;
        const cost = parseFloat(r.COST) || 0;
        const margin = sales - cost;
        const prevSales = prevSalesMap.get(codeValue) || 0;

        // Objective Logic:
        // 1. Check COMMERCIAL_TARGETS for vendor-level fixed target (for summary only)
        // 2. For per-client breakdown, ALWAYS use percentage-based (OBJ_CONFIG or default 10%)
        // 3. Fixed targets apply only to vendor totals, not individual clients

        // Get vendor-level fixed target for summary calculation (not per-client)
        // (dead-lite: verbatim del handler; sin efecto en el desglose por cliente)
        let _vendorHasFixedTarget = false;
        let _vendorFixedAmount = 0;
        for (const vendorCode of vendorCodesArray) {
            const vendorTarget = fixedTargetsMap.get(`VENDOR_${vendorCode}`);
            if (vendorTarget && vendorTarget.importe > 0) {
                _vendorHasFixedTarget = true;
                _vendorFixedAmount = vendorTarget.importe;
                break;
            }
        }

        // Per-client objective: ALWAYS use percentage-based calculation
        const targetPct = objectiveConfigMap.has(codeValue)
            ? objectiveConfigMap.get(codeValue)
            : defaultObjectiveData.percentage;

        // Percentage stored as 10 for 10%. Multiplier = 1 + (10/100) = 1.10
        const multiplier = 1 + (targetPct / 100.0);

        // Objective: Previous year sales * multiplier
        const objective = prevSales > 0 ? prevSales * multiplier : sales;

        const progress = objective > 0 ? (sales / objective) * 100 : (sales > 0 ? 100 : 0);

        // Status based on progress
        let status = 'critical';
        if (progress >= 100) status = 'achieved';
        else if (progress >= 80) status = 'ontrack';
        else if (progress >= 50) status = 'atrisk';

        return {
            code: codeValue,
            name: r.NAME?.trim() || 'Sin nombre',
            address: r.ADDRESS?.trim() || '',
            postalCode: r.POSTALCODE?.trim() || '',
            city: r.CITY?.trim() || '',
            current: sales,
            objective,
            prevYear: prevSales,
            margin,
            progress: Math.round(progress * 10) / 10,
            status
        };
    });

    // Summary counts (percentages based on RETURNED list, but count is TOTAL)
    const achieved = clients.filter(c => c.status === 'achieved').length;
    const ontrack = clients.filter(c => c.status === 'ontrack').length;
    const atrisk = clients.filter(c => c.status === 'atrisk').length;
    const critical = clients.filter(c => c.status === 'critical').length;

    return {
        clients,
        count: totalClientsCount, // Return TRUE total
        start: 0,
        limit: rowsLimit,
        periodObjective: clients.reduce((sum, c) => sum + c.objective, 0),
        totalSales: clients.reduce((sum, c) => sum + c.current, 0),
        years: yearsArray,
        months: monthsArray,
        summary: { achieved, ontrack, atrisk, critical }
    };
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
    BY_CLIENT_MAX_CLIENT_CODE_IN_PARAMS,
    BY_CLIENT_CODE_BATCH_SIZE,
    BY_CLIENT_BATCH_CONCURRENCY,
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
    getMatrixContactAndNotes,
    getMatrixProductRows,
    getMatrixFamilyAndFiNames,
    getPopulations,
    buildByClientPayload,
};
