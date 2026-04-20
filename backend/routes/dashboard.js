const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { verifyToken } = require('../middleware/auth');
const { query, queryWithParams } = require('../config/db');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL } = require('../services/redis-cache');
const {
    getCurrentDate,
    buildVendedorFilter,
    buildVendedorFilterLACLAE,
    buildColumnaVendedorFilter,
    getVendorColumn,
    getVendorColumnExpr,
    formatCurrency,
    MIN_YEAR,
    LAC_SALES_FILTER,
    LACLAE_SALES_FILTER,
    getBSales,
    sanitizeForSQL,
    handleRouteError
} = require('../utils/common');

function buildVendedorFilterParameterized(vendedorCodes, tableAlias = 'L') {
    if (!vendedorCodes || vendedorCodes === 'ALL') return { filter: '', params: [] };
    const prefix = tableAlias ? `${tableAlias}.` : '';
    const col = `${prefix}LCCDVD`;

    const codeList = vendedorCodes.split(',').map(c => c.trim());
    const validCodes = codeList
        .filter(c => c !== 'UNK' && /^[a-zA-Z0-9]+$/.test(c));

    if (validCodes.length === 0) return { filter: 'AND 1=0', params: [] };

    const placeholders = validCodes.map(() => '?').join(',');
    return {
        filter: `AND ${col} IN (${placeholders})`,
        params: validCodes
    };
}

function buildVendedorFilterLACLAEParameterized(vendedorCodes, tableAlias = 'L', year, month) {
    if (!vendedorCodes || vendedorCodes === 'ALL') return { filter: '', params: [] };
    const prefix = tableAlias ? `${tableAlias}.` : '';
    const col = `${prefix}LCCDVD`;

    const codeList = vendedorCodes.split(',').map(c => c.trim());
    const hasUnk = codeList.includes('UNK');
    const validCodes = codeList.filter(c => c !== 'UNK' && /^[a-zA-Z0-9]+$/.test(c));

    if (validCodes.length === 0 && !hasUnk) return { filter: 'AND 1=0', params: [] };

    const conditions = [];
    const params = [];

    if (validCodes.length > 0) {
        const placeholders = validCodes.map(() => '?').join(',');
        conditions.push(`${col} IN (${placeholders})`);
        params.push(...validCodes);
    }
    if (hasUnk) {
        conditions.push(`(${col} IS NULL OR ${col} = '')`);
    }

    return { filter: `AND (${conditions.join(' OR ')})`, params };
}

router.get('/metrics', verifyToken, async (req, res) => {
    try {
        const { vendedorCodes, year, month } = req.query;
        const now = getCurrentDate();
        const currentYear = parseInt(year) || now.getFullYear();
        const currentMonth = parseInt(month) || (now.getMonth() + 1);
        const cacheKey = `dashboard:metrics:${currentYear}:${currentMonth || 'all'}:${vendedorCodes || 'ALL'}`;

        const isAllVendors = !vendedorCodes || vendedorCodes === 'ALL';
        const currentTTL = isAllVendors ? TTL.MEDIUM : TTL.SHORT;
        const prevTTL = TTL.LONG;

        const vendedorResult = buildVendedorFilterParameterized(vendedorCodes);
        const currentDataSql = `
          SELECT
            COALESCE(SUM(L.LCIMVT), 0) as sales,
            COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) as margin,
            COALESCE(SUM(L.LCCTEV), 0) as boxes,
            COUNT(DISTINCT L.LCCDCL) as activeClients
          FROM DSED.LACLAE L
          WHERE L.LCAADC = ?
            AND L.LCMMDC = ?
            AND L.TPDC = 'LAC'
            AND L.LCTPVT IN ('CC', 'VC')
            AND L.LCCLLN IN ('AB', 'VT')
            AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
            ${vendedorResult.filter}
        `;
        const currentDataParams = [currentYear, currentMonth, ...vendedorResult.params];

        const lastDataSql = `
          SELECT
            COALESCE(SUM(L.LCIMVT), 0) as sales,
            COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) as margin,
            COALESCE(SUM(L.LCCTEV), 0) as boxes
          FROM DSED.LACLAE L
          WHERE L.LCAADC = ?
            AND L.LCMMDC = ?
            AND ${LACLAE_SALES_FILTER}
            ${vendedorResult.filter}
        `;
        const lastDataParams = [currentYear - 1, currentMonth, ...vendedorResult.params];

        const [currentData, lastData] = await Promise.all([
            cachedQuery(queryWithParams, currentDataSql, `${cacheKey}:curr`, currentTTL, currentDataParams),
            cachedQuery(queryWithParams, lastDataSql, `${cacheKey}:prev`, prevTTL, lastDataParams)
        ]);

        const today = now.getDate();
        let todaySales = 0;
        let todayOrders = 0;

        if (currentYear === now.getFullYear() && currentMonth === (now.getMonth() + 1)) {
            const todayDataSql = `
                SELECT COALESCE(SUM(L.LCIMVT), 0) as sales, COUNT(DISTINCT L.LCNRAB) as orders
                FROM DSED.LACLAE L
                WHERE L.LCAADC = ? AND L.LCMMDC = ? AND L.LCDDDC = ? AND ${LACLAE_SALES_FILTER} ${vendedorResult.filter}
            `;
            const todayDataParams = [currentYear, currentMonth, today, ...vendedorResult.params];
            const todayData = await cachedQuery(queryWithParams, todayDataSql, `${cacheKey}:today`, TTL.SHORT, todayDataParams);
            const td = todayData[0] || {};
            todaySales = parseFloat(td.SALES ?? td.sales) || 0;
            todayOrders = parseInt(td.ORDERS ?? td.orders) || 0;
        }

        const rawCurr = currentData[0] || {};
        const rawLast = lastData[0] || {};
        const pick = (obj, key) => obj[key.toUpperCase()] ?? obj[key.toLowerCase()] ?? obj[key];
        const curr = {
            SALES: pick(rawCurr, 'sales'),
            MARGIN: pick(rawCurr, 'margin'),
            BOXES: pick(rawCurr, 'boxes'),
            ACTIVECLIENTS: pick(rawCurr, 'activeClients') ?? pick(rawCurr, 'activeclients')
        };
        const last = {
            SALES: pick(rawLast, 'sales'),
            MARGIN: pick(rawLast, 'margin'),
            BOXES: pick(rawLast, 'boxes')
        };

        let currentSales = parseFloat(curr.SALES) || 0;
        let lastSales = parseFloat(last.SALES) || 0;

        if (vendedorCodes && vendedorCodes !== 'ALL') {
            const firstCode = vendedorCodes.split(',')[0]?.trim();
            if (firstCode) {
                const bSalesCurr = await getBSales(firstCode, currentYear);
                const bSalesLast = await getBSales(firstCode, currentYear - 1);
                currentSales += (bSalesCurr[currentMonth] || 0);
                lastSales += (bSalesLast[currentMonth] || 0);
            }
        }

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
        handleRouteError(error, res, 'Error calculating metrics', 500);
    }
});

router.get('/matrix-data', verifyToken, async (req, res) => {
    try {
        const { vendedorCodes, groupBy = 'vendor', year, years, clientCodes, productCodes, familyCodes } = req.query;
        const cacheKey = `dashboard:matrix:${JSON.stringify(req.query)}`;

        const { redisCache } = require('../services/redis-cache');
        const cachedResult = await redisCache.get('matrix', cacheKey);
        if (cachedResult) {
            logger.info(`⚡ Cache hit: matrix-data`);
            return res.json(cachedResult);
        }

        let selectedYear = parseInt(year) || getCurrentDate().getFullYear();
        let prevYear = selectedYear - 1;
        let yearParams = [];
        let yearFilter = '';

        if (years && years.trim().length > 0) {
            const yearList = years.split(',').map(y => parseInt(y.trim())).filter(y => !isNaN(y));
            if (yearList.length > 0) {
                const placeholders = yearList.map(() => '?').join(',');
                yearFilter = `AND L.LCAADC IN (${placeholders})`;
                yearParams = yearList;
            } else {
                yearFilter = 'AND L.LCAADC = ?';
                yearParams = [selectedYear];
            }
        } else {
            yearFilter = 'AND L.LCAADC IN (?, ?)';
            yearParams = [selectedYear, prevYear];
        }

        let queryYears = [];
        if (years && years.trim().length > 0) {
            queryYears = years.split(',').map(y => parseInt(y.trim())).filter(y => !isNaN(y));
        }
        if (queryYears.length === 0) {
            queryYears = [selectedYear, prevYear];
        }

        const vendedorResult = buildVendedorFilterParameterized(vendedorCodes);
        const vendedorParams = vendedorResult.params;

        let clientFilter = '';
        let clientParams = [];
        if (clientCodes && clientCodes !== 'ALL') {
            const codes = clientCodes.split(',').map(c => c.trim()).filter(c => /^[a-zA-Z0-9]+$/.test(c));
            if (codes.length > 0) {
                const placeholders = codes.map(() => '?').join(',');
                clientFilter = `AND L.LCCDCL IN (${placeholders})`;
                clientParams = codes;
            }
        }

        let productFilter = '';
        let productParams = [];
        if (productCodes && productCodes !== 'ALL') {
            const codes = productCodes.split(',').map(c => c.trim()).filter(c => /^[a-zA-Z0-9]+$/.test(c));
            if (codes.length > 0) {
                const placeholders = codes.map(() => '?').join(',');
                productFilter = `AND L.CODIGOARTICULO IN (${placeholders})`;
                productParams = codes;
            }
        }

        let familyProductFilter = '';
        let familyProductParams = [];
        if (familyCodes && familyCodes !== 'ALL') {
            const fCodes = familyCodes.split(',').map(f => f.trim()).filter(f => /^[a-zA-Z0-9]+$/.test(f) && f !== '');
            if (fCodes.length > 0) {
                const famProductsSql = `SELECT TRIM(CODIGOARTICULO) as CODE FROM DSEDAC.ART WHERE CODIGOFAMILIA IN (${fCodes.map(() => '?').join(',')})`;
                const famProducts = await cachedQuery(queryWithParams, famProductsSql, `fam_prods:${fCodes.join(',')}`, TTL.LONG, fCodes);
                if (famProducts.length > 0) {
                    const pCodes = famProducts.slice(0, 1000).map(p => p.CODE);
                    const placeholders = pCodes.map(() => '?').join(',');
                    familyProductFilter = `AND L.CODIGOARTICULO IN (${placeholders})`;
                    familyProductParams = pCodes;
                } else {
                    familyProductFilter = 'AND 1=0';
                }
            } else {
                familyProductFilter = 'AND 1=0';
            }
        }

        const hierarchy = groupBy.split(',').map(g => g.trim().toLowerCase());
        const selectClauses = ['L.LCAADC as YEAR', 'L.LCMMDC as MONTH'];
        const groupClauses = ['L.LCAADC', 'L.LCMMDC'];

        const vendorColExpr = getVendorColumnExpr('L', { forLACTable: true });

        hierarchy.forEach((level, index) => {
            const levelIdx = index + 1;
            if (level === 'vendor') {
                selectClauses.push(`RTRIM(${vendorColExpr}) as ID_${levelIdx}`);
                groupClauses.push(vendorColExpr);
            } else if (level === 'client') {
                selectClauses.push(`RTRIM(L.LCCDCL) as ID_${levelIdx}`);
                groupClauses.push('L.LCCDCL');
            } else if (level === 'product') {
                selectClauses.push(`RTRIM(L.CODIGOARTICULO) as ID_${levelIdx}`);
                groupClauses.push('L.CODIGOARTICULO');
            } else if (level === 'family') {
                selectClauses.push(`RTRIM(L.CODIGOARTICULO) as ID_${levelIdx}`);
                groupClauses.push('L.CODIGOARTICULO');
            } else if (level === 'subfamily') {
                selectClauses.push(`COALESCE(NULLIF(TRIM(A.CODIGOSUBFAMILIA), ''), 'General') as ID_${levelIdx}`);
                groupClauses.push('A.CODIGOSUBFAMILIA');
            }
        });

        selectClauses.push('SUM(L.LCIMVT) as SALES');
        selectClauses.push('SUM(L.LCIMVT - L.LCIMCT) as MARGIN');

        const needsArtJoin = hierarchy.includes('subfamily');
        const artJoinClause = needsArtJoin ? 'LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO' : '';

        const aggregateSQL = `
            SELECT ${selectClauses.join(', ')}
            FROM DSEDAC.LAC L
              ${artJoinClause}
              WHERE 1=1
              AND ${LAC_SALES_FILTER}
              ${yearFilter}
              ${vendedorResult.filter}
              ${clientFilter}
              ${productFilter}
              ${familyProductFilter}
            GROUP BY ${groupClauses.join(', ')}
            ORDER BY SUM(L.LCIMVT) DESC
            FETCH FIRST 1000 ROWS ONLY
        `;
        const aggregateParams = [...yearParams, ...vendedorParams, ...clientParams, ...productParams, ...familyProductParams];

        logger.info(`[MATRIX] Full SQL (${aggregateSQL.replace(/\s+/g, ' ').length} chars)`);

        const rawKey = `matrix:raw:${cacheKey}`;
        const rawData = await cachedQuery(queryWithParams, aggregateSQL, rawKey, TTL.MEDIUM, aggregateParams);

        const nameLookups = [];
        const lookup = (sql, key, params = []) => cachedQuery(queryWithParams, sql, key, TTL.LONG, params);

        if (hierarchy.includes('vendor')) {
            const vCodes = [...new Set(rawData.map(r => r.ID_1).filter(Boolean))];
            if (vCodes.length) {
                const placeholders = vCodes.map(() => '?').join(',');
                nameLookups.push(lookup(
                    `SELECT TRIM(CODIGOVENDEDOR) as CODE, TRIM(NOMBREVENDEDOR) as NAME FROM DSEDAC.VDD WHERE CODIGOVENDEDOR IN (${placeholders})`,
                    `names:vendors:${vCodes.length}`,
                    vCodes
                ).then(d => ({ type: 'vendor', data: d })));
            }
        }

        if (hierarchy.includes('client')) {
            const idx = hierarchy.indexOf('client') + 1;
            const cCodes = [...new Set(rawData.map(r => r[`ID_${idx}`]).filter(Boolean))];
            if (cCodes.length) {
                const codesToQuery = cCodes.slice(0, 2000);
                const placeholders = codesToQuery.map(() => '?').join(',');
                nameLookups.push(lookup(
                    `SELECT TRIM(CODIGOCLIENTE) as CODE, COALESCE(NULLIF(TRIM(NOMBREALTERNATIVO), ''), TRIM(NOMBRECLIENTE)) as NAME FROM DSEDAC.CLI WHERE CODIGOCLIENTE IN (${placeholders})`,
                    `names:clients:${cCodes.length}`,
                    codesToQuery
                ).then(d => ({ type: 'client', data: d })));
            }
        }

        if (hierarchy.includes('product') || hierarchy.includes('family')) {
            const prodIndices = [];
            hierarchy.forEach((h, i) => { if (h === 'product' || h === 'family') prodIndices.push(i + 1); });
            const productCodesSet = new Set();
            prodIndices.forEach(idx => rawData.forEach(r => { if (r[`ID_${idx}`]) productCodesSet.add(r[`ID_${idx}`]); }));

            const codesArr = [...productCodesSet].slice(0, 2000);
            if (codesArr.length > 0) {
                const placeholders = codesArr.map(() => '?').join(',');
                nameLookups.push(lookup(
                    `SELECT TRIM(A.CODIGOARTICULO) as CODE, TRIM(A.DESCRIPCIONARTICULO) as NAME, TRIM(A.CODIGOFAMILIA) as FAM_CODE, COALESCE(TRIM(F.DESCRIPCIONFAMILIA), TRIM(A.CODIGOFAMILIA)) as FAM_NAME
                     FROM DSEDAC.ART A LEFT JOIN DSEDAC.FAM F ON A.CODIGOFAMILIA = F.CODIGOFAMILIA
                     WHERE A.CODIGOARTICULO IN (${placeholders})`,
                    `names:products:${codesArr.length}`,
                    codesArr
                ).then(d => ({ type: 'art_mix', data: d })));
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
        const odbcInfo = error.odbcErrors ? ` ODBC: ${JSON.stringify(error.odbcErrors)}` : '';
        logger.error(`Matrix data error: ${error.message}${odbcInfo}`);
        res.status(500).json({
            error: 'Error obteniendo datos matriciales',
            detail: process.env.NODE_ENV !== 'production' ? error.message : undefined
        });
    }
});

router.get('/sales-evolution', verifyToken, async (req, res) => {
    try {
        const { vendedorCodes, years, granularity = 'month', upToToday = 'false', months = 36 } = req.query;
        const now = getCurrentDate();
        const selectedYears = years
            ? years.split(',').map(y => parseInt(y.trim()))
            : [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

        const yearsFilter = `AND L.LCAADC IN (${selectedYears.map(() => '?').join(',')})`;

        let dateFilter = '';
        let dateParams = [];
        if (upToToday === 'true') {
            const currentMonth = now.getMonth() + 1;
            const currentDay = now.getDate();
            dateFilter = `AND (L.LCAADC < ? OR (L.LCAADC = ? AND L.LCMMDC < ?) OR (L.LCAADC = ? AND L.LCMMDC = ? AND L.LCDDDC <= ?))`;
            dateParams = [now.getFullYear(), now.getFullYear(), currentMonth, now.getFullYear(), currentMonth, currentDay];
        }

        const cacheKey = `dashboard:evolution:${years || 'default'}:${granularity}:${upToToday}:${vendedorCodes || 'ALL'}`;

        const evolutionTTL = (!vendedorCodes || vendedorCodes === 'ALL') ? TTL.LONG : TTL.MEDIUM;

        let resultData = [];

        if (granularity === 'week') {
            const dailyQuery = `
        SELECT L.LCAADC as year, L.LCMMDC as month, L.LCDDDC as day,
               SUM(L.LCIMVT) as sales,
               COUNT(DISTINCT L.LCNRAB) as orders,
               COUNT(DISTINCT L.LCCDCL) as clients
        FROM DSED.LACLAE L
        WHERE ${LACLAE_SALES_FILTER} ${yearsFilter} ${dateFilter}
        GROUP BY L.LCAADC, L.LCMMDC, L.LCDDDC
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC, L.LCDDDC DESC
      `;
            const dailyParams = [...selectedYears, ...dateParams];
            const dailyData = await cachedQuery(queryWithParams, dailyQuery, `${cacheKey}:daily`, evolutionTTL, dailyParams);

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
        WHERE ${LACLAE_SALES_FILTER} ${yearsFilter} ${dateFilter}
        GROUP BY L.LCAADC, L.LCMMDC
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC
      `;
            const monthlyParams = [...selectedYears, ...dateParams];
            const rows = await cachedQuery(queryWithParams, monthlyQuery, `${cacheKey}:monthly`, evolutionTTL, monthlyParams);
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
        handleRouteError(error, res, 'Error obteniendo evolución', 500);
    }
});

router.get('/recent-sales', verifyToken, async (req, res) => {
    try {
        const { vendedorCodes, limit = 20 } = req.query;
        const vendedorResult = buildVendedorFilter(vendedorCodes, 'L');
        const cacheKey = `dashboard:recent_sales:${vendedorCodes || 'ALL'}:${limit}`;

        const recentTTL = (!vendedorCodes || vendedorCodes === 'ALL') ? TTL.MEDIUM : TTL.SHORT;

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
      WHERE L.ANODOCUMENTO >= ${MIN_YEAR} ${vendedorResult}
      GROUP BY L.ANODOCUMENTO, L.MESDOCUMENTO, L.DIADOCUMENTO,
        L.CODIGOCLIENTEALBARAN, C.NOMBRECLIENTE, L.CODIGOVENDEDOR, L.SERIEDOCUMENTO
      ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC
      FETCH FIRST ${parseInt(limit)} ROWS ONLY
        `;

        const sales = await cachedQuery(query, sql, cacheKey, recentTTL);

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
        handleRouteError(error, res, 'Error obteniendo ventas', 500);
    }
});

router.get('/products-search', verifyToken, async (req, res) => {
    try {
        const { query: searchTerm, limit = 50 } = req.query;

        let whereClause = "WHERE 1=1";
        const params = [];
        if (searchTerm) {
            const term = searchTerm.toUpperCase().trim();
            whereClause += " AND (UPPER(DESCRIPCIONARTICULO) LIKE ? OR CODIGOARTICULO LIKE ?)";
            params.push(`%${term}%`, `%${term}%`);
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

        const cacheKey = `search:products:${searchTerm || 'all'}:${limit}`;
        const products = await cachedQuery(queryWithParams, sql, cacheKey, TTL.MEDIUM, params);

        res.json(products.map(p => ({
            code: p.CODE,
            name: p.NAME,
            family: p.FAMILY
        })));

    } catch (error) {
        logger.error(`Product search error: ${error.message}`);
        handleRouteError(error, res, 'Error searching products', 500);
    }
});

module.exports = router;
