'use strict';

const logger = require('../../middleware/logger');
const { getCurrentDate } = require('../../utils/common');
const { resolveDashboardVendedorCodes } = require('../utils/dashboardScope');
const { DashboardRepository } = require('../repositories/dashboard.repository');
const { DashboardService } = require('../services/dashboard.service');
const { TTL, redisCache } = require('../../services/redis-cache');
const { respondError } = require('../middlewares/errorHandler');
const { parsePeriodQuery, parseEvolutionQuery } = require('../validators/query.validators');

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

function isDashboardForceRefresh(req) {
    return req?.query?.forceRefresh != null ||
        req?.query?.refresh != null ||
        req?.query?._ts != null;
}

/**
 * GET /api/dashboard/metrics — controlador fino: scope + delegacion al service.
 */
async function metricsController(req, res, next) {
    // Paridad de errores legacy: mismo mensaje que el catch inline previo.
    res.locals.errorStyle = 'legacy';
    res.locals.errorMessage = 'Error calculating metrics';
    try {
        logger.info(`[DASHBOARD] Metrics request from user: ${req.user?.code}, role: ${req.user?.role}, isJefeVentas: ${req.user?.isJefeVentas}`);
        logger.info(`[DASHBOARD] Query params: vendedorCodes=${req.query.vendedorCodes}, user has vendedorCodes: ${req.user?.vendedorCodes || 'none'}`);

        const scoped = resolveDashboardVendedorCodes(req, req.query.vendedorCodes);
        if (!scoped.ok) return res.status(scoped.status).json(scoped.body);
        const vendedorCodes = scoped.vendedorCodes;

        const now = getCurrentDate();
        const { year, month } = parsePeriodQuery(req.query, now);

        const result = await dashboardService.getMetrics(vendedorCodes, { year, month }, { forceRefresh: isDashboardForceRefresh(req) });

        res.set('X-Cache-Hit', result.fromCache ? 'true' : 'false');
        res.set('X-Cache-Scope', result.cacheScope);
        return res.json(result.payload);
    } catch (error) {
        return respondError(res, error, { style: 'legacy', action: 'GET /metrics' });
    }
}

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

        const { granularity, upToToday, months } = parseEvolutionQuery(req.query);

        const evolution = await dashboardService.getSalesEvolution(
            vendedorCodes,
            { years: req.query.years, granularity, upToToday, months },
        );
        return res.json({ evolution });
    } catch (error) {
        return respondError(res, error, { style: 'legacy', action: 'GET /sales-evolution' });
    }
}

module.exports = { metricsController, salesEvolutionController, __deps: { dashboardService } };
