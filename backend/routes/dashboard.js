const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { query } = require('../config/db');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL } = require('../services/redis-cache');
const {
    getCurrentDate,
    buildVendedorFilter,
    buildVendedorFilterLACLAE,
    formatCurrency,
    MIN_YEAR,
    LAC_SALES_FILTER,
    LACLAE_SALES_FILTER,
    getBSales
} = require('../utils/common');

// =============================================================================
// KPI CARDS ENDPOINT (Updated to use DSEDAC.LAC for proper history)
// =============================================================================
router.get('/metrics', async (req, res) => {
    try {
        const { vendedorCodes, year, month } = req.query;
        const now = getCurrentDate();
        const currentYear = parseInt(year) || now.getFullYear();
        const currentMonth = parseInt(month) || (now.getMonth() + 1);
        const cacheKey = `dashboard:metrics:${currentYear}:${currentMonth || 'all'}:${vendedorCodes}`;

        // -- FETCH FROM REDIS CACHE (L2) --
        // Logic wrapped directly in route to use parallel queries

        const vendedorFilter = buildVendedorFilterLACLAE(vendedorCodes);

        const currentDataSql = `
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
        `;

        const lastDataSql = `
          SELECT 
            COALESCE(SUM(L.LCIMVT), 0) as sales,
            COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) as margin,
            COALESCE(SUM(L.LCCTEV), 0) as boxes
          FROM DSED.LACLAE L
          WHERE L.LCAADC = ${currentYear - 1}
            AND L.LCMMDC = ${currentMonth}
            AND ${LACLAE_SALES_FILTER}
            ${vendedorFilter}
        `;

        // Execute in parallel with cache
        const [currentData, lastData] = await Promise.all([
            cachedQuery(query, currentDataSql, `${cacheKey}:curr`, TTL.SHORT),
            cachedQuery(query, lastDataSql, `${cacheKey}:prev`, TTL.LONG) // Prev year usage is static for this month
        ]);

        // Today's metrics (Real-time, short cache)
        const today = now.getDate();
        let todaySales = 0;
        let todayOrders = 0;

        if (currentYear === now.getFullYear() && currentMonth === (now.getMonth() + 1)) {
            const todayDataSql = `
                SELECT COALESCE(SUM(L.LCIMVT), 0) as sales, COUNT(DISTINCT L.LCNRAB) as orders
                FROM DSED.LACLAE L
                WHERE L.LCAADC = ${currentYear} AND L.LCMMDC = ${currentMonth} AND L.LCDDDC = ${today} AND ${LACLAE_SALES_FILTER} ${vendedorFilter}
            `;
            const todayData = await cachedQuery(query, todayDataSql, `${cacheKey}:today`, TTL.SHORT); // 5 min cache for today
            todaySales = parseFloat(todayData[0]?.SALES) || 0;
            todayOrders = parseInt(todayData[0]?.ORDERS) || 0;
        }

        const curr = currentData[0] || {};
        const last = lastData[0] || {};

        let currentSales = parseFloat(curr.SALES) || 0;
        let lastSales = parseFloat(last.SALES) || 0;

        // Add B-sales for consistency with commissions/objectives
        if (vendedorCodes && vendedorCodes !== 'ALL') {
            const firstCode = vendedorCodes.split(',')[0]?.trim();
            if (firstCode) {
                const bSalesCurr = await getBSales(firstCode, currentYear);
                const bSalesLast = await getBSales(firstCode, currentYear - 1);
                currentSales += (bSalesCurr[currentMonth] || 0);
                lastSales += (bSalesLast[currentMonth] || 0);
            }
        }

        // Calculate variations
        const calcVar = (curr, prev) => prev && prev !== 0 ? ((curr - prev) / prev) * 100 : 0;
        const growthPercent = calcVar(currentSales, lastSales);

        const responseData = {
            period: { year: currentYear, month: currentMonth },
            totalSales: currentSales,
            totalBoxes: parseFloat(curr.BOXES) || 0,
            totalOrders: todayOrders || 0,
            totalMargin: parseFloat(curr.MARGIN) || 0,
            uniqueClients: parseInt(curr.ACTIVECLIENTS) || 0,
            avgOrderValue: todayOrders > 0 ? todaySales / todayOrders : 0,
            todaySales: todaySales,
            todayOrders: todayOrders,
            lastMonthSales: lastSales,
            growthPercent: Math.round(growthPercent * 10) / 10,
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

        res.json(responseData);

    } catch (error) {
        logger.error(`Metrics error: ${error.message}`);
        res.status(500).json({ error: 'Error calculating metrics', details: error.message });
    }
});

// =============================================================================
// MATRIX DATA 
// =============================================================================
router.get('/matrix-data', async (req, res) => {
    try {
        const { vendedorCodes, groupBy = 'vendor', year, years, clientCodes, productCodes, familyCodes } = req.query;
        // Use a hash of query params as key
        const cacheKey = `dashboard:matrix:${JSON.stringify(req.query)}`;

        // This endpoint is heavy, use cachedQuery logic inside? 
        // Since we have complex logic with multiple steps (aggregates + lookups),
        // we should wrap the WHOLE thing or use Redis middleware.
        // We will cache manually here to reuse existing logic but put it in Redis.

        // Check cache manually for the final JSON result
        const { redisCache } = require('../services/redis-cache');
        const cachedResult = await redisCache.get('matrix', cacheKey);
        if (cachedResult) {
            logger.info(`⚡ Cache hit: matrix-data`);
            return res.json(cachedResult);
        }

        let yearFilter = '';
        let selectedYear = parseInt(year) || getCurrentDate().getFullYear();
        let prevYear = selectedYear - 1;

        if (years && years.trim().length > 0) {
            const yearList = years.split(',').map(y => parseInt(y.trim())).filter(y => !isNaN(y));
            if (yearList.length > 0) {
                yearFilter = `AND L.LCAADC IN (${yearList.join(',')})`;
            } else {
                yearFilter = `AND L.LCAADC = ${selectedYear}`;
            }
        } else {
            yearFilter = `AND L.LCAADC IN (${selectedYear}, ${prevYear})`;
        }

        const vendedorFilter = buildVendedorFilterLACLAE(vendedorCodes);

        const clientFilter = clientCodes && clientCodes !== 'ALL'
            ? `AND L.LCCDCL IN (${clientCodes.split(',').map(c => `'${c.trim()}'`).join(',')})`
            : '';

        const productFilter = productCodes && productCodes !== 'ALL'
            ? `AND L.CODIGOARTICULO IN (${productCodes.split(',').map(c => `'${c.trim()}'`).join(',')})`
            : '';

        let familyProductFilter = '';
        if (familyCodes && familyCodes !== 'ALL') {
            const fCodes = familyCodes.split(',').map(f => `'${f.trim()}'`).join(',');
            const famProducts = await cachedQuery(query, `SELECT TRIM(CODIGOARTICULO) as CODE FROM DSEDAC.ART WHERE CODIGOFAMILIA IN (${fCodes})`, `fam_prods:${fCodes}`, TTL.LONG);
            if (famProducts.length > 0) {
                const pCodes = famProducts.slice(0, 1000).map(p => `'${p.CODE}'`).join(','); // Safety limit
                familyProductFilter = `AND L.CODIGOARTICULO IN (${pCodes})`; // Simplified for performance
            } else {
                familyProductFilter = 'AND 1=0';
            }
        }

        const hierarchy = groupBy.split(',').map(g => g.trim().toLowerCase());
        const selectClauses = ['L.LCAADC as YEAR', 'L.LCMMDC as MONTH'];
        const groupClauses = ['L.LCAADC', 'L.LCMMDC'];

        hierarchy.forEach((level, index) => {
            const levelIdx = index + 1;
            if (level === 'vendor') {
                selectClauses.push(`RTRIM(L.LCCDVD) as ID_${levelIdx}`);
                groupClauses.push('L.LCCDVD');
            } else if (level === 'client') {
                selectClauses.push(`RTRIM(L.LCCDCL) as ID_${levelIdx}`);
                groupClauses.push('L.LCCDCL');
            } else if (level === 'product') {
                selectClauses.push(`RTRIM(L.CODIGOARTICULO) as ID_${levelIdx}`);
                groupClauses.push('L.CODIGOARTICULO');
            } else if (level === 'family') {
                selectClauses.push(`RTRIM(L.CODIGOARTICULO) as ID_${levelIdx}`);
                groupClauses.push('L.CODIGOARTICULO');
            }
        });

        // Matrix uses DSEDAC.LAC (has CODIGOARTICULO for product grouping).
        // DSEDAC.LAC does NOT have TPDC column, so must use LAC_SALES_FILTER (not LACLAE).
        // LCIMVT/LCIMCT short column names work on both LAC and LACLAE tables.
        selectClauses.push('SUM(L.LCIMVT) as SALES');
        selectClauses.push('SUM(L.LCIMVT - L.LCIMCT) as MARGIN');

        const aggregateSQL = `
            SELECT ${selectClauses.join(', ')}
            FROM DSEDAC.LAC L
              WHERE 1=1
              AND ${LAC_SALES_FILTER}
              ${yearFilter}
              ${vendedorFilter}
              ${clientFilter}
              ${productFilter}
              ${familyProductFilter}
            GROUP BY ${groupClauses.join(', ')}
            ORDER BY SUM(L.LCIMVT) DESC
            FETCH FIRST 50000 ROWS ONLY
        `;

        // We cache the RAW aggregate data
        const rawKey = `matrix:raw:${cacheKey}`;
        const rawData = await cachedQuery(query, aggregateSQL, rawKey, TTL.MEDIUM);

        const nameLookups = [];
        // Helper
        const lookup = (sql, key) => cachedQuery(query, sql, key, TTL.LONG);

        if (hierarchy.includes('vendor')) {
            const vCodes = [...new Set(rawData.map(r => r.ID_1).filter(Boolean))];
            if (vCodes.length) nameLookups.push(lookup(`SELECT TRIM(CODIGOVENDEDOR) as CODE, TRIM(NOMBREVENDEDOR) as NAME FROM DSEDAC.VDD WHERE CODIGOVENDEDOR IN (${vCodes.map(c => `'${c}'`).join(',')})`, `names:vendors:${vCodes.length}`).then(d => ({ type: 'vendor', data: d })));
        }

        // ... (Lookups logic similar to before but utilizing lookup helper) ...
        // Simplification: We need to recreate the map logic. 
        // Since I'm overwriting, I'll copy the logic but using fast optimized queries.

        // ... [Full Hydration Logic Omitted for Brevity - I will ensure it's in the final file] ...

        // RE-RUNNING THE FULL LOGIC CAREFULLY

        // Re-implement the loop and maps
        if (hierarchy.includes('client')) {
            const idx = hierarchy.indexOf('client') + 1;
            const cCodes = [...new Set(rawData.map(r => r[`ID_${idx}`]).filter(Boolean))];
            if (cCodes.length) nameLookups.push(lookup(`SELECT TRIM(CODIGOCLIENTE) as CODE, COALESCE(NULLIF(TRIM(NOMBREALTERNATIVO), ''), TRIM(NOMBRECLIENTE)) as NAME FROM DSEDAC.CLI WHERE CODIGOCLIENTE IN (${cCodes.slice(0, 2000).map(c => `'${c}'`).join(',')})`, `names:clients:${cCodes.length}`).then(d => ({ type: 'client', data: d })));
        }

        if (hierarchy.includes('product') || hierarchy.includes('family')) {
            const prodIndices = [];
            hierarchy.forEach((h, i) => { if (h === 'product' || h === 'family') prodIndices.push(i + 1); });
            const productCodes = new Set();
            prodIndices.forEach(idx => rawData.forEach(r => { if (r[`ID_${idx}`]) productCodes.add(r[`ID_${idx}`]); }));

            const codesArr = [...productCodes].slice(0, 2000);
            if (codesArr.length > 0) {
                const pSql = `
                    SELECT TRIM(A.CODIGOARTICULO) as CODE, TRIM(A.DESCRIPCIONARTICULO) as NAME,
                           TRIM(A.CODIGOFAMILIA) as FAM_CODE, COALESCE(TRIM(F.DESCRIPCIONFAMILIA), TRIM(A.CODIGOFAMILIA)) as FAM_NAME
                    FROM DSEDAC.ART A LEFT JOIN DSEDAC.FAM F ON A.CODIGOFAMILIA = F.CODIGOFAMILIA 
                    WHERE A.CODIGOARTICULO IN (${codesArr.map(c => `'${c}'`).join(',')})
                 `;
                nameLookups.push(lookup(pSql, `names:products:${codesArr.length}`).then(d => ({ type: 'art_mix', data: d })));
            }
        }

        const lookupResults = await Promise.all(nameLookups);

        const vendorMap = {};
        const clientMap = {};
        const productInfoMap = {};

        lookupResults.forEach(res => {
            if (res.type === 'vendor') res.data.forEach(x => vendorMap[x.CODE] = x.NAME || x.CODE);
            if (res.type === 'client') res.data.forEach(x => clientMap[x.CODE] = x.NAME || x.CODE);
            if (res.type === 'art_mix') res.data.forEach(x => productInfoMap[x.CODE] = { prodName: x.NAME, famCode: x.FAM_CODE, famName: x.FAM_NAME });
        });

        const aggregatedMap = new Map();
        rawData.forEach(row => {
            hierarchy.forEach((level, i) => {
                const idx = i + 1;
                const idVal = row[`ID_${idx}`];
                if (level === 'vendor') row[`NAME_${idx}`] = vendorMap[idVal] || 'Sin Comercial';
                else if (level === 'client') row[`NAME_${idx}`] = clientMap[idVal] || idVal;
                else if (level === 'product') {
                    const info = productInfoMap[idVal];
                    row[`NAME_${idx}`] = info ? info.prodName : idVal;
                } else if (level === 'family') {
                    const info = productInfoMap[idVal];
                    if (info) {
                        row[`ID_${idx}`] = info.famCode;
                        row[`NAME_${idx}`] = info.famName;
                    } else {
                        row[`ID_${idx}`] = 'UNK';
                        row[`NAME_${idx}`] = 'Unknown Family';
                    }
                }
            });

            const keyParts = [row.YEAR, row.MONTH];
            for (let i = 0; i < hierarchy.length; i++) keyParts.push(row[`ID_${i + 1}`]);
            const uniqueKey = keyParts.join('|');

            if (aggregatedMap.has(uniqueKey)) {
                const existing = aggregatedMap.get(uniqueKey);
                existing.SALES += parseFloat(row.SALES || 0);
                existing.MARGIN += parseFloat(row.MARGIN || 0);
            } else {
                aggregatedMap.set(uniqueKey, { ...row, SALES: parseFloat(row.SALES || 0), MARGIN: parseFloat(row.MARGIN || 0) });
            }
        });

        const finalData = Array.from(aggregatedMap.values());
        const responseStub = { rows: finalData, hierarchy, periods: [], year: selectedYear };

        await redisCache.set('matrix', cacheKey, responseStub, TTL.MEDIUM);
        res.json(responseStub);

    } catch (error) {
        logger.error(`Matrix data error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo datos matriciales' });
    }
});

// =============================================================================
// SALES EVOLUTION 
// =============================================================================
router.get('/sales-evolution', async (req, res) => {
    try {
        const { vendedorCodes, years, granularity = 'month', upToToday = 'false', months = 36 } = req.query;
        const vendedorFilter = buildVendedorFilterLACLAE(vendedorCodes);
        const now = getCurrentDate();
        const selectedYears = years
            ? years.split(',').map(y => parseInt(y.trim()))
            : [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];
        const yearsFilter = `AND L.LCAADC IN (${selectedYears.join(',')})`;

        let dateFilter = '';
        if (upToToday === 'true') {
            const currentMonth = now.getMonth() + 1;
            const currentDay = now.getDate();
            dateFilter = `AND (L.LCAADC < ${now.getFullYear()} OR (L.LCAADC = ${now.getFullYear()} AND L.LCMMDC < ${currentMonth}) OR (L.LCAADC = ${now.getFullYear()} AND L.LCMMDC = ${currentMonth} AND L.LCDDDC <= ${currentDay}))`;
        }

        const cacheKey = `dashboard:evolution:${years}:${granularity}:${upToToday}:${vendedorCodes}`;
        let resultData = [];

        if (granularity === 'week') {
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
            const dailyData = await cachedQuery(query, dailyQuery, `${cacheKey}:daily`, TTL.LONG);

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
            const rows = await cachedQuery(query, monthlyQuery, `${cacheKey}:monthly`, TTL.LONG);
            resultData = rows.map(r => ({
                year: r.YEAR, month: r.MONTH,
                totalSales: parseFloat(r.TOTALSALES) || 0,
                totalOrders: parseInt(r.TOTALORDERS) || 0,
                uniqueClients: parseInt(r.UNIQUECLIENTS) || 0
            }));
        }

        const limitedData = resultData.slice(0, parseInt(months) || 36);
        res.json({ evolution: limitedData });

    } catch (error) {
        logger.error(`Evolution error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo evolución', details: error.message });
    }
});

// =============================================================================
// RECENT SALES (Optimized with short cache)
// =============================================================================
router.get('/recent-sales', async (req, res) => {
    try {
        const { vendedorCodes, limit = 20 } = req.query;
        const vendedorFilter = buildVendedorFilter(vendedorCodes, 'L');
        const cacheKey = `dashboard:recent_sales:${vendedorCodes}:${limit}`;

        const sql = `
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
        `;

        const sales = await cachedQuery(query, sql, cacheKey, TTL.SHORT);

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

        const sql = `
            SELECT TRIM(CODIGOARTICULO) as CODE, 
                   TRIM(DESCRIPCIONARTICULO) as NAME,
                   TRIM(CODIGOFAMILIA) as FAMILY
            FROM DSEDAC.ART
            ${whereClause}
            ORDER BY DESCRIPCIONARTICULO
            FETCH FIRST ${parseInt(limit)} ROWS ONLY
        `;

        // Cache product searches as they are repetitive
        const cacheKey = `search:products:${searchTerm || 'all'}:${limit}`;
        const products = await cachedQuery(query, sql, cacheKey, TTL.MEDIUM);

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
