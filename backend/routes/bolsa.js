'use strict';

const express = require('express');
const { verifyToken, requireRoles } = require('../middleware/auth');
const logger = require('../middleware/logger');
const bolsaService = require('../services/bolsa-comercial.service');

const router = express.Router();

/**
 * GET /api/bolsa/:vendedorCode/status
 * Current bolsa status for the vendor this month
 */
router.get('/:vendedorCode/status', verifyToken, async (req, res) => {
    try {
        const vendedorCode = String(req.params.vendedorCode).trim();
        const now = new Date();
        const bolsa = await bolsaService.getOrCreateBolsa(
            vendedorCode,
            now.getFullYear(),
            now.getMonth() + 1
        );
        res.json({ success: true, bolsa });
    } catch (error) {
        logger.error(`[BOLSA] GET /status error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/bolsa/:vendedorCode/movements
 * Movement history for current or specified month
 */
router.get('/:vendedorCode/movements', verifyToken, async (req, res) => {
    try {
        const vendedorCode = String(req.params.vendedorCode).trim();
        const now = new Date();
        const year = parseInt(req.query.year) || now.getFullYear();
        const month = parseInt(req.query.month) || (now.getMonth() + 1);
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);

        const movements = await bolsaService.getMovimientos(vendedorCode, year, month, limit);
        res.json({ success: true, movements });
    } catch (error) {
        logger.error(`[BOLSA] GET /movements error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/bolsa/:vendedorCode/config
 * Update bolsa limits (JEFE_VENTAS / ADMIN only)
 */
router.put('/:vendedorCode/config', verifyToken, requireRoles('JEFE_VENTAS', 'ADMIN'), async (req, res) => {
    try {
        const vendedorCode = String(req.params.vendedorCode).trim();
        const now = new Date();
        const year = parseInt(req.body.year) || now.getFullYear();
        const month = parseInt(req.body.month) || (now.getMonth() + 1);
        const { limitePct, limiteImporte } = req.body;

        const bolsa = await bolsaService.updateBolsaConfig(
            vendedorCode, year, month,
            { limitePct, limiteImporte }
        );
        res.json({ success: true, bolsa });
    } catch (error) {
        logger.error(`[BOLSA] PUT /config error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
