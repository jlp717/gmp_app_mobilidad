'use strict';

const express = require('express');
const { verifyToken, requireRoles } = require('../middleware/auth');
const logger = require('../middleware/logger');
const bolsaService = require('../services/bolsa-comercial.service');
const { bolsaLimiter } = require('../middleware/security');

const router = express.Router();
router.use(bolsaLimiter);

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
        const requestId = req.headers['x-request-id'] || '';
        logger.error(`[BOLSA] GET /status error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message, request_id: requestId });
    }
});

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
        const requestId = req.headers['x-request-id'] || '';
        logger.error(`[BOLSA] GET /movements error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message, request_id: requestId });
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
 * GET /api/bolsa/:vendedorCode/history?months=12
 * Resumen mensual de los ultimos N meses (saldo / consumo / acumulado)
 */
router.get('/:vendedorCode/history', verifyToken, async (req, res) => {
    try {
        const vendedorCode = String(req.params.vendedorCode).trim();
        if (!/^[a-zA-Z0-9]{1,10}$/.test(vendedorCode)) {
            return res.status(400).json({ success: false, error: 'Invalid vendedorCode format' });
        }
        const months = parseInt(req.query.months) || 12;
        const history = await bolsaService.getHistorialMensual(vendedorCode, months);
        res.json({ success: true, ...history });
    } catch (error) {
        const requestId = req.headers['x-request-id'] || '';
        logger.error(`[BOLSA] GET /history error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message, request_id: requestId });
    }
});

/**
 * PUT /api/bolsa/:vendedorCode/config
 * Update bolsa limits (JEFE_VENTAS / ADMIN only)
 */
router.put('/:vendedorCode/config', verifyToken, requireRoles('JEFE_VENTAS', 'ADMIN'), async (req, res) => {
    try {
        const vendedorCode = String(req.params.vendedorCode).trim();
        if (!/^[a-zA-Z0-9]{1,10}$/.test(vendedorCode)) {
            return res.status(400).json({ success: false, error: 'Invalid vendedorCode format' });
        }
        const now = new Date();
        const year = parseInt(req.body.year) || now.getFullYear();
        if (year < 2020 || year > 2030) {
            return res.status(400).json({ success: false, error: 'Year out of range (2020-2030)' });
        }
        const month = parseInt(req.body.month) || (now.getMonth() + 1);
        if (month < 1 || month > 12) {
            return res.status(400).json({ success: false, error: 'Month out of range (1-12)' });
        }
        const { limitePct, limiteImporte } = req.body;

        const validated = {};
        if (limitePct !== undefined) {
            const pct = parseFloat(limitePct);
            if (isNaN(pct) || pct < 0 || pct > 100) {
                return res.status(400).json({ success: false, error: 'limitePct must be 0-100' });
            }
            validated.limitePct = pct;
        }
        if (limiteImporte !== undefined) {
            const imp = parseFloat(limiteImporte);
            if (isNaN(imp) || imp < 0) {
                return res.status(400).json({ success: false, error: 'limiteImporte must be >= 0' });
            }
            validated.limiteImporte = imp;
        }

        const bolsa = await bolsaService.updateBolsaConfig(
            vendedorCode, year, month,
            validated
        );
        res.json({ success: true, bolsa });
    } catch (error) {
        const requestId = req.headers['x-request-id'] || '';
        logger.error(`[BOLSA] PUT /config error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message, request_id: requestId });
    }
});

module.exports = router;
