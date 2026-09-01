'use strict';

const express = require('express');
const { verifyToken } = require('../../middleware/auth');
// Explicit .js: a .ts twin exists (default-export router for src/index.ts);
// jest moduleNameMapper routes bare paths to the .ts side, so pin this
// CommonJS factory's dependency to the .js controller with metricsController.
const { metricsController, salesEvolutionController } = require('../controllers/dashboard.controller.js');

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
