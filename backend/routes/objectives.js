const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { query } = require('../config/db');
const {
    getCurrentDate,
    buildVendedorFilter,
    buildVendedorFilterLACLAE,
    buildColumnaVendedorFilter,
    VENDOR_COLUMN,
    getVendorColumn,
    MIN_YEAR,
    LAC_SALES_FILTER,
    LACLAE_SALES_FILTER,
    getBSales
} = require('../utils/common');
const { getClientCodesFromCache } = require('../services/laclae');
const { redisCache, TTL } = require('../services/redis-cache');
const {
    getCachedFamilyNames,
    getCachedFi1Names,
    getCachedFi2Names,
    getCachedFi3Names,
    getCachedFi4Names,
    getCachedFi5Names,
    isCacheReady: isMetadataCacheReady
} = require('../services/metadataCache');


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
    const col = getVendorColumn(currentYear);
    const rows = await query(`
        SELECT DISTINCT TRIM(L.LCCDCL) as CLIENT_CODE
        FROM DSED.LACLAE L
        WHERE L.${col} = '${vendorCode}'
          AND L.LCAADC = ${currentYear}
          AND ${LACLAE_SALES_FILTER}
    `, false);

    // If no clients in current year, try previous year
    if (rows.length === 0) {
        const prevCol = getVendorColumn(currentYear - 1);
        const prevRows = await query(`
            SELECT DISTINCT TRIM(L.LCCDCL) as CLIENT_CODE
            FROM DSED.LACLAE L
            WHERE L.${prevCol} = '${vendorCode}'
              AND L.LCAADC = ${currentYear - 1}
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

    // PERF: Removed TRIM(L.LCCDCL) - DB2 CHAR comparison handles trailing spaces
    const rows = await query(`
        SELECT 
            L.LCMMDC as MONTH,
            SUM(L.LCIMVT) as SALES,
            SUM(L.LCIMCT) as COST,
            COUNT(DISTINCT L.LCCDCL) as CLIENTS
        FROM DSED.LACLAE L
        WHERE L.LCCDCL IN (${clientList})
          AND L.LCAADC = ${year}
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCMMDC
    `, false);

    // Build map: month -> {sales, cost, clients}
    const monthlyMap = {};
    rows.forEach(r => {
        monthlyMap[r.MONTH] = {
            sales: parseFloat(r.SALES) || 0,
            cost: parseFloat(r.COST) || 0,
            clients: parseInt(r.CLIENTS) || 0
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
    9: 'CUOTASEPTIEMBRE', 10: 'CUOTAOCTUBRE', 11: 'CUOTANOVIEMBRE', 12: 'CUOTADICIEMBRE'
};

/**
 * Get target percentage configuration for a vendor
 * Defaults to 10% if not configured
 */
async function getVendorTargetConfig(vendorCode) {
    if (!vendorCode || vendorCode === 'ALL') return 0.0; // Default 0% (IPC Only)
    try {
        const code = vendorCode.split(',')[0].trim();
        const rows = await query(`
            SELECT TARGET_PERCENTAGE 
            FROM JAVIER.OBJ_CONFIG 
            WHERE CODIGOVENDEDOR = '${code}'
        `, false);

        if (rows.length > 0) {
            return parseFloat(rows[0].TARGET_PERCENTAGE) || 0.0;
        }
        return 0.0; // Default 0%
    } catch (e) {
        logger.warn(`Could not fetch OBJ_CONFIG: ${e.message}`);
        return 0.0;
    }
}

// =============================================================================
// OBJECTIVES SUMMARY (Quota vs Actual)
// =============================================================================
router.get('/', async (req, res) => {
    try {
        const { vendedorCodes, year, month } = req.query;
        const now = getCurrentDate();
        const targetYear = parseInt(year) || now.getFullYear();
        const targetMonth = parseInt(month) || (now.getMonth() + 1);
        const vendedorFilter = buildVendedorFilter(vendedorCodes);

        // 1. Get Target Configuration (Global % increase)
        const targetPct = await getVendorTargetConfig(vendedorCodes);

        // Intentar obtener objetivos desde DSEDAC.COFC (cuotas mensuales)
        let salesObjective = 0;
        let marginObjective = 0;
        let objectiveSource = 'calculated'; // 'database' o 'calculated'

        try {
            // Obtener cuota del mes desde COFC (puede estar vinculada a vendedor o global)
            // Nota: Si hay filtro de vendedor, quizás deberíamos filtrar la cuota también
            const quotaField = MONTH_QUOTA_MAP[targetMonth];
            if (quotaField) {
                // Si hay vendedor específico, intentar filtrar COFC si tiene columna vendedor (o usar CMV)
                // Por ahora mantenemos lógica global si no es específica
                const quotaResult = await query(`
          SELECT COALESCE(SUM(${quotaField}), 0) as quota
          FROM DSEDAC.COFC
          WHERE CODIGOTIPOCUOTA IS NOT NULL
        `, false);

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
                const cmvResult = await query(`
          SELECT COALESCE(IMPORTEOBJETIVO, 0) as objetivo,
                 COALESCE(PORCENTAJEOBJETIVO, 0) as porcentaje
          FROM DSEDAC.CMV 
          WHERE CODIGOVENDEDOR = '${code}'
        `, false);

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

        // Ventas del mes actual (usando LAC)
        // Aplicamos vendedorFilter para que coincida con lo solicitado (Global o Vendedor)
        const currentSales = await query(`
      SELECT 
        COALESCE(SUM(IMPORTEVENTA), 0) as sales,
        COALESCE(SUM(IMPORTEVENTA - IMPORTECOSTO), 0) as margin,
        COUNT(DISTINCT CODIGOCLIENTEALBARAN) as clients
      FROM DSEDAC.LAC L
      WHERE ANODOCUMENTO = ${targetYear} AND MESDOCUMENTO = ${targetMonth} ${vendedorFilter}
    `);

        // Ventas del mismo mes año anterior (usando LAC)
        const lastYearSales = await query(`
      SELECT 
        COALESCE(SUM(IMPORTEVENTA), 0) as sales,
        COALESCE(SUM(IMPORTEVENTA - IMPORTECOSTO), 0) as margin,
        COUNT(DISTINCT CODIGOCLIENTEALBARAN) as clients
      FROM DSEDAC.LAC
      WHERE ANODOCUMENTO = ${targetYear - 1} AND MESDOCUMENTO = ${targetMonth} ${vendedorFilter}
    `);

        // NEW: Need Annual Totals of Previous Year for Seasonality Calculation
        const prevYearAnnual = await query(`
            SELECT COALESCE(SUM(IMPORTEVENTA), 0) as TOTAL_SALES
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO = ${targetYear - 1} ${vendedorFilter}
        `, false);

        const curr = currentSales[0] || {};
        const last = lastYearSales[0] || {};

        const salesCurrent = parseFloat(curr.SALES) || 0;
        const salesLast = parseFloat(last.SALES) || 0;
        const totalPrevYear = prevYearAnnual[0] ? parseFloat(prevYearAnnual[0].TOTAL_SALES) : 0;

        // Si no encontramos objetivo en BD, calcular con Lógica Estacional
        if (salesObjective === 0) {
            // Default flat if no history
            let calculatedTarget = salesLast * (1 + targetPct / 100);

            // Apply Seasonality if we have annual history
            if (totalPrevYear > 0) {
                const avgMonthlySales = totalPrevYear / 12;

                // Calculate Growth Factor for THIS month
                // Formula: Target% * (1 + Sensitivity * (Deviation))
                // Deviation = (LastYearMonth - Avg) / Avg

                const deviationRatio = avgMonthlySales > 0 ? (salesLast - avgMonthlySales) / avgMonthlySales : 0;

                // Variable Growth Percentage for this month
                // e.g. if Target is 10%, and month is high (+50% vs avg), Growth might be 10% * (1 + 0.5*0.5) = 12.5%
                const variableGrowthPct = (targetPct / 100) * (1 + (SEASONAL_AGGRESSIVENESS * deviationRatio));

                // Initial Raw Target
                const rawTarget = salesLast * (1 + variableGrowthPct);

                // NOTE: To be mathematically perfect and ensure Sum(MonthTargets) == AnnualTarget,
                // we should normalize. But for a single month lookup without calculating all 12, 
                // the raw formula is a very good approximation (+/- 1-2%). 
                // For exact precision, we'd need to calculate all 12 months here.
                // Given the requirement for "dynamic" and "more or less", this approximation is acceptable 
                // and much faster than querying 12 months of daily data on every refresh.

                salesObjective = rawTarget;
                objectiveSource = 'seasonality_dynamic';

            } else {
                // Fallback to simple % if no previous annual data
                // If no last year data at all, maybe based on current?
                if (salesLast === 0 && salesCurrent > 0) {
                    salesObjective = salesCurrent * (1 + targetPct / 100);
                } else {
                    salesObjective = calculatedTarget;
                }
            }
        }

        const salesProgress = salesObjective > 0 ? (salesCurrent / salesObjective) * 100 : 0;

        const marginCurrent = parseFloat(curr.MARGIN) || 0;
        const marginLast = parseFloat(last.MARGIN) || 0;
        // Si no hay marginObjective global, usar histórico + target%
        marginObjective = marginObjective || (marginLast * (1 + targetPct / 100));
        const marginProgress = marginObjective > 0 ? (marginCurrent / marginObjective) * 100 : 0;

        const clientsCurrent = parseInt(curr.CLIENTS) || 0;
        const clientsLast = parseInt(last.CLIENTS) || 0;
        const clientsObjective = Math.ceil(clientsLast * 1.05); // Clients usually fixed 5% or similar
        const clientsProgress = clientsObjective > 0 ? (clientsCurrent / clientsObjective) * 100 : 0;

        // Alertas
        const alerts = [];
        if (salesProgress < 80) alerts.push({ type: 'warning', message: `Ventas al ${salesProgress.toFixed(0)}% del objetivo` });
        if (salesProgress < 50) alerts.push({ type: 'danger', message: 'Ventas muy por debajo del objetivo' });
        if (marginProgress < 70) alerts.push({ type: 'warning', message: 'Margen por debajo del esperado' });

        res.json({
            period: { year: targetYear, month: targetMonth },
            objectiveSource,
            targetPercentage: targetPct, // Return for debug/ui
            objectives: {
                sales: {
                    target: salesObjective,
                    current: salesCurrent,
                    lastYear: salesLast,
                    progress: Math.round(salesProgress * 10) / 10,
                    variation: salesLast > 0 ? Math.round(((salesCurrent - salesLast) / salesLast) * 1000) / 10 : 0
                },
                margin: {
                    target: marginObjective,
                    current: marginCurrent,
                    lastYear: marginLast,
                    progress: Math.round(marginProgress * 10) / 10
                },
                clients: {
                    target: clientsObjective,
                    current: clientsCurrent,
                    lastYear: clientsLast,
                    progress: Math.round(clientsProgress * 10) / 10
                }
            },
            alerts
        });

    } catch (error) {
        logger.error(`Objectives error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo objetivos', details: error.message });
    }
});

// =============================================================================
// OBJECTIVES EVOLUTION
// =============================================================================
router.get('/evolution', async (req, res) => {
    try {
        const { vendedorCodes, years } = req.query;
        const now = getCurrentDate();
        const { calculateWorkingDays, calculateDaysPassed } = require('../utils/common');
        const { getVendorActiveDaysFromCache } = require('../services/laclae');

        // PERF: Route-level cache for evolution data
        const cacheKey = `obj:evolution:${vendedorCodes || 'ALL'}:${years || 'default'}`;
        const cachedResult = await redisCache.get('route', cacheKey);
        if (cachedResult) {
            logger.info(`[OBJECTIVES] ⚡ Cache HIT for evolution (${cacheKey})`);
            return res.json(cachedResult);
        }

        // Parse years - default to current year and previous 2 (3 years total)
        const yearsArray = years
            ? years.split(',').map(y => parseInt(y.trim())).filter(y => y >= MIN_YEAR)
            : [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

        // Include previous years for dynamic objective calculation
        const allYears = [...yearsArray, ...yearsArray.map(y => y - 1)];
        const uniqueYears = [...new Set(allYears)];
        const yearsFilter = uniqueYears.join(',');

        // Use Date-Aware filter (handles LCCDVD for <2026 and R1_T8CDVD for >=2026)
        const vendedorFilter = buildColumnaVendedorFilter(vendedorCodes, uniqueYears, 'L');

        // Get Active Days for calculating pace 
        // Logic: if multiple vendors selected, we might average or select first? 
        // User is usually viewing ONE vendor or ALL. 
        // If ALL, standard days. If specific, specific days.
        let activeWeekDays = [];
        if (vendedorCodes && vendedorCodes !== 'ALL') {
            const firstCode = vendedorCodes.split(',')[0].trim();
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
        const rows = await query(`
          SELECT 
            L.LCAADC as YEAR,
            L.LCMMDC as MONTH,
            SUM(L.LCIMVT) as SALES,
            SUM(L.LCIMCT) as COST,
            COUNT(DISTINCT L.LCCDCL) as CLIENTS
          FROM DSED.LACLAE L
          WHERE L.LCAADC IN (${yearsFilter})
            AND ${LACLAE_SALES_FILTER}
            ${vendedorFilter}
          GROUP BY L.LCAADC, L.LCMMDC
          ORDER BY YEAR, MONTH
        `);


        // =====================================================================
        // B-SALES: Add secondary channel sales from JAVIER.VENTAS_B
        // Ensures consistency with commissions endpoint
        // =====================================================================
        if (vendedorCodes && vendedorCodes !== 'ALL') {
            const firstCode = vendedorCodes.split(',')[0].trim();
            for (const yr of uniqueYears) {
                const bSalesMap = await getBSales(firstCode, yr);
                for (const [month, amount] of Object.entries(bSalesMap)) {
                    const m = parseInt(month);
                    const existingRow = rows.find(r => r.YEAR == yr && r.MONTH == m);
                    if (existingRow) {
                        existingRow.SALES = (parseFloat(existingRow.SALES) || 0) + amount;
                    } else if (amount > 0) {
                        rows.push({ YEAR: yr, MONTH: m, SALES: amount, COST: 0, CLIENTS: 0 });
                    }
                }
            }
        }

        // Organize by year
        const yearlyData = {};
        const yearTotals = {};

        // =====================================================================
        // INHERITED OBJECTIVES: Pre-load inherited sales for new vendors
        // =====================================================================
        // For vendors with incomplete history (some months with 0 sales in prevYear),
        // we calculate the target based on sales of their current clients by ANY vendor.
        let inheritedMonthlySales = {};
        const isAll = !vendedorCodes || vendedorCodes === 'ALL';

        if (!isAll) {
            // Check if vendor has any months without data in previous year (for current year objectives)
            const currentYear = yearsArray[0] || getCurrentDate().getFullYear();
            const prevYear = currentYear - 1;

            const monthsWithData = rows.filter(r => r.YEAR == prevYear).map(r => r.MONTH);
            const missingMonths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter(m => !monthsWithData.includes(m));

            if (missingMonths.length > 0) {
                // Vendor is "new" or has incomplete history - load inherited sales
                logger.info(`[OBJECTIVES] Vendor ${vendedorCodes} has ${missingMonths.length} months without data: [${missingMonths.join(',')}]. Loading inherited targets...`);

                const firstCode = vendedorCodes.split(',')[0].trim();
                const currentClients = await getVendorCurrentClients(firstCode, currentYear);
                if (currentClients.length > 0) {
                    inheritedMonthlySales = await getClientsMonthlySales(currentClients, prevYear);
                    logger.info(`[OBJECTIVES] Found ${currentClients.length} clients. Loaded inherited sales for ${Object.keys(inheritedMonthlySales).length} months.`);
                }
            }
        }

        // ==========================================================================
        // FIXED TARGETS: Check if vendor has fixed monthly targets from COMMERCIAL_TARGETS
        // ==========================================================================
        let fixedMonthlyTarget = null;
        if (vendedorCodes && vendedorCodes !== 'ALL') {
            const firstCode = vendedorCodes.split(',')[0].trim();
            const currentYear = yearsArray[0] || getCurrentDate().getFullYear();
            const currentMonth = now.getMonth() + 1;

            try {
                const fixedRows = await query(`
                    SELECT IMPORTE_OBJETIVO, IMPORTE_BASE_COMISION
                    FROM JAVIER.COMMERCIAL_TARGETS
                    WHERE CODIGOVENDEDOR = '${firstCode}'
                      AND ANIO = ${currentYear}
                      AND (MES = ${currentMonth} OR MES IS NULL)
                      AND ACTIVO = 1
                    ORDER BY MES DESC
                    FETCH FIRST 1 ROWS ONLY
                `, false);

                if (fixedRows && fixedRows.length > 0) {
                    fixedMonthlyTarget = parseFloat(fixedRows[0].IMPORTE_OBJETIVO) || null;
                    if (fixedMonthlyTarget) {
                        logger.info(`[OBJECTIVES] Vendor ${firstCode} has FIXED monthly target: ${fixedMonthlyTarget}€`);
                    }
                }
            } catch (err) {
                // Table might not exist - continue with percentage-based
                logger.debug(`[OBJECTIVES] COMMERCIAL_TARGETS: ${err.message}`);
            }
        }

        // 1. Get Target Config
        const targetPct = await getVendorTargetConfig(vendedorCodes);

        yearsArray.forEach(year => {
            // Calculate Annual Objective first
            let prevYearTotal = 0;
            let inheritedTotal = 0;
            let currentYearTotalSoFar = 0;

            // Collect Previous Year Data for Seasonality Calculation
            const prevYearMonthlySales = {};

            for (let m = 1; m <= 12; m++) {
                const row = rows.find(r => r.YEAR == year && r.MONTH == m); // Loose equality
                const prevRow = rows.find(r => r.YEAR == (year - 1) && r.MONTH == m);

                let ownPrevSales = prevRow ? parseFloat(prevRow.SALES) || 0 : 0;

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
            let annualObjective, monthlyObjective;

            if (fixedMonthlyTarget && fixedMonthlyTarget > 0) {
                monthlyObjective = fixedMonthlyTarget;
                annualObjective = fixedMonthlyTarget * 12;
            } else {
                // Standard calculation: previous year * (1 + targetPct)
                // Fallback to 10% if 0 (though normally handled by getVendorTargetConfig)
                const growthFactor = 1 + (targetPct / 100);
                annualObjective = combinedPrevTotal > 0 ? combinedPrevTotal * growthFactor : (currentYearTotalSoFar > 0 ? currentYearTotalSoFar * growthFactor : 0);
                monthlyObjective = annualObjective / 12;
            }

            // ===================================
            // CALCULATE SEASONAL FACTORS
            // ===================================
            const seasonalTargets = {};
            if (!fixedMonthlyTarget && combinedPrevTotal > 0) {
                const avgMonthly = combinedPrevTotal / 12;
                let rawSum = 0;

                // Pass 1: Calculate Raw Weighted Targets
                const tempTargets = {};
                for (let m = 1; m <= 12; m++) {
                    const sale = prevYearMonthlySales[m] || 0;
                    const deviationRatio = avgMonthly > 0 ? (sale - avgMonthly) / avgMonthly : 0;
                    // Formula from simulation
                    const variableGrowthPct = (targetPct / 100) * (1 + (SEASONAL_AGGRESSIVENESS * deviationRatio));
                    const rawTarget = sale * (1 + variableGrowthPct);
                    tempTargets[m] = rawTarget;
                    rawSum += rawTarget;
                }

                // Pass 2: Normalize
                const correctionFactor = rawSum > 0 ? annualObjective / rawSum : 1;
                for (let m = 1; m <= 12; m++) {
                    seasonalTargets[m] = tempTargets[m] * correctionFactor;
                }
            }


            yearlyData[year] = [];

            for (let m = 1; m <= 12; m++) {
                const row = rows.find(r => r.YEAR == year && r.MONTH == m);
                const prevRow = rows.find(r => r.YEAR == (year - 1) && r.MONTH == m);

                const sales = row ? parseFloat(row.SALES) || 0 : 0;
                const cost = row ? parseFloat(row.COST) || 0 : 0;
                const clients = row ? parseInt(row.CLIENTS) || 0 : 0;

                // SEASONAL OBJECTIVE with INHERITED support:
                let seasonalObjective = 0;

                // FIXED TARGET OVERRIDE: If fixedMonthlyTarget is set, use it for all months
                if (fixedMonthlyTarget && fixedMonthlyTarget > 0) {
                    seasonalObjective = fixedMonthlyTarget;
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
                    sales: sales,
                    cost: cost,
                    margin: sales - cost,
                    clients: clients,
                    objective: seasonalObjective,
                    workingDays: totalWorkingDays,
                    daysPassed: daysPassed
                });
            }

            const data = yearlyData[year];
            yearTotals[year] = {
                totalSales: data.reduce((sum, m) => sum + m.sales, 0),
                totalCost: data.reduce((sum, m) => sum + m.cost, 0),
                totalMargin: data.reduce((sum, m) => sum + m.margin, 0),
                annualObjective: annualObjective
            };
        });

        const responseData = {
            years: yearsArray,
            yearlyData,
            yearTotals,
            monthNames: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
        };

        // PERF: Cache the result (5 min for specific vendor, 10 min for ALL)
        const cacheTTL = (!vendedorCodes || vendedorCodes === 'ALL') ? TTL.SHORT * 2 : TTL.SHORT;
        await redisCache.set('route', cacheKey, responseData, cacheTTL);
        logger.info(`[OBJECTIVES] 💾 Cached evolution (${cacheKey})`);

        res.json(responseData);

    } catch (error) {
        logger.error(`Objectives evolution error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo evolución de objetivos', details: error.message });
    }
});

// =============================================================================
// OBJECTIVES MATRIX
// =============================================================================
router.get('/matrix', async (req, res) => {
    try {
        const {
            clientCode, years, startMonth = '1', endMonth = '12',
            productCode, productName, familyCode, subfamilyCode,
            // NEW: FI filters
            fi1, fi2, fi3, fi4, fi5
        } = req.query;

        if (!clientCode) {
            return res.status(400).json({ error: 'clientCode is required' });
        }

        // Parse years and range
        const yearsArray = years ? years.split(',').map(y => parseInt(y.trim())).filter(y => y >= 2015) : [new Date().getFullYear()];
        const monthStart = parseInt(startMonth);
        const monthEnd = parseInt(endMonth);

        // Determine years to fetch (include previous year for YoY if needed)
        const allYearsToFetch = new Set(yearsArray);
        yearsArray.forEach(y => allYearsToFetch.add(y - 1));
        const yearsFilter = Array.from(allYearsToFetch).join(',');

        // --- NEW: Client Contact & Observations ---
        let contactInfo = { phone: '', phone2: '', email: '', phones: [] };
        let editableNotes = null;

        // Get phones (separate try-catch to not break if one fails)
        try {
            const contactRows = await query(`
                SELECT TELEFONO1 as PHONE, TELEFONO2 as PHONE2 
                FROM DSEDAC.CLI WHERE CODIGOCLIENTE = '${clientCode}' FETCH FIRST 1 ROWS ONLY
            `);
            if (contactRows.length > 0) {
                const c = contactRows[0];
                const phones = [];
                if (c.PHONE?.trim()) phones.push({ type: 'Teléfono 1', number: c.PHONE.trim() });
                if (c.PHONE2?.trim()) phones.push({ type: 'Teléfono 2', number: c.PHONE2.trim() });

                contactInfo = {
                    phone: c.PHONE?.trim() || '',
                    phone2: c.PHONE2?.trim() || '',
                    email: '',
                    phones: phones
                };
            }
        } catch (e) {
            logger.warn(`Could not load contact info: ${e.message}`);
        }

        // Get editable notes (separate try-catch - table may not exist)
        try {
            const notesRows = await query(`
                SELECT OBSERVACIONES, MODIFIED_BY FROM JAVIER.CLIENT_NOTES 
                WHERE CLIENT_CODE = '${clientCode}' FETCH FIRST 1 ROWS ONLY
            `, false);
            if (notesRows.length > 0) {
                editableNotes = {
                    text: notesRows[0].OBSERVACIONES,
                    modifiedBy: notesRows[0].MODIFIED_BY
                };
            }
        } catch (e) {
            // Table may not exist - this is OK, just skip notes
            logger.debug(`Notes table not available: ${e.message}`);
        }
        // -------------------------------------------

        // Build filter conditions (using LACLAE column names)
        let filterConditions = '';
        if (productCode && productCode.trim()) {
            filterConditions += ` AND UPPER(L.LCCDRF) LIKE '%${productCode.trim().toUpperCase()}%'`;
        }
        if (productName && productName.trim()) {
            filterConditions += ` AND (UPPER(A.DESCRIPCIONARTICULO) LIKE '%${productName.trim().toUpperCase()}%' OR UPPER(L.LCDESC) LIKE '%${productName.trim().toUpperCase()}%')`;
        }
        // Legacy family/subfamily filters (mantener compatibilidad)
        if (familyCode && familyCode.trim()) {
            filterConditions += ` AND A.CODIGOFAMILIA = '${familyCode.trim()}'`;
        }
        if (subfamilyCode && subfamilyCode.trim()) {
            filterConditions += ` AND A.CODIGOSUBFAMILIA = '${subfamilyCode.trim()}'`;
        }

        // NEW: FI hierarchical filters (join con ARTX)
        let needsArtxJoin = false;
        if (fi1 && fi1.trim()) {
            filterConditions += ` AND TRIM(AX.FILTRO01) = '${fi1.trim()}'`;
            needsArtxJoin = true;
        }
        if (fi2 && fi2.trim()) {
            filterConditions += ` AND TRIM(AX.FILTRO02) = '${fi2.trim()}'`;
            needsArtxJoin = true;
        }
        if (fi3 && fi3.trim()) {
            filterConditions += ` AND TRIM(AX.FILTRO03) = '${fi3.trim()}'`;
            needsArtxJoin = true;
        }
        if (fi4 && fi4.trim()) {
            filterConditions += ` AND TRIM(AX.FILTRO04) = '${fi4.trim()}'`;
            needsArtxJoin = true;
        }
        if (fi5 && fi5.trim()) {
            filterConditions += ` AND TRIM(A.CODIGOSECCIONLARGA) = '${fi5.trim()}'`;
        }

        // Build ARTX join if needed
        const artxJoin = needsArtxJoin ? 'LEFT JOIN DSEDAC.ARTX AX ON L.LCCDRF = AX.CODIGOARTICULO' : '';

        // Get product purchases for this client - USING DSED.LACLAE (which has data for all clients including PUA)
        const rows = await query(`
      SELECT 
        L.LCCDRF as PRODUCT_CODE,
        COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.LCDESC)) as PRODUCT_NAME,
        COALESCE(A.CODIGOFAMILIA, 'SIN_FAM') as FAMILY_CODE,
        COALESCE(NULLIF(TRIM(A.CODIGOSUBFAMILIA), ''), 'General') as SUBFAMILY_CODE,
        COALESCE(TRIM(A.UNIDADMEDIDA), 'UDS') as UNIT_TYPE,
        L.LCAADC as YEAR,
        L.LCMMDC as MONTH,
        SUM(L.LCIMVT) as SALES,
        SUM(L.LCIMCT) as COST,
        SUM(L.LCCTUD) as UNITS,
        -- Discount detection AND details (using LACLAE equivalents)
        SUM(CASE WHEN L.LCPRTC <> 0 AND L.LCPRT1 <> 0 
                  AND L.LCPRTC <> L.LCPRT1 THEN 1 ELSE 0 END) as HAS_SPECIAL_PRICE,
        SUM(CASE WHEN L.LCPJDT <> 0 THEN 1 ELSE 0 END) as HAS_DISCOUNT,
        AVG(CASE WHEN L.LCPJDT <> 0 THEN L.LCPJDT ELSE NULL END) as AVG_DISCOUNT_PCT,
        CAST(NULL AS DECIMAL(10,2)) as AVG_DISCOUNT_EUR,
        -- Average prices for comparison
        AVG(L.LCPRTC) as AVG_CLIENT_TARIFF,
        AVG(L.LCPRT1) as AVG_BASE_TARIFF,
        -- FI codes for 5-level hierarchy grouping
        COALESCE(TRIM(AX.FILTRO01), '') as FI1_CODE,
        COALESCE(TRIM(AX.FILTRO02), '') as FI2_CODE,
        COALESCE(TRIM(AX.FILTRO03), '') as FI3_CODE,
        COALESCE(TRIM(AX.FILTRO04), '') as FI4_CODE,
        COALESCE(TRIM(A.CODIGOSECCIONLARGA), '') as FI5_CODE
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.ART A ON L.LCCDRF = A.CODIGOARTICULO
      LEFT JOIN DSEDAC.ARTX AX ON L.LCCDRF = AX.CODIGOARTICULO
      WHERE L.LCCDCL = '${clientCode}'
        AND L.LCAADC IN(${yearsFilter})
        AND L.LCMMDC BETWEEN ${monthStart} AND ${monthEnd}
        // FILTERS to match LACLAE logic
        ${buildColumnaVendedorFilter(clientCode ? 'ALL' : vendedorCodes, allYearsToFetch, 'L')}
        AND ${LACLAE_SALES_FILTER}
        ${filterConditions}
      GROUP BY L.LCCDRF, A.DESCRIPCIONARTICULO, L.LCDESC, A.CODIGOFAMILIA, A.CODIGOSUBFAMILIA, A.UNIDADMEDIDA, L.LCAADC, L.LCMMDC, AX.FILTRO01, AX.FILTRO02, AX.FILTRO03, AX.FILTRO04, A.CODIGOSECCIONLARGA
      ORDER BY SALES DESC
    `);

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

        // Load FI descriptions for all levels (from cache or fallback to query)
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
                const famRows = await query(`SELECT CODIGOFAMILIA, DESCRIPCIONFAMILIA FROM DSEDAC.FAM`, false, false);
                famRows.forEach(r => { familyNames[r.CODIGOFAMILIA?.trim()] = r.DESCRIPCIONFAMILIA?.trim() || r.CODIGOFAMILIA?.trim(); });

                const fi1Rows = await query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI1`, false, false);
                fi1Rows.forEach(r => {
                    const code = (r.CODIGOFILTRO || '').toString().trim();
                    const name = (r.DESCRIPCIONFILTRO || '').toString().trim();
                    if (code) fi1Names[code] = name;
                });

                const fi2Rows = await query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI2`, false, false);
                fi2Rows.forEach(r => {
                    const code = (r.CODIGOFILTRO || '').toString().trim();
                    const name = (r.DESCRIPCIONFILTRO || '').toString().trim();
                    if (code) fi2Names[code] = name;
                });

                const fi3Rows = await query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI3`, false, false);
                fi3Rows.forEach(r => {
                    const code = (r.CODIGOFILTRO || '').toString().trim();
                    const name = (r.DESCRIPCIONFILTRO || '').toString().trim();
                    if (code) fi3Names[code] = name;
                });

                const fi4Rows = await query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI4`, false, false);
                fi4Rows.forEach(r => {
                    const code = (r.CODIGOFILTRO || '').toString().trim();
                    const name = (r.DESCRIPCIONFILTRO || '').toString().trim();
                    if (code) fi4Names[code] = name;
                });

                const fi5Rows = await query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI5`, false, false);
                fi5Rows.forEach(r => {
                    const code = (r.CODIGOFILTRO || '').toString().trim();
                    const name = (r.DESCRIPCIONFILTRO || '').toString().trim();
                    if (code) fi5Names[code] = name;
                });

            } catch (e) {
                logger.warn(`Could not load family/FI names: ${e.message}`);
            }
        }

        // Build hierarchy: Family -> Subfamily -> Product (legacy)
        const familyMap = new Map();

        // NEW: Build 5-level FI hierarchy: FI1 -> FI2 -> FI3 -> FI4 -> Products
        const fiHierarchyMap = new Map();

        let grandTotalSales = 0, grandTotalCost = 0, grandTotalUnits = 0;
        let grandTotalPrevSales = 0, grandTotalPrevCost = 0, grandTotalPrevUnits = 0;
        const productSet = new Set();
        const prevProductSet = new Set(); // Products from previous year

        // Monthly YoY Calculation
        const monthlyStats = new Map();
        for (let m = 1; m <= 12; m++) monthlyStats.set(m, { currentSales: 0, prevSales: 0, currentUnits: 0 });

        const isSelectedYear = (y) => yearsArray.includes(y);
        const isPrevYear = (y) => yearsArray.some(selected => selected - 1 === y);

        rows.forEach(row => {
            const famCode = row.FAMILY_CODE?.trim() || 'SIN_FAM';
            const subfamCode = row.SUBFAMILY_CODE?.trim() || 'General';
            const prodCode = row.PRODUCT_CODE?.trim() || '';
            const prodName = row.PRODUCT_NAME?.trim() || 'Sin nombre';
            const unitType = row.UNIT_TYPE?.trim() || 'UDS';
            const year = parseInt(row.YEAR);
            const month = parseInt(row.MONTH);
            const sales = parseFloat(row.SALES) || 0;
            const cost = parseFloat(row.COST) || 0;
            const units = parseFloat(row.UNITS) || 0;

            const hasSpecialPrice = parseInt(row.HAS_SPECIAL_PRICE) > 0;
            const hasDiscount = parseInt(row.HAS_DISCOUNT) > 0;
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
            } else if (isPrevYear(year)) {
                mStat.prevSales += sales;
            }

            // Only add to Grand Totals if it's a Selected Year
            if (isSelectedYear(year)) {
                grandTotalSales += sales;
                grandTotalCost += cost;
                grandTotalUnits += units;
                productSet.add(prodCode);
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
                        subfamilies: new Map()
                    });
                }
                const family = familyMap.get(famCode);

                if (isSelectedYear(year)) {
                    family.totalSales += sales;
                    family.totalCost += cost;
                    family.totalUnits += units;
                }

                // Subfamily
                const subfamName = subfamilyNames[subfamCode] ? `${subfamCode} - ${subfamilyNames[subfamCode]}` : subfamCode;
                if (!family.subfamilies.has(subfamCode)) {
                    family.subfamilies.set(subfamCode, {
                        subfamilyCode: subfamCode,
                        subfamilyName: subfamName,
                        totalSales: 0, totalCost: 0, totalUnits: 0,
                        products: new Map()
                    });
                }
                const subfamily = family.subfamilies.get(subfamCode);

                if (isSelectedYear(year)) {
                    subfamily.totalSales += sales;
                    subfamily.totalCost += cost;
                    subfamily.totalUnits += units;
                }

                // Product
                if (!subfamily.products.has(prodCode)) {
                    subfamily.products.set(prodCode, {
                        productCode: prodCode,
                        productName: prodName,
                        unitType: unitType,
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
                    sales: 0, units: 0, avgDiscountPct: 0, avgDiscountEur: 0
                };
                product.monthlyData[year][month].sales += sales;
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
                        unitType: unitType,
                        fi5Code: fi5Code,
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
                if (!fiProduct.monthlyData[year][month]) fiProduct.monthlyData[year][month] = { sales: 0, units: 0 };
                fiProduct.monthlyData[year][month].sales += sales;
                fiProduct.monthlyData[year][month].units += units;
            }
        });

        // Helper
        const getSalesForKey = (keyCode, filterFn) => {
            let total = 0;
            rows.forEach(r => {
                if (filterFn(r) && isPrevYear(parseInt(r.YEAR))) {
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
                yoyTrend: yoyTrend
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
                        flatMonthly[m.toString()] = { selectedSales: 0, selectedUnits: 0, prevSales: 0, prevUnits: 0 };
                    }
                    Object.keys(p.monthlyData).forEach(yearStr => {
                        const y = parseInt(yearStr);
                        const mData = p.monthlyData[yearStr];
                        Object.keys(mData).forEach(mStr => {
                            if (isSelectedYear(y)) {
                                flatMonthly[mStr].selectedSales += mData[mStr].sales || 0;
                                flatMonthly[mStr].selectedUnits += mData[mStr].units || 0;
                            } else if (isPrevYear(y)) {
                                flatMonthly[mStr].prevSales += mData[mStr].sales || 0;
                                flatMonthly[mStr].prevUnits += mData[mStr].units || 0;
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
                            prevSales: d.prevSales, // Added for frontend context
                            yoyTrend: mTrend,
                            yoyVariation: mVar
                        };
                    });

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
                        monthlyData: monthlyOutput,
                        yoyTrend,
                        yoyVariation: parseFloat(variation.toFixed(1))
                    };
                }).sort((a, b) => b.totalSales - a.totalSales);

                const margin = s.totalSales - s.totalCost;
                const marginPercent = s.totalSales > 0 ? (margin / s.totalSales) * 100 : 0;
                return {
                    subfamilyCode: s.subfamilyCode,
                    subfamilyName: s.subfamilyName,
                    totalSales: parseFloat(s.totalSales.toFixed(2)),
                    totalUnits: s.totalUnits,
                    totalMarginPercent: parseFloat(marginPercent.toFixed(1)),
                    products
                };
            }).sort((a, b) => b.totalSales - a.totalSales);

            const margin = f.totalSales - f.totalCost;
            const marginPercent = f.totalSales > 0 ? (margin / f.totalSales) * 100 : 0;
            return {
                familyCode: f.familyCode,
                familyName: f.familyName,
                totalSales: parseFloat(f.totalSales.toFixed(2)),
                totalUnits: f.totalUnits,
                totalMarginPercent: parseFloat(marginPercent.toFixed(1)),
                subfamilies
            };
        }).sort((a, b) => b.totalSales - a.totalSales);

        // ===== FINALIZE 5-LEVEL FI HIERARCHY =====
        // Helper to format monthly data for FI levels
        const formatLevelMonthly = (monthlyData) => {
            const flatMonthly = {};
            for (let m = 1; m <= 12; m++) {
                flatMonthly[m.toString()] = { selectedSales: 0, selectedUnits: 0, selectedCost: 0, prevSales: 0, prevUnits: 0, prevCost: 0 };
            }
            Object.keys(monthlyData).forEach(yearStr => {
                const y = parseInt(yearStr);
                const mData = monthlyData[yearStr];
                Object.keys(mData).forEach(mStr => {
                    if (isSelectedYear(y)) {
                        flatMonthly[mStr].selectedSales += mData[mStr].sales || 0;
                        flatMonthly[mStr].selectedUnits += mData[mStr].units || 0;
                        flatMonthly[mStr].selectedCost += mData[mStr].cost || 0;
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
                    yoyVariation: parseFloat(mVar.toFixed(1))
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
                let yoy2 = 'neutral';
                if (fi2.prevYearSales === 0 && fi2.totalSales > 0) yoy2 = 'new';
                else if (variation2 > 5) yoy2 = 'up';
                else if (variation2 < -5) yoy2 = 'down';

                const children2 = Array.from(fi2.children.values()).map(fi3 => {
                    const margin3 = fi3.totalSales - fi3.totalCost;
                    const marginPercent3 = fi3.totalSales > 0 ? (margin3 / fi3.totalSales) * 100 : 0;
                    const prevMargin3 = fi3.prevYearSales - fi3.prevYearCost;
                    const variation3 = fi3.prevYearSales > 0 ? ((fi3.totalSales - fi3.prevYearSales) / fi3.prevYearSales) * 100 : 0;
                    let yoy3 = 'neutral';
                    if (fi3.prevYearSales === 0 && fi3.totalSales > 0) yoy3 = 'new';
                    else if (variation3 > 5) yoy3 = 'up';
                    else if (variation3 < -5) yoy3 = 'down';

                    const children3 = Array.from(fi3.children.values()).map(fi4 => {
                        const margin4 = fi4.totalSales - fi4.totalCost;
                        const marginPercent4 = fi4.totalSales > 0 ? (margin4 / fi4.totalSales) * 100 : 0;
                        const prevMargin4 = fi4.prevYearSales - fi4.prevYearCost;
                        const variation4 = fi4.prevYearSales > 0 ? ((fi4.totalSales - fi4.prevYearSales) / fi4.prevYearSales) * 100 : 0;
                        let yoy4 = 'neutral';
                        if (fi4.prevYearSales === 0 && fi4.totalSales > 0) yoy4 = 'new';
                        else if (variation4 > 5) yoy4 = 'up';
                        else if (variation4 < -5) yoy4 = 'down';

                        const products = Array.from(fi4.products.values())
                            .map(formatFiProduct)
                            .sort((a, b) => b.totalSales - a.totalSales);

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
                            yoyTrend: yoy4,
                            yoyVariation: parseFloat(variation4.toFixed(1)),
                            monthlyData: formatLevelMonthly(fi4.monthlyData || {}),
                            productCount: products.length,
                            products
                        };
                    }).filter(f => f.totalSales > 0 || f.productCount > 0).sort((a, b) => b.totalSales - a.totalSales);

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
                        yoyTrend: yoy3,
                        yoyVariation: parseFloat(variation3.toFixed(1)),
                        monthlyData: formatLevelMonthly(fi3.monthlyData || {}),
                        childCount: children3.length,
                        children: children3
                    };
                }).filter(f => f.totalSales > 0 || f.childCount > 0).sort((a, b) => b.totalSales - a.totalSales);

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
                    yoyTrend: yoy2,
                    yoyVariation: parseFloat(variation2.toFixed(1)),
                    monthlyData: formatLevelMonthly(fi2.monthlyData || {}),
                    childCount: children2.length,
                    children: children2
                };
            }).filter(f => f.totalSales > 0 || f.childCount > 0).sort((a, b) => b.totalSales - a.totalSales);

            const prevMargin1 = fi1.prevYearSales - fi1.prevYearCost;
            const variation1 = fi1.prevYearSales > 0 ? ((fi1.totalSales - fi1.prevYearSales) / fi1.prevYearSales) * 100 : 0;
            let yoy1 = 'neutral';
            if (fi1.prevYearSales === 0 && fi1.totalSales > 0) yoy1 = 'new';
            else if (variation1 > 5) yoy1 = 'up';
            else if (variation1 < -5) yoy1 = 'down';

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
                yoyTrend: yoy1,
                yoyVariation: parseFloat(variation1.toFixed(1)),
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

        const summary = {
            isNewClient,
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
            grandTotal: {
                sales: grandTotalSales,
                cost: grandTotalCost,
                margin: grandTotalMargin,
                units: grandTotalUnits,
                products: productSet.size
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
        logger.error(`Objectives matrix error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo matriz de cliente', details: error.message });
    }
});

// =============================================================================
// POPULATIONS (For dropdown filters)
// =============================================================================
router.get('/populations', async (req, res) => {
    try {
        const rows = await query(`
            SELECT DISTINCT TRIM(POBLACION) as CITY 
            FROM DSEDAC.CLI 
            WHERE ANOBAJA = 0 
            AND TRIM(POBLACION) <> ''
            ORDER BY 1
        `);
        res.json(rows.map(r => r.CITY));
    } catch (error) {
        logger.error(`Error getting populations: ${error.message}`);
        res.status(500).json([]);
    }
});

// =============================================================================
// OBJECTIVES BY CLIENT
// =============================================================================
router.get('/by-client', async (req, res) => {
    try {
        const { vendedorCodes, years, months, city, code, nif, name, limit } = req.query;
        const now = getCurrentDate();

        // PERF: Route-level cache for by-client (only when no search filters)
        const hasFilters = city || code || nif || name;
        const cacheKey = `obj:byclient:${vendedorCodes || 'ALL'}:${years || 'default'}:${months || 'all'}:${limit || '1000'}`;
        if (!hasFilters) {
            const cachedResult = await redisCache.get('route', cacheKey);
            if (cachedResult) {
                logger.info(`[OBJECTIVES] ⚡ Cache HIT for by-client (${cacheKey})`);
                return res.json(cachedResult);
            }
        }

        // Parse years and months - default to full year
        const yearsArray = years ? years.split(',').map(y => parseInt(y.trim())).filter(y => y >= MIN_YEAR) : [now.getFullYear()];
        const monthsArray = months ? months.split(',').map(m => parseInt(m.trim())).filter(m => m >= 1 && m <= 12) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        const rowsLimit = limit ? parseInt(limit) : 1000;

        const yearsFilter = yearsArray.join(',');
        const monthsFilter = monthsArray.join(',');

        // Use LACLAE with R1_T8CDVD (route vendor) for consistency with client list and rutero
        const vendedorFilter = buildVendedorFilterLACLAE(vendedorCodes, 'L');

        let extraFilters = '';
        if (city && city.trim()) extraFilters += ` AND UPPER(C.POBLACION) = '${city.trim().toUpperCase()}'`;
        if (code && code.trim()) extraFilters += ` AND C.CODIGOCLIENTE LIKE '%${code.trim()}%'`;
        if (nif && nif.trim()) extraFilters += ` AND C.NIF LIKE '%${nif.trim()}%'`;
        if (name && name.trim()) {
            const safeName = name.trim().toUpperCase().replace(/'/g, "''");
            extraFilters += ` AND (UPPER(C.NOMBRECLIENTE) LIKE '%${safeName}%' OR UPPER(C.NOMBREALTERNATIVO) LIKE '%${safeName}%')`;
        }

        // Main year for objective calculation
        const mainYear = Math.max(...yearsArray);
        const prevYear = mainYear - 1;

        // OPTIMIZATION: Get client codes from cache instead of heavy subquery
        const cachedClientCodes = getClientCodesFromCache(vendedorCodes);

        let totalClientsCount = 0;
        let currentRows = [];

        if (cachedClientCodes && cachedClientCodes.length > 0) {
            // Use cached client codes for fast filtering
            const clientCodesFilter = cachedClientCodes.map(c => `'${c}'`).join(',');

            // Query 0: Count clients from cache (filtered by extra filters if any)
            if (extraFilters) {
                const countResult = await query(`
                    SELECT COUNT(*) as TOTAL
                    FROM DSEDAC.CLI C
                    WHERE C.CODIGOCLIENTE IN (${clientCodesFilter})
                      AND C.ANOBAJA = 0
                      ${extraFilters}
                `, false);
                totalClientsCount = countResult[0] ? parseInt(countResult[0].TOTAL) : 0;
            } else {
                totalClientsCount = cachedClientCodes.length;
            }

            // Query 1: Get client info + sales data (optimized with IN clause)
            currentRows = await query(`
              SELECT 
                C.CODIGOCLIENTE as CODE,
                COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), C.NOMBRECLIENTE) as NAME,
                C.DIRECCION as ADDRESS,
                C.CODIGOPOSTAL as POSTALCODE,
                C.POBLACION as CITY,
                COALESCE(S.SALES, 0) as SALES,
                COALESCE(S.COST, 0) as COST
              FROM DSEDAC.CLI C
              LEFT JOIN (
                SELECT LCCDCL, SUM(LCIMVT) as SALES, SUM(LCIMCT) as COST
                FROM DSED.LACLAE
                WHERE LCAADC IN(${yearsFilter})
                  AND LCMMDC IN(${monthsFilter})
                  AND ${LACLAE_SALES_FILTER.replace(/L\./g, '')}
                  AND LCCDCL IN (${clientCodesFilter})
                GROUP BY LCCDCL
              ) S ON C.CODIGOCLIENTE = S.LCCDCL
              WHERE C.CODIGOCLIENTE IN (${clientCodesFilter})
                AND C.ANOBAJA = 0
                ${extraFilters}
              ORDER BY COALESCE(S.SALES, 0) DESC
              FETCH FIRST ${rowsLimit} ROWS ONLY
            `);
        } else {
            // Fallback: Use original query with vendedor filter if cache not available
            const vendedorFilterSales = buildVendedorFilterLACLAE(vendedorCodes, 'L');

            currentRows = await query(`
              SELECT 
                L.LCCDCL as CODE,
                COALESCE(NULLIF(TRIM(MIN(C.NOMBREALTERNATIVO)), ''), MIN(C.NOMBRECLIENTE)) as NAME,
                MIN(C.DIRECCION) as ADDRESS,
                MIN(C.CODIGOPOSTAL) as POSTALCODE,
                MIN(C.POBLACION) as CITY,
                SUM(L.LCIMVT) as SALES,
                SUM(L.LCIMCT) as COST
              FROM DSED.LACLAE L
              LEFT JOIN DSEDAC.CLI C ON L.LCCDCL = C.CODIGOCLIENTE
              WHERE L.LCAADC IN(${yearsFilter})
                AND L.LCMMDC IN(${monthsFilter})
                AND ${LACLAE_SALES_FILTER}
                ${vendedorFilterSales}
                ${extraFilters}
              GROUP BY L.LCCDCL
              ORDER BY SALES DESC
              FETCH FIRST ${rowsLimit} ROWS ONLY
            `);
            totalClientsCount = currentRows.length;
        }

        // Query 2: Get previous year data for same period (for objective calculation)
        // Optimization: Only fetch previous data for the clients we actually retrieved in currentRows
        // to avoid huge joins if only showing top 100
        const retrievedCodes = currentRows.map(r => `'${r.CODE}'`).join(',');

        let prevSalesMap = new Map();

        if (retrievedCodes.length > 0) {
            const prevRows = await query(`
              SELECT 
                L.LCCDCL as CODE,
                SUM(L.LCIMVT) as PREV_SALES
              FROM DSED.LACLAE L
              WHERE L.LCAADC = ${prevYear}
                AND L.LCMMDC IN(${monthsFilter})
                AND ${LACLAE_SALES_FILTER}
                AND L.LCCDCL IN (${retrievedCodes})
              GROUP BY L.LCCDCL
            `);

            prevRows.forEach(r => {
                prevSalesMap.set(r.CODE?.trim() || '', parseFloat(r.PREV_SALES) || 0);
            });
        }

        // Fetch Objective Configuration from JAVIER.OBJ_CONFIG
        // Get config for retrieved clients AND the default ('*')
        let objectiveConfigMap = new Map();
        let defaultObjectiveData = { percentage: 10 }; // Fallback hardcoded if DB empty

        if (retrievedCodes.length > 0) {
            const objConfQuery = `
                SELECT CODIGOCLIENTE, TARGET_PERCENTAGE 
                FROM JAVIER.OBJ_CONFIG 
                WHERE CODIGOCLIENTE IN (${retrievedCodes}, '*') 
                   OR CODIGOCLIENTE = '*'
             `;

            try {
                const confRows = await query(objConfQuery);
                confRows.forEach(r => {
                    const code = r.CODIGOCLIENTE?.trim();
                    const pct = parseFloat(r.TARGET_PERCENTAGE) || 0;
                    if (code === '*') {
                        defaultObjectiveData.percentage = pct;
                    } else {
                        objectiveConfigMap.set(code, pct);
                    }
                });
            } catch (err) {
                logger.warn(`Could not load objective config: ${err.message}`);
            }
        }

        // NEW: Fetch fixed monthly targets from COMMERCIAL_TARGETS for vendors with fixed amounts
        // This is for new commercials like #15 who have fixed objectives (e.g., 25,000€/month)
        let fixedTargetsMap = new Map();
        const vendorCodesArray = vendedorCodes ? vendedorCodes.split(',').map(v => v.trim()) : [];

        if (vendorCodesArray.length > 0) {
            const now = getCurrentDate();
            const currentMonth = now.getMonth() + 1;
            const currentYear = now.getFullYear();

            try {
                const vendorList = vendorCodesArray.map(v => `'${v}'`).join(',');
                const fixedRows = await query(`
                    SELECT CODIGOVENDEDOR, IMPORTE_OBJETIVO, IMPORTE_BASE_COMISION, PORCENTAJE_MEJORA
                    FROM JAVIER.COMMERCIAL_TARGETS
                    WHERE CODIGOVENDEDOR IN (${vendorList})
                      AND ANIO = ${currentYear}
                      AND (MES = ${currentMonth} OR MES IS NULL)
                      AND ACTIVO = 1
                    ORDER BY MES DESC
                    FETCH FIRST 1 ROWS ONLY
                `, false);

                fixedRows.forEach(r => {
                    const vendorCode = r.CODIGOVENDEDOR?.trim();
                    if (vendorCode) {
                        // Store as vendor-level target (applies to all clients of this vendor)
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
            } catch (err) {
                logger.warn(`Could not load fixed commercial targets: ${err.message}`);
            }
        }

        const clients = currentRows.map(r => {
            const code = r.CODE?.trim() || '';
            const sales = parseFloat(r.SALES) || 0;
            const cost = parseFloat(r.COST) || 0;
            const margin = sales - cost;
            const prevSales = prevSalesMap.get(code) || 0;

            // Objective Logic: 
            // 1. Check COMMERCIAL_TARGETS for vendor-level fixed target (for summary only)
            // 2. For per-client breakdown, ALWAYS use percentage-based (OBJ_CONFIG or default 10%)
            // 3. Fixed targets apply only to vendor totals, not individual clients

            // Get vendor-level fixed target for summary calculation (not per-client)
            let vendorHasFixedTarget = false;
            let vendorFixedAmount = 0;
            for (const vendorCode of vendorCodesArray) {
                const vendorTarget = fixedTargetsMap.get(`VENDOR_${vendorCode}`);
                if (vendorTarget && vendorTarget.importe > 0) {
                    vendorHasFixedTarget = true;
                    vendorFixedAmount = vendorTarget.importe;
                    break;
                }
            }

            // Per-client objective: ALWAYS use percentage-based calculation
            let targetPct = objectiveConfigMap.has(code)
                ? objectiveConfigMap.get(code)
                : defaultObjectiveData.percentage;

            // Percentage stored as 10 for 10%. Multiplier = 1 + (10/100) = 1.10
            const multiplier = 1 + (targetPct / 100.0);

            // Objective: Previous year sales * multiplier
            let objective = prevSales > 0 ? prevSales * multiplier : sales;

            const progress = objective > 0 ? (sales / objective) * 100 : (sales > 0 ? 100 : 0);

            // Status based on progress
            let status = 'critical';
            if (progress >= 100) status = 'achieved';
            else if (progress >= 80) status = 'ontrack';
            else if (progress >= 50) status = 'atrisk';

            return {
                code,
                name: r.NAME?.trim() || 'Sin nombre',
                address: r.ADDRESS?.trim() || '',
                postalCode: r.POSTALCODE?.trim() || '',
                city: r.CITY?.trim() || '',
                current: sales,
                objective: objective,
                prevYear: prevSales,
                margin: margin,
                progress: Math.round(progress * 10) / 10,
                status: status
            };
        });

        // Summary counts (percentages based on RETURNED list, but count is TOTAL)
        const achieved = clients.filter(c => c.status === 'achieved').length;
        const ontrack = clients.filter(c => c.status === 'ontrack').length;
        const atrisk = clients.filter(c => c.status === 'atrisk').length;
        const critical = clients.filter(c => c.status === 'critical').length;

        const responseData = {
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

        // PERF: Cache result if no search filters (5 min)
        if (!hasFilters) {
            await redisCache.set('route', cacheKey, responseData, TTL.SHORT);
            logger.info(`[OBJECTIVES] 💾 Cached by-client (${cacheKey})`);
        }

        res.json(responseData);

    } catch (error) {
        logger.error(`Objectives by-client error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo objetivos por cliente', details: error.message });
    }
});

module.exports = router;
