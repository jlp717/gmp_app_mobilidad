'use strict';

const logger = require('../../middleware/logger');
const { getCurrentDate, LACLAE_SALES_FILTER, aggregateBSalesByMonth } = require('../../utils/common');
const { TTL } = require('../../services/redis-cache');
const { buildVendedorFilterParameterized } = require('../utils/dashboardFilters');

const DASHBOARD_CACHE_VERSION = 'v20260602-b-sales-all';

/**
 * Logica de negocio de dashboard. Cero SQL aqui: el acceso a datos vive en
 * DashboardRepository (inyectado por constructor para tests con mocks).
 */
class DashboardService {
    /**
     * @param {object} deps
     * @param {import('../repositories/dashboard.repository').DashboardRepository} deps.repository
     * @param {object} [deps.cache] redis-cache (TTL/get/set)
     */
    constructor({ repository, cache }) {
        this._repo = repository;
        this._cache = cache; // { TTL, get, set }
    }

    /**
     * KPIs del periodo con comparativa mes anterior y ventas B.
     * @returns {Promise<{payload:Object, fromCache:boolean, cacheScope:string}>}
     */
    async getMetrics(vendedorCodes, { year, month }, { forceRefresh = false } = {}) {
        const now = getCurrentDate();
        const currentYear = parseInt(year) || now.getFullYear();
        const currentMonth = parseInt(month) || (now.getMonth() + 1);
        const cacheKey = `dashboard:metrics:${DASHBOARD_CACHE_VERSION}:${currentYear}:${currentMonth || 'all'}:${vendedorCodes || 'ALL'}`;

        const isAllVendors = !vendedorCodes || vendedorCodes === 'ALL';
        const currentTTL = isAllVendors ? this._cache.TTL.MEDIUM : this._cache.TTL.SHORT;
        const prevTTL = this._cache.TTL.LONG;
        const responseCacheKey = `${cacheKey}:response`;
        const cacheScope = vendedorCodes || 'ALL';

        if (!forceRefresh) {
            const cachedResponse = await this._cache.get('dashboard', responseCacheKey);
            if (cachedResponse) {
                return { payload: cachedResponse, fromCache: true, cacheScope };
            }
        }

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
            this._repo.fetchPeriodAggregate(currentDataSql, currentDataParams, `${cacheKey}:curr`, currentTTL),
            this._repo.fetchPeriodAggregate(lastDataSql, lastDataParams, `${cacheKey}:prev`, prevTTL)
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
            const todayData = await this._repo.fetchPeriodAggregate(todayDataSql, todayDataParams, `${cacheKey}:today`, TTL.SHORT);
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

        const bSalesScope = vendedorCodes && vendedorCodes !== 'ALL' ? vendedorCodes : [];
        const [bSalesCurrByVendor, bSalesLastByVendor] = await Promise.all([
            this._repo.fetchBSalesByVendor(currentYear, bSalesScope),
            this._repo.fetchBSalesByVendor(currentYear - 1, bSalesScope),
        ]);
        const bSalesCurrByMonth = aggregateBSalesByMonth(bSalesCurrByVendor);
        const bSalesLastByMonth = aggregateBSalesByMonth(bSalesLastByVendor);
        currentSales += (bSalesCurrByMonth[currentMonth] || 0);
        lastSales += (bSalesLastByMonth[currentMonth] || 0);

        const calcVar = (currVal, prev) => prev && prev !== 0 ? ((currVal - prev) / prev) * 100 : 0;
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

        await this._cache.set('dashboard', responseCacheKey, responseData, currentTTL);

        return { payload: responseData, fromCache: false, cacheScope };
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

        const vendedorResult = buildVendedorFilterParameterized(vendedorCodes, 'L');
        const vendorFilter = vendedorResult.filter;
        const vendorParams = vendedorResult.params;

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
            const dailyQuery = `
        SELECT L.LCAADC as year, L.LCMMDC as month, L.LCDDDC as day,
               SUM(L.LCIMVT) as sales,
               COUNT(DISTINCT L.LCNRAB) as orders,
               COUNT(DISTINCT L.LCCDCL) as clients
        FROM DSED.LACLAE L
        WHERE ${LACLAE_SALES_FILTER} ${yearsFilter} ${vendorFilter} ${dateFilter}
        GROUP BY L.LCAADC, L.LCMMDC, L.LCDDDC
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC, L.LCDDDC DESC
      `;
            const dailyParams = [...selectedYears, ...vendorParams, ...dateParams];
            const dailyData = await this._repo.fetchPeriodAggregate(dailyQuery, dailyParams, `${cacheKey}:daily`, evolutionTTL);

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
        WHERE ${LACLAE_SALES_FILTER} ${yearsFilter} ${vendorFilter} ${dateFilter}
        GROUP BY L.LCAADC, L.LCMMDC
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC
      `;
            const monthlyParams = [...selectedYears, ...vendorParams, ...dateParams];
            const rows = await this._repo.fetchPeriodAggregate(monthlyQuery, monthlyParams, `${cacheKey}:monthly`, evolutionTTL);
            resultData = rows.map(r => ({
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
        }

        logger.debug?.(`[DashboardService] evolution rows=${resultData.length}`);
        return resultData.slice(0, parseInt(months) || 36);
    }
}

module.exports = { DashboardService, DASHBOARD_CACHE_VERSION };
