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
    return Array.isArray(values)
        ? values.map(normalizeVendorCode).filter(code => code && code.toUpperCase() !== 'ALL')
        : [];
}
function parseVendorCodesParam(value) {
    if (!value) return [];
    return String(value)
        .split(',')
        .map(normalizeVendorCode)
        .filter(Boolean)
        .filter(code => code.toUpperCase() !== 'ALL');
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
function authorizeManagerCodes(req, requestedCodes) {
    const user = req.user || {};
    if (!isManagerUser(user)) return { ok: false, code: 'MANAGER_REQUIRED' };
    const visible = getVisibleVendorCodes(user);
    if (visible.length === 0 || requestedCodes.length === 0) return { ok: true, codes: requestedCodes.length ? requestedCodes : visible };
    const unauthorized = requestedCodes.some(code => !visible.some(visibleCode => vendorCodesMatch(visibleCode, code)));
    if (unauthorized) return { ok: false, code: 'FORBIDDEN_VENDOR' };
    return { ok: true, codes: requestedCodes };
}
function sendForbiddenVendor(req, res) { return res.status(403).json({ success: false, code: 'FORBIDDEN_VENDOR', error: 'No autorizado para consultar este vendedor', request_id: requestId(req) }); }
function sendBolsaInternalError(req, res) { return res.status(500).json({ success: false, code: 'BOLSA_INTERNAL_ERROR', error: 'No se pudo procesar la bolsa comercial', request_id: requestId(req) }); }

function sendManagerRequired(req, res) { return res.status(403).json({ success: false, code: 'MANAGER_REQUIRED', error: 'Solo Jefe de Ventas puede consultar la bolsa agrupada', request_id: requestId(req) }); }

function stripMarginFieldsFromMovement(movement) {
    if (!movement || typeof movement !== 'object') return movement;
    const sanitized = { ...movement };
    delete sanitized.precioMinimoCongelado;
    delete sanitized.precioVenta;
    return sanitized;
}

function parseMovementFilters(query) {
    return {
        tipo: query.tipo,
        dateFrom: query.dateFrom || query.fechaDesde,
        dateTo: query.dateTo || query.fechaHasta,
        document: query.document || query.documento || query.pedido || query.numeroPedido || query.numeroFactura,
        client: query.client || query.cliente || query.codigoCliente,
    };
}

function parsePeriod(query, now = new Date()) {
    const year = parseInt(query.year) || now.getFullYear();
    const month = parseInt(query.month) || (now.getMonth() + 1);
    if (year < 2020 || year > 2030 || month < 1 || month > 12) {
        return { ok: false, year, month };
    }
    return { ok: true, year, month };
}

/**
 * GET /api/bolsa/grouped
 * Manager-only grouped month status by commercial vendor.
 */
router.get('/grouped', verifyToken, async (req, res) => {
    try {
        const requestedCodes = parseVendorCodesParam(req.query.vendedorCodes || req.query.vendedores);
        if (requestedCodes.some(code => !isValidBolsaVendorCode(code))) {
            return sendInvalidVendedorCode(req, res);
        }
        const auth = authorizeManagerCodes(req, requestedCodes);
        if (!auth.ok) {
            return auth.code === 'MANAGER_REQUIRED' ? sendManagerRequired(req, res) : sendForbiddenVendor(req, res);
        }
        const period = parsePeriod(req.query);
        if (!period.ok) {
            return res.status(400).json({ success: false, code: 'INVALID_PERIOD', error: 'Periodo fuera de rango', request_id: requestId(req) });
        }
        const grouped = await bolsaService.getGroupedStatus(auth.codes || [], period.year, period.month);
        res.json({ success: true, ...grouped });
    } catch (error) {
        logger.error(`[BOLSA] GET /grouped error: ${error.message}`);
        sendBolsaInternalError(req, res);
    }
});

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
        const period = parsePeriod(req.query);
        if (!period.ok) {
            return res.status(400).json({ success: false, code: 'INVALID_PERIOD', error: 'Periodo fuera de rango', request_id: requestId(req) });
        }
        const bolsa = await bolsaService.getBolsaStatus(
            vendedorCode,
            period.year,
            period.month
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
        const filters = parseMovementFilters(req.query);
        const hasDateFilter = Boolean(filters.dateFrom || filters.dateTo);
        const year = parseInt(req.query.year) || (hasDateFilter ? undefined : now.getFullYear());
        const month = parseInt(req.query.month) || (hasDateFilter ? undefined : (now.getMonth() + 1));
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);

        const movements = await bolsaService.getMovimientos(vendedorCode, year, month, limit, filters);
        const visibleMovements = isManagerUser(req.user)
            ? movements
            : (movements || []).map(stripMarginFieldsFromMovement);
        res.json({ success: true, movements: visibleMovements });
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
        const period = parsePeriod(req.query);
        if (!period.ok) {
            return res.status(400).json({ success: false, code: 'INVALID_PERIOD', error: 'Periodo fuera de rango', request_id: requestId(req) });
        }
        const history = await bolsaService.getHistorialMensual(vendedorCode, months, period.year, period.month);
        res.json({ success: true, ...history });
    } catch (error) {
        logger.error(`[BOLSA] GET /history error: ${error.message}`);
        sendBolsaInternalError(req, res);
    }
});

/**
 * PUT /api/bolsa/:vendedorCode/config
 * Update bolsa limits (JEFE_VENTAS only)
 */
router.put('/:vendedorCode/config', verifyToken, requireRoles('JEFE_VENTAS'), async (req, res) => {
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
