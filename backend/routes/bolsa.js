'use strict';

const express = require('express');
const { verifyToken, requireRoles } = require('../middleware/auth');
const logger = require('../middleware/logger');
const bolsaService = require('../services/bolsa-comercial.service');
const { bolsaLimiter } = require('../middleware/security');

const router = express.Router();
router.use(bolsaLimiter);

const VENDEDOR_CODE_PATTERN = /^[a-zA-Z0-9]{1,10}$/;

// Regla del proyecto: 'ALL' significa "todos los vendedores" y NUNCA debe
// usarse como literal de vendedor. La bolsa es por vendedor individual; sin
// este guard un GET /bolsa/ALL/status crearia una fila fantasma
// CODIGOVENDEDOR='ALL' en JAVIER.BOLSA_COMERCIAL via getOrCreateBolsa().
function isValidBolsaVendorCode(value) {
    return VENDEDOR_CODE_PATTERN.test(value) && String(value).toUpperCase() !== 'ALL';
}

function requestId(req) {
    return String(req.headers['x-request-id'] || req.id || '');
}

function sendInvalidVendedorCode(req, res) {
    return res.status(400).json({ success: false, code: 'INVALID_VENDEDOR_CODE', error: 'Invalid vendedorCode format', request_id: requestId(req) });
}

function normalizeVendorCode(value) { return String(value || '').trim(); }
function vendorCodesMatch(left, right) {
    const a = normalizeVendorCode(left);
    const b = normalizeVendorCode(right);
    if (!a || !b) return false;
    return a === b || a.replace(/^0+/, '') === b.replace(/^0+/, '');
}
function getUserVendorCode(user) { return normalizeVendorCode(user && (user.code || user.codigo || user.codigoVendedor || user.vendedorCode || user.userId || user.id)); }
function isManagerUser(user) {
    const role = String((user && (user.role || user.userRole || user.tipo)) || '').trim().toUpperCase();
    return Boolean(user && user.isJefeVentas === true) || ['JEFE_VENTAS', 'ADMIN', 'JEFE', 'DIRECTOR'].includes(role);
}
function getVisibleVendorCodes(user) {
    const values = user && (user.vendorCodes || user.vendedorCodes);
    return Array.isArray(values) ? values.map(normalizeVendorCode).filter(Boolean) : [];
}
function authorizeVendorScope(req, vendedorCode) {
    const user = req.user || {};
    if (isManagerUser(user)) {
        const visible = getVisibleVendorCodes(user);
        if (visible.length === 0 || visible.some(code => vendorCodesMatch(code, vendedorCode))) return { ok: true };
        return { ok: false };
    }
    const own = getUserVendorCode(user);
    return { ok: Boolean(own && vendorCodesMatch(own, vendedorCode)) };
}
function sendForbiddenVendor(req, res) { return res.status(403).json({ success: false, code: 'FORBIDDEN_VENDOR', error: 'No autorizado para consultar este vendedor', request_id: requestId(req) }); }
function sendBolsaInternalError(req, res) { return res.status(500).json({ success: false, code: 'BOLSA_INTERNAL_ERROR', error: 'No se pudo procesar la bolsa comercial', request_id: requestId(req) }); }

/**
 * GET /api/bolsa/:vendedorCode/status
 * Current bolsa status for the vendor this month
 */
router.get('/:vendedorCode/status', verifyToken, async (req, res) => {
    try {
        const vendedorCode = String(req.params.vendedorCode).trim();
        if (!isValidBolsaVendorCode(vendedorCode)) {
            return sendInvalidVendedorCode(req, res);
        }
        if (!authorizeVendorScope(req, vendedorCode).ok) {
            return sendForbiddenVendor(req, res);
        }
        const now = new Date();
        const bolsa = await bolsaService.getBolsaStatus(
            vendedorCode,
            now.getFullYear(),
            now.getMonth() + 1
        );
        res.json({ success: true, bolsa });
    } catch (error) {
        logger.error(`[BOLSA] GET /status error: ${error.message}`);
        sendBolsaInternalError(req, res);
    }
});

router.get('/:vendedorCode/movements', verifyToken, async (req, res) => {
    try {
        const vendedorCode = String(req.params.vendedorCode).trim();
        if (!isValidBolsaVendorCode(vendedorCode)) {
            return sendInvalidVendedorCode(req, res);
        }
        if (!authorizeVendorScope(req, vendedorCode).ok) {
            return sendForbiddenVendor(req, res);
        }
        const now = new Date();
        const year = parseInt(req.query.year) || now.getFullYear();
        const month = parseInt(req.query.month) || (now.getMonth() + 1);
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);

        const movements = await bolsaService.getMovimientos(vendedorCode, year, month, limit);
        res.json({ success: true, movements });
    } catch (error) {
        logger.error(`[BOLSA] GET /movements error: ${error.message}`);
        sendBolsaInternalError(req, res);
    }
});


/**
 * GET /api/bolsa/:vendedorCode/history?months=12
 * Resumen mensual de los ultimos N meses (saldo / consumo / acumulado)
 */
router.get('/:vendedorCode/history', verifyToken, async (req, res) => {
    try {
        const vendedorCode = String(req.params.vendedorCode).trim();
        if (!isValidBolsaVendorCode(vendedorCode)) {
            return sendInvalidVendedorCode(req, res);
        }
        if (!authorizeVendorScope(req, vendedorCode).ok) {
            return sendForbiddenVendor(req, res);
        }
        const months = parseInt(req.query.months) || 12;
        const history = await bolsaService.getHistorialMensual(vendedorCode, months);
        res.json({ success: true, ...history });
    } catch (error) {
        logger.error(`[BOLSA] GET /history error: ${error.message}`);
        sendBolsaInternalError(req, res);
    }
});

/**
 * PUT /api/bolsa/:vendedorCode/config
 * Update bolsa limits (JEFE_VENTAS / ADMIN only)
 */
router.put('/:vendedorCode/config', verifyToken, requireRoles('JEFE_VENTAS', 'ADMIN'), async (req, res) => {
    try {
        const vendedorCode = String(req.params.vendedorCode).trim();
        if (!isValidBolsaVendorCode(vendedorCode)) {
            return sendInvalidVendedorCode(req, res);
        }
        if (!authorizeVendorScope(req, vendedorCode).ok) {
            return sendForbiddenVendor(req, res);
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
        logger.error(`[BOLSA] PUT /config error: ${error.message}`);
        sendBolsaInternalError(req, res);
    }
});

module.exports = router;
