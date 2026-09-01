const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const logger = require('../middleware/logger');
const { verifyToken } = require('../middleware/auth');
const { query, queryWithParams } = require('../config/db');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL, redisCache } = require('../services/redis-cache');
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
    getBSalesByVendor,
    aggregateBSalesByMonth,
    sanitizeForSQL,
    handleRouteError
} = require('../utils/common');
const {
    normalizeVendorCode,
    dashboardCodesMatch,
    isDashboardManager,
    dashboardVisibleVendorCodes,
    resolveDashboardVendedorCodes
} = require('../src/utils/dashboardScope');
const {
    buildVendedorFilterParameterized,
    buildVendedorFilterLACLAEParameterized
} = require('../src/utils/dashboardFilters');
const {
    metricsController,
    salesEvolutionController
} = require('../src/controllers/dashboard.controller');

const DASHBOARD_CACHE_VERSION = 'v20260602-b-sales-all';
const VOLATILE_CACHE_QUERY_KEYS = new Set(['forcerefresh', 'refresh', '_ts', 't', 'cachebust', 'cachebuster']);

function clampInt(value, defaultValue, min, max) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return defaultValue;
    return Math.max(min, Math.min(max, parsed));
}

function canonicalQueryKey(query, overrides = {}) {
    const merged = { ...(query || {}), ...overrides };
    return Object.keys(merged)
        .filter((key) => !VOLATILE_CACHE_QUERY_KEYS.has(String(key).toLowerCase()))
        .sort()
        .map((key) => `${key}=${String(merged[key] ?? '')}`)
        .join('&');
}

function hashValues(values) {
    const normalized = [...new Set((values || []).map((v) => String(v).trim()).filter(Boolean))]
        .sort()
        .join(',');
    return crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 16);
}

function isDashboardForceRefresh(req) {
    return req?.query?.forceRefresh != null ||
        req?.query?.refresh != null ||
        req?.query?._ts != null;
}

const DASHBOARD_FAMILY_DISTINCT_SQL = Object.freeze({
    family1: "SELECT DISTINCT TRIM(FI1) as CODE FROM DSEDAC.ART WHERE FI1 IS NOT NULL AND NOT (TRIM(FI1) = '')",
    family2: "SELECT DISTINCT TRIM(FI2) as CODE FROM DSEDAC.ART WHERE FI2 IS NOT NULL AND NOT (TRIM(FI2) = '')",
    family3: "SELECT DISTINCT TRIM(FI3) as CODE FROM DSEDAC.ART WHERE FI3 IS NOT NULL AND NOT (TRIM(FI3) = '')",
    family4: "SELECT DISTINCT TRIM(FI4) as CODE FROM DSEDAC.ART WHERE FI4 IS NOT NULL AND NOT (TRIM(FI4) = '')",
    family5: "SELECT DISTINCT TRIM(FI5) as CODE FROM DSEDAC.ART WHERE FI5 IS NOT NULL AND NOT (TRIM(FI5) = '')",
});

function buildBoundInSql(sqlPrefix, valueCount, sqlSuffix = ')') {
    const count = Number.parseInt(valueCount, 10);
    if (!Number.isInteger(count) || count < 1 || count > 2000) {
        throw new Error('Invalid bounded IN-list size');
    }
    return sqlPrefix + Array(count).fill('?').join(',') + sqlSuffix;
}

function buildFamilyDistinctSql(fiLevel) {
    const sql = DASHBOARD_FAMILY_DISTINCT_SQL[String(fiLevel || '').toLowerCase()];
    if (!sql) throw new Error('Invalid family hierarchy level');
    return sql;
}

router.get('/metrics', verifyToken, (req, res, next) => metricsController(req, res, next));

router.get('/matrix-data', verifyToken, async (req, res) => {
    try {
        let { vendedorCodes, groupBy = 'vendor', year, years, clientCodes, productCodes, familyCodes } = req.query;
        
        const scoped = resolveDashboardVendedorCodes(req, vendedorCodes);
        if (!scoped.ok) return res.status(scoped.status).json(scoped.body);
        vendedorCodes = scoped.vendedorCodes;
        
        const cacheKey = `dashboard:matrix:v3:${canonicalQueryKey(req.query, {
            vendedorCodes: vendedorCodes || 'ALL',
            userRole: req.user?.role || '',
            userCode: req.user?.code || req.user?.id || ''
        })}`;

        const cachedResult = isDashboardForceRefresh(req) ? null : await redisCache.get('matrix', cacheKey);
        if (cachedResult) {
            logger.info(`⚡ Cache hit: matrix-data`);
            res.set('X-Cache-Hit', 'true');
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
                const famProductsSql = buildBoundInSql('SELECT TRIM(CODIGOARTICULO) as CODE FROM DSEDAC.ART WHERE CODIGOFAMILIA IN (', fCodes.length);
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

        // Determine if we need ART table join
        const needsArtJoin = hierarchy.some(h =>
            ['product', 'productCode', 'productDesc', 'family', 'family1', 'family2', 'family3', 'family4', 'family5', 'subfamily'].includes(h)
        );

        hierarchy.forEach((level, index) => {
            const levelIdx = index + 1;
            if (level === 'vendor') {
                selectClauses.push(`RTRIM(${vendorColExpr}) as ID_${levelIdx}`);
                groupClauses.push(vendorColExpr);
            } else if (level === 'client') {
                selectClauses.push(`RTRIM(L.LCCDCL) as ID_${levelIdx}`);
                groupClauses.push('L.LCCDCL');
            } else if (level === 'product') {
                // Legacy: product code as ID, description as NAME (resolved later)
                selectClauses.push(`RTRIM(L.CODIGOARTICULO) as ID_${levelIdx}`);
                groupClauses.push('L.CODIGOARTICULO');
            } else if (level === 'productCode') {
                // Product code only (for hierarchy that separates code from description)
                selectClauses.push(`RTRIM(L.CODIGOARTICULO) as ID_${levelIdx}`);
                groupClauses.push('L.CODIGOARTICULO');
            } else if (level === 'productDesc') {
                // Product description as the hierarchy level
                selectClauses.push(`RTRIM(A.DESCRIPCIONARTICULO) as ID_${levelIdx}`);
                groupClauses.push('A.DESCRIPCIONARTICULO');
            } else if (level === 'family') {
                // Legacy: family code as ID, family name as NAME (resolved via product lookup)
                selectClauses.push(`RTRIM(L.CODIGOARTICULO) as ID_${levelIdx}`);
                groupClauses.push('L.CODIGOARTICULO');
            } else if (level === 'family1') {
                selectClauses.push(`COALESCE(NULLIF(TRIM(A.FI1), ''), 'Sin Familia 1') as ID_${levelIdx}`);
                groupClauses.push('A.FI1');
            } else if (level === 'family2') {
                selectClauses.push(`COALESCE(NULLIF(TRIM(A.FI2), ''), 'Sin Familia 2') as ID_${levelIdx}`);
                groupClauses.push('A.FI2');
            } else if (level === 'family3') {
                selectClauses.push(`COALESCE(NULLIF(TRIM(A.FI3), ''), 'Sin Familia 3') as ID_${levelIdx}`);
                groupClauses.push('A.FI3');
            } else if (level === 'family4') {
                selectClauses.push(`COALESCE(NULLIF(TRIM(A.FI4), ''), 'Sin Familia 4') as ID_${levelIdx}`);
                groupClauses.push('A.FI4');
            } else if (level === 'family5') {
                selectClauses.push(`COALESCE(NULLIF(TRIM(A.FI5), ''), 'Sin Familia 5') as ID_${levelIdx}`);
                groupClauses.push('A.FI5');
            } else if (level === 'subfamily') {
                selectClauses.push(`COALESCE(NULLIF(TRIM(A.CODIGOSUBFAMILIA), ''), 'General') as ID_${levelIdx}`);
                groupClauses.push('A.CODIGOSUBFAMILIA');
            }
        });

        selectClauses.push('SUM(L.LCIMVT) as SALES');
        selectClauses.push('SUM(L.LCIMVT - L.LCIMCT) as MARGIN');
        selectClauses.push('COUNT(DISTINCT L.LCNRAB) as ORDERS');

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
                const vendorNamesSql = buildBoundInSql('SELECT TRIM(CODIGOVENDEDOR) as CODE, TRIM(NOMBREVENDEDOR) as NAME FROM DSEDAC.VDD WHERE CODIGOVENDEDOR IN (', vCodes.length);
                nameLookups.push(lookup(
                    vendorNamesSql,
                    'names:vendors:' + hashValues(vCodes),
                    vCodes
                ).then(function (d) { return { type: 'vendor', data: d }; }));
            }
        }

        if (hierarchy.includes('client')) {
            const idx = hierarchy.indexOf('client') + 1;
            const cCodes = [...new Set(rawData.map(r => r[`ID_${idx}`]).filter(Boolean))];
            if (cCodes.length) {
                const codesToQuery = cCodes.slice(0, 2000);
                const clientNamesSql = buildBoundInSql("SELECT TRIM(CODIGOCLIENTE) as CODE, COALESCE(NULLIF(TRIM(NOMBREALTERNATIVO), ''), TRIM(NOMBRECLIENTE)) as NAME FROM DSEDAC.CLI WHERE CODIGOCLIENTE IN (", codesToQuery.length);
                nameLookups.push(lookup(
                    clientNamesSql,
                    'names:clients:' + hashValues(codesToQuery),
                    codesToQuery
                ).then(function (d) { return { type: 'client', data: d }; }));
            }
        }

        if (hierarchy.includes('product') || hierarchy.includes('productCode') || hierarchy.includes('productDesc') || hierarchy.includes('family')) {
            const prodIndices = [];
            hierarchy.forEach((h, i) => { if (['product', 'productCode', 'productDesc', 'family'].includes(h)) prodIndices.push(i + 1); });
            const productCodesSet = new Set();
            prodIndices.forEach(idx => rawData.forEach(r => { if (r[`ID_${idx}`]) productCodesSet.add(r[`ID_${idx}`]); }));

            const codesArr = [...productCodesSet].slice(0, 2000);
            if (codesArr.length > 0) {
                const placeholders = codesArr.map(() => '?').join(',');
                nameLookups.push(lookup(
                    `SELECT TRIM(A.CODIGOARTICULO) as CODE, TRIM(A.DESCRIPCIONARTICULO) as NAME, TRIM(A.CODIGOFAMILIA) as FAM_CODE, COALESCE(TRIM(F.DESCRIPCIONFAMILIA), TRIM(A.CODIGOFAMILIA)) as FAM_NAME
                     FROM DSEDAC.ART A LEFT JOIN DSEDAC.FAM F ON A.CODIGOFAMILIA = F.CODIGOFAMILIA
                     WHERE A.CODIGOARTICULO IN (${placeholders})`,
                    `names:products:${hashValues(codesArr)}`,
                    codesArr
                ).then(d => ({ type: 'art_mix', data: d })));
            }
        }

        // FI Family lookups (FI1-FI5) - get distinct values from ART for each family level
        const fiLevels = hierarchy.filter(h => h.startsWith('family') && h !== 'family');
        if (fiLevels.length > 0) {
            const fiLookupPromises = fiLevels.map(fiLevel => {
                const sql = buildFamilyDistinctSql(fiLevel);
                return lookup(sql, 'names:' + fiLevel.toLowerCase() + ':distinct').then(function (d) { return { type: fiLevel, data: d }; });
            });
            nameLookups.push(...fiLookupPromises);
        }

        const lookupResults = await Promise.all(nameLookups);

        const vendorMap = {};
        const clientMap = {};
        const productInfoMap = {};
        const fiFamilyNames = {}; // FI1, FI2, etc. -> code maps

        lookupResults.forEach(res => {
            if (res.type === 'vendor') res.data.forEach(x => vendorMap[x.CODE] = x.NAME || x.CODE);
            if (res.type === 'client') res.data.forEach(x => clientMap[x.CODE] = x.NAME || x.CODE);
            if (res.type === 'art_mix') res.data.forEach(x => productInfoMap[x.CODE] = { prodName: x.NAME, famCode: x.FAM_CODE, famName: x.FAM_NAME });
            // FI family levels: store distinct codes (they're already the display value)
            if (res.type.startsWith('family') && res.type !== 'family') {
                fiFamilyNames[res.type] = {};
                res.data.forEach(x => {
                    const code = x.CODE || 'Sin dato';
                    fiFamilyNames[res.type][code] = code;
                });
            }
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
                } else if (level === 'productCode') {
                    // Show code as both ID and name (code IS the display)
                    row[`NAME_${idx}`] = idVal;
                } else if (level === 'productDesc') {
                    // Description is already the ID from the query
                    row[`NAME_${idx}`] = idVal;
                } else if (level === 'family') {
                    const info = productInfoMap[idVal];
                    if (info) {
                        row[`ID_${idx}`] = info.famCode;
                        row[`NAME_${idx}`] = info.famName;
                    } else {
                        row[`ID_${idx}`] = 'UNK';
                        row[`NAME_${idx}`] = 'Unknown Family';
                    }
                } else if (level.startsWith('family') && level !== 'family') {
                    // FI1-FI5: ID is already the family value from the query
                    row[`NAME_${idx}`] = idVal || 'Sin dato';
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
        res.set('X-Cache-Hit', 'false');
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

router.get('/sales-evolution', verifyToken, (req, res, next) => salesEvolutionController(req, res, next));

router.get('/recent-sales', verifyToken, async (req, res) => {
    try {
        let { vendedorCodes } = req.query;
        const limit = clampInt(req.query.limit, 20, 1, 100);
        
        const scoped = resolveDashboardVendedorCodes(req, vendedorCodes);
        if (!scoped.ok) return res.status(scoped.status).json(scoped.body);
        vendedorCodes = scoped.vendedorCodes;

        const vendedorResult = buildVendedorFilterParameterized(vendedorCodes, 'L');
        const cacheKey = `dashboard:recent_sales:${vendedorCodes || 'ALL'}:${limit}`;

        const recentTTL = (!vendedorCodes || vendedorCodes === 'ALL') ? TTL.MEDIUM : TTL.SHORT;

        // "Recent sales" never needs the full 3-year window MIN_YEAR allows —
        // bounding to current-1 halves the rows DB2 must group+sort before FETCH FIRST.
        const recentSalesMinYear = new Date().getFullYear() - 1;

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
      WHERE L.ANODOCUMENTO >= ${recentSalesMinYear} ${vendedorResult.filter}
      GROUP BY L.ANODOCUMENTO, L.MESDOCUMENTO, L.DIADOCUMENTO,
        L.CODIGOCLIENTEALBARAN, C.NOMBRECLIENTE, L.CODIGOVENDEDOR, L.SERIEDOCUMENTO
      ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC
      FETCH FIRST ${limit} ROWS ONLY
        `;

        const sales = await cachedQuery(queryWithParams, sql, cacheKey, recentTTL, vendedorResult.params);

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
        const { query: searchTerm } = req.query;
        const limit = clampInt(req.query.limit, 50, 1, 100);

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
            FETCH FIRST ${limit} ROWS ONLY
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
