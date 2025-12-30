const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { query } = require('../config/db');
const {
    getCurrentDate,
    buildVendedorFilter,
    formatCurrency,
    MIN_YEAR,
    LAC_SALES_FILTER
} = require('../utils/common');

// =============================================================================
// YOY COMPARISON (Using LAC)
// =============================================================================
router.get('/yoy-comparison', async (req, res) => {
    try {
        const { vendedorCodes, year, month } = req.query;
        const currentYear = parseInt(year) || getCurrentDate().getFullYear();
        const vendedorFilter = buildVendedorFilter(vendedorCodes);

        // Optional month filter
        const monthFilter = month ? `AND MESDOCUMENTO = ${month}` : '';

        const getData = async (yr) => {
            const result = await query(`
          SELECT 
            SUM(IMPORTEVENTA) as sales, 
            SUM(IMPORTEVENTA - IMPORTECOSTO) as margin,
            COUNT(DISTINCT CODIGOCLIENTEALBARAN) as clients
          FROM DSEDAC.LAC 
          WHERE ANODOCUMENTO = ${yr} AND ${LAC_SALES_FILTER} ${monthFilter} ${vendedorFilter}
        `);
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
// TOP CLIENTS
// =============================================================================
router.get('/top-clients', async (req, res) => {
    try {
        const { vendedorCodes, year, month, limit = 10 } = req.query;
        const vendedorFilter = buildVendedorFilter(vendedorCodes);

        let dateFilter = '';
        if (year) dateFilter += ` AND ANODOCUMENTO = ${year}`;
        if (month) dateFilter += ` AND MESDOCUMENTO = ${month}`;

        const topClients = await query(`
      SELECT 
        CODIGOCLIENTEALBARAN as code,
        SUM(IMPORTEVENTA) as totalSales,
        COUNT(*) as transactions
      FROM DSEDAC.LAC
      WHERE 1=1 ${dateFilter} ${vendedorFilter}
      GROUP BY CODIGOCLIENTEALBARAN
      ORDER BY totalSales DESC
      FETCH FIRST ${limit} ROWS ONLY
    `);

        // Get client names from CLI table
        const enhancedClients = await Promise.all(topClients.map(async (c) => {
            const info = await query(`SELECT NOMBRECLIENTE, POBLACION FROM DSEDAC.CLI WHERE CODIGOCLIENTE = '${c.CODE}' FETCH FIRST 1 ROWS ONLY`);
            return {
                code: c.CODE?.trim(),
                name: info[0]?.NOMBRECLIENTE?.trim() || `Cliente ${c.CODE}`,
                city: info[0]?.POBLACION?.trim() || '',
                totalSales: formatCurrency(c.TOTALSALES),
                year: year || new Date().getFullYear()
            };
        }));

        res.json({ clients: enhancedClients });

    } catch (error) {
        logger.error(`Top clients error: ${error.message}`);
        res.status(500).json({ error: 'Error top clients', details: error.message });
    }
});

// =============================================================================
// TRENDS (Updated to use DSEDAC.LAC for proper history)
// =============================================================================
router.get('/trends', async (req, res) => {
    try {
        const { vendedorCodes } = req.query;
        const vendedorFilter = buildVendedorFilter(vendedorCodes);

        // Get last 6 months from LAC
        const history = await query(`
      SELECT ANODOCUMENTO as year, MESDOCUMENTO as month, SUM(IMPORTEVENTA) as sales
      FROM DSEDAC.LAC
      WHERE ANODOCUMENTO >= 2024 ${vendedorFilter}
      GROUP BY ANODOCUMENTO, MESDOCUMENTO
      ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC
      FETCH FIRST 6 ROWS ONLY
    `);

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

        const products = await query(`
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
    `);

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

        // Monthly margin evolution
        const monthlyMargins = await query(`
      SELECT MESDOCUMENTO as month,
  SUM(IMPORTEVENTA) as sales,
  SUM(IMPORTEMARGENREAL) as margin
      FROM DSEDAC.LINDTO
      WHERE ANODOCUMENTO = ${year} ${vendedorFilter}
      GROUP BY MESDOCUMENTO
      ORDER BY MESDOCUMENTO
  `);

        // Margin by product family
        const familyMargins = await query(`
      SELECT COALESCE(A.CODIGOFAMILIA, 'SIN FAM') as family,
  SUM(L.IMPORTEVENTA) as sales,
  SUM(L.IMPORTEMARGENREAL) as margin
      FROM DSEDAC.LINDTO L
      LEFT JOIN DSEDAC.ART A ON TRIM(L.CODIGOARTICULO) = TRIM(A.CODIGOARTICULO)
      WHERE L.ANODOCUMENTO = ${year} ${vendedorFilter}
      GROUP BY A.CODIGOFAMILIA
      ORDER BY sales DESC
      FETCH FIRST 10 ROWS ONLY
    `);

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
        // Note: queryWithParams might need 'await' wrapper if db.js doesn't handle it (it does)
        const { queryWithParams } = require('../config/db'); // Require locally if not top-level

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

module.exports = router;
