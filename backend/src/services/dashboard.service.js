'use strict';

const logger = require('../../middleware/logger');
const { getCurrentDate, LACLAE_SALES_FILTER, aggregateBSalesByMonth } = require('../../utils/common');
const { TTL } = require('../../services/redis-cache');
const { buildVendedorFilterParameterized } = require('../utils/dashboardFilters');

const DASHBOARD_CACHE_VERSION = 'v20260602-b-sales-all';

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
    constructor({ repository, cache }) {
        this._repo = repository;
        this._cache = cache; // { TTL, get, set }
    }

    /** Paso 1: resolver periodo efectivo y claves de cache. */
    _resolvePeriod(vendedorCodes, yearRaw, monthRaw) {
        const now = getCurrentDate();
        const year = parseInt(yearRaw) || now.getFullYear();
        const month = parseInt(monthRaw) || (now.getMonth() + 1);
        const cacheKey = `dashboard:metrics:${DASHBOARD_CACHE_VERSION}:${year}:${month || 'all'}:${vendedorCodes || 'ALL'}`;
        const isAllVendors = !vendedorCodes || vendedorCodes === 'ALL';
        return {
            now,
            year,
            month,
            cacheKey,
            isAllVendors,
            currentTTL: isAllVendors ? this._cache.TTL.MEDIUM : this._cache.TTL.SHORT,
            prevTTL: this._cache.TTL.LONG,
            responseCacheKey: `${cacheKey}:response`,
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
          FROM DSED.LACLAE L
          WHERE L.LCAADC = ?
            AND L.LCMMDC = ?
            AND L.TPDC = 'LAC'
            AND L.LCTPVT IN ('CC', 'VC')
            AND L.LCCLLN IN ('AB', 'VT')
            AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
            ${vendorFilter}
        `;
        const lastDataSql = `
          SELECT
            COALESCE(SUM(L.LCIMVT), 0) as sales,
            COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) as margin,
            COALESCE(SUM(L.LCCTEV), 0) as boxes
          FROM DSED.LACLAE L
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
        if (!(ctx.year === ctx.now.getFullYear() && ctx.month === (ctx.now.getMonth() + 1))) {
            return { todaySales: 0, todayOrders: 0 };
        }
        const todayDataSql = `
                SELECT COALESCE(SUM(L.LCIMVT), 0) as sales, COUNT(DISTINCT L.LCNRAB) as orders
                FROM DSED.LACLAE L
                WHERE L.LCAADC = ? AND L.LCMMDC = ? AND L.LCDDDC = ? AND ${LACLAE_SALES_FILTER} ${vendorFilter}
        `;
        const params = [ctx.year, ctx.month, ctx.now.getDate(), ...vendorParams];
        const rows = await this._repo.fetchPeriodAggregate(todayDataSql, params, `${ctx.cacheKey}:today`, TTL.SHORT);
        const td = rows[0] || {};
        return {
            todaySales: parseFloat(td.SALES ?? td.sales) || 0,
            todayOrders: parseInt(td.ORDERS ?? td.orders) || 0,
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
        const bSalesScope = vendedorCodes && vendedorCodes !== 'ALL' ? vendedorCodes : [];
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
    _buildMetricsPayload(period, curr, last, salesTotals, todayInfo) {
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
            todayOrders: todayInfo.todayOrders,
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
    async getMetrics(vendedorCodes, { year, month }, { forceRefresh = false } = {}) {
        const ctx = this._resolvePeriod(vendedorCodes, year, month);

        if (!forceRefresh) {
            const cachedResponse = await this._cache.get('dashboard', ctx.responseCacheKey);
            if (cachedResponse) {
                return { payload: cachedResponse, fromCache: true, cacheScope: ctx.cacheScope };
            }
        }

        const vendor = buildVendedorFilterParameterized(vendedorCodes);
        const [currentRows, lastRows] = await this._fetchPeriodAggregates(ctx, vendor.filter, vendor.params);
        const todayInfo = await this._computeTodaySales(ctx, vendor.filter, vendor.params);
        const { curr, last } = this._normalizeAggregates(currentRows[0] || {}, lastRows[0] || {});
        const salesTotals = await this._enrichWithBSales(vendedorCodes, ctx.year, ctx.month, curr, last);
        const payload = this._buildMetricsPayload(
            { year: ctx.year, month: ctx.month },
            curr,
            last,
            salesTotals,
            todayInfo,
        );

        await this._cache.set('dashboard', ctx.responseCacheKey, payload, ctx.currentTTL);
        return { payload, fromCache: false, cacheScope: ctx.cacheScope };
    }

    /**
     * Evolucion de ventas mensual/semanal.
     * @returns {Promise<Array<Object>>} filas de evolucion ya limitadas a `months`
     */
    async getSalesEvolution(vendedorCodes, { years, granularity = 'month', upToToday = 'false', months = 36 } = {}) {
        const now = getCurrentDate();
        const selectedYears = years
            ? years.split(',').map(y => parseInt(y.trim()))
            : [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

        const yearsFilter = `AND L.LCAADC IN (${selectedYears.map(() => '?').join(',')})`;
        const vendorResult = buildVendedorFilterParameterized(vendedorCodes, 'L');
        let dateFilter = '';
        let dateParams = [];
        if (upToToday === 'true') {
            const currentMonth = now.getMonth() + 1;
            const currentDay = now.getDate();
            dateFilter = `AND (L.LCAADC < ? OR (L.LCAADC = ? AND L.LCMMDC < ?) OR (L.LCAADC = ? AND L.LCMMDC = ? AND L.LCDDDC <= ?))`;
            dateParams = [now.getFullYear(), now.getFullYear(), currentMonth, now.getFullYear(), currentMonth, currentDay];
        }

        const cacheKey = `dashboard:evolution:${DASHBOARD_CACHE_VERSION}:${years || 'default'}:${granularity}:${upToToday}:${vendedorCodes || 'ALL'}`;
        const evolutionTTL = (!vendedorCodes || vendedorCodes === 'ALL') ? TTL.LONG : TTL.MEDIUM;

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
        FROM DSED.LACLAE L
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
        FROM DSED.LACLAE L
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

        const bSalesScope = vendedorCodes && vendedorCodes !== 'ALL' ? vendedorCodes : [];
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

module.exports = { DashboardService, DASHBOARD_CACHE_VERSION };
