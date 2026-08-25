'use strict';

const express = require('express');
const {
    dailySummaryController,
    vencimientosController,
    commissionsSummaryController,
} = require('../controllers/repartidorFinanzas.controller');

/**
 * Subrouters financieros del repartidor (src). En produccion el mount de
 * routes/repartidor-finanzas.js aplica verifyToken + guards antes del
 * controlador; estos routers encapsulan solo la parte de aplicacion.
 */
function createRepartidorFinanzasRoutes(deps = {}) {
    const router = express.Router();
    router.get('/daily-summary/:repartidorId', deps.dailySummary || dailySummaryController);
    router.get('/vencimientos/:repartidorId', deps.vencimientos || vencimientosController);
    router.get('/commissions/summary/:repartidorId', deps.commissions || commissionsSummaryController);
    return router;
}

module.exports = { createRepartidorFinanzasRoutes };
