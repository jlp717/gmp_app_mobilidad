const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { query, queryWithParams, getPool } = require('../config/db');
const {
    getCurrentDate,
    buildVendedorFilter,
    formatCurrency,
    LAC_SALES_FILTER
} = require('../utils/common');
const {
    getWeekCountsFromCache,
    getTotalClientsFromCache,
    getClientsForDay,
    getVendedoresFromCache
} = require('../services/laclae');

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

// =============================================================================
// ROUTER CALENDAR
// =============================================================================
router.get('/router/calendar', async (req, res) => {
    try {
        const { vendedorCodes } = req.query;
        const now = getCurrentDate();
        const year = parseInt(req.query.year) || now.getFullYear();
        const month = parseInt(req.query.month) || (now.getMonth() + 1);
        const vendedorFilter = buildVendedorFilter(vendedorCodes, 'L');

        const activities = await query(`
SELECT
L.ANODOCUMENTO as year, L.MESDOCUMENTO as month, L.DIADOCUMENTO as day,
  L.CODIGOCLIENTEALBARAN as clientCode, C.NOMBRECLIENTE as clientName,
  C.DIRECCION as clientAddress, C.POBLACION as clientCity,
  C.TELEFONO1 as clientPhone, L.CODIGOVENDEDOR as vendedorCode,
  SUM(L.IMPORTEVENTA) as totalSale,
  SUM(L.IMPORTEMARGENREAL) as totalMargin,
  COUNT(*) as numLines,
  COUNT(DISTINCT L.CODIGOARTICULO) as numProducts
      FROM DSEDAC.LINDTO L
      LEFT JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
      WHERE L.ANODOCUMENTO = ${year} AND L.MESDOCUMENTO = ${month} ${vendedorFilter}
      GROUP BY L.ANODOCUMENTO, L.MESDOCUMENTO, L.DIADOCUMENTO,
  L.CODIGOCLIENTEALBARAN, C.NOMBRECLIENTE, C.DIRECCION, C.POBLACION,
  C.TELEFONO1, L.CODIGOVENDEDOR
      ORDER BY L.DIADOCUMENTO DESC, totalSale DESC
    `);

        // Group by day
        const dayMap = {};
        activities.forEach(a => {
            const day = a.DAY;
            if (!dayMap[day]) {
                dayMap[day] = { day, visits: [], totalSales: 0, totalClients: 0 };
            }
            dayMap[day].visits.push({
                client: {
                    code: a.CLIENTCODE?.trim(),
                    name: a.CLIENTNAME?.trim(),
                    address: a.CLIENTADDRESS?.trim(),
                    city: a.CLIENTCITY?.trim(),
                    phone: a.CLIENTPHONE?.trim()
                },
                vendedorCode: a.VENDEDORCODE?.trim(),
                sale: formatCurrency(a.TOTALSALE),
                margin: formatCurrency(a.TOTALMARGIN),
                numLines: parseInt(a.NUMLINES) || 0,
                numProducts: parseInt(a.NUMPRODUCTS) || 0
            });
            dayMap[day].totalSales += formatCurrency(a.TOTALSALE);
            dayMap[day].totalClients++;
        });

        res.json({
            period: { year, month },
            days: Object.values(dayMap).sort((a, b) => b.day - a.day),
            summary: {
                totalDaysWithActivity: Object.keys(dayMap).length,
                totalVisits: activities.length,
                totalSales: activities.reduce((sum, a) => sum + formatCurrency(a.TOTALSALE), 0)
            }
        });

    } catch (error) {
        logger.error(`Router error: ${error.message} `);
        res.status(500).json({ error: 'Error obteniendo rutero', details: error.message });
    }
});

// =============================================================================
// RUTERO WEEK (Fast CACHE version)
// =============================================================================
router.get('/rutero/week', async (req, res) => {
    try {
        const { vendedorCodes, role } = req.query;
        const now = getCurrentDate();

        logger.info(`[RUTERO WEEK] vendedorCodes: "${vendedorCodes}", role: "${role}"`);

        // Try to use cache first (instant response)
        const cachedCounts = getWeekCountsFromCache(vendedorCodes, role || 'comercial');

        if (cachedCounts) {
            // Calculate total unique clients from cache
            const totalClients = getTotalClientsFromCache(vendedorCodes, role || 'comercial');
            const todayName = DAY_NAMES[now.getDay()];

            logger.info(`[RUTERO WEEK] From cache: ${JSON.stringify(cachedCounts)}, total: ${totalClients}`);

            return res.json({
                week: cachedCounts,
                todayName,
                role: role || 'comercial',
                totalUniqueClients: totalClients
            });
        }

        // Fallback: Cache not ready, return empty
        logger.warn(`[RUTERO WEEK] Cache not ready, returning empty`);
        res.json({
            week: { lunes: 0, martes: 0, miercoles: 0, jueves: 0, viernes: 0, sabado: 0, domingo: 0 },
            todayName: DAY_NAMES[now.getDay()],
            role: role || 'comercial',
            totalUniqueClients: 0,
            cacheStatus: 'loading'
        });
    } catch (error) {
        logger.error(`Rutero week error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo rutero semana', details: error.message });
    }
});

// =============================================================================
// RUTERO VENDEDORES
// =============================================================================
router.get('/rutero/vendedores', async (req, res) => {
    try {
        // Try cache first for codes and client counts
        const cachedVendedores = getVendedoresFromCache();

        if (cachedVendedores && cachedVendedores.length > 0) {
            // Get vendor names from VEN table
            const codes = cachedVendedores.map(v => `'${v.code}'`).join(',');

            try {
                const namesResult = await query(`
          SELECT TRIM(CODIGOVENDEDOR) as CODE, TRIM(NOMBREVENDEDOR) as NAME 
          FROM DSEDAC.VEN 
          WHERE CODIGOVENDEDOR IN (${codes})
        `);

                // Create a map of code -> name
                const nameMap = {};
                namesResult.forEach(row => {
                    nameMap[row.CODE?.trim()] = row.NAME?.trim() || '';
                });

                // Merge names with cached data
                const vendedoresConNombres = cachedVendedores.map(v => ({
                    code: v.code,
                    name: nameMap[v.code] || `Vendedor ${v.code}`,
                    clients: v.clients
                }));

                logger.info(`[RUTERO VENDEDORES] From cache with names: ${vendedoresConNombres.length} salespeople`);
                return res.json({
                    vendedores: vendedoresConNombres,
                    count: vendedoresConNombres.length
                });
            } catch (queryError) {
                // If name query fails, return cache data without names
                logger.warn(`[RUTERO VENDEDORES] Name query failed, returning codes only: ${queryError.message}`);
                return res.json({
                    vendedores: cachedVendedores,
                    count: cachedVendedores.length
                });
            }
        }

        // Fallback: Cache not ready
        logger.warn(`[RUTERO VENDEDORES] Cache not ready`);
        res.json({
            vendedores: [],
            count: 0,
            cacheStatus: 'loading'
        });
    } catch (error) {
        logger.error(`Rutero vendedores error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo vendedores', details: error.message });
    }
});

// =============================================================================
// RUTERO CONFIGURATION (GET/POST)
// =============================================================================
router.post('/rutero/config', async (req, res) => {
    let conn;
    try {
        const { vendedor, dia, orden } = req.body;

        if (!vendedor || !dia || !orden || !Array.isArray(orden)) {
            return res.status(400).json({ error: 'Datos inválidos. Se requiere vendedor, dia y array de orden.' });
        }

        // Connect manually for transaction support using pool
        const pool = getPool();
        if (!pool) throw new Error("Database pool not initialized");

        conn = await pool.connect();
        await conn.beginTransaction();

        // 1. Delete existing config for this vendor/day
        await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${vendedor}' AND DIA = '${dia}'`);

        // 2. Insert new order
        // Note: ODBC basic driver might not support batch inserts efficiently, so we loop.
        for (const item of orden) {
            if (item.cliente) {
                await conn.query(`
          INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) 
          VALUES ('${vendedor}', '${dia}', '${item.cliente}', ${parseInt(item.posicion) || 0})
        `);
            }
        }

        await conn.commit();
        res.json({ success: true, message: 'Orden actualizado' });

    } catch (error) {
        if (conn) {
            try { await conn.rollback(); } catch (e) { }
        }
        logger.error(`Rutero config save error: ${error.message}`);
        res.status(500).json({ error: 'Error guardando orden', details: error.message });
    } finally {
        if (conn) {
            try { await conn.close(); } catch (e) { }
        }
    }
});

router.get('/rutero/config', async (req, res) => {
    try {
        const { vendedor, dia } = req.query;
        if (!vendedor || !dia) return res.status(400).json({ error: 'Vendedor y dia requeridos' });

        const rows = await query(`
      SELECT CLIENTE, ORDEN 
      FROM JAVIER.RUTERO_CONFIG 
      WHERE VENDEDOR = '${vendedor}' AND DIA = '${dia}' 
      ORDER BY ORDEN ASC
    `);

        res.json({ config: rows });
    } catch (error) {
        logger.error(`Rutero config fetch error: ${error.message}`);
        res.status(500).json({ error: 'Error recuperando orden' });
    }
});

// =============================================================================
// RUTERO DAY
// =============================================================================
router.get('/rutero/day/:day', async (req, res) => {
    try {
        const { day } = req.params;
        const { vendedorCodes, year, role } = req.query;
        const now = getCurrentDate();
        const currentYear = parseInt(year) || now.getFullYear();
        const previousYear = currentYear - 1;
        const isVisit = role !== 'repartidor';

        // End date for current year: yesterday or Dec 31
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const endMonthCurrent = yesterday.getMonth() + 1;
        const endDayCurrent = yesterday.getDate();
        const endMonthPrevious = endMonthCurrent;
        const endDayPrevious = endDayCurrent;

        // Validate day
        if (DAY_NAMES.indexOf(day.toLowerCase()) === -1) {
            return res.status(400).json({ error: 'Día inválido', day });
        }

        // Fetch custom order
        let orderMap = new Map();
        try {
            const primaryVendor = vendedorCodes ? vendedorCodes.split(',')[0].trim() : '';
            if (primaryVendor) {
                const configRows = await query(`
          SELECT CLIENTE, ORDEN 
          FROM JAVIER.RUTERO_CONFIG 
          WHERE VENDEDOR = '${primaryVendor}' AND DIA = '${day.toLowerCase()}'
        `);
                configRows.forEach(r => orderMap.set(r.CLIENTE.trim(), r.ORDEN));
            }
        } catch (e) {
            logger.warn(`Order config error: ${e.message}`);
        }

        // Get client codes for the selected day from CACHE
        let dayClientCodes = getClientsForDay(vendedorCodes, day, role || 'comercial');

        if (!dayClientCodes) {
            logger.warn(`[RUTERO DAY] Cache not ready`);
            return res.json({ clients: [], count: 0, day, cacheStatus: 'loading' });
        }

        if (dayClientCodes.length === 0) {
            return res.json({
                clients: [], count: 0, day, year: currentYear, compareYear: previousYear
            });
        }

        // Build client filter
        const batchSize = 200;
        const clientBatch = dayClientCodes.slice(0, batchSize);
        const safeClientFilter = clientBatch.map(c => `'${c.replace(/'/g, "''")}'`).join(',');
        const clientFilter = `L.CODIGOCLIENTEALBARAN IN (${safeClientFilter})`;

        // Get YTD cumulative sales for CURRENT YEAR
        const currentYearRows = await query(`
      SELECT 
        L.CODIGOCLIENTEALBARAN as CODE,
        COALESCE(NULLIF(TRIM(MIN(C.NOMBREALTERNATIVO)), ''), MIN(C.NOMBRECLIENTE)) as NAME,
        MIN(C.DIRECCION) as ADDRESS,
        MIN(C.POBLACION) as CITY,
        MIN(C.TELEFONO1) as PHONE,
        SUM(L.IMPORTEVENTA) as SALES,
        SUM(L.IMPORTECOSTO) as COST
      FROM DSEDAC.LAC L
      LEFT JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
      WHERE ${clientFilter}
        AND L.ANODOCUMENTO = ${currentYear}
        AND ${LAC_SALES_FILTER}
        AND (L.MESDOCUMENTO < ${endMonthCurrent} OR (L.MESDOCUMENTO = ${endMonthCurrent} AND L.DIADOCUMENTO <= ${endDayCurrent}))
      GROUP BY L.CODIGOCLIENTEALBARAN
    `);

        // Get YTD for previous year same period
        const prevYearMap = new Map();
        const prevYearRows = await query(`
      SELECT 
        L.CODIGOCLIENTEALBARAN as CODE,
        SUM(L.IMPORTEVENTA) as SALES,
        SUM(L.IMPORTECOSTO) as COST
      FROM DSEDAC.LAC L
      WHERE ${clientFilter}
        AND L.ANODOCUMENTO = ${previousYear}
        AND ${LAC_SALES_FILTER}
        AND (L.MESDOCUMENTO < ${endMonthPrevious} OR (L.MESDOCUMENTO = ${endMonthPrevious} AND L.DIADOCUMENTO <= ${endDayPrevious}))
      GROUP BY L.CODIGOCLIENTEALBARAN
    `);
        prevYearRows.forEach(r => {
            prevYearMap.set(r.CODE?.trim() || '', {
                sales: parseFloat(r.SALES) || 0,
                cost: parseFloat(r.COST) || 0
            });
        });

        // Get GPS coordinates
        let gpsMap = new Map();
        try {
            const gpsResult = await query(`
        SELECT CODIGO, LATITUD, LONGITUD
        FROM DSEMOVIL.CLIENTES
        WHERE CODIGO IN (${clientBatch.map(c => `'${c}'`).join(',')})
          AND LATITUD IS NOT NULL AND LATITUD <> 0
      `);
            gpsResult.forEach(g => {
                gpsMap.set(g.CODIGO?.trim() || '', {
                    lat: parseFloat(g.LATITUD) || null,
                    lon: parseFloat(g.LONGITUD) || null
                });
            });
        } catch (e) {
            logger.warn(`Could not load GPS data: ${e.message}`);
        }

        // Build response
        const clients = currentYearRows.map(r => {
            const code = r.CODE?.trim() || '';
            const ytdSales = parseFloat(r.SALES) || 0;
            const ytdCost = parseFloat(r.COST) || 0;
            const ytdMargin = ytdSales > 0 ? ((ytdSales - ytdCost) / ytdSales * 100) : 0;

            const prevData = prevYearMap.get(code) || { sales: 0, cost: 0 };
            const prevSales = prevData.sales;

            const yoyVariation = prevSales > 0
                ? ((ytdSales - prevSales) / prevSales * 100)
                : (ytdSales > 0 ? 100 : 0);
            const isPositive = ytdSales >= prevSales;
            const gps = gpsMap.get(code) || { lat: null, lon: null };

            return {
                code,
                name: r.NAME?.trim() || 'Sin nombre',
                address: r.ADDRESS?.trim() || '',
                city: r.CITY?.trim() || '',
                phone: r.PHONE?.trim() || '',
                latitude: gps.lat,
                longitude: gps.lon,
                status: {
                    isPositive,
                    ytdSales: Math.round(ytdSales * 100) / 100,
                    ytdPrevYear: Math.round(prevSales * 100) / 100,
                    yoyVariation: Math.round(yoyVariation * 10) / 10,
                    margin: Math.round(ytdMargin * 10) / 10,
                    currentMonthSales: ytdSales,
                    prevMonthSales: prevSales,
                    variation: yoyVariation
                }
            };
        }).sort((a, b) => {
            const orderA = orderMap.has(a.code) ? orderMap.get(a.code) : 999999;
            const orderB = orderMap.has(b.code) ? orderMap.get(b.code) : 999999;
            if (orderA !== orderB) return orderA - orderB;
            return b.status.ytdSales - a.status.ytdSales;
        });

        res.json({
            clients,
            count: clients.length,
            totalDayClients: dayClientCodes.length,
            day,
            year: currentYear,
            compareYear: previousYear
        });

    } catch (error) {
        logger.error(`Rutero day error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo rutero del día', details: error.message });
    }
});

// =============================================================================
// RUTERO CLIENT STATUS (YoY Comparison)
// =============================================================================
router.get('/rutero/client/:code/status', async (req, res) => {
    try {
        const { code } = req.params;
        const clientCode = code.trim();
        const now = getCurrentDate();
        const currentYear = now.getFullYear();

        // Ventas por mes del año actual (usando LAC) - parameterized
        const currentYearData = await queryWithParams(`
      SELECT MESDOCUMENTO as month, SUM(IMPORTEVENTA) as sales, SUM(IMPORTEVENTA - IMPORTECOSTO) as margin
      FROM DSEDAC.LAC
      WHERE CODIGOCLIENTEALBARAN = ? AND ANODOCUMENTO = ${currentYear}
      GROUP BY MESDOCUMENTO
      ORDER BY MESDOCUMENTO
    `, [clientCode]);

        // Ventas por mes del año anterior (usando LAC) - parameterized
        const lastYearData = await queryWithParams(`
      SELECT MESDOCUMENTO as month, SUM(IMPORTEVENTA) as sales, SUM(IMPORTEVENTA - IMPORTECOSTO) as margin
      FROM DSEDAC.LAC
      WHERE CODIGOCLIENTEALBARAN = ? AND ANODOCUMENTO = ${currentYear - 1}
      GROUP BY MESDOCUMENTO
      ORDER BY MESDOCUMENTO
    `, [clientCode]);

        // Crear mapa de comparación
        const comparison = [];
        for (let m = 1; m <= 12; m++) {
            const curr = currentYearData.find(d => d.MONTH === m);
            const last = lastYearData.find(d => d.MONTH === m);
            const currSales = parseFloat(curr?.SALES) || 0;
            const lastSales = parseFloat(last?.SALES) || 0;
            const variation = lastSales > 0 ? ((currSales - lastSales) / lastSales) * 100 : (currSales > 0 ? 100 : 0);

            comparison.push({
                month: m,
                currentYear: currSales,
                lastYear: lastSales,
                variation: Math.round(variation * 10) / 10,
                isPositive: variation >= 0
            });
        }

        res.json(comparison);

    } catch (error) {
        logger.error(`Rutero client status error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo estado del cliente', details: error.message });
    }
});

// =============================================================================
// RUTERO CLIENT DETAIL (Comprehensive View)
// =============================================================================
router.get('/rutero/client/:code/detail', async (req, res) => {
    try {
        const { code } = req.params;
        const { year, filterMonth } = req.query;
        const clientCode = code.trim();
        const now = getCurrentDate();
        const targetYear = parseInt(year) || now.getFullYear();

        // 1. Client Info with Razón Social - parameterized
        const clientInfo = await queryWithParams(`
      SELECT 
        CODIGOCLIENTE as code,
        COALESCE(NULLIF(TRIM(NOMBREALTERNATIVO), ''), TRIM(NOMBRECLIENTE)) as razonSocial,
        NOMBRECLIENTE as nombreCompleto,
        NIF, DIRECCION, POBLACION, PROVINCIA, CODIGOPOSTAL,
        TELEFONO1, TELEFONO2, PERSONACONTACTO, CODIGORUTA
      FROM DSEDAC.CLI
      WHERE CODIGOCLIENTE = ?
      FETCH FIRST 1 ROWS ONLY
    `, [clientCode]);

        if (clientInfo.length === 0) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        // 2. Monthly Sales Breakdown (Current + Last Year)
        let salesByMonth = [];
        try {
            salesByMonth = await queryWithParams(`
        SELECT 
          L.ANODOCUMENTO as year,
          L.MESDOCUMENTO as month,
          SUM(L.IMPORTEVENTA) as sales,
          SUM(L.IMPORTEMARGENREAL) as margin,
          COUNT(DISTINCT L.NUMERODOCUMENTO) as invoices,
          COUNT(DISTINCT L.CODIGOARTICULO) as products
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.CAC C ON C.CCSBAB = L.LCSBAB 
          AND C.CCYEAB = L.LCYEAB 
          AND C.CCSRAB = L.LCSRAB 
          AND C.CCTRAB = L.LCTRAB 
          AND C.CCNRAB = L.LCNRAB
        WHERE L.CODIGOCLIENTEALBARAN = ?
          AND L.ANODOCUMENTO IN (${targetYear}, ${targetYear - 1})
          AND L.LCTPVT <> 'SC'
          AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
          AND COALESCE(C.CCSNSD, '') <> 'E'
        GROUP BY L.ANODOCUMENTO, L.MESDOCUMENTO
        ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC
      `, [clientCode]);
        } catch (e) {
            // Fallback without margin
            salesByMonth = await queryWithParams(`
        SELECT 
          ANODOCUMENTO as year,
          MESDOCUMENTO as month,
          SUM(IMPORTEVENTA) as sales,
          0 as margin,
          COUNT(DISTINCT NUMERODOCUMENTO) as invoices,
          COUNT(DISTINCT CODIGOARTICULO) as products
        FROM DSEDAC.LAC
        WHERE CODIGOCLIENTEALBARAN = ?
          AND ANODOCUMENTO IN (${targetYear}, ${targetYear - 1})
        GROUP BY ANODOCUMENTO, MESDOCUMENTO
        ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC
      `, [clientCode]);
        }

        // 3. Product Purchases with Dates - Parameterized to fix safeCode bug
        let productFilter = '';
        if (filterMonth) {
            productFilter = `AND MESDOCUMENTO = ${parseInt(filterMonth)}`;
        }

        let productPurchases = [];
        try {
            productPurchases = await queryWithParams(`
        SELECT 
          L.CODIGOARTICULO as productCode,
          L.DESCRIPCION as productName,
          L.ANODOCUMENTO as year,
          L.MESDOCUMENTO as month,
          L.DIADOCUMENTO as day,
          L.PRECIOVENTA as price,
          L.CANTIDADUNIDADES as quantity,
          L.IMPORTEVENTA as total,
          L.CODIGOLOTE as lote,
          L.REFERENCIADOCUMENTO as ref,
          L.NUMERODOCUMENTO as invoice
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.CAC C ON C.CCSBAB = L.LCSBAB 
          AND C.CCYEAB = L.LCYEAB 
          AND C.CCSRAB = L.LCSRAB 
          AND C.CCTRAB = L.LCTRAB 
          AND C.CCNRAB = L.LCNRAB
        WHERE L.CODIGOCLIENTEALBARAN = ?
          AND L.ANODOCUMENTO = ${targetYear}
          AND L.LCTPVT <> 'SC'
          AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
          AND COALESCE(C.CCSNSD, '') <> 'E'
          ${productFilter}
        ORDER BY L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC
        FETCH FIRST 300 ROWS ONLY
      `, [clientCode]);
        } catch (e) {
            logger.warn(`Product purchases query failed: ${e.message}`);
        }

        // 4. Yearly Totals (last 3 years) - Parameterized
        let yearlyTotals = [];
        try {
            yearlyTotals = await queryWithParams(`
        SELECT 
          L.ANODOCUMENTO as year,
          SUM(L.IMPORTEVENTA) as totalSales,
          SUM(L.IMPORTEMARGENREAL) as totalMargin
        FROM DSEDAC.LAC L
        WHERE L.CODIGOCLIENTEALBARAN = ?
          AND L.ANODOCUMENTO >= ${targetYear - 2}
        GROUP BY L.ANODOCUMENTO
        ORDER BY L.ANODOCUMENTO DESC
      `, [clientCode]);
        } catch (e) { }

        // 5. Top Products - Parameterized
        let topProducts = [];
        try {
            topProducts = await queryWithParams(`
        SELECT 
          L.CODIGOARTICULO as code,
          MAX(L.DESCRIPCION) as name,
          SUM(L.IMPORTEVENTA) as totalSales,
          SUM(L.CANTIDADUNIDADES) as totalUnits,
          COUNT(*) as purchases
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.CAC C ON C.CCSBAB = L.LCSBAB 
          AND C.CCYEAB = L.LCYEAB 
          AND C.CCSRAB = L.LCSRAB 
          AND C.CCTRAB = L.LCTRAB 
          AND C.CCNRAB = L.LCNRAB
        WHERE L.CODIGOCLIENTEALBARAN = ?
          AND L.ANODOCUMENTO = ${targetYear}
          AND L.LCTPVT <> 'SC'
          AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
          AND COALESCE(C.CCSNSD, '') <> 'E'
        GROUP BY L.CODIGOARTICULO
        ORDER BY SUM(L.IMPORTEVENTA) DESC
        FETCH FIRST 20 ROWS ONLY
      `, [clientCode]);
        } catch (e) { }

        // 6. Purchase frequency - Parameterized
        let purchaseFreq = [];
        try {
            purchaseFreq = await queryWithParams(`
        SELECT 
          COUNT(DISTINCT DIADOCUMENTO || MESDOCUMENTO || ANODOCUMENTO) as purchaseDays,
          MIN(MESDOCUMENTO) as firstMonth,
          MAX(MESDOCUMENTO) as lastMonth
        FROM DSEDAC.LAC
        WHERE CODIGOCLIENTEALBARAN = ?
          AND ANODOCUMENTO = ${targetYear}
      `, [clientCode]);
        } catch (e) { }

        // Build response
        const c = clientInfo[0];

        const monthlyData = [];
        for (let m = 1; m <= 12; m++) {
            const currRow = salesByMonth.find(r => r.YEAR === targetYear && r.MONTH === m);
            const lastRow = salesByMonth.find(r => r.YEAR === targetYear - 1 && r.MONTH === m);

            const currSales = parseFloat(currRow?.SALES) || 0;
            const lastSales = parseFloat(lastRow?.SALES) || 0;
            const variation = lastSales > 0 ? ((currSales - lastSales) / lastSales) * 100 : (currSales > 0 ? 100 : 0);

            monthlyData.push({
                month: m,
                monthName: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][m - 1],
                currentYear: currSales,
                currentYearFormatted: `${currSales.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`,
                lastYear: lastSales,
                lastYearFormatted: `${lastSales.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`,
                variation: Math.round(variation * 10) / 10,
                isPositive: variation >= 0,
                margin: parseFloat(currRow?.MARGIN) || 0,
                invoices: parseInt(currRow?.INVOICES) || 0,
                products: parseInt(currRow?.PRODUCTS) || 0
            });
        }

        const freq = purchaseFreq[0] || {};
        const purchaseDays = parseInt(freq.PURCHASEDAYS) || 0;
        const monthsActive = (parseInt(freq.LASTMONTH) || 1) - (parseInt(freq.FIRSTMONTH) || 1) + 1;
        const avgPurchasesPerMonth = monthsActive > 0 ? purchaseDays / monthsActive : 0;

        res.json({
            client: {
                code: c.CODE?.trim(),
                razonSocial: c.RAZONSOCIAL?.trim() || c.NOMBRECOMPLETO?.trim(),
                nombreCompleto: c.NOMBRECOMPLETO?.trim(),
                nif: c.NIF?.trim(),
                address: c.DIRECCION?.trim(),
                city: c.POBLACION?.trim(),
                province: c.PROVINCIA?.trim(),
                postalCode: c.CODIGOPOSTAL?.trim(),
                phone: c.TELEFONO1?.trim(),
                phone2: c.TELEFONO2?.trim(),
                contact: c.PERSONACONTACTO?.trim(),
                route: c.CODIGORUTA?.trim()
            },
            stats: {
                avgPurchasesPerMonth: Math.round(avgPurchasesPerMonth * 10) / 10,
                totalPurchasesYear: purchaseDays
            },
            monthlyData,
            topProducts: topProducts.map(p => ({
                code: p.CODE?.trim(),
                name: p.NAME?.trim(),
                totalSales: formatCurrency(p.TOTALSALES),
                totalUnits: parseInt(p.TOTALUNITS) || 0,
                purchases: parseInt(p.PURCHASES) || 0
            })),
            purchases: productPurchases.map(p => ({
                productCode: p.PRODUCTCODE?.trim(),
                productName: p.PRODUCTNAME?.trim(),
                date: `${String(p.DAY).padStart(2, '0')}/${String(p.MONTH).padStart(2, '0')}/${p.YEAR}`,
                quantity: parseInt(p.QUANTITY) || 0,
                price: formatCurrency(p.PRICE),
                total: formatCurrency(p.TOTAL),
                invoice: p.INVOICE
            })),
            yearlyTotals: yearlyTotals.map(y => ({
                year: y.YEAR,
                totalSales: formatCurrency(y.TOTALSALES),
                totalMargin: formatCurrency(y.TOTALMARGIN)
            }))
        });

    } catch (error) {
        logger.error(`Rutero detail error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo detalle', details: error.message });
    }
});

module.exports = router;
