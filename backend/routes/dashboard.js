const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { query } = require('../config/db');
const {
    getCurrentDate,
    buildVendedorFilter,
    buildVendedorFilterLACLAE,
    formatCurrency,
    MIN_YEAR,
    LAC_SALES_FILTER,
    LACLAE_SALES_FILTER
} = require('../utils/common');


// Simple In-Memory Cache for Dashboard Data (5 min TTL)
const dashboardCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getFromCache(key) {
    const item = dashboardCache.get(key);
    if (item && item.expiry > Date.now()) {
        return item.data;
    }
    dashboardCache.delete(key);
    return null;
}

function setInCache(key, data) {
    // Prevent memory overflow
    if (dashboardCache.size > 100) {
        // Remove oldest entries (simple approach: clear half)
        const keys = [...dashboardCache.keys()];
        for (let i = 0; i < 50; i++) dashboardCache.delete(keys[i]);
    }
    dashboardCache.set(key, { data, expiry: Date.now() + CACHE_TTL });
}

// =============================================================================
// KPI CARDS ENDPOINT (Updated to use DSEDAC.LAC for proper history)
// =============================================================================
router.get('/metrics', async (req, res) => {
    try {
        const cacheKey = `metrics:${JSON.stringify(req.query)}`;
        const cached = getFromCache(cacheKey);
        if (cached) {
            logger.info(`⚡ Cache hit: ${req.originalUrl}`);
            return res.json(cached);
        }

        const { vendedorCodes, year, month } = req.query;
        const now = getCurrentDate();
        const currentYear = parseInt(year) || now.getFullYear();
        const currentMonth = parseInt(month) || (now.getMonth() + 1);

        const vendedorFilter = buildVendedorFilterLACLAE(vendedorCodes);

        // Query Current Year Data from LACLAE (Lineas Albarán Clientes)
        // Using LCIMVT for sales WITHOUT VAT (matches 15,220,182.87€ for 2025)
        const currentData = await query(`
      SELECT 
        COALESCE(SUM(L.LCIMVT), 0) as sales,
        COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) as margin,
        COALESCE(SUM(L.LCCTEV), 0) as boxes,
        COUNT(DISTINCT L.LCCDCL) as activeClients
      FROM DSED.LACLAE L
      WHERE L.LCAADC = ${currentYear} 
        AND L.LCMMDC = ${currentMonth} 
        AND ${LACLAE_SALES_FILTER}
        ${vendedorFilter}
    `);

        // Query Last Year Data (Same Month)
        const lastData = await query(`
      SELECT 
        COALESCE(SUM(L.LCIMVT), 0) as sales,
        COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) as margin,
        COALESCE(SUM(L.LCCTEV), 0) as boxes
      FROM DSED.LACLAE L
      WHERE L.LCAADC = ${currentYear - 1} 
        AND L.LCMMDC = ${currentMonth} 
        AND ${LACLAE_SALES_FILTER}
        ${vendedorFilter}
    `);

        // Today's metrics (using LACLAE for consistency)
        const today = now.getDate();
        // Only fetch if requesting current month
        let todaySales = 0;
        let todayOrders = 0;

        if (currentYear === now.getFullYear() && currentMonth === (now.getMonth() + 1)) {
            const todayData = await query(`
            SELECT COALESCE(SUM(L.LCIMVT), 0) as sales, COUNT(DISTINCT L.LCNRAB) as orders
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ${currentYear} AND L.LCMMDC = ${currentMonth} AND L.LCDDDC = ${today} AND ${LACLAE_SALES_FILTER} ${vendedorFilter}
        `);
            todaySales = parseFloat(todayData[0]?.SALES) || 0;
            todayOrders = parseInt(todayData[0]?.ORDERS) || 0;
        }


        const curr = currentData[0] || {};
        const last = lastData[0] || {};

        const currentSales = parseFloat(curr.SALES) || 0;
        const lastSales = parseFloat(last.SALES) || 0;

        // Calculate variations
        const calcVar = (curr, prev) => prev && prev !== 0 ? ((curr - prev) / prev) * 100 : 0;
        const growthPercent = calcVar(currentSales, lastSales);

        const responseData = {
            period: { year: currentYear, month: currentMonth },
            // Return raw numbers (not formatted strings) to avoid type errors in frontend
            totalSales: currentSales,
            totalBoxes: parseFloat(curr.BOXES) || 0,
            totalOrders: todayOrders || 0, // Use today's orders count for now
            totalMargin: parseFloat(curr.MARGIN) || 0,
            uniqueClients: parseInt(curr.ACTIVECLIENTS) || 0,
            avgOrderValue: todayOrders > 0 ? todaySales / todayOrders : 0,
            todaySales: todaySales,
            todayOrders: todayOrders,
            lastMonthSales: lastSales,
            growthPercent: Math.round(growthPercent * 10) / 10,

            // Detailed object structure for new frontend (if applicable)
            sales: {
                value: currentSales,
                variation: growthPercent,
                trend: currentSales >= lastSales ? 'up' : 'down'
            },
            margin: {
                value: parseFloat(curr.MARGIN) || 0,
                variation: calcVar(parseFloat(curr.MARGIN), parseFloat(last.MARGIN)),
                trend: parseFloat(curr.MARGIN) >= parseFloat(last.MARGIN) ? 'up' : 'down'
            },
            clients: {
                value: parseInt(curr.ACTIVECLIENTS) || 0,
                variation: 0,
                trend: 'neutral'
            },
            boxes: {
                value: parseFloat(curr.BOXES) || 0,
                variation: calcVar(parseFloat(curr.BOXES), parseFloat(last.BOXES)),
                trend: parseFloat(curr.BOXES) >= parseFloat(last.BOXES) ? 'up' : 'down'
            }
        };

        setInCache(cacheKey, responseData);
        res.json(responseData);

    } catch (error) {
        logger.error(`Metrics error: ${error.message}`);
        res.status(500).json({ error: 'Error calculating metrics', details: error.message });
    }
});

// =============================================================================
// MATRIX DATA - Power BI Style Pivoted Data (Using LAC for reliability)
// =============================================================================
// =============================================================================
// MATRIX DATA - Dynamic Hierarchy Support
// =============================================================================
// =============================================================================
// MATRIX DATA - Dynamic Hierarchy Support
// =============================================================================
router.get('/matrix-data', async (req, res) => {
    try {
        const cacheKey = `matrix:${JSON.stringify(req.query)}`;
        const cached = getFromCache(cacheKey);
        if (cached) {
            logger.info(`⚡ Cache hit: ${req.originalUrl}`);
            return res.json(cached);
        }

        // groupBy is now a comma-separated list: "vendor,client,product"
        const { vendedorCodes, groupBy = 'vendor', year, years } = req.query;

        // Year Logic: Support single 'year' (with YoY) OR multiple 'years' (no automatic YoY)
        let yearFilter = '';
        let selectedYear = parseInt(year) || getCurrentDate().getFullYear();
        let prevYear = selectedYear - 1;

        if (years && years.trim().length > 0) {
            const yearList = years.split(',').map(y => parseInt(y.trim())).filter(y => !isNaN(y));
            if (yearList.length > 0) {
                yearFilter = `AND L.ANODOCUMENTO IN (${yearList.join(',')})`;
            } else {
                yearFilter = `AND L.ANODOCUMENTO = ${selectedYear}`;
            }
        } else {
            // Default behavior: Selected Year + Previous Year for YoY
            yearFilter = `AND L.ANODOCUMENTO IN (${selectedYear}, ${prevYear})`;
        }

        // --- FILTER BUILDING ---
        const vendedorFilter = buildVendedorFilter(vendedorCodes);

        const { clientCodes } = req.query;
        const clientFilter = clientCodes && clientCodes !== 'ALL'
            ? `AND L.CODIGOCLIENTEALBARAN IN (${clientCodes.split(',').map(c => `'${c.trim()}'`).join(',')})`
            : '';

        const { productCodes } = req.query;
        const productFilter = productCodes && productCodes !== 'ALL'
            ? `AND L.CODIGOARTICULO IN (${productCodes.split(',').map(c => `'${c.trim()}'`).join(',')})`
            : '';

        // --- FAMILY FILTERING (New) ---
        // Since LAC doesn't have CODIGOFAMILIA, we must first find which products belong to these families
        let familyProductFilter = '';
        const { familyCodes } = req.query;

        if (familyCodes && familyCodes !== 'ALL') {
            const fCodes = familyCodes.split(',').map(f => `'${f.trim()}'`).join(',');
            // Lookup products for these families
            const famProducts = await query(`
                SELECT TRIM(CODIGOARTICULO) as CODE 
                FROM DSEDAC.ART 
                WHERE CODIGOFAMILIA IN (${fCodes})
             `);

            if (famProducts.length > 0) {
                // Create a list of product codes
                const pCodes = famProducts.map(p => `'${p.CODE}'`).join(',');
                // Limit query length safety - if too many, we might need a different approach (e.g. subquery)
                // For now, assuming manageable size. If very large, a subquery is safer but slower in some DBs.
                // DB2 supports WHERE IN (SELECT ...) efficiently.
                familyProductFilter = `AND L.CODIGOARTICULO IN (SELECT CODIGOARTICULO FROM DSEDAC.ART WHERE CODIGOFAMILIA IN (${fCodes}))`;
            } else {
                // No products found for family? Then return empty results
                familyProductFilter = 'AND 1=0';
            }
        }

        // --- DYNAMIC GROUPING LOGIC ---
        const hierarchy = groupBy.split(',').map(g => g.trim().toLowerCase());

        // Step 1: Build aggregate query WITHOUT JOINs (only LAC table)
        const selectClauses = ['L.ANODOCUMENTO as YEAR', 'L.MESDOCUMENTO as MONTH'];
        const groupClauses = ['L.ANODOCUMENTO', 'L.MESDOCUMENTO'];
        const needsVendor = hierarchy.includes('vendor');
        const needsClient = hierarchy.includes('client');
        const needsProduct = hierarchy.includes('product');
        const needsFamily = hierarchy.includes('family');

        hierarchy.forEach((level, index) => {
            const levelIdx = index + 1;
            if (level === 'vendor') {
                selectClauses.push(`TRIM(L.CODIGOVENDEDOR) as ID_${levelIdx}`);
                groupClauses.push('L.CODIGOVENDEDOR');
            } else if (level === 'client') {
                selectClauses.push(`TRIM(L.CODIGOCLIENTEALBARAN) as ID_${levelIdx}`);
                groupClauses.push('L.CODIGOCLIENTEALBARAN');
            } else if (level === 'product') {
                selectClauses.push(`TRIM(L.CODIGOARTICULO) as ID_${levelIdx}`);
                groupClauses.push('L.CODIGOARTICULO');
            } else if (level === 'family') {
                // Family requires ART join - we workaround by grouping by Product
                // and then later re-aggregating by Family in JS.
                selectClauses.push(`TRIM(L.CODIGOARTICULO) as ID_${levelIdx}`);
                groupClauses.push('L.CODIGOARTICULO');
            }
        });

        // Add Measures
        selectClauses.push('SUM(L.IMPORTEVENTA) as SALES');
        selectClauses.push('SUM(L.IMPORTEVENTA - L.IMPORTECOSTO) as MARGIN');

        // Execute aggregate query
        const aggregateSQL = `
            SELECT ${selectClauses.join(', ')}
            FROM DSEDAC.LAC L
              WHERE 1=1
              -- Golden Filters
              AND ${LAC_SALES_FILTER}
              ${yearFilter}
              ${vendedorFilter}
              ${clientFilter}
              ${productFilter}
              ${familyProductFilter}
            GROUP BY ${groupClauses.join(', ')}
            ORDER BY SUM(L.IMPORTEVENTA) DESC
            FETCH FIRST 50000 ROWS ONLY
        `;

        const rawData = await query(aggregateSQL);

        // Step 2: Fetch names separately for each dimension
        const nameLookups = [];

        if (needsVendor) {
            const vendorIdx = hierarchy.indexOf('vendor') + 1;
            const vendorCodes = [...new Set(rawData.map(r => r[`ID_${vendorIdx}`]).filter(Boolean))];
            if (vendorCodes.length > 0) {
                nameLookups.push(
                    query(`SELECT TRIM(CODIGOVENDEDOR) as CODE, TRIM(NOMBREVENDEDOR) as NAME FROM DSEDAC.VDD WHERE CODIGOVENDEDOR IN (${vendorCodes.map(c => `'${c}'`).join(',')})`)
                        .then(vendors => ({ type: 'vendor', idx: vendorIdx, data: vendors }))
                        .catch(() => ({ type: 'vendor', idx: vendorIdx, data: [] }))
                );
            }
        }

        if (needsClient) {
            const clientIdx = hierarchy.indexOf('client') + 1;
            const clientCodesList = [...new Set(rawData.map(r => r[`ID_${clientIdx}`]).filter(Boolean))];
            if (clientCodesList.length > 0) {
                nameLookups.push(
                    query(`SELECT TRIM(CODIGOCLIENTE) as CODE, COALESCE(NULLIF(TRIM(NOMBREALTERNATIVO), ''), TRIM(NOMBRECLIENTE)) as NAME FROM DSEDAC.CLI WHERE CODIGOCLIENTE IN (${clientCodesList.map(c => `'${c}'`).join(',')})`)
                        .then(clients => ({ type: 'client', idx: clientIdx, data: clients }))
                        .catch(() => ({ type: 'client', idx: clientIdx, data: [] }))
                );
            }
        }

        if (needsProduct || needsFamily) {
            // Process products/families together since both come from ART
            // Find ALL indices that need product/family info
            const prodIndices = [];
            const famIndices = [];

            hierarchy.forEach((h, i) => {
                if (h === 'product') prodIndices.push(i + 1);
                if (h === 'family') famIndices.push(i + 1);
            });

            // Collect all unique Product IDs from the rawData columns for these indices
            const productCodes = new Set();
            prodIndices.forEach(idx => rawData.forEach(r => { if (r[`ID_${idx}`]) productCodes.add(r[`ID_${idx}`]); }));
            famIndices.forEach(idx => rawData.forEach(r => { if (r[`ID_${idx}`]) productCodes.add(r[`ID_${idx}`]); }));

            if (productCodes.size > 0) {
                const codesArr = [...productCodes];
                // Chunk queries if too many (DB2 limiit ~1000 items in IN clause usually safe, but let's be careful)
                // For simplicity assuming under 2000 unique products in top 50k rows for now or standard limit

                const productQuery = `
                    SELECT 
                        TRIM(A.CODIGOARTICULO) as CODE, 
                        TRIM(A.DESCRIPCIONARTICULO) as NAME,
                        TRIM(A.CODIGOFAMILIA) as FAM_CODE,
                        COALESCE(TRIM(F.DESCRIPCIONFAMILIA), TRIM(A.CODIGOFAMILIA)) as FAM_NAME
                    FROM DSEDAC.ART A 
                    LEFT JOIN DSEDAC.FAM F ON A.CODIGOFAMILIA = F.CODIGOFAMILIA 
                    WHERE A.CODIGOARTICULO IN (${codesArr.map(c => `'${c}'`).join(',')})
                `;

                nameLookups.push(
                    query(productQuery)
                        .then(products => ({ type: 'art_mix', prodIndices, famIndices, data: products }))
                        .catch(err => {
                            logger.warn(`Error fetching product info: ${err.message}`);
                            return { type: 'art_mix', prodIndices, famIndices, data: [] };
                        })
                );
            }
        }

        const lookupResults = await Promise.all(nameLookups);

        // Step 3: Hydrate Data & CORRECT IDs
        // Create maps first
        const vendorMap = {};
        const clientMap = {};
        const productInfoMap = {}; // Maps ProductID -> { name, famCode, famName }

        lookupResults.forEach(res => {
            if (res.type === 'vendor') {
                res.data.forEach(x => vendorMap[x.CODE] = x.NAME || x.CODE);
            } else if (res.type === 'client') {
                res.data.forEach(x => clientMap[x.CODE] = x.NAME || x.CODE);
            } else if (res.type === 'art_mix') {
                res.data.forEach(x => {
                    productInfoMap[x.CODE] = {
                        prodName: x.NAME || x.CODE,
                        famCode: x.FAM_CODE || 'UNK',
                        famName: x.FAM_NAME ? `${x.FAM_CODE} - ${x.FAM_NAME}` : `Family ${x.FAM_CODE}`
                    };
                });
            }
        });

        // =================================================================================
        // STEP 4: RE-AGGREGATION (Critical for Family Grouping & Performance)
        // =================================================================================
        const aggregatedMap = new Map();

        rawData.forEach(row => {
            // Mutate/Prepare row
            hierarchy.forEach((level, i) => {
                const idx = i + 1;
                const idVal = row[`ID_${idx}`];

                if (level === 'vendor') {
                    if (vendorMap[idVal]) {
                        row[`NAME_${idx}`] = vendorMap[idVal];
                    } else {
                        // Fallback for orphan codes (e.g. '82', '20', or empty)
                        row[`NAME_${idx}`] = 'Sin Comercial Asignado';
                        // Optional: Unify their ID to a generic one if we want them grouped together?
                        // User said "ponlo sin código". 
                        // If we return ID='82' and Name='Sin Comercial Asignado', they naturally group if frontend groups by Name.
                        // If frontend groups by ID, we might see multiple "Sin Comercial Asignado" rows.
                        // Better to group them? Or keep distinct?
                        // "ponlo sin código" likely means display empty code or specific label.
                        // Let's keep the ID for traceability but set Name clearly. 
                        // Actually, to ensure they group together if desired, we could alias the ID, but that breaks drill-down.
                        // Safest: Set Name = 'Sin Comercial Asignado'.
                        // If 'idVal' is empty string, make it clearer?
                        if (!idVal || idVal.trim() === '') row[`ID_${idx}`] = 'UNK';
                    }
                } else if (level === 'client') {
                    row[`NAME_${idx}`] = clientMap[idVal] || idVal;
                } else if (level === 'product') {
                    // ID is correct (Product Code), set Name
                    const info = productInfoMap[idVal];
                    row[`NAME_${idx}`] = info ? info.prodName : idVal;
                } else if (level === 'family') {
                    // ID is currently Product Code (from SQL Group By). 
                    // WE MUST REPLACE IT with Family Code.
                    const info = productInfoMap[idVal];
                    if (info) {
                        row[`ID_${idx}`] = info.famCode;
                        row[`NAME_${idx}`] = info.famName;
                    } else {
                        // Fallback if product not found (should be rare)
                        row[`ID_${idx}`] = 'UNK';
                        row[`NAME_${idx}`] = 'Unknown Family';
                    }
                }
            });

            // Build unique key based on potentially MODIFIED IDs
            const keyParts = [row.YEAR, row.MONTH];
            for (let i = 0; i < hierarchy.length; i++) {
                keyParts.push(row[`ID_${i + 1}`]);
            }
            const uniqueKey = keyParts.join('|');

            if (aggregatedMap.has(uniqueKey)) {
                const existing = aggregatedMap.get(uniqueKey);
                existing.SALES += parseFloat(row.SALES || 0);
                existing.MARGIN += parseFloat(row.MARGIN || 0);
            } else {
                aggregatedMap.set(uniqueKey, {
                    ...row,
                    SALES: parseFloat(row.SALES || 0),
                    MARGIN: parseFloat(row.MARGIN || 0)
                });
            }
        });

        const finalData = Array.from(aggregatedMap.values());

        setInCache(cacheKey, {
            rows: finalData,
            hierarchy: hierarchy,
            periods: [],
            year: selectedYear
        });

        res.json({
            rows: finalData,
            hierarchy: hierarchy,
            periods: [],
            year: selectedYear
        });

    } catch (error) {
        logger.error(`Matrix data error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo datos matriciales', details: error.message });
    }
});

// =============================================================================
// SALES EVOLUTION (Multi-year comparison, weekly/monthly, YTD support)
// =============================================================================
router.get('/sales-evolution', async (req, res) => {
    try {
        const { vendedorCodes, years, granularity = 'month', upToToday = 'false', months = 36 } = req.query;
        const vendedorFilter = buildVendedorFilterLACLAE(vendedorCodes);

        // Parse years
        const now = getCurrentDate();
        const selectedYears = years
            ? years.split(',').map(y => parseInt(y.trim()))
            : [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];
        const yearsFilter = `AND L.LCAADC IN (${selectedYears.join(',')})`;

        // YTD filter logic
        let dateFilter = '';
        if (upToToday === 'true') {
            const currentMonth = now.getMonth() + 1;
            const currentDay = now.getDate();
            dateFilter = `AND (L.LCAADC < ${now.getFullYear()} OR (L.LCAADC = ${now.getFullYear()} AND L.LCMMDC < ${currentMonth}) OR (L.LCAADC = ${now.getFullYear()} AND L.LCMMDC = ${currentMonth} AND L.LCDDDC <= ${currentDay}))`;
        }

        let resultData = [];

        if (granularity === 'week') {
            // Weekly: Get DAILY data and aggregate in JS
            const dailyQuery = `
        SELECT L.LCAADC as year, L.LCMMDC as month, L.LCDDDC as day,
               SUM(L.LCIMVT) as sales,
               COUNT(DISTINCT L.LCNRAB) as orders,
               COUNT(DISTINCT L.LCCDCL) as clients
        FROM DSED.LACLAE L
        WHERE ${LACLAE_SALES_FILTER} ${yearsFilter} ${dateFilter} ${vendedorFilter}
        GROUP BY L.LCAADC, L.LCMMDC, L.LCDDDC
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC, L.LCDDDC DESC
      `;
            const dailyData = await query(dailyQuery, false);

            const weeklyMap = {};
            dailyData.forEach(row => {
                const date = new Date(row.YEAR, row.MONTH - 1, row.DAY);
                const startOfYear = new Date(row.YEAR, 0, 1);
                const days = Math.floor((date - startOfYear) / (24 * 60 * 60 * 1000));
                const week = Math.ceil((days + startOfYear.getDay() + 1) / 7);
                const key = `${row.YEAR}-W${String(week).padStart(2, '0')}`;

                if (!weeklyMap[key]) {
                    weeklyMap[key] = { year: row.YEAR, week: week, month: row.MONTH, totalSales: 0, totalOrders: 0, uniqueClients: 0 };
                }
                weeklyMap[key].totalSales += parseFloat(row.SALES) || 0;
                weeklyMap[key].totalOrders += parseInt(row.ORDERS) || 0;
                weeklyMap[key].uniqueClients += parseInt(row.CLIENTS) || 0;
            });

            resultData = Object.values(weeklyMap).sort((a, b) => (b.year * 100 + b.week) - (a.year * 100 + a.week));

        } else {
            // Monthly: Simple Group By Month
            const monthlyQuery = `
        SELECT L.LCAADC as year, L.LCMMDC as month,
               SUM(L.LCIMVT) as totalSales,
               COUNT(DISTINCT L.LCNRAB) as totalOrders,
               COUNT(DISTINCT L.LCCDCL) as uniqueClients
        FROM DSED.LACLAE L
        WHERE ${LACLAE_SALES_FILTER} ${yearsFilter} ${dateFilter} ${vendedorFilter}
        GROUP BY L.LCAADC, L.LCMMDC
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC
      `;
            const rows = await query(monthlyQuery);
            resultData = rows.map(r => ({
                year: r.YEAR, month: r.MONTH,
                totalSales: parseFloat(r.TOTALSALES) || 0,
                totalOrders: parseInt(r.TOTALORDERS) || 0,
                uniqueClients: parseInt(r.UNIQUECLIENTS) || 0
            }));
        }


        // Apply row limit in JS to be safe
        const limitedData = resultData.slice(0, parseInt(months) || 36);

        res.json({ evolution: limitedData });

    } catch (error) {
        logger.error(`Evolution error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo evolución', details: error.message });
    }
});

// =============================================================================
// RECENT SALES
// =============================================================================
router.get('/recent-sales', async (req, res) => {
    try {
        const { vendedorCodes, limit = 20 } = req.query;
        const vendedorFilter = buildVendedorFilter(vendedorCodes, 'L');

        const sales = await query(`
      SELECT 
        L.ANODOCUMENTO as year, L.MESDOCUMENTO as month, L.DIADOCUMENTO as day,
        L.CODIGOCLIENTEALBARAN as clientCode,
        C.NOMBRECLIENTE as clientName, L.CODIGOVENDEDOR as vendedorCode,
        L.SERIEDOCUMENTO as docType,
        SUM(L.IMPORTEVENTA) as totalEuros,
        SUM(L.CANTIDADENVASES) as totalBoxes,
        SUM(L.IMPORTEMARGENREAL) as totalMargin,
        COUNT(*) as numLines
      FROM DSEDAC.LINDTO L
      LEFT JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
      WHERE L.ANODOCUMENTO >= ${MIN_YEAR} ${vendedorFilter}
      GROUP BY L.ANODOCUMENTO, L.MESDOCUMENTO, L.DIADOCUMENTO,
        L.CODIGOCLIENTEALBARAN, C.NOMBRECLIENTE, L.CODIGOVENDEDOR, L.SERIEDOCUMENTO
      ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC
      FETCH FIRST ${parseInt(limit)} ROWS ONLY
        `);

        res.json({
            sales: sales.map(s => ({
                date: `${s.YEAR}-${String(s.MONTH).padStart(2, '0')}-${String(s.DAY).padStart(2, '0')}`,
                clientCode: s.CLIENTCODE?.trim(),
                clientName: s.CLIENTNAME?.trim() || 'Sin nombre',
                vendedorCode: s.VENDEDORCODE?.trim(),
                type: s.DOCTYPE?.trim() || 'VT',
                totalEuros: formatCurrency(s.TOTALEUROS),
                totalMargin: formatCurrency(s.TOTALMARGIN),
                totalBoxes: parseInt(s.TOTALBOXES) || 0,
                numLines: parseInt(s.NUMLINES) || 0
            }))
        });

    } catch (error) {
        logger.error(`Recent sales error: ${error.message} `);
        res.status(500).json({ error: 'Error obteniendo ventas', details: error.message });
    }
});

// =============================================================================
// PRODUCT SEARCH
// =============================================================================
router.get('/products-search', async (req, res) => {
    try {
        const { query: searchTerm, limit = 50 } = req.query;

        let whereClause = "WHERE 1=1";
        if (searchTerm) {
            const term = searchTerm.toUpperCase().trim();
            whereClause += ` AND (UPPER(DESCRIPCIONARTICULO) LIKE '%${term}%' OR CODIGOARTICULO LIKE '%${term}%')`;
        }

        const products = await query(`
            SELECT TRIM(CODIGOARTICULO) as CODE, 
                   TRIM(DESCRIPCIONARTICULO) as NAME,
                   TRIM(CODIGOFAMILIA) as FAMILY
            FROM DSEDAC.ART
            ${whereClause}
            ORDER BY DESCRIPCIONARTICULO
            FETCH FIRST ${parseInt(limit)} ROWS ONLY
        `);

        res.json(products.map(p => ({
            code: p.CODE,
            name: p.NAME,
            family: p.FAMILY
        })));

    } catch (error) {
        logger.error(`Product search error: ${error.message}`);
        res.status(500).json({ error: 'Error searching products', details: error.message });
    }
});

module.exports = router;
