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
// KPI CARDS ENDPOINT (Updated to use DSEDAC.LAC for proper history)
// =============================================================================
router.get('/metrics', async (req, res) => {
    try {
        const { vendedorCodes, year, month } = req.query;
        const now = getCurrentDate();
        const currentYear = parseInt(year) || now.getFullYear();
        const currentMonth = parseInt(month) || (now.getMonth() + 1);

        const vendedorFilter = buildVendedorFilter(vendedorCodes);

        // Query Current Year Data from LAC (Lineas Albarán Clientes)
        // Margin calculated as Sales - Cost
        const currentData = await query(`
      SELECT 
        COALESCE(SUM(IMPORTEVENTA), 0) as sales,
        COALESCE(SUM(IMPORTEVENTA - IMPORTECOSTO), 0) as margin,
        COALESCE(SUM(CANTIDADENVASES), 0) as boxes,
        COUNT(DISTINCT CODIGOCLIENTEALBARAN) as activeClients
      FROM DSEDAC.LAC
      WHERE ANODOCUMENTO = ${currentYear} 
        AND MESDOCUMENTO = ${currentMonth} 
        AND ${LAC_SALES_FILTER}
        ${vendedorFilter}
    `);

        // Query Last Year Data (Same Month)
        const lastData = await query(`
      SELECT 
        COALESCE(SUM(IMPORTEVENTA), 0) as sales,
        COALESCE(SUM(IMPORTEVENTA - IMPORTECOSTO), 0) as margin,
        COALESCE(SUM(CANTIDADENVASES), 0) as boxes
      FROM DSEDAC.LAC
      WHERE ANODOCUMENTO = ${currentYear - 1} 
        AND MESDOCUMENTO = ${currentMonth} 
        AND ${LAC_SALES_FILTER}
        ${vendedorFilter}
    `);

        // Today's metrics (using LAC for consistency)
        const today = now.getDate();
        // Only fetch if requesting current month
        let todaySales = 0;
        let todayOrders = 0;

        if (currentYear === now.getFullYear() && currentMonth === (now.getMonth() + 1)) {
            const todayData = await query(`
            SELECT COALESCE(SUM(IMPORTEVENTA), 0) as sales, COUNT(*) as orders
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO = ${currentYear} AND MESDOCUMENTO = ${currentMonth} AND DIADOCUMENTO = ${today} AND ${LAC_SALES_FILTER} ${vendedorFilter}
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

        res.json({
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
        });

    } catch (error) {
        logger.error(`Metrics error: ${error.message}`);
        res.status(500).json({ error: 'Error calculating metrics', details: error.message });
    }
});

// =============================================================================
// MATRIX DATA - Power BI Style Pivoted Data (Using LAC for reliability)
// =============================================================================
router.get('/matrix-data', async (req, res) => {
    try {
        const { vendedorCodes, groupBy = 'vendor', year } = req.query;

        const selectedYear = parseInt(year) || getCurrentDate().getFullYear();
        const prevYear = selectedYear - 1;

        // Build vendedor filter
        // Note: We use the manual construction here to match original logic precisely, 
        // but buildVendedorFilter would likely work too.
        // Keeping consistent with original server.js for now.
        const vendedorFilter = vendedorCodes && vendedorCodes !== 'ALL'
            ? `AND L.CODIGOVENDEDOR IN (${vendedorCodes.split(',').map(c => `'${c.trim()}'`).join(',')})`
            : '';

        let rawData;

        if (groupBy === 'vendor') {
            // Group by commercial - using LAC (reliable, indexed)
            rawData = await query(`
        SELECT 
          L.CODIGOVENDEDOR as CODE,
          L.ANODOCUMENTO as YEAR,
          L.MESDOCUMENTO as MONTH,
          SUM(L.IMPORTEVENTA) as SALES,
          SUM(L.IMPORTEVENTA - L.IMPORTECOSTO) as MARGIN
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.CAC CA ON CA.CCSBAB = L.LCSBAB 
          AND CA.CCYEAB = L.LCYEAB 
          AND CA.CCSRAB = L.LCSRAB 
          AND CA.CCTRAB = L.LCTRAB 
          AND CA.CCNRAB = L.LCNRAB
        WHERE L.ANODOCUMENTO IN (${selectedYear}, ${prevYear})
          AND L.CODIGOVENDEDOR IS NOT NULL
          -- Matrix cleanup filters
          AND L.LCTPVT <> 'SC'
          AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
          AND COALESCE(CA.CCSNSD, '') <> 'E'
          ${vendedorFilter}
        GROUP BY L.CODIGOVENDEDOR, L.ANODOCUMENTO, L.MESDOCUMENTO
        ORDER BY YEAR DESC, MONTH DESC
      `);

        } else if (groupBy === 'product') {
            // Group by product
            rawData = await query(`
        SELECT 
          L.CODIGOARTICULO as CODE,
          COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.DESCRIPCIONARTICULO)) as NAME,
          A.CODIGOFAMILIA as FAMILY,
          L.ANODOCUMENTO as YEAR,
          L.MESDOCUMENTO as MONTH,
          SUM(L.IMPORTEVENTA) as SALES,
          SUM(L.IMPORTEVENTA - L.IMPORTECOSTO) as MARGIN
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
        LEFT JOIN DSEDAC.CAC CA ON CA.CCSBAB = L.LCSBAB 
          AND CA.CCYEAB = L.LCYEAB 
          AND CA.CCSRAB = L.LCSRAB 
          AND CA.CCTRAB = L.LCTRAB 
          AND CA.CCNRAB = L.LCNRAB
        WHERE L.ANODOCUMENTO IN (${selectedYear}, ${prevYear})
          -- Matrix cleanup filters
          AND L.LCTPVT <> 'SC'
          AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
          AND COALESCE(CA.CCSNSD, '') <> 'E'
          ${vendedorFilter}
        GROUP BY L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, L.DESCRIPCIONARTICULO, A.CODIGOFAMILIA, L.ANODOCUMENTO, L.MESDOCUMENTO
        ORDER BY YEAR DESC, MONTH DESC
        FETCH FIRST 500 ROWS ONLY
      `);

        } else if (groupBy === 'client') {
            // Group by client
            rawData = await query(`
        SELECT 
          L.CODIGOCLIENTEALBARAN as CODE,
          COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE)) as NAME,
          L.ANODOCUMENTO as YEAR,
          L.MESDOCUMENTO as MONTH,
          SUM(L.IMPORTEVENTA) as SALES,
          SUM(L.IMPORTEVENTA - L.IMPORTECOSTO) as MARGIN
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
        LEFT JOIN DSEDAC.CAC CA ON CA.CCSBAB = L.LCSBAB 
          AND CA.CCYEAB = L.LCYEAB 
          AND CA.CCSRAB = L.LCSRAB 
          AND CA.CCTRAB = L.LCTRAB 
          AND CA.CCNRAB = L.LCNRAB
        WHERE L.ANODOCUMENTO IN (${selectedYear}, ${prevYear})
          -- Matrix cleanup filters
          AND L.LCTPVT <> 'SC'
          AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
          AND COALESCE(CA.CCSNSD, '') <> 'E'
          ${vendedorFilter}
        GROUP BY L.CODIGOCLIENTEALBARAN, C.NOMBREALTERNATIVO, C.NOMBRECLIENTE, L.ANODOCUMENTO, L.MESDOCUMENTO
        ORDER BY YEAR DESC, MONTH DESC
        FETCH FIRST 500 ROWS ONLY
      `);

        } else if (groupBy === 'family') {
            // Group by product family
            rawData = await query(`
        SELECT 
          A.CODIGOFAMILIA as CODE,
          F.DESCRIPCIONFAMILIA as NAME,
          L.ANODOCUMENTO as YEAR,
          L.MESDOCUMENTO as MONTH,
          SUM(L.IMPORTEVENTA) as SALES,
          SUM(L.IMPORTEVENTA - L.IMPORTECOSTO) as MARGIN
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
        LEFT JOIN DSEDAC.FAM F ON A.CODIGOFAMILIA = F.CODIGOFAMILIA
        LEFT JOIN DSEDAC.CAC CA ON CA.CCSBAB = L.LCSBAB 
          AND CA.CCYEAB = L.LCYEAB 
          AND CA.CCSRAB = L.LCSRAB 
          AND CA.CCTRAB = L.LCTRAB 
          AND CA.CCNRAB = L.LCNRAB
        WHERE L.ANODOCUMENTO IN (${selectedYear}, ${prevYear})
          -- Matrix cleanup filters
          AND L.LCTPVT <> 'SC'
          AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
          AND COALESCE(CA.CCSNSD, '') <> 'E'
          ${vendedorFilter}
        GROUP BY A.CODIGOFAMILIA, F.DESCRIPCIONFAMILIA, L.ANODOCUMENTO, L.MESDOCUMENTO
        ORDER BY YEAR DESC, MONTH DESC
      `);
        } else {
            return res.status(400).json({ error: 'groupBy debe ser: vendor, product, client, o family' });
        }

        // Pivot the data by month
        const pivoted = {};
        const months = new Set();

        rawData.forEach(row => {
            const id = row.CODE?.trim() || 'unknown';
            const name = row.NAME?.trim() || id;

            if (!pivoted[id]) {
                pivoted[id] = {
                    id,
                    name: groupBy === 'vendor' ? `Comercial ${id}` : name,
                    type: groupBy,
                    data: {},
                    total: 0,
                    margin: 0
                };
            }

            const period = `${row.YEAR}-${String(row.MONTH).padStart(2, '0')}`;
            months.add(period);

            const sales = parseFloat(row.SALES) || 0;
            const margin = parseFloat(row.MARGIN) || 0;

            if (!pivoted[id].data[period]) {
                pivoted[id].data[period] = { sales: 0, margin: 0 };
            }
            pivoted[id].data[period].sales += sales;
            pivoted[id].data[period].margin += margin;
            pivoted[id].total += sales;
            pivoted[id].margin += margin;
        });

        // Sort by total and limit
        const rows = Object.values(pivoted)
            .sort((a, b) => b.total - a.total)
            .slice(0, 50);

        const periodList = Array.from(months).sort();

        res.json({
            rows,
            periods: periodList,
            groupBy,
            year: selectedYear,
            prevYear
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
        const vendedorFilter = buildVendedorFilter(vendedorCodes);

        // Parse years
        const now = getCurrentDate();
        const selectedYears = years ? years.split(',').map(y => parseInt(y.trim())) : [now.getFullYear()];
        const yearsFilter = `AND ANODOCUMENTO IN (${selectedYears.join(',')})`;

        // YTD filter logic
        let dateFilter = '';
        if (upToToday === 'true') {
            const currentMonth = now.getMonth() + 1;
            const currentDay = now.getDate();
            dateFilter = `AND (ANODOCUMENTO < ${now.getFullYear()} OR (ANODOCUMENTO = ${now.getFullYear()} AND MESDOCUMENTO < ${currentMonth}) OR (ANODOCUMENTO = ${now.getFullYear()} AND MESDOCUMENTO = ${currentMonth} AND DIADOCUMENTO <= ${currentDay}))`;
        }

        let resultData = [];

        if (granularity === 'week') {
            // Weekly: Get DAILY data and aggregate in JS
            const dailyQuery = `
        SELECT ANODOCUMENTO as year, MESDOCUMENTO as month, DIADOCUMENTO as day,
               SUM(IMPORTEVENTA) as sales,
               COUNT(DISTINCT NUMERODOCUMENTO) as orders,
               COUNT(DISTINCT CODIGOCLIENTEALBARAN) as clients
        FROM DSEDAC.LAC
        WHERE ${LAC_SALES_FILTER} ${yearsFilter} ${dateFilter} ${vendedorFilter}
        GROUP BY ANODOCUMENTO, MESDOCUMENTO, DIADOCUMENTO
        ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
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
        SELECT ANODOCUMENTO as year, MESDOCUMENTO as month,
               SUM(IMPORTEVENTA) as totalSales,
               COUNT(DISTINCT NUMERODOCUMENTO) as totalOrders,
               COUNT(DISTINCT CODIGOCLIENTEALBARAN) as uniqueClients
        FROM DSEDAC.LAC
        WHERE ${LAC_SALES_FILTER} ${yearsFilter} ${dateFilter} ${vendedorFilter}
        GROUP BY ANODOCUMENTO, MESDOCUMENTO
        ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC
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

        res.json(limitedData);

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

module.exports = router;
