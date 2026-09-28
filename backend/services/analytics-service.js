'use strict';

/**
 * Analytics service — reglas de negocio de analytics.
 *
 * Logica movida verbatim desde backend/routes/analytics.js (sin cambios de
 * comportamiento ni de shapes JSON). Las rutas validan input/authZ, llaman aqui
 * y responden.
 *
 * TODO(DIP): recibir query/caches/tablas siempre por parametros en vez de
 * requires directos (patron actual del repo por tiempo).
 */

const { createHash } = require('crypto');
const {
    getCurrentDate,
    getVendorColumn,
    formatCurrency,
    MIN_YEAR,
    LACLAE_SALES_FILTER,
    sanitizeForSQL,
    sargableDocumentDateBound,
} = require('../utils/common');
const { TTL } = require('./redis-cache');
const { historicalYearsCacheMeta } = require('../src/services/dashboard.service.js');
const { buildVendedorFilterParameterized } = require('../src/utils/dashboardFilters');
const repo = require('../repositories/analytics-repository');

function asTrimmedText(value) {
    if (value == null) return '';
    return String(value).trim();
}

function calcGrowth(curr, prev) {
    return prev && prev !== 0 ? ((curr - prev) / prev) * 100 : 0;
}

function inputError(code, message) {
    const err = new Error(message);
    err.status = 400;
    err.code = code;
    return err;
}

async function getYoyComparison({ vendedorCodes, year, month }, deps = {}) {
    const tables = deps.tables || repo.resolveTables();
    const currentYear = parseInt(year) || getCurrentDate().getFullYear();
    const monthNum = month ? parseInt(month, 10) : 0;
    const monthFilter = monthNum >= 1 && monthNum <= 12 ? 'AND L.LCMMDC = ?' : '';
    const monthParams = monthNum >= 1 && monthNum <= 12 ? [monthNum] : [];
    const vendorFilter = buildVendedorFilterParameterized(
        vendedorCodes,
        'L',
        getVendorColumn(currentYear, monthNum || undefined),
    );
    const cacheKeyBase = `analytics:yoy:${currentYear}:${month || 'all'}:${vendedorCodes}`;

    const getData = (yr) => repo.fetchYoyYear({
        year: yr,
        monthParams,
        vendorParams: vendorFilter.params,
        monthFilter,
        vendorFilterClause: vendorFilter.filter,
        cacheKeyBase,
        tables,
    }, deps);

    const lastYr = currentYear - 1;
    const [currRows, prevRows] = await Promise.all([
        getData(currentYear),
        getData(lastYr),
    ]);
    const curr = currRows[0] || {};
    const prev = prevRows[0] || {};

    const currSales = parseFloat(curr.SALES) || 0;
    const prevSales = parseFloat(prev.SALES) || 0;
    const currMargin = parseFloat(curr.MARGIN) || 0;
    const prevMargin = parseFloat(prev.MARGIN) || 0;

    return {
        currentYear: {
            year: currentYear,
            sales: formatCurrency(currSales),
            margin: formatCurrency(currMargin),
            boxes: 0,
        },
        lastYear: {
            year: lastYr,
            sales: formatCurrency(prevSales),
            margin: formatCurrency(prevMargin),
            boxes: 0,
        },
        currentPeriod: { year: currentYear, sales: formatCurrency(currSales) },
        previousPeriod: { year: lastYr, sales: formatCurrency(prevSales) },
        growth: {
            salesPercent: Math.round(calcGrowth(currSales, prevSales) * 10) / 10,
            salesGrowth: Math.round(calcGrowth(currSales, prevSales) * 10) / 10,
            marginPercent: Math.round(calcGrowth(currMargin, prevMargin) * 10) / 10,
        },
    };
}

async function getTopClients({ vendedorCodes, year, month, limit = 10 }, deps = {}) {
    const tables = deps.tables || repo.resolveTables();
    const yearNum = year ? parseInt(year, 10) : 0;
    const monthNum = month ? parseInt(month, 10) : 0;
    const dateParams = [];
    let dateFilter = '';
    if (yearNum) {
        dateFilter += ' AND L.LCAADC = ?';
        dateParams.push(yearNum);
    }
    if (monthNum >= 1 && monthNum <= 12) {
        dateFilter += ' AND L.LCMMDC = ?';
        dateParams.push(monthNum);
    }
    const vendorFilter = buildVendedorFilterParameterized(
        vendedorCodes,
        'L',
        getVendorColumn(yearNum || undefined, monthNum || undefined),
    );

    const safeLimit = parseInt(limit, 10) || 10;
    const sql = repo.topClientsSql(tables, dateFilter, vendorFilter.filter, safeLimit);

    const now = getCurrentDate();
    const yearMeta = historicalYearsCacheMeta([year || now.getFullYear()], now);
    const cacheKey = `analytics:top_clients:${yearMeta.bucket}:${year || 'current'}:${month || 'all'}:${vendedorCodes || 'ALL'}:${limit}`;
    const topClients = await repo.fetchTopClients({
        sql,
        params: [...dateParams, ...vendorFilter.params],
        cacheKey,
        ttl: yearMeta.ttl,
    }, deps);

    if (!Array.isArray(topClients) || topClients.length === 0) {
        return { clients: [] };
    }

    const enhancedClients = topClients
        .map((c) => {
            const code = (c.CODE ?? c.code ?? '').toString().trim();
            if (!code) return null;

            return {
                code,
                name: (c.NAME ?? c.name ?? '').toString().trim() || `Cliente ${code}`,
                city: (c.CITY ?? c.city ?? '').toString().trim(),
                totalSales: formatCurrency(c.TOTALSALES ?? c.totalSales ?? 0),
                year: year || new Date().getFullYear(),
            };
        })
        .filter(Boolean);

    return { clients: enhancedClients };
}

async function getTrends({ vendedorCodes }, deps = {}) {
    const tables = deps.tables || repo.resolveTables();
    const vendorFilter = buildVendedorFilterParameterized(
        vendedorCodes,
        'L',
        getVendorColumn(),
    );

    const history = await repo.fetchTrends({
        vendorParams: vendorFilter.params,
        vendorFilterClause: vendorFilter.filter,
        cacheKey: `analytics:trends:${vendedorCodes}`,
        tables,
    }, deps);

    // Simple prediction logic
    let trend = 'stable';
    const sales = history.map((h) => parseFloat(h.SALES)).reverse(); // Chronological order
    if (sales.length >= 2) {
        if (sales[sales.length - 1] > sales[0] * 1.1) trend = 'upward';
        else if (sales[sales.length - 1] < sales[0] * 0.9) trend = 'downward';
    }

    // Generate basic predictions
    const lastMonth = sales.length > 0 ? sales[sales.length - 1] : 0;
    const predictions = [
        { period: 'Next +1', predictedSales: lastMonth * (trend === 'upward' ? 1.05 : 0.95), confidence: 0.75 },
        { period: 'Next +2', predictedSales: lastMonth * (trend === 'upward' ? 1.10 : 0.90), confidence: 0.60 },
        { period: 'Next +3', predictedSales: lastMonth * (trend === 'upward' ? 1.15 : 0.85), confidence: 0.45 },
    ];

    return { trend, predictions };
}

async function getTopProducts({ vendedorCodes, limit = 20, year: rawYear }, deps = {}) {
    const tables = deps.tables || repo.resolveTables();
    const now = getCurrentDate();
    const year = parseInt(rawYear, 10) || now.getFullYear();
    const vendorFilter = buildVendedorFilterParameterized(vendedorCodes, 'L', 'CODIGOVENDEDOR');
    const safeLimit = parseInt(limit, 10) || 20;

    const products = await repo.fetchTopProducts({
        year,
        vendorParams: vendorFilter.params,
        vendorFilterClause: vendorFilter.filter,
        cacheKey: `analytics:top_products:${year}:${vendedorCodes}:${limit}`,
        ttl: (deps.TTL || TTL).MEDIUM,
        safeLimit,
        tables,
    }, deps);

    return {
        year,
        products: products.map((p) => ({
            code: p.CODE?.trim(),
            name: p.NAME?.trim(),
            brand: p.BRAND?.trim(),
            family: p.FAMILY?.trim(),
            totalSales: formatCurrency(p.TOTALSALES),
            totalMargin: formatCurrency(p.TOTALMARGIN),
            marginPercent: p.TOTALSALES > 0 ? Math.round((p.TOTALMARGIN / p.TOTALSALES) * 1000) / 10 : 0,
            totalBoxes: parseInt(p.TOTALBOXES) || 0,
            totalUnits: parseInt(p.TOTALUNITS) || 0,
            numClients: parseInt(p.NUMCLIENTS) || 0,
        })),
    };
}

async function getMargins({ vendedorCodes, year: rawYear }, deps = {}) {
    const tables = deps.tables || repo.resolveTables();
    const now = getCurrentDate();
    const year = parseInt(rawYear, 10) || now.getFullYear();
    const vendorFilter = buildVendedorFilterParameterized(vendedorCodes, '', 'CODIGOVENDEDOR');
    const vendorFilterAliased = buildVendedorFilterParameterized(vendedorCodes, 'L', 'CODIGOVENDEDOR');

    const cacheKey = `analytics:margins:${year}:${vendedorCodes}`;

    const [monthlyMargins, familyMargins] = await repo.fetchMargins({
        year,
        vendorParams: vendorFilter.params,
        vendorAliasedParams: vendorFilterAliased.params,
        vendorFilterClause: vendorFilter.filter,
        vendorAliasedClause: vendorFilterAliased.filter,
        cacheKey,
        ttl: (deps.TTL || TTL).MEDIUM,
        tables,
    }, deps);

    return {
        year,
        monthlyMargins: monthlyMargins.map((m) => ({
            month: m.MONTH,
            sales: formatCurrency(m.SALES),
            margin: formatCurrency(m.MARGIN),
            marginPercent: m.SALES > 0 ? Math.round((m.MARGIN / m.SALES) * 1000) / 10 : 0,
        })),
        familyMargins: familyMargins.map((f) => ({
            family: f.FAMILY?.trim() || 'Sin familia',
            sales: formatCurrency(f.SALES),
            margin: formatCurrency(f.MARGIN),
            marginPercent: f.SALES > 0 ? Math.round((f.MARGIN / f.SALES) * 1000) / 10 : 0,
        })),
    };
}

async function getSalesHistory({
    requestedScope, clientCode, productSearch, startDate, endDate, limit = 100, offset = 0, user,
}, deps = {}) {
    const tables = deps.tables || repo.resolveTables();
    const vendorFilter = buildVendedorFilterParameterized(
        requestedScope === 'ALL' ? 'ALL' : requestedScope.join(','),
        'L',
        'CODIGOVENDEDOR',
    );
    let whereClause = `WHERE 1=1 ${vendorFilter.filter}`;
    const whereParams = [...vendorFilter.params];

    // Filter by Client - safe interpolation
    if (clientCode) {
        const safeClientCode = clientCode.trim().replace(/[^a-zA-Z0-9]/g, '');
        whereClause += ' AND L.CODIGOCLIENTEALBARAN = ?';
        whereParams.push(safeClientCode);
    }

    // Filter by Product (Code or Description) or Batch/Reference - safe interpolation
    if (productSearch) {
        const safeTerm = sanitizeForSQL(productSearch.toUpperCase().trim()).replace(/[%_\\]/g, '');
        whereClause += ' AND (UPPER(L.DESCRIPCION) LIKE ? OR L.CODIGOARTICULO LIKE ? OR CHAR(L.REFERENCIADOCUMENTO) LIKE ?)';
        const searchPattern = `%${safeTerm}%`;
        whereParams.push(searchPattern, searchPattern, searchPattern);
    }

    // Filter by Date Range (YYYY-MM-DD), sargable on ANO/MES/DIA.
    if (startDate) {
        const startBound = sargableDocumentDateBound('gte', startDate);
        if (!startBound) {
            throw inputError('INVALID_DATE', 'startDate debe ser YYYY-MM-DD');
        }
        whereClause += ` AND ${startBound.sql}`;
        whereParams.push(...startBound.params);
    }

    if (endDate) {
        const endBound = sargableDocumentDateBound('lte', endDate);
        if (!endBound) {
            throw inputError('INVALID_DATE', 'endDate debe ser YYYY-MM-DD');
        }
        whereClause += ` AND ${endBound.sql}`;
        whereParams.push(...endBound.params);
    } else {
        whereClause += ' AND L.ANODOCUMENTO >= ?';
        whereParams.push(MIN_YEAR);
    }

    const querySql = repo.salesHistorySql(tables, whereClause, offset, limit);

    // Hash the effective SQL, all binds and authenticated scope. Unlike a
    // delimited key, this cannot confuse search/client values or pagination.
    // No raw identity or search data is exposed in cache logs.
    const cacheKey = `analytics:sales-history:v2:${createHash('sha256')
        .update(JSON.stringify([
            user?.id ?? user?.code ?? null,
            user?.company ?? null,
            user?.role ?? null,
            user?.vendorCodes ?? [],
            user?.vendedorCodes ?? [],
            querySql,
            whereParams,
        ]))
        .digest('hex')}`;
    const rows = await repo.fetchSalesHistory({
        whereClause,
        whereParams,
        offset,
        limit,
        cacheKey,
        // 5-minute normal TTL; retain the helper's existing stale fallback.
        ttl: (deps.TTL || TTL).SHORT,
        queryType: 'sales-history',
        tables,
    }, deps);

    // Format for frontend
    const formattedRows = rows.map((r) => ({
        date: `${r.YEAR}-${String(r.MONTH).padStart(2, '0')}-${String(r.DAY).padStart(2, '0')}`,
        year: r.YEAR,
        month: r.MONTH,
        clientCode: asTrimmedText(r.CLIENTCODE),
        productCode: asTrimmedText(r.PRODUCTCODE),
        productName: asTrimmedText(r.PRODUCTNAME),
        price: formatCurrency(r.PRICE),
        quantity: parseFloat(r.QUANTITY) || 0,
        total: formatCurrency(r.TOTAL),
        lote: asTrimmedText(r.LOTE),
        ref: asTrimmedText(r.REF),
        invoice: asTrimmedText(r.INVOICE),
        family: asTrimmedText(r.FAMILY),
        subfamily: asTrimmedText(r.SUBFAMILY) || 'General',
        fi1: asTrimmedText(r.FI1),
        fi2: asTrimmedText(r.FI2),
        fi3: asTrimmedText(r.FI3),
        fi4: asTrimmedText(r.FI4),
        fi5: asTrimmedText(r.FI5),
    }));

    return {
        rows: formattedRows,
        count: formattedRows.length,
        limit: parseInt(limit),
        offset: parseInt(offset),
    };
}

async function getSalesHistorySummary({ vendedorCodes, clientCode, productSearch, startDate, endDate }, deps = {}) {
    const tables = deps.tables || repo.resolveTables();
    const vendorFilter = buildVendedorFilterParameterized(vendedorCodes, 'L', 'LCCDVD');

    const extraParams = [];
    const clientFilter = clientCode ? 'AND L.LCCDCL = ?' : '';
    if (clientCode) extraParams.push(String(clientCode).trim());
    const searchFilter = productSearch
        ? 'AND (UPPER(L.LCDESC) LIKE UPPER(?) OR TRIM(L.LCCDRF) LIKE ?)'
        : '';
    if (productSearch) {
        const like = `%${String(productSearch).trim()}%`;
        extraParams.push(like, like);
    }

    // Helper to query LACLAE
    const getStats = async (year) => repo.fetchSalesSummaryStats({
        year,
        vendorParams: vendorFilter.params,
        extraParams,
        vendorFilterClause: vendorFilter.filter,
        clientFilter,
        searchFilter,
        tables,
    }, deps);

    // Helper for Year Breakdown
    const getYearBreakdown = async (startYear, endYear) => repo.fetchSalesSummaryYearBreakdown({
        startYear,
        endYear,
        vendorParams: vendorFilter.params,
        extraParams,
        vendorFilterClause: vendorFilter.filter,
        clientFilter,
        searchFilter,
        tables,
    }, deps);

    // Helper for Monthly Breakdown (Current vs Last Year)
    const getMonthlyBreakdown = async (year, prevYear) => {
        const rows = await repo.fetchSalesSummaryMonthlyBreakdown({
            year,
            prevYear,
            vendorParams: vendorFilter.params,
            extraParams,
            vendorFilterClause: vendorFilter.filter,
            clientFilter,
            searchFilter,
            tables,
        }, deps);

        // Merge rows into Month objects
        const months = {};
        for (let i = 1; i <= 12; i++) months[i] = { month: i, current: 0, previous: 0 };

        rows.forEach((r) => {
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
        getMonthlyBreakdown(currentYear, previousYear),
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

    const calcSummaryGrowth = (c, p) => ((p && p !== 0) ? ((c - p) / p) * 100 : (c > 0 ? 100 : 0));

    return {
        isNewClient,
        current: {
            sales: currSales,
            margin: currMargin,
            units: currUnits,
            productCount: currProducts,
            label: `${currentYear}`,
        },
        previous: {
            sales: prevSales,
            margin: prevMargin,
            units: prevUnits,
            productCount: prevProducts,
            label: `${previousYear}`,
        },
        growth: {
            sales: calcSummaryGrowth(currSales, prevSales),
            margin: currMargin - prevMargin, // Difference in percentage points
            units: calcSummaryGrowth(currUnits, prevUnits),
            productCount: calcSummaryGrowth(currProducts, prevProducts),
        },
        breakdown: breakdown.map((b) => ({
            year: b.YEAR,
            sales: parseFloat(b.SALES || 0),
            margin: parseFloat(b.MARGIN || 0),
            units: parseFloat(b.UNITS || 0),
        })),
        monthlyBreakdown, // array of { month, current, previous }
    };
}

module.exports = {
    getYoyComparison,
    getTopClients,
    getTrends,
    getTopProducts,
    getMargins,
    getSalesHistory,
    getSalesHistorySummary,
};
