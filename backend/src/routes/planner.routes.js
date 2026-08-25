'use strict';

const express = require('express');
const { ruteroWeekController } = require('../controllers/planner.controller');

/**
 * Ruta canonica /rutero/week (src). El mount productivo vive en
 * routes/planner.js con requirePlannerVendorScope; esta factoria existe para
 * wiring documentado y tests de contrato sin auth externa.
 */
function createPlannerRoutes({ week = ruteroWeekController } = {}) {
    const router = express.Router();
    router.get('/rutero/week', week);
    return router;
}

module.exports = { createPlannerRoutes };
