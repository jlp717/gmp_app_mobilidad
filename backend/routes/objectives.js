const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { query } = require('../config/db');
const {
    getCurrentDate,
    buildVendedorFilter,
    buildVendedorFilterLACLAE,
    MIN_YEAR,
    LAC_SALES_FILTER,
    LACLAE_SALES_FILTER
} = require('../utils/common');


// =============================================================================
// INHERITED OBJECTIVES LOGIC
// For new vendors who don't have full history, we calculate objectives based
// on the sales of previous vendors who managed their current clients.
// =============================================================================

/**
 * Get all clients currently managed by a vendor (from current year or most recent data)
 */
async function getVendorCurrentClients(vendorCode, currentYear) {
    const rows = await query(`
        SELECT DISTINCT TRIM(L.LCCDCL) as CLIENT_CODE
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDVD) = '${vendorCode}'
          AND L.LCAADC = ${currentYear}
          AND ${LACLAE_SALES_FILTER}
    `, false);

    // If no clients in current year, try previous year
    if (rows.length === 0) {
        const prevRows = await query(`
            SELECT DISTINCT TRIM(L.LCCDCL) as CLIENT_CODE
            FROM DSED.LACLAE L
            WHERE TRIM(L.LCCDVD) = '${vendorCode}'
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

    const rows = await query(`
        SELECT 
            L.LCMMDC as MONTH,
            SUM(L.LCIMVT) as SALES,
            SUM(L.LCIMCT) as COST,
            COUNT(DISTINCT L.LCCDCL) as CLIENTS
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDCL) IN (${clientList})
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


// Mapeo mes número -> campo de cuota en COFC
const MONTH_QUOTA_MAP = {
    1: 'CUOTAENERO', 2: 'CUOTAFEBRERO', 3: 'CUOTAMARZO', 4: 'CUOTAABRIL',
    5: 'CUOTAMAYO', 6: 'CUOTAJUNIO', 7: 'CUOTAJULIO', 8: 'CUOTAAGOSTO',
    9: 'CUOTASEPTIEMBRE', 10: 'CUOTAOCTUBRE', 11: 'CUOTANOVIEMBRE', 12: 'CUOTADICIEMBRE'
};

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
          WHERE TRIM(CODIGOVENDEDOR) = '${code}'
        `, false);

                if (cmvResult[0]) {
                    const cmvObjective = parseFloat(cmvResult[0].OBJETIVO) || 0;
                    const cmvPercentage = parseFloat(cmvResult[0].PORCENTAJE) || 0;

                    if (cmvObjective > 0) {
                        salesObjective = cmvObjective;
                        objectiveSource = 'database';
                    } else if (cmvPercentage > 0) {
                        // Si hay porcentaje objetivo, calcular basado en año anterior (usando LAC)
                        const lastYearSales = await query(`
              SELECT COALESCE(SUM(IMPORTEVENTA), 0) as sales
              FROM DSEDAC.LAC L
              WHERE ANODOCUMENTO = ${targetYear - 1} AND MESDOCUMENTO = ${targetMonth} ${vendedorFilter}
            `, false);
                        const lastSales = parseFloat(lastYearSales[0]?.SALES) || 0;
                        salesObjective = lastSales * (1 + cmvPercentage / 100);
                        objectiveSource = 'database';
                    }
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

        const curr = currentSales[0] || {};
        const last = lastYearSales[0] || {};

        const salesCurrent = parseFloat(curr.SALES) || 0;
        const salesLast = parseFloat(last.SALES) || 0;

        // Si no encontramos objetivo en BD, calcular como +10% sobre año anterior
        if (salesObjective === 0) {
            salesObjective = salesLast * 1.10;
        }
        // Si sigue siendo 0 (sin histórico), poner un default simbólico o 0
        if (salesObjective === 0 && salesCurrent > 0) salesObjective = salesCurrent * 1.1;

        const salesProgress = salesObjective > 0 ? (salesCurrent / salesObjective) * 100 : 0;

        const marginCurrent = parseFloat(curr.MARGIN) || 0;
        const marginLast = parseFloat(last.MARGIN) || 0;
        // Si no hay marginObjective global, usar histórico + 10%
        marginObjective = marginObjective || (marginLast * 1.10);
        const marginProgress = marginObjective > 0 ? (marginCurrent / marginObjective) * 100 : 0;

        const clientsCurrent = parseInt(curr.CLIENTS) || 0;
        const clientsLast = parseInt(last.CLIENTS) || 0;
        const clientsObjective = Math.ceil(clientsLast * 1.05);
        const clientsProgress = clientsObjective > 0 ? (clientsCurrent / clientsObjective) * 100 : 0;

        // Alertas
        const alerts = [];
        if (salesProgress < 80) alerts.push({ type: 'warning', message: `Ventas al ${salesProgress.toFixed(0)}% del objetivo` });
        if (salesProgress < 50) alerts.push({ type: 'danger', message: 'Ventas muy por debajo del objetivo' });
        if (marginProgress < 70) alerts.push({ type: 'warning', message: 'Margen por debajo del esperado' });

        res.json({
            period: { year: targetYear, month: targetMonth },
            objectiveSource,
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

        // Parse years - default to current year and previous 2 (3 years total)
        const yearsArray = years
            ? years.split(',').map(y => parseInt(y.trim())).filter(y => y >= MIN_YEAR)
            : [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

        // Include previous years for dynamic objective calculation
        const allYears = [...yearsArray, ...yearsArray.map(y => y - 1)];
        const uniqueYears = [...new Set(allYears)];
        const yearsFilter = uniqueYears.join(',');

        // Use LACLAE-specific vendor filter (uses LCCDVD column)
        const vendedorFilter = buildVendedorFilterLACLAE(vendedorCodes);

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
          ORDER BY L.LCAADC, L.LCMMDC
        `);


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
                console.log(`📊 [OBJECTIVES] Vendor ${vendedorCodes} has ${missingMonths.length} months without data: [${missingMonths.join(',')}]. Loading inherited targets...`);

                const firstCode = vendedorCodes.split(',')[0].trim();
                const currentClients = await getVendorCurrentClients(firstCode, currentYear);
                if (currentClients.length > 0) {
                    inheritedMonthlySales = await getClientsMonthlySales(currentClients, prevYear);
                    console.log(`📊 [OBJECTIVES] Found ${currentClients.length} clients. Loaded inherited sales for ${Object.keys(inheritedMonthlySales).length} months.`);
                }
            }
        }

        yearsArray.forEach(year => {
            // Calculate Annual Objective first: Total Previous Year Sales * 1.10
            let prevYearTotal = 0;
            let inheritedTotal = 0;
            let currentYearTotalSoFar = 0;

            for (let m = 1; m <= 12; m++) {
                const row = rows.find(r => r.YEAR == year && r.MONTH == m); // Loose equality
                const prevRow = rows.find(r => r.YEAR == (year - 1) && r.MONTH == m);

                let ownPrevSales = prevRow ? parseFloat(prevRow.SALES) || 0 : 0;

                // Use inherited sales when vendor has no own sales for this month
                if (ownPrevSales === 0 && inheritedMonthlySales[m]) {
                    inheritedTotal += inheritedMonthlySales[m].sales;
                } else {
                    prevYearTotal += ownPrevSales;
                }

                if (row) currentYearTotalSoFar += parseFloat(row.SALES) || 0;
            }

            // Combined: own sales + inherited sales from clients
            const combinedPrevTotal = prevYearTotal + inheritedTotal;
            const annualObjective = combinedPrevTotal > 0 ? combinedPrevTotal * 1.10 : (currentYearTotalSoFar > 0 ? currentYearTotalSoFar * 1.10 : 0);
            const monthlyObjective = annualObjective / 12;

            yearlyData[year] = [];

            for (let m = 1; m <= 12; m++) {
                const row = rows.find(r => r.YEAR == year && r.MONTH == m);
                const prevRow = rows.find(r => r.YEAR == (year - 1) && r.MONTH == m);

                const sales = row ? parseFloat(row.SALES) || 0 : 0;
                const cost = row ? parseFloat(row.COST) || 0 : 0;
                const clients = row ? parseInt(row.CLIENTS) || 0 : 0;

                // SEASONAL OBJECTIVE with INHERITED support:
                // If we have combined history (own + inherited), use it for seasonality.
                let seasonalObjective = 0;

                if (combinedPrevTotal > 0) {
                    // Get own sales first
                    let baseSales = prevRow ? parseFloat(prevRow.SALES) || 0 : 0;

                    // If no own sales, use inherited sales for this month
                    if (baseSales === 0 && inheritedMonthlySales[m]) {
                        baseSales = inheritedMonthlySales[m].sales;
                    }

                    seasonalObjective = baseSales * 1.10;
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

        res.json({
            years: yearsArray,
            yearlyData,
            yearTotals,
            monthNames: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
        });

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
            productCode, productName, familyCode, subfamilyCode
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
        try {
            // Get phones (EMAIL no existe en DSEDAC.CLI)
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
                    email: c.EMAIL?.trim() || '',
                    phones: phones
                };
            }

            // Get editable notes
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
            logger.warn(`Could not load client details for matrix: ${e.message}`);
        }
        // -------------------------------------------

        // Build filter conditions
        let filterConditions = '';
        if (productCode && productCode.trim()) {
            filterConditions += ` AND UPPER(L.CODIGOARTICULO) LIKE '%${productCode.trim().toUpperCase()}%'`;
        }
        if (productName && productName.trim()) {
            filterConditions += ` AND (UPPER(A.DESCRIPCIONARTICULO) LIKE '%${productName.trim().toUpperCase()}%' OR UPPER(L.DESCRIPCION) LIKE '%${productName.trim().toUpperCase()}%')`;
        }
        if (familyCode && familyCode.trim()) {
            filterConditions += ` AND A.CODIGOFAMILIA = '${familyCode.trim()}'`;
        }
        if (subfamilyCode && subfamilyCode.trim()) {
            filterConditions += ` AND A.CODIGOSUBFAMILIA = '${subfamilyCode.trim()}'`;
        }

        // Get product purchases for this client
        const rows = await query(`
      SELECT 
        L.CODIGOARTICULO as PRODUCT_CODE,
        COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.DESCRIPCION)) as PRODUCT_NAME,
        COALESCE(A.CODIGOFAMILIA, 'SIN_FAM') as FAMILY_CODE,
        COALESCE(NULLIF(TRIM(A.CODIGOSUBFAMILIA), ''), 'General') as SUBFAMILY_CODE,
        COALESCE(TRIM(A.UNIDADMEDIDA), 'UDS') as UNIT_TYPE,
        L.ANODOCUMENTO as YEAR,
        L.MESDOCUMENTO as MONTH,
        SUM(L.IMPORTEVENTA) as SALES,
        SUM(L.IMPORTECOSTO) as COST,
        SUM(L.CANTIDADUNIDADES) as UNITS,
        -- Discount detection AND details
        SUM(CASE WHEN L.PRECIOTARIFACLIENTE <> 0 AND L.PRECIOTARIFA01 <> 0 
                  AND L.PRECIOTARIFACLIENTE <> L.PRECIOTARIFA01 THEN 1 ELSE 0 END) as HAS_SPECIAL_PRICE,
        SUM(CASE WHEN L.PORCENTAJEDESCUENTO <> 0 OR L.IMPORTEDESCUENTOUNIDAD <> 0 THEN 1 ELSE 0 END) as HAS_DISCOUNT,
        AVG(CASE WHEN L.PORCENTAJEDESCUENTO <> 0 THEN L.PORCENTAJEDESCUENTO ELSE NULL END) as AVG_DISCOUNT_PCT,
        AVG(CASE WHEN L.IMPORTEDESCUENTOUNIDAD <> 0 THEN L.IMPORTEDESCUENTOUNIDAD ELSE NULL END) as AVG_DISCOUNT_EUR,
        -- Average prices for comparison
        AVG(L.PRECIOTARIFACLIENTE) as AVG_CLIENT_TARIFF,
        AVG(L.PRECIOTARIFA01) as AVG_BASE_TARIFF
      FROM DSEDAC.LAC L
      LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
      LEFT JOIN DSEDAC.CAC C ON C.CCSBAB = L.LCSBAB 
        AND C.CCYEAB = L.LCYEAB 
        AND C.CCSRAB = L.LCSRAB 
        AND C.CCTRAB = L.LCTRAB 
        AND C.CCNRAB = L.LCNRAB
      WHERE L.CODIGOCLIENTEALBARAN = '${clientCode}'
        AND L.ANODOCUMENTO IN(${yearsFilter})
        AND L.MESDOCUMENTO BETWEEN ${monthStart} AND ${monthEnd}
        -- FILTERS to match LACLAE logic
        AND ${LAC_SALES_FILTER}
        ${filterConditions}
      GROUP BY L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, L.DESCRIPCION, A.CODIGOFAMILIA, A.CODIGOSUBFAMILIA, A.UNIDADMEDIDA, L.ANODOCUMENTO, L.MESDOCUMENTO
      ORDER BY SALES DESC
    `);

        // Get family names and available filters properly
        const familyNames = {};
        const subfamilyNames = {};

        // Logic to build distinct filter lists based on ACTUAL data found
        const availableFamiliesMap = new Map();
        const availableSubfamiliesMap = new Map();

        try {
            // 1. Load Name Maps
            const famRows = await query(`SELECT CODIGOFAMILIA, DESCRIPCIONFAMILIA FROM DSEDAC.FAM`);
            famRows.forEach(r => { familyNames[r.CODIGOFAMILIA?.trim()] = r.DESCRIPCIONFAMILIA?.trim() || r.CODIGOFAMILIA?.trim(); });
            // SFM Empty

        } catch (e) {
            logger.warn(`Could not load family names: ${e.message}`);
        }

        // Build hierarchy: Family -> Subfamily -> Product
        const familyMap = new Map();
        let grandTotalSales = 0, grandTotalCost = 0, grandTotalUnits = 0;
        let grandTotalPrevSales = 0, grandTotalPrevCost = 0, grandTotalPrevUnits = 0;
        const productSet = new Set();

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

            // Populate Distinct Filter Maps
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

        // Calculate Aggregated Summary
        const grandTotalMargin = grandTotalSales - grandTotalCost;
        const grandTotalPrevMargin = grandTotalPrevSales - grandTotalPrevCost;

        const salesGrowth = grandTotalPrevSales > 0 ? ((grandTotalSales - grandTotalPrevSales) / grandTotalPrevSales) * 100 : 0;
        const marginGrowth = grandTotalPrevMargin > 0 ? ((grandTotalMargin - grandTotalPrevMargin) / grandTotalPrevMargin) * 100 : 0;
        const unitsGrowth = grandTotalPrevUnits > 0 ? ((grandTotalUnits - grandTotalPrevUnits) / grandTotalPrevUnits) * 100 : 0;

        const summary = {
            current: {
                label: yearsArray.join(', '),
                sales: grandTotalSales,
                margin: grandTotalMargin,
                units: grandTotalUnits,
                products: productSet.size
            },
            previous: {
                label: yearsArray.map(y => y - 1).join(', '),
                sales: grandTotalPrevSales,
                margin: grandTotalPrevMargin,
                units: grandTotalPrevUnits
            },
            growth: {
                sales: salesGrowth,
                margin: marginGrowth,
                units: unitsGrowth
            },
            breakdown: []
        };

        res.json({
            clientCode,
            contactInfo, // NEW
            editableNotes, // NEW
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
                subfamilies: Array.from(availableSubfamiliesMap.values()).sort((a, b) => a.name.localeCompare(b.name))
            },
            families,
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

        // Parse years and months - default to full year
        const yearsArray = years ? years.split(',').map(y => parseInt(y.trim())).filter(y => y >= MIN_YEAR) : [now.getFullYear()];
        const monthsArray = months ? months.split(',').map(m => parseInt(m.trim())).filter(m => m >= 1 && m <= 12) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        const rowsLimit = limit ? parseInt(limit) : 1000; // Default limit 1000 if not specified to prevent overload

        const yearsFilter = yearsArray.join(',');
        const monthsFilter = monthsArray.join(',');
        const vendedorFilter = buildVendedorFilter(vendedorCodes, 'L');

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

        // Query 0: Get TOTAL COUNT (ignoring limit)
        const countResult = await query(`
            SELECT COUNT(DISTINCT L.CODIGOCLIENTEALBARAN) as TOTAL
            FROM DSEDAC.LAC L
            LEFT JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
            WHERE L.ANODOCUMENTO IN(${yearsFilter})
                AND L.MESDOCUMENTO IN(${monthsFilter})
                AND ${LAC_SALES_FILTER}
                ${vendedorFilter}
                ${extraFilters}
        `, false); // false = simple query mode if needed, or stick to default

        const totalClientsCount = countResult[0] ? parseInt(countResult[0].TOTAL) : 0;

        // Query 1: Get current period client data (WITH LIMIT)
        const currentRows = await query(`
      SELECT 
        L.CODIGOCLIENTEALBARAN as CODE,
        COALESCE(NULLIF(TRIM(MIN(C.NOMBREALTERNATIVO)), ''), MIN(C.NOMBRECLIENTE)) as NAME,
        MIN(C.DIRECCION) as ADDRESS,
        MIN(C.CODIGOPOSTAL) as POSTALCODE,
        MIN(C.POBLACION) as CITY,
        SUM(L.IMPORTEVENTA) as SALES,
        SUM(L.IMPORTECOSTO) as COST
      FROM DSEDAC.LAC L
      LEFT JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
      LEFT JOIN DSEDAC.CAC CA ON CA.CCSBAB = L.LCSBAB 
        AND CA.CCYEAB = L.LCYEAB 
        AND CA.CCSRAB = L.LCSRAB 
        AND CA.CCTRAB = L.LCTRAB 
        AND CA.CCNRAB = L.LCNRAB
      WHERE L.ANODOCUMENTO IN(${yearsFilter})
        AND L.MESDOCUMENTO IN(${monthsFilter})
        -- Matrix cleanup filters
        -- Golden Filters
        AND L.LCTPVT IN ('CC', 'VC')
        AND L.LCCLLN IN ('AB', 'VT')
        AND L.LCSRAB NOT IN ('N', 'Z')
        AND COALESCE(CA.CCSNSD, '') <> 'E'
        ${vendedorFilter}
        ${extraFilters}
      GROUP BY L.CODIGOCLIENTEALBARAN
      ORDER BY SALES DESC
      FETCH FIRST ${rowsLimit} ROWS ONLY
    `);

        // Query 2: Get previous year data for same period (for objective calculation)
        // Optimization: Only fetch previous data for the clients we actually retrieved in currentRows
        // to avoid huge joins if only showing top 100
        const retrievedCodes = currentRows.map(r => `'${r.CODE}'`).join(',');

        let prevSalesMap = new Map();

        if (retrievedCodes.length > 0) {
            const prevRows = await query(`
              SELECT 
                L.CODIGOCLIENTEALBARAN as CODE,
                SUM(L.IMPORTEVENTA) as PREV_SALES
              FROM DSEDAC.LAC L
              LEFT JOIN DSEDAC.CAC CA ON CA.CCSBAB = L.LCSBAB 
                AND CA.CCYEAB = L.LCYEAB 
                AND CA.CCSRAB = L.LCSRAB 
                AND CA.CCTRAB = L.LCTRAB 
                AND CA.CCNRAB = L.LCNRAB
              WHERE L.ANODOCUMENTO = ${prevYear}
                AND L.MESDOCUMENTO IN(${monthsFilter})
                AND L.LCTPVT IN ('CC', 'VC')
                AND L.LCCLLN IN ('AB', 'VT')
                AND L.LCSRAB NOT IN ('N', 'Z')
                AND COALESCE(CA.CCSNSD, '') <> 'E'
                AND L.CODIGOCLIENTEALBARAN IN (${retrievedCodes})
              GROUP BY L.CODIGOCLIENTEALBARAN
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

        const clients = currentRows.map(r => {
            const code = r.CODE?.trim() || '';
            const sales = parseFloat(r.SALES) || 0;
            const cost = parseFloat(r.COST) || 0;
            const margin = sales - cost;
            const prevSales = prevSalesMap.get(code) || 0;

            // Objective Logic: 
            // 1. Look for specific client rule
            // 2. If not found, use Default from DB ('*')
            // 3. Fallback to 10%
            let targetPct = objectiveConfigMap.has(code)
                ? objectiveConfigMap.get(code)
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

        res.json({
            clients,
            count: totalClientsCount, // Return TRUE total
            start: 0,
            limit: rowsLimit,
            periodObjective: clients.reduce((sum, c) => sum + c.objective, 0),
            totalSales: clients.reduce((sum, c) => sum + c.current, 0),
            years: yearsArray,
            months: monthsArray,
            summary: { achieved, ontrack, atrisk, critical }
        });

    } catch (error) {
        logger.error(`Objectives by-client error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo objetivos por cliente', details: error.message });
    }
});

module.exports = router;
