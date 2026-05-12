'use strict';

const express = require('express');
const { verifyToken } = require('../middleware/auth');
const logger = require('../middleware/logger');
const evolutionService = require('../services/evolution.service');

const router = express.Router();
router.use(verifyToken);

// Req #2: Margin visibility
const MARGIN_ROLES = ['JEFE_VENTAS', 'ADMIN'];
function canSeeMargin(user) {
    return MARGIN_ROLES.includes((user?.role || '').toUpperCase()) || user?.isJefeVentas;
}
function stripMargin(data, user) {
    if (canSeeMargin(user)) return data;
    if (Array.isArray(data)) {
        return data.map(d => {
            const c = { ...d };
            delete c.totalCosto; delete c.totalMargen; delete c.margenPct;
            return c;
        });
    }
    const c = { ...data };
    delete c.totalCosto; delete c.totalMargen; delete c.margenPct;
    return c;
}

/**
 * GET /api/evolution/monthly
 */
router.get('/monthly', async (req, res) => {
    try {
        const { vendedorCodes, clientCode, months } = req.query;
        const result = await evolutionService.getSalesEvolution({
            vendedorCodes, clientCode,
            months: parseInt(months) || 24,
        });
        result.monthly = stripMargin(result.monthly, req.user);
        res.json({ success: true, ...result });
    } catch (error) {
        logger.error(`[EVOLUTION] GET /monthly error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/evolution/products
 */
router.get('/products', async (req, res) => {
    try {
        const { vendedorCodes, clientCode, limit } = req.query;
        const products = await evolutionService.getProductEvolution({
            vendedorCodes, clientCode,
            limit: parseInt(limit) || 20,
        });
        res.json({ success: true, products });
    } catch (error) {
        logger.error(`[EVOLUTION] GET /products error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/evolution/clients
 */
router.get('/clients', async (req, res) => {
    try {
        const { vendedorCodes, limit } = req.query;
        const clients = await evolutionService.getClientEvolution({
            vendedorCodes,
            limit: parseInt(limit) || 30,
        });
        res.json({ success: true, clients });
    } catch (error) {
        logger.error(`[EVOLUTION] GET /clients error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
