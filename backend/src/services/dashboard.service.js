'use strict';

const logger = require('../../middleware/logger');
const { getCurrentDate, LACLAE_SALES_FILTER, aggregateBSalesByMonth } = require('../../utils/common');
const { TTL, redisCache } = require('../../services/redis-cache');
const { beginRouteFill, endRouteFill } = require('../../services/route-cache-stampede');
const { buildVendedorFilterParameterized } = require('../utils/dashboardFilters');
const { comercialErpTable } = require('../../utils/comercial-erp-tables');
const { getMadridDateParts } = require('../utils/dashboard-date');

const DASHBOARD_CACHE_VERSION = 'v20260929-sales-today-gross-alert-v2';
const CLOSED_YEAR_TTL_SECONDS = 7 * 24 * 3600;
const OPEN_MONTH_TTL_SECONDS = 10 * 60;

function isCompanyWideVendorScope(vendedorCodes) {
    return typeof vendedorCodes === 'string' && vendedorCodes.trim().toUpperCase() === 'ALL';
}

function assertVendorScope(vendedorCodes) {
    if (typeof vendedorCodes === 'string' && vendedorCodes.trim().length > 0) return;
    const error = new Error('DASHBOARD_VENDOR_SCOPE_REQUIRED');
    error.statusCode = 403;
    error.code = 'DASHBOARD_VENDOR_SCOPE_REQUIRED';
    throw error;
}

function historicalYearsCacheMeta(years, now = getCurrentDate()) {
    const nowYear = getMadridDateParts(now).year;
    const list = (Array.isArray(years) ? years : [years])
        .map((year) => parseInt(year, 10))
        .filter((year) => Number.isFinite(year));
    const hasOpen = list.length === 0 || list.some((year) => year >= nowYear);
    return {
        bucket: hasOpen ? 'open' : 'closed',
        ttl: hasOpen ? OPEN_MONTH_TTL_SECONDS : CLOSED_YEAR_TTL_SECONDS,
    };
}

/**
 * Logica de negocio de dashboard. Cero SQL aqui: el acceso a datos vive en
 * DashboardRepository (inyectado por constructor para tests con mocks).
 * getMetrics se descompone en pasos con un unico proposito cada uno.
 */
class DashboardService {
    /**
     * @param {object} deps
     * @param {import('../repositories/dashboard.repository').DashboardRepository} deps.repository
     * @param {object} [deps.cache] contrato {TTL,get,set}
     */
    constructor({ repository, cache, clock = getCurrentDate }) {
        this._repo = repository;
        this._cache = cache; // { TTL, get, set }
        this._clock = clock;
    }

    /** Paso 1: resolver periodo efectivo y claves de cache. */
    _resolvePeriod(vendedorCodes, yearRaw, monthRaw, asOf = this._clock()) {
        const now = asOf instanceof Date ? new Date(asOf.getTime()) : new Date(asOf);
        const madrid = getMadridDateParts(now);
        const year = parseInt(yearRaw) || madrid.year;
        const month = parseInt(monthRaw) || madrid.month;
        const cacheKey = `dashboard:metrics:${DASHBOARD_CACHE_VERSION}:${year}:${month || 'all'}:${isCompanyWideVendorScope(vendedorCodes) ? 'ALL' : vendedorCodes}`;
        const isAllVendors = isCompanyWideVendorScope(vendedorCodes);
        const isCurrentPeriod = year === madrid.year && month === madrid.month;
        const todayKey = isCurrentPeriod
            ? madrid.dateKey
            : null;
        const currentMeta = historicalYearsCacheMeta([year], now);
        const prevMeta = historicalYearsCacheMeta([year - 1], now);
        return {
            now,
            madrid,
            year,
            month,
            cacheKey,
            isAllVendors,
            isCurrentPeriod,
            currentTTL: currentMeta.ttl,
            prevTTL: prevMeta.ttl,
            todayCacheKey: todayKey ? `${cacheKey}:today:${todayKey}` : null,
            responseCacheKey: `${cacheKey}:response${todayKey ? `:day:${todayKey}` : ''}`,
            cacheScope: vendedorCodes || 'ALL',
        };
    }

    /** Paso 2: KPIs agregados del periodo corriente y del mismo mes ano anterior. */
    _fetchPeriodAggregates(ctx, vendorFilter, vendorParams) {
        const currentDataSql = `
          SELECT
            COALESCE(SUM(L.LCIMVT), 0) as sales,
            COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) as margin,
            COALESCE(SUM(L.LCCTEV), 0) as boxes,
            COUNT(DISTINCT L.LCCDCL) as activeClients
          FROM ${comercialErpTable('LACLAE')} L
          WHERE L.LCAADC = ?
            AND L.LCMMDC = ?
            AND ${LACLAE_SALES_FILTER}
            ${vendorFilter}
        `;
        const lastDataSql = `
          SELECT
            COALESCE(SUM(L.LCIMVT), 0) as sales,
            COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) as margin,
            COALESCE(SUM(L.LCCTEV), 0) as boxes
          FROM ${comercialErpTable('LACLAE')} L
          WHERE L.LCAADC = ?
            AND L.LCMMDC = ?
            AND ${LACLAE_SALES_FILTER}
            ${vendorFilter}
        `;
        return Promise.all([
            this._repo.fetchPeriodAggregate(currentDataSql, [ctx.year, ctx.month, ...vendorParams], `${ctx.cacheKey}:curr`, ctx.currentTTL),
            this._repo.fetchPeriodAggregate(lastDataSql, [ctx.year - 1, ctx.month, ...vendorParams], `${ctx.cacheKey}:prev`, ctx.prevTTL),
        ]);
    }

    /** Paso 3: ventas de hoy (solo si el periodo solicitado es el actual). */
    async _computeTodaySales(ctx, vendorFilter, vendorParams) {
        if (!ctx.isCurrentPeriod) {
            return {
                todaySales: 0,
                todaySalesGross: 0,
                todaySalesFiltered: 0,
                todaySalesGap: 0,
                todayOrders: 0,
                todayOrdersFiltered: 0,
                todayDocumentsGross: 0,
                todayDocumentsFiltered: 0,
                todayClients: 0,
                todayClientsFiltered: 0,
            };
        }
        // Ventas Hoy conserva el bruto documental. El equivalente del filtro
        // histórico queda separado para que la diferencia sea auditable.
        const documentKey = `L.LCSBAB || DIGITS(L.LCYEAB) || L.LCSRAB || DIGITS(L.LCTRAB) || DIGITS(L.LCNRAB)`;
        const todayDataSql = `
                SELECT
                  COALESCE(SUM(L.LCIMVT), 0) as sales,
                  COALESCE(SUM(CASE WHEN ${LACLAE_SALES_FILTER} THEN L.LCIMVT ELSE 0 END), 0) as filteredSales,
                  COUNT(DISTINCT ${documentKey}) as documents,
                  COUNT(DISTINCT CASE WHEN ${LACLAE_SALES_FILTER} THEN ${documentKey} END) as filteredDocuments,
                  COUNT(DISTINCT CASE WHEN ${LACLAE_SALES_FILTER} THEN L.LCNRAB END) as legacyFilteredOrders,
                  COUNT(DISTINCT L.LCCDCL) as clients,
                  COUNT(DISTINCT CASE WHEN ${LACLAE_SALES_FILTER} THEN L.LCCDCL END) as filteredClients
                FROM ${comercialErpTable('LACLAE')} L
                WHERE L.LCAADC = ? AND L.LCMMDC = ? AND L.LCDDDC = ? ${vendorFilter}
        `;
        const params = [ctx.year, ctx.month, ctx.madrid.day, ...vendorParams];
        const rows = await this._repo.fetchPeriodAggregate(todayDataSql, params, ctx.todayCacheKey, TTL.SHORT);
        const td = rows[0] || {};
        const todaySalesGross = parseFloat(td.SALES ?? td.sales) || 0;
        const todaySalesFiltered = parseFloat(td.FILTEREDSALES ?? td.filteredSales) || 0;
        return {
            // Las apps ya instaladas leen todaySales. La hoja de ruta es el
            // bruto documental; el filtro histórico queda en todaySalesFiltered.
            todaySales: todaySalesGross,
            todaySalesGross,
            todaySalesFiltered,
            todaySalesGap: Number((todaySalesGross - todaySalesFiltered).toFixed(2)),
            todayOrders: parseInt(td.LEGACYFILTEREDORDERS ?? td.legacyFilteredOrders) || 0,
            todayOrdersFiltered: parseInt(td.LEGACYFILTEREDORDERS ?? td.legacyFilteredOrders) || 0,
            todayDocumentsGross: parseInt(td.DOCUMENTS ?? td.documents) || 0,
            todayDocumentsFiltered: parseInt(td.FILTEREDDOCUMENTS ?? td.filteredDocuments) || 0,
            todayClients: parseInt(td.CLIENTS ?? td.clients) || 0,
            todayClientsFiltered: parseInt(td.FILTEREDCLIENTS ?? td.filteredClients) || 0,
        };
    }

    /** Paso 4: normalizar filas crudas DB2 (columnas upper/lower) a numeros. */
    _normalizeAggregates(rawCurr, rawLast) {
        const pick = (obj, key) => obj[key.toUpperCase()] ?? obj[key.toLowerCase()] ?? obj[key];
        return {
            curr: {
                SALES: pick(rawCurr, 'sales'),
                MARGIN: pick(rawCurr, 'margin'),
                BOXES: pick(rawCurr, 'boxes'),
                ACTIVECLIENTS: pick(rawCurr, 'activeClients') ?? pick(rawCurr, 'activeclients'),
            },
            last: {
                SALES: pick(rawLast, 'sales'),
                MARGIN: pick(rawLast, 'margin'),
                BOXES: pick(rawLast, 'boxes'),
            },
        };
    }

    /** Paso 5: sumar ventas B del periodo a las ventas A. */
    async _enrichWithBSales(vendedorCodes, year, month, curr, last) {
        const bSalesScope = vendedorCodes && !isCompanyWideVendorScope(vendedorCodes) ? vendedorCodes : [];
        const [bSalesCurrByVendor, bSalesLastByVendor] = await Promise.all([
            this._repo.fetchBSalesByVendor(year, bSalesScope),
            this._repo.fetchBSalesByVendor(year - 1, bSalesScope),
        ]);
        const bSalesCurrByMonth = aggregateBSalesByMonth(bSalesCurrByVendor);
        const bSalesLastByMonth = aggregateBSalesByMonth(bSalesLastByVendor);
        return {
            currentSales: (parseFloat(curr.SALES) || 0) + (bSalesCurrByMonth[month] || 0),
            lastSales: (parseFloat(last.SALES) || 0) + (bSalesLastByMonth[month] || 0),
        };
    }

    /** Paso 6: construir payload final con variaciones y tendencias. */
    _buildMetricsPayload(period, curr, last, salesTotals, todayInfo, todayContractDate) {
        const calcVar = (currVal, prev) => prev && prev !== 0 ? ((currVal - prev) / prev) * 100 : 0;
        const growthPercent = calcVar(salesTotals.currentSales, salesTotals.lastSales);
        return {
            period,
            totalSales: salesTotals.currentSales,
            totalBoxes: parseFloat(curr.BOXES) || 0,
            totalOrders: todayInfo.todayOrders || 0,
            totalMargin: parseFloat(curr.MARGIN) || 0,
            uniqueClients: parseInt(curr.ACTIVECLIENTS) || 0,
            avgOrderValue: todayInfo.todayOrders > 0 ? todayInfo.todaySales / todayInfo.todayOrders : 0,
            todaySales: todayInfo.todaySales,
            todaySalesGross: todayInfo.todaySalesGross,
            todaySalesFiltered: todayInfo.todaySalesFiltered,
            todaySalesGap: todayInfo.todaySalesGap,
            todayOrders: todayInfo.todayOrders,
            todayOrdersFiltered: todayInfo.todayOrdersFiltered,
            todayDocumentsGross: todayInfo.todayDocumentsGross,
            todayDocumentsFiltered: todayInfo.todayDocumentsFiltered,
            todayClients: todayInfo.todayClients,
            todayClientsFiltered: todayInfo.todayClientsFiltered,
            todayContractDate,
            lastMonthSales: salesTotals.lastSales,
            growthPercent: Math.round(growthPercent * 10) / 10,
            sales: {
                value: salesTotals.currentSales,
                variation: growthPercent,
                trend: salesTotals.currentSales >= salesTotals.lastSales ? 'up' : 'down'
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
    }

    /**
     * KPIs del periodo con comparativa mes anterior y ventas B.
     * @returns {Promise<{payload:Object, fromCache:boolean, cacheScope:string}>}
     */
    async getMetrics(vendedorCodes, { year, month }, { forceRefresh = false, asOf } = {}) {
        assertVendorScope(vendedorCodes);
        const ctx = this._resolvePeriod(vendedorCodes, year, month, asOf || this._clock());

        if (!forceRefresh) {
            const cachedResponse = await this._cache.get('dashboard', ctx.responseCacheKey);
            if (cachedResponse) {
                return { payload: cachedResponse, fromCache: true, cacheScope: ctx.cacheScope };
            }
        }

        let stampede = { fill: true, lock: null, busy: false, hit: null };
        if (!forceRefresh && redisCache.isConnected) {
            stampede = await beginRouteFill(ctx.responseCacheKey, { namespace: 'dashboard' });
            if (stampede.hit) {
                return { payload: stampede.hit, fromCache: true, cacheScope: ctx.cacheScope };
            }
            if (stampede.busy) {
                const error = new Error('ROUTE_FILL_BUSY');
                error.statusCode = 503;
                error.code = 'ROUTE_FILL_BUSY';
                throw error;
            }
        }

        try {
            const vendor = buildVendedorFilterParameterized(vendedorCodes);
            // _computeTodaySales does not depend on period aggregates — run in parallel
            // instead of paying its latency serially before B-sales enrichment.
            const [aggregateRows, todayInfo] = await Promise.all([
                this._fetchPeriodAggregates(ctx, vendor.filter, vendor.params),
                this._computeTodaySales(ctx, vendor.filter, vendor.params),
            ]);
            const [currentRows, lastRows] = aggregateRows;
            const { curr, last } = this._normalizeAggregates(currentRows[0] || {}, lastRows[0] || {});
            const salesTotals = await this._enrichWithBSales(vendedorCodes, ctx.year, ctx.month, curr, last);
            const payload = this._buildMetricsPayload(
                { year: ctx.year, month: ctx.month },
                curr,
                last,
                salesTotals,
                todayInfo,
                ctx.isCurrentPeriod ? ctx.madrid.dateKey : null,
            );

            await this._cache.set('dashboard', ctx.responseCacheKey, payload, ctx.currentTTL);
            return { payload, fromCache: false, cacheScope: ctx.cacheScope };
        } finally {
            await endRouteFill(ctx.responseCacheKey, stampede.lock, { namespace: 'dashboard' });
        }
    }

    /** Canon DB2 independiente y sin cache para la alerta de discrepancia. */
    async getTodayGrossAudit(vendedorCodes, asOf) {
        assertVendorScope(vendedorCodes);
        if (!isCompanyWideVendorScope(vendedorCodes)) {
            const error = new Error('DASHBOARD_AUDIT_SCOPE_FORBIDDEN');
            error.statusCode = 403;
            error.code = 'DASHBOARD_AUDIT_SCOPE_FORBIDDEN';
            throw error;
        }
        const madrid = getMadridDateParts(asOf || this._clock());
        const documentKey = `L.LCSBAB || DIGITS(L.LCYEAB) || L.LCSRAB || DIGITS(L.LCTRAB) || DIGITS(L.LCNRAB)`;
        const sql = `
          SELECT COALESCE(SUM(L.LCIMVT), 0) AS sales,
                 COUNT(DISTINCT ${documentKey}) AS documents
          FROM ${comercialErpTable('LACLAE')} L
          WHERE L.LCAADC = ? AND L.LCMMDC = ? AND L.LCDDDC = ?
        `;
        const rows = await this._repo.fetchDailyGrossAudit(sql, [madrid.year, madrid.month, madrid.day]);
        const row = rows?.[0] || {};
        return {
            date: madrid.dateKey,
            sales: Number(row.SALES ?? row.sales ?? 0),
            documents: Number(row.DOCUMENTS ?? row.documents ?? 0),
        };
    }

    /**
     * Evolucion de ventas mensual/semanal.
     * @returns {Promise<Array<Object>>} filas de evolucion ya limitadas a `months`
     */
    async getSalesEvolution(vendedorCodes, { years, granularity = 'month', upToToday = 'false', months = 36 } = {}) {
        assertVendorScope(vendedorCodes);
        const now = getCurrentDate();
        const madrid = getMadridDateParts(now);
        const selectedYears = years
            ? years.split(',').map(y => parseInt(y.trim()))
            : [madrid.year, madrid.year - 1, madrid.year - 2];

        const yearsFilter = `AND L.LCAADC IN (${selectedYears.map(() => '?').join(',')})`;
        const vendorResult = buildVendedorFilterParameterized(vendedorCodes, 'L');
        let dateFilter = '';
        let dateParams = [];
        if (upToToday === 'true') {
            const currentMonth = madrid.month;
            const currentDay = madrid.day;
            dateFilter = `AND (L.LCAADC < ? OR (L.LCAADC = ? AND L.LCMMDC < ?) OR (L.LCAADC = ? AND L.LCMMDC = ? AND L.LCDDDC <= ?))`;
            dateParams = [madrid.year, madrid.year, currentMonth, madrid.year, currentMonth, currentDay];
        }

        const yearMeta = historicalYearsCacheMeta(selectedYears, now);
        const cacheKey = `dashboard:evolution:${DASHBOARD_CACHE_VERSION}:${years || 'default'}:${granularity}:${upToToday}:${isCompanyWideVendorScope(vendedorCodes) ? 'ALL' : vendedorCodes}:${yearMeta.bucket}`;
        const evolutionTTL = yearMeta.ttl;

        let resultData = [];
        if (granularity === 'week') {
            resultData = await this._fetchWeeklyEvolution(selectedYears, yearsFilter, vendorResult, dateFilter, dateParams, cacheKey, evolutionTTL);
        } else {
            resultData = await this._fetchMonthlyEvolution(selectedYears, yearsFilter, vendorResult, dateFilter, dateParams, cacheKey, evolutionTTL, vendedorCodes);
        }

        logger.debug?.(`[DashboardService] evolution rows=${resultData.length}`);
        return resultData.slice(0, parseInt(months) || 36);
    }

    _fetchDailyEvolutionRows(selectedYears, yearsFilter, vendorResult, dateFilter, dateParams, cacheKey, ttl) {
        const dailyQuery = `
        SELECT L.LCAADC as year, L.LCMMDC as month, L.LCDDDC as day,
               SUM(L.LCIMVT) as sales,
               COUNT(DISTINCT L.LCNRAB) as orders,
               COUNT(DISTINCT L.LCCDCL) as clients
        FROM ${comercialErpTable('LACLAE')} L
        WHERE ${LACLAE_SALES_FILTER} ${yearsFilter} ${vendorResult.filter} ${dateFilter}
        GROUP BY L.LCAADC, L.LCMMDC, L.LCDDDC
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC, L.LCDDDC DESC
      `;
        const dailyParams = [...selectedYears, ...vendorResult.params, ...dateParams];
        return this._repo.fetchPeriodAggregate(dailyQuery, dailyParams, `${cacheKey}:daily`, ttl);
    }

    async _fetchWeeklyEvolution(selectedYears, yearsFilter, vendorResult, dateFilter, dateParams, cacheKey, evolutionTTL) {
        const dailyData = await this._fetchDailyEvolutionRows(selectedYears, yearsFilter, vendorResult, dateFilter, dateParams, cacheKey, evolutionTTL);
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
        return Object.values(weeklyMap).sort((a, b) => (b.year * 100 + b.week) - (a.year * 100 + a.week));
    }

    async _fetchMonthlyEvolution(selectedYears, yearsFilter, vendorResult, dateFilter, dateParams, cacheKey, evolutionTTL, vendedorCodes) {
        const monthlyQuery = `
        SELECT L.LCAADC as year, L.LCMMDC as month,
               SUM(L.LCIMVT) as totalSales,
               COUNT(DISTINCT L.LCNRAB) as totalOrders,
               COUNT(DISTINCT L.LCCDCL) as uniqueClients
        FROM ${comercialErpTable('LACLAE')} L
        WHERE ${LACLAE_SALES_FILTER} ${yearsFilter} ${vendorResult.filter} ${dateFilter}
        GROUP BY L.LCAADC, L.LCMMDC
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC
      `;
        const monthlyParams = [...selectedYears, ...vendorResult.params, ...dateParams];
        const rows = await this._repo.fetchPeriodAggregate(monthlyQuery, monthlyParams, `${cacheKey}:monthly`, evolutionTTL);
        const resultData = rows.map(r => ({
            year: r.YEAR, month: r.MONTH,
            totalSales: parseFloat(r.TOTALSALES) || 0,
            totalOrders: parseInt(r.TOTALORDERS) || 0,
            uniqueClients: parseInt(r.UNIQUECLIENTS) || 0
        }));

        const bSalesScope = vendedorCodes && !isCompanyWideVendorScope(vendedorCodes) ? vendedorCodes : [];
        const bSalesByYear = await Promise.all(
            selectedYears.map(async y => ({
                year: y,
                byMonth: aggregateBSalesByMonth(await this._repo.fetchBSalesByVendor(y, bSalesScope))
            }))
        );
        const bSalesMap = new Map(bSalesByYear.map(item => [item.year, item.byMonth]));
        resultData.forEach(row => {
            row.totalSales += (bSalesMap.get(row.year)?.[row.month] || 0);
        });
        return resultData;
    }
}

module.exports = {
    DashboardService,
    DASHBOARD_CACHE_VERSION,
    CLOSED_YEAR_TTL_SECONDS,
    OPEN_MONTH_TTL_SECONDS,
    historicalYearsCacheMeta,
    isCompanyWideVendorScope,
};
