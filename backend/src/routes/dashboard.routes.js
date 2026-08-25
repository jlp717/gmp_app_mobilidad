'use strict';

const express = require('express');
const { verifyToken } = require('../../middleware/auth');
const { metricsController, salesEvolutionController } = require('../controllers/dashboard.controller');

/**
 * Rutas canonicas de dashboard (src). En produccion los mounts legacy de
 * routes/dashboard.js delegan en estos controladores con la misma cadena
 * (verifyToken + cacheMiddleware global), asi que esta factoria es la fuente
 * de verdad para wiring y tests de contrato.
 */
function createDashboardRoutes({ metrics = metricsController, evolution = salesEvolutionController } = {}) {
    const router = express.Router();
    router.get('/metrics', verifyToken, metrics);
    router.get('/sales-evolution', verifyToken, evolution);
    return router;
}

module.exports = { createDashboardRoutes };
