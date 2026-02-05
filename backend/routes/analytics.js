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
    LACLAE_SALES_FILTER
} = require('../utils/common');


// =============================================================================
// YOY COMPARISON (Using LACLAE with LCIMVT for sales without VAT)
// =============================================================================
router.get('/yoy-comparison', async (req, res) => {
    try {
        const { vendedorCodes, year, month } = req.query;
        const currentYear = parseInt(year) || getCurrentDate().getFullYear();
        const vendedorFilter = buildVendedorFilterLACLAE(vendedorCodes);

        // Optional month filter
        const monthFilter = month ? `AND L.LCMMDC = ${month}` : '';
        const cacheKeyBase = `analytics:yoy:${currentYear}:${month || 'all'}:${vendedorCodes}`;

        const getData = async (yr) => {
            const sql = `
          SELECT 
            SUM(L.LCIMVT) as sales, 
            SUM(L.LCIMVT - L.LCIMCT) as margin,
            COUNT(DISTINCT L.LCCDCL) as clients
          FROM DSED.LACLAE L 
          WHERE L.LCYEAB = ${yr} AND ${LACLAE_SALES_FILTER} ${monthFilter} ${vendedorFilter}
        `;
            const result = await cachedQuery(query, sql, `${cacheKeyBase}:${yr}`, TTL.LONG);
            return result[0] || {};
        };


        const curr = await getData(currentYear);
        const lastYr = currentYear - 1;
        const prev = await getData(lastYr);

        const currSales = parseFloat(curr.SALES) || 0;
        const prevSales = parseFloat(prev.SALES) || 0;
        const currMargin = parseFloat(curr.MARGIN) || 0;
        const prevMargin = parseFloat(prev.MARGIN) || 0;

        const calcGrowth = (curr, prev) => prev && prev !== 0 ? ((curr - prev) / prev) * 100 : 0;

        res.json({
            currentYear: {
                year: currentYear,
                sales: formatCurrency(currSales),
                margin: formatCurrency(currMargin),
                boxes: 0
            },
            lastYear: {
                year: lastYr,
                sales: formatCurrency(prevSales),
                margin: formatCurrency(prevMargin),
                boxes: 0
            },
            currentPeriod: { year: currentYear, sales: formatCurrency(currSales) },
            previousPeriod: { year: lastYr, sales: formatCurrency(prevSales) },
            growth: {
                salesPercent: Math.round(calcGrowth(currSales, prevSales) * 10) / 10,
                salesGrowth: Math.round(calcGrowth(currSales, prevSales) * 10) / 10,
                marginPercent: Math.round(calcGrowth(currMargin, prevMargin) * 10) / 10
            }
        });

    } catch (error) {
        logger.error(`YoY error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo comparación', details: error.message });
    }
});

// =============================================================================
// TOP CLIENTS (Using LACLAE with LCIMVT)
// =============================================================================
router.get('/top-clients', async (req, res) => {
    try {
        const { vendedorCodes, year, month, limit = 10 } = req.query;
        const vendedorFilter = buildVendedorFilterLACLAE(vendedorCodes);

        let dateFilter = '';
        if (year) dateFilter += ` AND L.LCYEAB = ${year}`;
        if (month) dateFilter += ` AND L.LCMMDC = ${month}`;

        const sql = `
      SELECT 
        L.LCCDCL as code,
        SUM(L.LCIMVT) as totalSales,
        COUNT(*) as transactions
      FROM DSED.LACLAE L
      WHERE ${LACLAE_SALES_FILTER} ${dateFilter} ${vendedorFilter}
      GROUP BY L.LCCDCL
      ORDER BY totalSales DESC
      FETCH FIRST ${limit} ROWS ONLY
    `;

        const cacheKey = `analytics:top_clients:${year || 'current'}:${month || 'all'}:${vendedorCodes}:${limit}`;
        const topClients = await cachedQuery(query, sql, cacheKey, TTL.MEDIUM);

        // Get client names from CLI table (cached separately usually, but here we specific queries)
        // We can cache individual client details or the whole enriched list
        // Let's enrich and leverage CLI table efficiency

        if (topClients.length === 0) return res.json({ clients: [] });

        const clientCodes = topClients.map(c => `'${c.CODE}'`).join(',');
        const namesMsg = `
            SELECT CODIGOCLIENTE as C, NOMBRECLIENTE as N, POBLACION as P 
            FROM DSEDAC.CLI WHERE CODIGOCLIENTE IN (${clientCodes})
        `;
        // Cache detailed names lookup for a long time
        const clientDetails = await cachedQuery(query, namesMsg, `clients:details:${topClients.length}:${topClients[0].CODE}`, TTL.LONG);
        const detailsMap = {};
        clientDetails.forEach(d => detailsMap[d.C.trim()] = { name: d.N, city: d.P });

        const enhancedClients = topClients.map(c => {
            const info = detailsMap[c.CODE.trim()] || {};
            return {
                code: c.CODE?.trim(),
                name: info.name?.trim() || `Cliente ${c.CODE}`,
                city: info.city?.trim() || '',
                totalSales: formatCurrency(c.TOTALSALES),
                year: year || new Date().getFullYear()
            };
        });

        res.json({ clients: enhancedClients });

    } catch (error) {
        logger.error(`Top clients error: ${error.message}`);
        res.status(500).json({ error: 'Error top clients', details: error.message });
    }
});

// =============================================================================
// TRENDS (Using LACLAE with LCIMVT)
// =============================================================================
router.get('/trends', async (req, res) => {
    try {
        const { vendedorCodes } = req.query;
        const vendedorFilter = buildVendedorFilterLACLAE(vendedorCodes);

        // Get last 6 months from LACLAE
        const sql = `
      SELECT L.LCYEAB as year, L.LCMMDC as month, SUM(L.LCIMVT) as sales
      FROM DSED.LACLAE L
      WHERE L.LCYEAB >= ${MIN_YEAR} AND ${LACLAE_SALES_FILTER} ${vendedorFilter}
      GROUP BY L.LCYEAB, L.LCMMDC
      ORDER BY L.LCYEAB DESC, L.LCMMDC DESC
      FETCH FIRST 6 ROWS ONLY
    `;
        const history = await cachedQuery(query, sql, `analytics:trends:${vendedorCodes}`, TTL.LONG);

        // Simple prediction logic
        let trend = 'stable';
        const sales = history.map(h => parseFloat(h.SALES)).reverse(); // Chronological order
        if (sales.length >= 2) {
            if (sales[sales.length - 1] > sales[0] * 1.1) trend = 'upward';
            else if (sales[sales.length - 1] < sales[0] * 0.9) trend = 'downward';
        }

        // Generate basic predictions
        const lastMonth = sales.length > 0 ? sales[sales.length - 1] : 0;
        const predictions = [
            { period: 'Next +1', predictedSales: lastMonth * (trend === 'upward' ? 1.05 : 0.95), confidence: 0.75 },
            { period: 'Next +2', predictedSales: lastMonth * (trend === 'upward' ? 1.10 : 0.90), confidence: 0.60 },
            { period: 'Next +3', predictedSales: lastMonth * (trend === 'upward' ? 1.15 : 0.85), confidence: 0.45 }
        ];

        res.json({ trend, predictions });

    } catch (error) {
        logger.error(`Trends error: ${error.message}`);
        res.status(500).json({ error: 'Error calculating trends', details: error.message });
    }
});

// =============================================================================
// TOP PRODUCTS
// =============================================================================
router.get('/top-products', async (req, res) => {
    try {
        const { vendedorCodes, limit = 20 } = req.query;
        const now = getCurrentDate();
        const year = parseInt(req.query.year) || now.getFullYear();
        const vendedorFilter = buildVendedorFilter(vendedorCodes);

        const sql = `
      SELECT L.CODIGOARTICULO as code,
  COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.DESCRIPCION), 'Producto ' || TRIM(L.CODIGOARTICULO)) as name,
  A.CODIGOMARCA as brand,
  A.CODIGOFAMILIA as family,
  SUM(L.IMPORTEVENTA) as totalSales,
  SUM(L.IMPORTEMARGENREAL) as totalMargin,
  SUM(L.CANTIDADENVASES) as totalBoxes,
  SUM(L.CANTIDADUNIDADES) as totalUnits,
  COUNT(DISTINCT L.CODIGOCLIENTEALBARAN) as numClients
      FROM DSEDAC.LINDTO L
      LEFT JOIN DSEDAC.ART A ON TRIM(L.CODIGOARTICULO) = TRIM(A.CODIGOARTICULO)
      WHERE L.ANODOCUMENTO = ${year} ${vendedorFilter}
      GROUP BY L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, L.DESCRIPCION, A.CODIGOMARCA, A.CODIGOFAMILIA
      ORDER BY totalSales DESC
      FETCH FIRST ${parseInt(limit)} ROWS ONLY
    `;

        const products = await cachedQuery(query, sql, `analytics:top_products:${year}:${vendedorCodes}:${limit}`, TTL.MEDIUM);

        res.json({
            year,
            products: products.map(p => ({
                code: p.CODE?.trim(),
                name: p.NAME?.trim(),
                brand: p.BRAND?.trim(),
                family: p.FAMILY?.trim(),
                totalSales: formatCurrency(p.TOTALSALES),
                totalMargin: formatCurrency(p.TOTALMARGIN),
                marginPercent: p.TOTALSALES > 0 ? Math.round((p.TOTALMARGIN / p.TOTALSALES) * 1000) / 10 : 0,
                totalBoxes: parseInt(p.TOTALBOXES) || 0,
                totalUnits: parseInt(p.TOTALUNITS) || 0,
                numClients: parseInt(p.NUMCLIENTS) || 0
            }))
        });
    } catch (error) {
        logger.error(`Top Products error: ${error.message} `);
        res.status(500).json({ error: 'Error obteniendo productos', details: error.message });
    }
});

// =============================================================================
// MARGIN ANALYSIS
// =============================================================================
router.get('/margins', async (req, res) => {
    try {
        const { vendedorCodes } = req.query;
        const now = getCurrentDate();
        const year = parseInt(req.query.year) || now.getFullYear();
        const vendedorFilter = buildVendedorFilter(vendedorCodes);

        const cacheKey = `analytics:margins:${year}:${vendedorCodes}`;

        // Monthly margin evolution
        const monthlySql = `
      SELECT MESDOCUMENTO as month,
  SUM(IMPORTEVENTA) as sales,
  SUM(IMPORTEMARGENREAL) as margin
      FROM DSEDAC.LINDTO
      WHERE ANODOCUMENTO = ${year} ${vendedorFilter}
      GROUP BY MESDOCUMENTO
      ORDER BY MESDOCUMENTO
  `;
        const monthlyMargins = await cachedQuery(query, monthlySql, `${cacheKey}:monthly`, TTL.MEDIUM);

        // Margin by product family
        const familySql = `
      SELECT COALESCE(A.CODIGOFAMILIA, 'SIN FAM') as family,
  SUM(L.IMPORTEVENTA) as sales,
  SUM(L.IMPORTEMARGENREAL) as margin
      FROM DSEDAC.LINDTO L
      LEFT JOIN DSEDAC.ART A ON TRIM(L.CODIGOARTICULO) = TRIM(A.CODIGOARTICULO)
      WHERE L.ANODOCUMENTO = ${year} ${vendedorFilter}
      GROUP BY A.CODIGOFAMILIA
      ORDER BY sales DESC
      FETCH FIRST 10 ROWS ONLY
    `;
        const familyMargins = await cachedQuery(query, familySql, `${cacheKey}:family`, TTL.MEDIUM);

        res.json({
            year,
            monthlyMargins: monthlyMargins.map(m => ({
                month: m.MONTH,
                sales: formatCurrency(m.SALES),
                margin: formatCurrency(m.MARGIN),
                marginPercent: m.SALES > 0 ? Math.round((m.MARGIN / m.SALES) * 1000) / 10 : 0
            })),
            familyMargins: familyMargins.map(f => ({
                family: f.FAMILY?.trim() || 'Sin familia',
                sales: formatCurrency(f.SALES),
                margin: formatCurrency(f.MARGIN),
                marginPercent: f.SALES > 0 ? Math.round((f.MARGIN / f.SALES) * 1000) / 10 : 0
            }))
        });

    } catch (error) {
        logger.error(`Margins error: ${error.message} `);
        res.status(500).json({ error: 'Error obteniendo márgenes', details: error.message });
    }
});


// =============================================================================
// SALES HISTORY EXPLORER (Detailed Product Sales)
// =============================================================================
router.get('/sales-history', async (req, res) => {
    try {
        const {
            vendedorCodes,
            clientCode,
            productSearch,
            startDate,
            endDate,
            limit = 100,
            offset = 0
        } = req.query;

        const vendedorFilter = buildVendedorFilter(vendedorCodes);

        // We'll use a parameters array for safe execution
        const queryParams = [];
        let whereClause = `WHERE 1=1 ${vendedorFilter}`;

        // Filter by Client - Parameterized
        if (clientCode) {
            whereClause += ` AND CODIGOCLIENTEALBARAN = ?`;
            queryParams.push(clientCode.trim());
        }

        // Filter by Product (Code or Description) or Batch/Reference - Parameterized
        if (productSearch) {
            const term = productSearch.toUpperCase().trim();
            whereClause += ` AND (UPPER(DESCRIPCION) LIKE ? OR CODIGOARTICULO LIKE ? OR REFERENCIA LIKE ?)`;
            // We pass the LIKE pattern as parameter
            const likePattern = `%${term}%`;
            queryParams.push(likePattern, likePattern, likePattern);
        }

        // Filter by Date Range (YYYY-MM-DD)
        if (startDate) {
            const start = new Date(startDate);
            const startNum = start.getFullYear() * 10000 + (start.getMonth() + 1) * 100 + start.getDate();
            whereClause += ` AND (ANODOCUMENTO * 10000 + MESDOCUMENTO * 100 + DIADOCUMENTO) >= ${startNum}`;
        }

        if (endDate) {
            const end = new Date(endDate);
            const endNum = end.getFullYear() * 10000 + (end.getMonth() + 1) * 100 + end.getDate();
            whereClause += ` AND (ANODOCUMENTO * 10000 + MESDOCUMENTO * 100 + DIADOCUMENTO) <= ${endNum}`;
        } else {
            whereClause += ` AND ANODOCUMENTO >= ${MIN_YEAR}`;
        }

        // Use parameterized query helper
        const { queryWithParams } = require('../config/db');

        // Construct query
        const querySql = `
      SELECT 
        ANODOCUMENTO as year, 
        MESDOCUMENTO as month, 
        DIADOCUMENTO as day,
        CODIGOCLIENTEALBARAN as clientCode,
        CODIGOARTICULO as productCode,
        DESCRIPCION as productName,
        IMPORTEVENTA as total,
        PRECIOVENTA as price,
        CANTIDADUNIDADES as quantity,
        TRAZABILIDADALBARAN as lote,
        REFERENCIA as ref,
        NUMERODOCUMENTO as invoice
      FROM DSEDAC.LAC
      ${whereClause}
      ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
      OFFSET ${parseInt(offset)} ROWS
      FETCH FIRST ${parseInt(limit)} ROWS ONLY
    `;

        // Detailed history is usually NOT cached due to high filter variability
        const rows = await queryWithParams(querySql, queryParams);

        // Format for frontend
        const formattedRows = rows.map(r => ({
            date: `${r.YEAR}-${String(r.MONTH).padStart(2, '0')}-${String(r.DAY).padStart(2, '0')}`,
            year: r.YEAR,
            month: r.MONTH,
            clientCode: r.CLIENTCODE?.trim(),
            productCode: r.PRODUCTCODE?.trim(),
            productName: r.PRODUCTNAME?.trim(),
            price: formatCurrency(r.PRICE),
            quantity: parseFloat(r.QUANTITY) || 0,
            total: formatCurrency(r.TOTAL),
            lote: r.LOTE?.trim() || '',
            ref: r.REF?.trim() || '',
            invoice: r.INVOICE?.trim()
        }));

        res.json({
            rows: formattedRows,
            count: formattedRows.length,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

    } catch (error) {
        logger.error(`Sales history error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo histórico de ventas', details: error.message });
    }
});


// =============================================================================
// SALES HISTORY SUMMARY (Comparison Header)
// =============================================================================
router.get('/sales-history/summary', async (req, res) => {
    try {
        const { vendedorCodes, clientCode, productSearch, startDate, endDate } = req.query;

        // Build filters for LACLAE table
        const LACLAE_FILTER = `L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC') AND L.LCCLLN IN ('AB', 'VT') AND L.LCSRAB NOT IN ('N', 'Z')`;

        // Vendedor filter - adaptar para LACLAE (LCCDVD)
        let vendedorFilter = '';
        if (vendedorCodes) {
            const codes = vendedorCodes.split(',').map(c => `'${c.trim()}'`).join(',');
            vendedorFilter = `AND L.LCCDVD IN (${codes})`;
        }

        // Client filter - adaptar para LACLAE (LCCDCL)
        const clientFilter = clientCode ? `AND TRIM(L.LCCDCL) = '${clientCode}'` : '';

        // Product search filter - adaptar para LACLAE (LCCDRF, LCDESC)
        const searchFilter = productSearch
            ? `AND (UPPER(L.LCDESC) LIKE UPPER('%${productSearch}%') OR TRIM(L.LCCDRF) LIKE '%${productSearch}%')`
            : '';

        // Helper to query LACLAE
        const getStats = async (year) => {
            const queryStr = `
                SELECT 
                    SUM(L.LCIMVT) as sales,
                    SUM(L.LCIMVT - L.LCIMCT) as margin,
                    SUM(L.LCCTUD) as units,
                    COUNT(DISTINCT TRIM(L.LCCDRF)) as product_count
                FROM DSED.LACLAE L
                WHERE ${LACLAE_FILTER}
                  AND L.LCYEAB = ${year}
                  ${vendedorFilter}
                  ${clientFilter}
                  ${searchFilter}
            `;
            const cacheKey = `history:summary:laclae:${year}:${vendedorCodes}:${clientCode}:${productSearch}`;
            const result = await cachedQuery(query, queryStr, cacheKey, TTL.SHORT);
            return result[0] || {};
        };

        // Helper for Year Breakdown
        const getYearBreakdown = async (startYear, endYear) => {
            const queryStr = `
                SELECT 
                    L.LCYEAB as year,
                    SUM(L.LCIMVT) as sales,
                    SUM(L.LCIMVT - L.LCIMCT) as margin,
                    SUM(L.LCCTUD) as units
                FROM DSED.LACLAE L
                WHERE ${LACLAE_FILTER}
                  AND L.LCYEAB BETWEEN ${startYear} AND ${endYear}
                  ${vendedorFilter}
                  ${clientFilter}
                  ${searchFilter}
                GROUP BY L.LCYEAB
                ORDER BY L.LCYEAB DESC
            `;
            return await cachedQuery(query, queryStr, `history:breakdown:laclae:${startYear}:${endYear}:${vendedorCodes}:${clientCode}:${productSearch}`, TTL.SHORT);
        };

        // Helper for Monthly Breakdown (Current vs Last Year)
        const getMonthlyBreakdown = async (year, prevYear) => {
            // Get Monthly data for BOTH years
            const queryStr = `
                SELECT 
                    L.LCYEAB as year,
                    L.LCMMDC as month,
                    SUM(L.LCIMVT) as sales
                FROM DSED.LACLAE L
                WHERE ${LACLAE_FILTER}
                  AND L.LCYEAB IN (${year}, ${prevYear})
                  ${vendedorFilter}
                  ${clientFilter}
                  ${searchFilter}
                GROUP BY L.LCYEAB, L.LCMMDC
                ORDER BY L.LCMMDC
            `;
            const rows = await cachedQuery(query, queryStr, `history:monthly:${year}:${prevYear}:${vendedorCodes}:${clientCode}:${productSearch}`, TTL.SHORT);

            // Merge rows into Month objects
            const months = {};
            for (let i = 1; i <= 12; i++) months[i] = { month: i, current: 0, previous: 0 };

            rows.forEach(r => {
                const m = r.MONTH;
                if (!months[m]) return;
                if (r.YEAR === year) months[m].current = parseFloat(r.SALES || 0);
                if (r.YEAR === prevYear) months[m].previous = parseFloat(r.SALES || 0);
            });

            return Object.values(months);
        };

        // --- Determine years ---
        const now = new Date();
        const currentYear = startDate ? parseInt(startDate.substring(0, 4)) : now.getFullYear();
        const previousYear = currentYear - 1;

        // Execute parallel queries
        const [curr, prev, breakdown, monthlyBreakdown] = await Promise.all([
            getStats(currentYear),
            getStats(previousYear),
            getYearBreakdown(previousYear, currentYear),
            getMonthlyBreakdown(currentYear, previousYear)
        ]);

        const currSales = parseFloat(curr.SALES || 0);
        const prevSales = parseFloat(prev.SALES || 0);
        const currMarginAbs = parseFloat(curr.MARGIN || 0);
        const prevMarginAbs = parseFloat(prev.MARGIN || 0);
        const currUnits = parseFloat(curr.UNITS || 0);
        const prevUnits = parseFloat(prev.UNITS || 0);
        const currProducts = parseInt(curr.PRODUCT_COUNT || 0);
        const prevProducts = parseInt(prev.PRODUCT_COUNT || 0);

        // Calculate margin as percentage: (margin / sales) * 100
        const currMargin = currSales > 0 ? (currMarginAbs / currSales) * 100 : 0;
        const prevMargin = prevSales > 0 ? (prevMarginAbs / prevSales) * 100 : 0;

        // Determine if client is NEW (no sales in entire previous year)
        const isNewClient = prevSales < 0.01 && currSales > 0;

        const calcGrowth = (c, p) => (p && p !== 0) ? ((c - p) / p) * 100 : (c > 0 ? 100 : 0);

        res.json({
            isNewClient,
            current: {
                sales: currSales,
                margin: currMargin,
                units: currUnits,
                productCount: currProducts,
                label: `${currentYear}`
            },
            previous: {
                sales: prevSales,
                margin: prevMargin,
                units: prevUnits,
                productCount: prevProducts,
                label: `${previousYear}`
            },
            growth: {
                sales: calcGrowth(currSales, prevSales),
                margin: currMargin - prevMargin, // Difference in percentage points
                units: calcGrowth(currUnits, prevUnits),
                productCount: calcGrowth(currProducts, prevProducts)
            },
            breakdown: breakdown.map(b => ({
                year: b.YEAR,
                sales: parseFloat(b.SALES || 0),
                margin: parseFloat(b.MARGIN || 0),
                units: parseFloat(b.UNITS || 0)
            })),
            monthlyBreakdown: monthlyBreakdown // array of { month, current, previous }
        });

    } catch (error) {
        logger.error(`Error in sales-history/summary: ${error.message}`);
        res.status(500).json({ error: 'Error calculating summary', details: error.message });
    }
});

module.exports = router;
