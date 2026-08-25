'use strict';

const logger = require('../../middleware/logger');
const { RuteroRepository } = require('../repositories/rutero.repository');
const { RuteroSemanalService } = require('../services/ruteroSemana.service');
const {
    getWeekCountsFromCache,
    getTotalClientsFromCache,
} = require('../../services/laclae');
const { respondError } = require('../middlewares/errorHandler');
const { parseRuteroWeekQuery } = require('../validators/query.validators');

// Instancia por defecto (produccion): cache laclae real + repo DB2.
const ruteroSemanalService = new RuteroSemanalService({
    repository: new RuteroRepository(),
    getWeekCountsFromCache,
    getTotalClientsFromCache,
});

/**
 * GET /api/rutero/week — controlador fino.
 * El middleware de scope (requirePlannerVendorScope) sigue aplicandose en la
 * declaracion de ruta legacy; aqui solo orquestamos service => respuesta.
 */
async function ruteroWeekController(req, res, next) {
    res.locals.errorStyle = 'legacy';
    res.locals.errorMessage = 'Error obteniendo rutero semana';
    try {
        const { vendedorCodes, role, ignoreOverridesBool } = parseRuteroWeekQuery(req.query);

        logger.info(`[RUTERO WEEK] vendedorCodes: "${vendedorCodes}", role: "${role || 'comercial'}", ignoreOverrides: ${ignoreOverridesBool}`);

        const { payload } = await ruteroSemanalService.obtenerRuteroSemanal({
            vendedorCodes,
            role,
            ignoreOverridesBool,
        });
        return res.json(payload);
    } catch (error) {
        void next;
        return respondError(res, error, { style: 'legacy', action: 'GET /rutero/week' });
    }
}

module.exports = { ruteroWeekController };
