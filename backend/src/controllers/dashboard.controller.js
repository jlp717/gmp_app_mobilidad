'use strict';

const logger = require('../../middleware/logger');
const { getCurrentDate } = require('../../utils/common');
const { resolveDashboardVendedorCodes } = require('../utils/dashboardScope');
const { getMadridDateParts, madridDateLike } = require('../utils/dashboard-date');
const { DashboardRepository } = require('../repositories/dashboard.repository');
// Explicit .js: a .ts twin of this module exists; jest resolves the TS
// chain via moduleNameMapper, so pin this CommonJS require to its real file.
const { DashboardService } = require('../services/dashboard.service.js');
const { TTL, redisCache } = require('../../services/redis-cache');
const { respondError } = require('../middlewares/errorHandler');
const { parsePeriodQuery, parseEvolutionQuery } = require('../validators/query.validators');
const { SalesDiscrepancyAlertService } = require('../../services/sales-discrepancy-alert-service');

// Instancia por defecto (produccion). Los tests instancian con mocks.
const dashboardService = new DashboardService({
    repository: new DashboardRepository(),
    // Adapter al contrato {TTL,get,set} del service sobre redis-cache real.
    cache: {
        TTL,
        get: (...args) => redisCache.get(...args),
        set: (...args) => redisCache.set(...args),
    },
});
const salesDiscrepancyAlertService = new SalesDiscrepancyAlertService({ dashboardService });

function isDashboardForceRefresh(req) {
    return req?.query?.forceRefresh != null ||
        req?.query?.refresh != null ||
        req?.query?._ts != null;
}

function isDashboardManagerUser(user) {
    const role = String(user?.role || '').trim().toUpperCase();
    return user?.isJefeVentas === true || role === 'JEFE_VENTAS' || role === 'ADMIN';
}

/**
 * GET /api/dashboard/metrics — controlador fino: scope + delegacion al service.
 */
function createMetricsController({
    metricsService = dashboardService,
    alertService = salesDiscrepancyAlertService,
    now = getCurrentDate,
    schedule = setImmediate,
} = {}) {
    return async function metrics(req, res) {
        res.locals.errorStyle = 'legacy';
        res.locals.errorMessage = 'Error calculating metrics';
        try {
            logger.info(`[DASHBOARD] Metrics request from user: ${req.user?.code}, role: ${req.user?.role}, isJefeVentas: ${req.user?.isJefeVentas}`);
            logger.info(`[DASHBOARD] Query params: vendedorCodes=${req.query.vendedorCodes}, user has vendedorCodes: ${req.user?.vendedorCodes || 'none'}`);

            const scoped = resolveDashboardVendedorCodes(req, req.query.vendedorCodes);
            if (!scoped.ok) return res.status(scoped.status).json(scoped.body);
            const vendedorCodes = scoped.vendedorCodes;
            const asOf = now();
            const madrid = getMadridDateParts(asOf);
            const { year, month } = parsePeriodQuery(req.query, madridDateLike(asOf));

            const result = await metricsService.getMetrics(
                vendedorCodes,
                { year, month },
                { forceRefresh: isDashboardForceRefresh(req), asOf },
            );

            res.set('X-Cache-Hit', result.fromCache ? 'true' : 'false');
            res.set('X-Cache-Scope', result.cacheScope);
            const response = res.json(result.payload);
            const eligible = vendedorCodes === 'ALL'
                && isDashboardManagerUser(req.user)
                && year === madrid.year
                && month === madrid.month;
            if (eligible) {
                schedule(() => {
                    Promise.resolve(alertService.audit({ scope: 'ALL', payload: result.payload, asOf }))
                        .catch(() => logger.error('[sales-alert] scheduled audit failed', {
                            code: 'SALES_ALERT_SCHEDULED_AUDIT_FAILED',
                        }));
                });
            }
            return response;
        } catch (error) {
            return respondError(res, error, { style: 'legacy', action: 'GET /metrics' });
        }
    };
}

const metricsController = createMetricsController();

/**
 * GET /api/dashboard/sales-evolution
 */
async function salesEvolutionController(req, res, next) {
    res.locals.errorStyle = 'legacy';
    res.locals.errorMessage = 'Error obteniendo evolución';
    try {
        const scoped = resolveDashboardVendedorCodes(req, req.query.vendedorCodes);
        if (!scoped.ok) return res.status(scoped.status).json(scoped.body);
        const vendedorCodes = scoped.vendedorCodes;

        const { granularity, upToToday, months, years } = parseEvolutionQuery(req.query);

        const evolution = await dashboardService.getSalesEvolution(
            vendedorCodes,
            { years, granularity, upToToday, months },
        );
        return res.json({ evolution });
    } catch (error) {
        return respondError(res, error, { style: 'legacy', action: 'GET /sales-evolution' });
    }
}

module.exports = {
    metricsController,
    salesEvolutionController,
    createMetricsController,
    __deps: { dashboardService, salesDiscrepancyAlertService },
};
