'use strict';

const { RepartidorFinanzasService } = require('../services/repartidorFinanzas.service');
const {
    listParamsSchema,
    dailySummaryQuerySchema,
    vencimientosQuerySchema,
    rangeQuerySchema,
    assertExplicitRepartidorSelector,
} = require('../validators/repartidorFinanzas.validators');

// Instancia por defecto (produccion): servicio canonico de finanzas.
const respondError = require('../middlewares/errorHandler').respondError;
const finanzasService = new RepartidorFinanzasService();

function _markError(res, action) {
    res.locals.errorStyle = 'finanzas';
    res.locals.errorAction = action;
}

/**
 * GET /daily-summary/:repartidorId — Liquidacion Diaria.
 * Shape de respuesta identico al previo (incluye canReverseCobros: false).
 */
async function dailySummaryController(req, res, next) {
    try {
        const params = listParamsSchema.parse(req.params);
        const query = dailySummaryQuerySchema.parse(req.query);
        const result = await finanzasService.getDailySummary({
            repartidorId: params.repartidorId,
            date: query.date,
        });
        return res.json({ success: true, ...result, canReverseCobros: false });
    } catch (error) {
        _markError(res, 'GET /daily-summary');
        return respondError(res, error, { style: 'finanzas', action: res.locals.errorAction });
    }
}

/**
 * GET /vencimientos/:repartidorId
 */
async function vencimientosController(req, res, next) {
    try {
        const params = listParamsSchema.parse(req.params);
        assertExplicitRepartidorSelector(params.repartidorId);
        const query = vencimientosQuerySchema.parse(req.query);
        const page = await finanzasService.getVencimientos({
            repartidorId: params.repartidorId,
            from: query.from,
            to: query.to,
            limit: query.limit,
            cursor: query.cursor,
            clientCode: query.clientCode,
            search: query.search,
            estado: query.estado,
        });
        return res.json({
            success: true,
            repartidorId: params.repartidorId,
            range: { from: query.from, to: query.to, limit: query.limit, search: query.search ?? null },
            vencimientos: page.items,
            pagination: {
                total: page.total,
                limit: query.limit,
                hasMore: page.hasMore,
                nextCursor: page.nextCursor,
            },
        });
    } catch (error) {
        _markError(res, 'GET /vencimientos');
        return respondError(res, error, { style: 'finanzas', action: res.locals.errorAction });
    }
}

/**
 * GET /commissions/summary/:repartidorId
 */
async function commissionsSummaryController(req, res, next) {
    try {
        const params = listParamsSchema.parse(req.params);
        assertExplicitRepartidorSelector(params.repartidorId);
        const query = rangeQuerySchema.parse(req.query);
        const summary = await finanzasService.getCommissionSummary({
            repartidorId: params.repartidorId,
            from: query.from,
            to: query.to,
        });
        return res.json({ success: true, ...summary });
    } catch (error) {
        _markError(res, 'GET /commissions/summary');
        return respondError(res, error, { style: 'finanzas', action: res.locals.errorAction });
    }
}

module.exports = {
    dailySummaryController,
    vencimientosController,
    commissionsSummaryController,
    __deps: { finanzasService },
};
