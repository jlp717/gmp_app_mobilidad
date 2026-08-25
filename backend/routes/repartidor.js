/**
 * REPARTIDOR ROUTES
 * Backend endpoints for repartidor-specific functionality
 * - Collections (cobros) from DSEDAC.CAC/CVC
 * - Commissions with 30% threshold logic
 * - Historical deliveries and signatures
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const logger = require('../middleware/logger');
const { sanitizeCodeListForParams, sanitizeForSQL } = require('../utils/common');
const repartidorDb = require('../repositories/repartidor-route-db2-repository');
const { generateInvoicePDF } = require('../app/services/pdfService');
const { isDeliveryStatusAvailable, isDeliveryStatusNewSchema } = require('../utils/delivery-status-check');
const { sendEmailWithPdf, generateInvoiceEmailHtml, generateDeliveryEmailHtml, cachePdf, getCachedPdf } = require('../services/emailPdfService');
const { redisCache, TTL } = require('../services/redis-cache');
const whatsappGateway = require('../services/whatsappGatewayService');
const {
    RepartoEmailDeliveryPolicyError,
    resolveRepartoEmailDelivery,
    buildRepartoMessageId,
} = require('../services/reparto-email-delivery-policy');
const { verifyToken, requireJefeVentas } = require('../middleware/auth');
const { CircuitBreaker: RepartidorCircuitBreaker } = require('../services/circuit-breaker');

const repartidorBreaker = new RepartidorCircuitBreaker({
    name: 'repartidor',
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 10000
});
const REPARTIDOR_PDF_CACHE_VERSION = 'v3';
const REPARTIDOR_DOCUMENT_PDF_CACHE_TTL = Number(TTL?.REALTIME) || 60;
const { generateDeliveryReceipt } = require('../app/services/deliveryReceiptService');
const facturasService = require('../services/facturas.service');
const pdfService = require('../services/pdf.service');

const ruteroOrdenRepo = require('../repositories/repartidor-rutero-orden-db2-repository');
const {
  optimizeRoutePackage,
  annotateRouteTimeline,
  resolveDepartureMinute,
  normalizeOrigin,
} = require('../services/repartidor-rutero-route-optimizer');
const {
  parseRouteDate,
  normalizeOrdenPayload,
  normalizeOptimizeStopsPayload,
  preferredStartMinute,
  buildWindowLabel,
  isClosedOnDate,
  formatMinuteLabel,
} = require('../services/repartidor-rutero-orden-service');

const REPARTIDOR_READ_PAGE_MAX = 100;

function normalizedRole(user) {
    return String(user?.role || '').trim().toUpperCase();
}

function isRepartoPrivileged(user) {
    const role = normalizedRole(user);
    const activeMode = String(user?.activeMode || '').trim().toUpperCase();
    return (role === 'ADMIN' || role === 'JEFE_VENTAS') && activeMode === 'REPARTIDOR';
}

function canonicalRepartidorCode(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{1,2}$/.test(raw) || raw === 'ALL') return '';
    return /^\d{1,2}$/.test(raw) ? raw.padStart(2, '0') : raw;
}

/** Single driver only — multi-id / ALL selectors rejected with 422. */
function authorizeSingleRepartidorId(req, res, rawId) {
  const raw = String(rawId || '').trim();
  if (!raw || raw.includes(',') || /^ALL$/i.test(raw)) {
    sendRouteError(res, 422, 'REPARTIDOR_ID_MULTI_NOT_ALLOWED');
    return null;
  }
  const ids = authorizedRepartidorIds(req, res, raw);
  if (!ids) return null;
  if (ids.length !== 1) {
    sendRouteError(res, 422, 'REPARTIDOR_ID_MULTI_NOT_ALLOWED');
    return null;
  }
  return ids[0];
}

function sendRouteError(res, status, code) {
    return res.status(status).json({ success: false, code, error: 'No se pudo completar la solicitud' });
}

function parseBoundedInt(value, { min, max, name, fallback }) {
    if (value === undefined || value === null || value === '') return { value: fallback };
    if (!/^\d+$/.test(String(value))) return { error: `${name}_INVALID` };
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return { error: `${name}_INVALID` };
    return { value: parsed };
}

function parseRuteroOrigin(value) {
    if (value === undefined || value === null || value === '') return { value: null };
    if (typeof value !== 'object' || !normalizeOrigin(value)) return { error: 'RUTERO_ORIGIN_INVALID' };
    return { value: normalizeOrigin(value) };
}

function parseRuteroDepartureMinute(value) {
    if (value === undefined || value === null || value === '') return { value: resolveDepartureMinute({}) };
    if (!/^\d+$/.test(String(value))) return { error: 'RUTERO_DEPARTURE_MINUTE_INVALID' };
    const minute = Number(value);
    if (!Number.isSafeInteger(minute) || minute < 0 || minute >= 1440) {
        return { error: 'RUTERO_DEPARTURE_MINUTE_INVALID' };
    }
    return { value: minute };
}

function parseIsoDate(value, name) {
    if (!value) return { value: null };
    const raw = String(value).trim();
    // Accept YYYY-MM-DD and full ISO timestamps (Flutter toIso8601String).
    const ymd = /^(\d{4}-\d{2}-\d{2})/.exec(raw)?.[1];
    if (!ymd) return { error: `${name}_INVALID` };
    const date = new Date(`${ymd}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== ymd) {
        return { error: `${name}_INVALID` };
    }
    return { value: Number(ymd.replace(/-/g, '')) };
}

function parsePagination(query, defaultLimit = REPARTIDOR_READ_PAGE_MAX, maxOffset = REPARTIDOR_READ_PAGE_MAX) {
    const limit = parseBoundedInt(query.limit, {
        min: 1,
        max: REPARTIDOR_READ_PAGE_MAX,
        name: 'LIMIT',
        fallback: defaultLimit
    });
    const offset = parseBoundedInt(query.offset, {
        min: 0,
        max: maxOffset,
        name: 'OFFSET',
        fallback: 0
    });
    return { limit, offset };
}

function authorizedRepartidorIds(req, res, rawIds) {
    const rawParts = String(rawIds || '').split(',').map((id) => id.trim()).filter(Boolean);
    const normalized = rawParts.map(canonicalRepartidorCode);
    const ids = [...new Set(normalized)];
    if (ids.length > REPARTIDOR_READ_PAGE_MAX || normalized.some((id) => !id)) {
        sendRouteError(res, 422, 'REPARTIDOR_ID_INVALID');
        return null;
    }
    if (!ids.length) {
        sendRouteError(res, 400, 'REPARTIDOR_ID_INVALID');
        return null;
    }
    const user = req.user;
    if (!user) {
        sendRouteError(res, 401, 'AUTH_REQUIRED');
        return null;
    }
    const role = normalizedRole(user);
    const allowed = uniqueActorCodes(user.repartidorCodes);
    if (isRepartoPrivileged(user)) {
        if (allowed.length > 0 && ids.every((id) => allowed.some((code) =>
            normalizeVendorCode(code) === normalizeVendorCode(id)))) return ids;
        sendRouteError(res, 403, 'REPARTIDOR_ACCESS_DENIED');
        return null;
    }
    if (role === 'JEFE_VENTAS') {
        sendRouteError(res, 403, 'REPARTIDOR_MODE_REQUIRED');
        return null;
    }
    if (role !== 'REPARTIDOR') {
        sendRouteError(res, 403, 'REPARTIDOR_ACCESS_DENIED');
        return null;
    }
    const ownId = canonicalRepartidorCode(user.code || user.id || '');
    if (ids.length !== 1 || !ownId || allowed.length !== 1
        || normalizeVendorCode(ids[0]) !== normalizeVendorCode(allowed[0])
        || normalizeVendorCode(ownId) !== normalizeVendorCode(allowed[0])) {
        sendRouteError(res, 403, 'REPARTIDOR_ACCESS_DENIED');
        return null;
    }
    return ids;
}

function parseAlbaranOwnershipKey(source) {
    const year = parseBoundedInt(source.year ?? source.ejercicio, { min: 2000, max: 2100, name: 'YEAR', fallback: null });
    const terminal = parseBoundedInt(source.terminal, { min: 0, max: 9999, name: 'TERMINAL', fallback: null });
    const number = parseBoundedInt(source.number ?? source.numero, { min: 1, max: 999999999, name: 'NUMBER', fallback: null });
    const series = String(source.series ?? source.serie ?? '').trim().toUpperCase();
    if (year.error || terminal.error || number.error || year.value === null || terminal.value === null || number.value === null || !/^[A-Z0-9]{1,3}$/.test(series)) {
        return null;
    }
    return { year: year.value, series, terminal: terminal.value, number: number.value };
}

function parseInvoiceOwnershipKey(source) {
    const year = parseBoundedInt(source.year ?? source.ejercicio, { min: 2000, max: 2100, name: 'YEAR', fallback: null });
    const number = parseBoundedInt(source.number ?? source.numero, { min: 1, max: 999999999, name: 'NUMBER', fallback: null });
    const series = String(source.series ?? source.serie ?? '').trim().toUpperCase();
    if (year.error || number.error || year.value === null || number.value === null || !/^[A-Z0-9]{1,3}$/.test(series)) {
        return null;
    }
    return { year: year.value, series, number: number.value };
}

async function resolveAlbaranOwners(key) {
    return repartidorDb.resolveAlbaranOwners(key);
}

async function resolveInvoiceOwners(key) {
    return repartidorDb.resolveInvoiceOwners(key);
}

async function resolveDeliveryOwners(entregaId) {
    return repartidorDb.resolveDeliveryOwners(entregaId);
}

function rawRepartidorId(req) {
    return String(req.query?.repartidorId || req.body?.repartidorId || '').trim();
}

function hintedRepartidorId(req) {
    return canonicalRepartidorCode(rawRepartidorId(req));
}

function uniqueActorCodes(values) {
    return [...new Set((values || [])
        .map(canonicalRepartidorCode)
        .filter(Boolean))];
}

function normalizeVendorCode(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.replace(/^0+/, '') || raw;
}

function actorVendorCodes(user) {
    const own = String(user?.code || user?.id || '').trim();
    const tokenCodes = [
        ...(Array.isArray(user?.vendorCodes) ? user.vendorCodes : []),
        ...(Array.isArray(user?.vendedorCodes) ? user.vendedorCodes : []),
        own,
    ];
    return uniqueActorCodes(tokenCodes);
}

function vendorCodesIntersect(left, right) {
    const allowed = new Set(right.map(normalizeVendorCode).filter(Boolean));
    return left.some((code) => allowed.has(normalizeVendorCode(code)));
}

function authorizeResolvedOwner(req, res, rows, { requireRepartoOwnerHint = false } = {}) {
    const drivers = uniqueActorCodes((rows || []).map((row) => row.OWNER_ID));
    const vendors = uniqueActorCodes((rows || []).map((row) => row.VENDOR_ID));
    if (drivers.length === 0 && vendors.length === 0) {
        sendRouteError(res, 404, 'DOCUMENT_NOT_FOUND');
        return false;
    }
    const role = normalizedRole(req.user);
    const hinted = hintedRepartidorId(req);
    const repartoActor = role === 'REPARTIDOR' || isRepartoPrivileged(req.user);
    if (requireRepartoOwnerHint && repartoActor) {
        const authorized = authorizedRepartidorIds(req, res, hinted);
        if (!authorized || authorized.length !== 1) return false;
        const matchingDriver = drivers.find((driver) =>
            normalizeVendorCode(driver) === normalizeVendorCode(authorized[0]));
        if (!matchingDriver) {
            sendRouteError(res, 403, 'DOCUMENT_ACCESS_DENIED');
            return false;
        }
        req.documentOwnerId = matchingDriver;
        return true;
    }
    if (role === 'COMERCIAL' && vendorCodesIntersect(actorVendorCodes(req.user), vendors)) {
        req.documentOwnerId = vendors[0];
        return true;
    }
    sendRouteError(res, 403, 'DOCUMENT_ACCESS_DENIED');
    return false;
}

function documentOwnershipGuard(keyParser, ownerResolver, sourceSelector, options) {
    return async (req, res, next) => {
        const key = keyParser(sourceSelector(req));
        if (!key) return sendRouteError(res, 422, 'DOCUMENT_KEY_INVALID');
        if (options?.requireRepartoOwnerHint && !prevalidateStrictDocumentOwner(req, res)) return;
        try {
            const rows = await ownerResolver(key);
            if (!authorizeResolvedOwner(req, res, rows, options)) return;
            req.documentOwnershipKey = key;
            return next();
        } catch (_error) {
            logger.error('[REPARTIDOR] Document ownership lookup failed');
            return sendRouteError(res, 503, 'DOCUMENT_OWNER_LOOKUP_FAILED');
        }
    };
}

function prevalidateStrictDocumentOwner(req, res) {
    const role = normalizedRole(req.user);
    const activeMode = String(req.user?.activeMode || '').trim().toUpperCase();
    const raw = rawRepartidorId(req);
    const hint = hintedRepartidorId(req);
    if ((role === 'ADMIN' || role === 'JEFE_VENTAS') && activeMode !== 'REPARTIDOR') {
        sendRouteError(res, 403, 'DOCUMENT_REPARTO_MODE_REQUIRED');
        return false;
    }
    if (role === 'REPARTIDOR' || role === 'JEFE_VENTAS' || role === 'ADMIN') {
        if (!hint || raw.includes(',') || /^ALL$/i.test(raw)) {
            sendRouteError(res, 422, 'DOCUMENT_OWNER_REQUIRED');
            return false;
        }
        const authorized = authorizedRepartidorIds(req, res, hint);
        return Boolean(authorized && authorized.length === 1);
    }
    return true;
}

const strictRepartoDocumentOwner = { requireRepartoOwnerHint: true };
const albaranQueryOwnership = documentOwnershipGuard(parseAlbaranOwnershipKey, resolveAlbaranOwners, (req) => req.query, strictRepartoDocumentOwner);
const albaranParamOwnership = documentOwnershipGuard(parseAlbaranOwnershipKey, resolveAlbaranOwners, (req) => req.params, strictRepartoDocumentOwner);
const invoiceParamOwnership = documentOwnershipGuard(parseInvoiceOwnershipKey, resolveInvoiceOwners, (req) => req.params, strictRepartoDocumentOwner);
const documentBodyOwnership = documentOwnershipGuard(
    (body) => String(body.type || 'albaran').toLowerCase() === 'factura'
        ? parseInvoiceOwnershipKey(body)
        : String(body.type || 'albaran').toLowerCase() === 'albaran'
            ? parseAlbaranOwnershipKey(body)
            : null,
    async (key) => Object.prototype.hasOwnProperty.call(key, 'terminal')
        ? resolveAlbaranOwners(key)
        : resolveInvoiceOwners(key),
    (req) => req.body || {},
    strictRepartoDocumentOwner
);

function validateDocumentEmailRequest(req, res, next) {
    const destinatario = String(req.body?.destinatario || '').trim();
    const asunto = String(req.body?.asunto || '').trim();
    const cuerpo = String(req.body?.cuerpo || '').trim();
    if (destinatario.length > 180 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinatario)) {
        return sendRouteError(res, 422, 'EMAIL_INVALID');
    }
    if (asunto.length > 200 || cuerpo.length > 5000) {
        return sendRouteError(res, 422, 'EMAIL_CONTENT_INVALID');
    }
    if (!prevalidateStrictDocumentOwner(req, res)) return;
    req.documentEmail = { destinatario, asunto, cuerpo };
    return next();
}

async function deliveryOwnership(req, res, next) {
    const entregaId = String(req.params.entregaId || '').trim();
    if (!/^\d{1,18}$/.test(entregaId)) return sendRouteError(res, 422, 'DELIVERY_ID_INVALID');
    if (!prevalidateStrictDocumentOwner(req, res)) return;
    try {
        const rows = await resolveDeliveryOwners(entregaId);
        if (!authorizeResolvedOwner(req, res, rows, strictRepartoDocumentOwner)) return;
        return next();
    } catch (_error) {
        logger.error('[REPARTIDOR] Delivery ownership lookup failed');
        return sendRouteError(res, 503, 'DOCUMENT_OWNER_LOOKUP_FAILED');
    }
}

async function legacySignatureOwnership(req, res, next) {
    const parts = String(req.params.id || '').split('-');
    const key = parts.length === 4
        ? parseAlbaranOwnershipKey({ year: parts[0], series: parts[1], terminal: parts[2], number: parts[3] })
        : null;
    if (!key) return sendRouteError(res, 422, 'DOCUMENT_KEY_INVALID');
    if (!prevalidateStrictDocumentOwner(req, res)) return;
    try {
        const rows = await resolveAlbaranOwners(key);
        if (!authorizeResolvedOwner(req, res, rows, strictRepartoDocumentOwner)) return;
        req.documentOwnershipKey = key;
        return next();
    } catch (_error) {
        logger.error('[REPARTIDOR] Legacy signature ownership lookup failed');
        return sendRouteError(res, 503, 'DOCUMENT_OWNER_LOOKUP_FAILED');
    }
}
function canonicalRepartoMutationRequired(_req, res) {
    return res.status(410).json({
        success: false,
        code: 'CANONICAL_REPARTO_ROUTE_REQUIRED',
        error: 'Usa POST /api/repartidor-finanzas/rutero/confirm-delivery-cobro',
    });
}

// Legacy write endpoints are permanently retired. Canonical confirmation and
// finance routes own every repartidor mutation and expose idempotent contracts.
router.post('/entregas', verifyToken, canonicalRepartoMutationRequired);
router.post('/entregas/:entregaId/firma', verifyToken, canonicalRepartoMutationRequired);
router.post('/entregas/:entregaId/lineas', verifyToken, canonicalRepartoMutationRequired);
router.post('/cobros', verifyToken, canonicalRepartoMutationRequired);
// Ownership gates resolve a unique
// document owner from the complete document key before any signature, PDF or
// sharing work can execute.
router.get('/history/signature', verifyToken, albaranQueryOwnership);
router.get('/entregas/:entregaId/firma', verifyToken, deliveryOwnership);
router.get('/history/legacy-signature/:id', verifyToken, legacySignatureOwnership);
router.get('/document/albaran/:year/:serie/:terminal/:number/pdf', verifyToken, albaranParamOwnership);
router.get('/document/invoice/:year/:serie/:number/pdf', verifyToken, invoiceParamOwnership);
router.post('/document/send-email', verifyToken, validateDocumentEmailRequest, documentBodyOwnership);
router.post('/document/share/whatsapp', verifyToken, documentBodyOwnership);

// NOTE: the guarded GET/POST registrations above are middleware-only chains;
// each one calls next() into its terminal handler further below in this file.
// They look duplicated but are intentional ownership gates. Do not remove.

// Commission configuration (30% threshold for repartidores)
const REPARTIDOR_CONFIG = {
    threshold: 30.0, // 30% minimum to earn commission
    tiers: [
        { min: 100.01, max: 103.00, pct: 1.0 },
        { min: 103.01, max: 106.00, pct: 1.3 },
        { min: 106.01, max: 110.00, pct: 1.6 },
        { min: 110.01, max: 999.99, pct: 2.0 }
    ]
};

// =============================================================================
// GET /collections/summary/:repartidorId
// Resumen de cobros por cliente para un repartidor
// =============================================================================
router.get('/collections/summary/:repartidorId', verifyToken, async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { year, month } = req.query;

        const yearResult = parseBoundedInt(year, { min: 2000, max: 2100, name: 'YEAR', fallback: new Date().getFullYear() });
        const monthResult = parseBoundedInt(month, { min: 1, max: 12, name: 'MONTH', fallback: new Date().getMonth() + 1 });
        if (yearResult.error || monthResult.error) return sendRouteError(res, 422, yearResult.error || monthResult.error);
        const selectedYear = yearResult.value;
        const selectedMonth = monthResult.value;
        const repartidorParams = authorizedRepartidorIds(req, res, repartidorId);
        if (!repartidorParams) return;

        const repartidorKey = repartidorParams.join(',');
        logger.info(`[REPARTIDOR] Getting collections summary for ${repartidorKey} (${selectedMonth}/${selectedYear})`);

        let rows = [];
        try {
            rows = await repartidorDb.getCollectionsSummary(selectedMonth, selectedYear, repartidorParams);
        } catch (_queryError) {
            logger.warn('[REPARTIDOR] Query error in collections/summary');
            return sendRouteError(res, 503, 'REPARTIDOR_COLLECTIONS_UNAVAILABLE');
        }
        if (rows.some((row) =>
            Number(row.CVC_DOCUMENTOS || 0) !== Number(row.NUM_DOCUMENTOS || 0) ||
            Number(row.CVC_AMBIGUOUS_DOCUMENTS || 0) > 0
        ) && !repartidorDb.isIsolatedTestTableSet()) {
            return sendRouteError(res, 503, 'REPARTIDOR_COLLECTION_DATA_INCOMPLETE');
        }

        const cvcIncomplete = rows.some((row) =>
            Number(row.CVC_DOCUMENTOS || 0) !== Number(row.NUM_DOCUMENTOS || 0) ||
            Number(row.CVC_AMBIGUOUS_DOCUMENTS || 0) > 0
        );
        const availability = cvcIncomplete || rows.batchStatus === 'PARTIAL' ? 'PARTIAL' : 'AVAILABLE';
        let overlay = { total: 0, byDay: [] };
        try {
            overlay = await repartidorDb.getAppCollectedOverlay({
                month: selectedMonth,
                year: selectedYear,
                repartidorIds: repartidorParams,
            });
        } catch (_overlayError) {
            logger.warn('[REPARTIDOR] App cobros overlay unavailable');
        }

        // Calculate commissions for each client
        const clients = rows.map(row => {
            const collectable = parseFloat(row.TOTAL_COBRABLE) || 0;
            const collected = parseFloat(row.TOTAL_COBRADO) || 0;
            const pending = parseFloat(row.TOTAL_PENDIENTE) || 0;
            const percentage = collectable > 0 ? (collected / collectable) * 100 : 0;
            const thresholdMet = percentage >= REPARTIDOR_CONFIG.threshold;

            // Only calculate commission if threshold met AND > 100%
            let commission = 0;
            let tier = 0;
            if (thresholdMet && percentage > 100) {
                const excess = collected - collectable;
                for (const t of REPARTIDOR_CONFIG.tiers) {
                    if (percentage >= t.min && percentage <= t.max) {
                        commission = excess * (t.pct / 100);
                        tier = REPARTIDOR_CONFIG.tiers.indexOf(t) + 1;
                        break;
                    }
                }
            }

            // Map forma pago
            const fp = String(row.FORMA_PAGO || '').toUpperCase();
            let paymentType = 'Otro';
            if (fp.includes('CTR') || fp.includes('CONTADO')) paymentType = 'Contado';
            else if (fp.includes('REP')) paymentType = 'Reposición';
            else if (fp.includes('MEN')) paymentType = 'Mensual';

            return {
                clientId: row.CLIENTE,
                clientName: row.NOMBRE_CLIENTE || row.CLIENTE,
                collectable,
                collected,
                pending,
                collectionAvailability: availability,
                percentage: parseFloat(percentage.toFixed(2)),
                thresholdMet,
                thresholdProgress: Math.min(percentage / REPARTIDOR_CONFIG.threshold, 1),
                commission: parseFloat(commission.toFixed(2)),
                tier,
                paymentType,
                numDocuments: row.NUM_DOCUMENTOS
            };
        });

        if (overlay.total > 0) {
            clients.push({
                clientId: '_APP',
                clientName: 'Cobros registrados en la app',
                collectable: 0,
                collected: parseFloat(Number(overlay.total).toFixed(2)),
                pending: 0,
                collectionAvailability: availability,
                percentage: 0,
                thresholdMet: false,
                thresholdProgress: 0,
                commission: 0,
                tier: 0,
                paymentType: 'App',
                numDocuments: 0,
            });
        }

        // Calculate totals
        const totalCollectable = clients.reduce((sum, c) => sum + c.collectable, 0);
        const totalCollected = clients.reduce((sum, c) => sum + c.collected, 0);
        const totalCommission = clients.reduce((sum, c) => sum + c.commission, 0);
        const overallPercentage = totalCollectable > 0 ? (totalCollected / totalCollectable) * 100 : 0;

        res.json({
            success: true,
            repartidorId,
            period: { year: selectedYear, month: selectedMonth },
            summary: {
                totalCollectable: parseFloat(totalCollectable.toFixed(2)),
                totalCollected: parseFloat(totalCollected.toFixed(2)),
                totalCommission: parseFloat(totalCommission.toFixed(2)),
                overallPercentage: parseFloat(overallPercentage.toFixed(2)),
                thresholdMet: overallPercentage >= REPARTIDOR_CONFIG.threshold,
                clientCount: clients.length
            },
            collectionAvailability: availability,
            clients
        });

    } catch (_error) {
        logger.error('[REPARTIDOR] Error in collections/summary');
        sendRouteError(res, 503, 'REPARTIDOR_SUMMARY_FAILED');
    }
});

// =============================================================================
// GET /collections/daily/:repartidorId
// Acumulado diario de cobros del mes
// =============================================================================
router.get('/collections/daily/:repartidorId', verifyToken, async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { year, month } = req.query;

        const yearResult = parseBoundedInt(year, { min: 2000, max: 2100, name: 'YEAR', fallback: new Date().getFullYear() });
        const monthResult = parseBoundedInt(month, { min: 1, max: 12, name: 'MONTH', fallback: new Date().getMonth() + 1 });
        if (yearResult.error || monthResult.error) return sendRouteError(res, 422, yearResult.error || monthResult.error);
        const selectedYear = yearResult.value;
        const selectedMonth = monthResult.value;

        const repartidorIdList = authorizedRepartidorIds(req, res, repartidorId);
        if (!repartidorIdList) return;

        const repartidorKey = repartidorIdList.join(',');
        logger.info(`[REPARTIDOR] Getting daily collections for ${repartidorKey}`);

        let rows = [];
        try {
            rows = await repartidorDb.getCollectionsDaily(selectedYear, selectedMonth, repartidorIdList);
        } catch (_queryError) {
            logger.warn('[REPARTIDOR] Query error in collections/daily');
            return sendRouteError(res, 503, 'REPARTIDOR_COLLECTIONS_UNAVAILABLE');
        }
        if (rows.some((row) =>
            Number(row.CVC_DOCUMENTOS || 0) !== Number(row.NUM_DOCUMENTOS || 0) ||
            Number(row.CVC_AMBIGUOUS_DOCUMENTS || 0) > 0
        ) && !repartidorDb.isIsolatedTestTableSet()) {
            return sendRouteError(res, 503, 'REPARTIDOR_COLLECTION_DATA_INCOMPLETE');
        }

        const cvcIncomplete = rows.some((row) =>
            Number(row.CVC_DOCUMENTOS || 0) !== Number(row.NUM_DOCUMENTOS || 0) ||
            Number(row.CVC_AMBIGUOUS_DOCUMENTS || 0) > 0
        );
        const availability = cvcIncomplete || rows.batchStatus === 'PARTIAL' ? 'PARTIAL' : 'AVAILABLE';
        let overlay = { total: 0, byDay: [] };
        try {
            overlay = await repartidorDb.getAppCollectedOverlay({
                month: selectedMonth,
                year: selectedYear,
                repartidorIds: repartidorIdList,
            });
        } catch (_overlayError) {
            logger.warn('[REPARTIDOR] App cobros overlay unavailable');
        }
        const overlayByDay = new Map(overlay.byDay.map((row) => [Number(row.day), Number(row.collected) || 0]));

        const daily = rows.map(row => {
            const appCollected = overlayByDay.get(Number(row.DIA)) || 0;
            overlayByDay.delete(Number(row.DIA));
            return {
                day: row.DIA,
                date: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(row.DIA).padStart(2, '0')}`,
                collectable: parseFloat(row.TOTAL_COBRABLE) || 0,
                collected: (parseFloat(row.TOTAL_COBRADO) || 0) + appCollected,
                pending: parseFloat(row.TOTAL_PENDIENTE) || 0,
                collectionAvailability: availability,
            };
        });
        for (const [day, collected] of overlayByDay.entries()) {
            if (!day || collected <= 0) continue;
            daily.push({
                day,
                date: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
                collectable: 0,
                collected,
                pending: 0,
                collectionAvailability: availability,
            });
        }
        daily.sort((left, right) => Number(left.day) - Number(right.day));

        res.json({
            success: true,
            collectionAvailability: availability,
            daily
        });

    } catch (_error) {
        logger.error('[REPARTIDOR] Error in collections/daily');
        sendRouteError(res, 503, 'REPARTIDOR_DAILY_FAILED');
    }
});



// =============================================================================
// GET /history/documents/:clientId
// Historial de documentos (albaranes/facturas) de un cliente
// FIX: GROUP BY to eliminate duplicates, JOIN DELIVERY_STATUS for real status
// =============================================================================
router.get('/history/documents/:clientId', verifyToken, async (req, res) => {
    try {
        const { clientId } = req.params;
        const { repartidorId, limit, offset, dateFrom, dateTo, year } = req.query;
        if (!repartidorId) return sendRouteError(res, 400, 'REPARTIDOR_ID_REQUIRED');

        const yearResult = parseBoundedInt(year, { min: 2000, max: 2100, name: 'YEAR', fallback: null });
        const dateFromResult = parseIsoDate(dateFrom, 'DATE_FROM');
        const dateToResult = parseIsoDate(dateTo, 'DATE_TO');
        // Keep the endpoint's own nextOffset values reusable across long
        // histories while retaining a finite bound against abusive scans.
        const pagination = parsePagination({ limit, offset }, 50, 1000000);
        const validationError = yearResult.error || dateFromResult.error || dateToResult.error || pagination.limit.error || pagination.offset.error;
        if (validationError) return sendRouteError(res, 422, validationError);
        if (dateFromResult.value && dateToResult.value && dateFromResult.value > dateToResult.value) {
            return sendRouteError(res, 422, 'DATE_RANGE_INVALID');
        }

        logger.info(`[REPARTIDOR] Getting documents for client ${clientId}`);

        const ids = authorizedRepartidorIds(req, res, repartidorId);
        if (!ids) return;
        const pageLimit = pagination.limit.value;
        const pageOffset = pagination.offset.value;
        const clientCode = clientId;
        // Keep unfiltered history bounded: the mobile UI presents the last
        // three years unless the caller explicitly supplies a year or range.
        const yearValue = yearResult.value;
        const minYearValue = (!yearValue && !dateFromResult.value)
            ? (new Date().getUTCFullYear() - 2)
            : null;

        const docResult = await repartidorDb.getClientDocuments({
            repartidorIds: ids,
            clientCode,
            yearValue,
            minYearValue,
            dateFromValue: dateFromResult.value,
            dateToValue: dateToResult.value,
            pageOffset,
            pageLimit,
        });
        const rows = docResult.rows;
        const dsAvailLabel = docResult.deliveryStatusAvailability;
        const totalDocuments = Number(rows?.[0]?.TOTAL_COUNT || 0);

        // SQL performs the primary dedupe; retain a defensive in-memory guard
        // so a malformed adapter result cannot duplicate an albaran.
        const uniqueMap = new Map();
        (rows || []).filter((row) => Number(row.META_ONLY || 0) !== 1).forEach(row => {
            const subempresa = String(row.SUBEMPRESAALBARAN || '').trim();
            const serie = (row.SERIEALBARAN || '').toString().trim();
            const key = `ALB-${subempresa}-${row.EJERCICIOALBARAN}-${serie}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}`;

            if (!uniqueMap.has(key)) {
                uniqueMap.set(key, { ...row });
            }
        });
        const uniqueRows = Array.from(uniqueMap.values());
        if (uniqueRows.length < (rows || []).filter((row) => Number(row.META_ONLY || 0) !== 1).length) {
            logger.info(`[REPARTIDOR] Defensive document dedupe applied for client ${clientId}`);
        }

        // --- Helper: compute status for a row ---
        function computeRowStatus(row) {
            const canonical = String(row.CANONICAL_STATUS || '').trim().toUpperCase();
            if (canonical === 'ENTREGADO') return 'delivered';
            if (canonical === 'PARCIAL') return 'partial';
            if (['NO_ENTREGADO', 'RECHAZADO', 'NO_REALIZADA'].includes(canonical)) {
                return 'no_delivered';
            }
            const appStatus = (row.DELIVERY_STATUS || '').trim().toLowerCase();

            if (appStatus === 'delivered' || appStatus === 'entregado') {
                return 'delivered';
            }
            if (['no_delivered', 'no_entregado', 'no_realizada', 'no_realizado', 'absent', 'rechazado', 'rechazada'].includes(appStatus)) {
                return 'no_delivered';
            }
            if (appStatus === 'parcial' || appStatus === 'partial') return 'partial';
            if (appStatus === 'en_ruta') return 'en_ruta';
            // Any explicit canonical status wins over legacy flags. Unknown
            // values stay pending instead of being upgraded to delivered.
            if (appStatus) return 'pending';
            // SITUACIONALBARAN F/R is ERP paper/route state, not app delivery.
            // CONFORMADOSN remains a paper fallback only when the write-set
            // overlay (TEST in isolated_test, production tables otherwise)
            // has not already spoken.
            if ((row.CONFORMADOSN || '').trim().toUpperCase() === 'S') return 'delivered';
            return 'pending';
        }

        // --- Helper: build document from row ---
        function buildDocument(row, overrides = {}) {
            // A grouped invoice keeps header values from row, while a
            // constituent delivery may own the authoritative signature.
            const referenceRow = overrides.referenceRow || row;
            const rawAmount = Number.isFinite(Number(row.IMPORTETOTAL)) ? Number(row.IMPORTETOTAL) : 0;
            const importe = overrides.amount !== undefined ? overrides.amount : rawAmount;
            const status = computeRowStatus(row);
            const hasFirmaPath = !!referenceRow.FIRMA_PATH;
            const numFactura = parseInt(row.NUMEROFACTURA) || 0;
            const serieFactura = (row.SERIEFACTURA || '').trim();
            const ejercicioFactura = parseInt(row.EJERCICIOFACTURA) || 0;
            const isFactura = numFactura > 0;
            const legacyNombre = (referenceRow.LEGACY_FIRMA_NOMBRE || '').trim();
            const hasLegacySig = legacyNombre.length > 0;
            const subempresa = String(row.SUBEMPRESAALBARAN || '').trim();
            const serie = (row.SERIEALBARAN || 'A').trim();
            const pendingAvailability = overrides.pendingAvailability ||
                (Number(row.CVC_PRESENT || 0) === 1 ? 'AVAILABLE' : 'UNAVAILABLE');
            const preparationOrderNumber = Number(referenceRow.PREPARATION_ORDER_NUMBER);
            const preparationOrderYear = Number(referenceRow.PREPARATION_ORDER_YEAR);

            const document = {
                id: `${subempresa}-${referenceRow.EJERCICIOALBARAN}-${serie}-${referenceRow.TERMINALALBARAN}-${referenceRow.NUMEROALBARAN}`,
                subempresa,
                type: overrides.type || (isFactura ? 'factura' : 'albaran'),
                number: overrides.number !== undefined ? overrides.number : (isFactura ? numFactura : row.NUMEROALBARAN),
                albaranNumber: referenceRow.NUMEROALBARAN,
                facturaNumber: numFactura || null,
                serieFactura: serieFactura || null,
                ejercicioFactura: ejercicioFactura || null,
                serie: (referenceRow.SERIEALBARAN || 'A').trim(),
                ejercicio: referenceRow.EJERCICIOALBARAN,
                terminal: referenceRow.TERMINALALBARAN,
                preparationOrderNumber: Number.isInteger(preparationOrderNumber) && preparationOrderNumber > 0
                    ? preparationOrderNumber
                    : null,
                preparationOrderYear: Number.isInteger(preparationOrderYear) && preparationOrderYear > 0
                    ? preparationOrderYear
                    : null,
                date: `${row.ANO}-${String(row.MES).padStart(2, '0')}-${String(row.DIA).padStart(2, '0')}`,
                time: (row.HORALLEGADA && row.HORALLEGADA > 0)
                    ? `${String(row.HORALLEGADA).padStart(6, '0').substring(0, 2)}:${String(row.HORALLEGADA).padStart(6, '0').substring(2, 4)}`
                    : null,
                amount: importe,
                pendingAvailability,
                status: overrides.status || status,
                hasSignature: hasFirmaPath || hasLegacySig || !!referenceRow.CANONICAL_FIRMA_EVIDENCE_ID,
                confirmationId: overrides.confirmationId !== undefined
                    ? overrides.confirmationId
                    : referenceRow.CANONICAL_CONFIRMATION_ID == null
                    ? null
                    : String(referenceRow.CANONICAL_CONFIRMATION_ID),
                cobroId: overrides.cobroId !== undefined
                    ? overrides.cobroId
                    : referenceRow.CANONICAL_COBRO_ID == null
                    ? null
                    : String(referenceRow.CANONICAL_COBRO_ID),
                cobrado: overrides.cobrado !== undefined
                    ? overrides.cobrado
                    : referenceRow.CANONICAL_COBRADO === true,
                importeCobrado: overrides.importeCobrado !== undefined
                    ? overrides.importeCobrado
                    : (Number.isFinite(Number(referenceRow.CANONICAL_IMPORTE_COBRADO))
                        ? Number(referenceRow.CANONICAL_IMPORTE_COBRADO)
                        : null),
                importePendienteCobro: overrides.importePendienteCobro !== undefined
                    ? overrides.importePendienteCobro
                    : (Number.isFinite(Number(referenceRow.CANONICAL_IMPORTE_PENDIENTE_COBRO))
                        ? Number(referenceRow.CANONICAL_IMPORTE_PENDIENTE_COBRO)
                        : null),
                formaPagoCobro: overrides.formaPagoCobro !== undefined
                    ? overrides.formaPagoCobro
                    : (referenceRow.CANONICAL_FORMA_PAGO_COBRO
                        ? String(referenceRow.CANONICAL_FORMA_PAGO_COBRO)
                        : null),
                cobroParcial: overrides.cobroParcial !== undefined
                    ? overrides.cobroParcial
                    : referenceRow.CANONICAL_COBRO_PARCIAL === true,
                signaturePath: referenceRow.FIRMA_PATH || null,
                deliveryDate: referenceRow.DELIVERY_UPDATED_AT || null,
                deliveryRepartidor: referenceRow.DELIVERY_REPARTIDOR || null,
                deliveryObs: referenceRow.OBSERVACIONES || null,
                legacySignatureName: legacyNombre || null,
                hasLegacySignature: hasLegacySig,
                legacyDate: (referenceRow.LEGACY_ANO > 0)
                    ? `${referenceRow.LEGACY_ANO}-${String(referenceRow.LEGACY_MES).padStart(2, '0')}-${String(referenceRow.LEGACY_DIA).padStart(2, '0')} ${String(referenceRow.LEGACY_HORA).padStart(6, '0').substring(0, 2)}:${String(referenceRow.LEGACY_HORA).padStart(6, '0').substring(2, 4)}`
                    : null,
                // When grouped by factura, include constituent albaranes
                ...(overrides.albaranes ? { albaranes: overrides.albaranes } : {})
            };
            if (pendingAvailability === 'AVAILABLE') {
                document.pending = overrides.pending !== undefined
                    ? overrides.pending
                    : (Number.isFinite(Number(row.CVC_PENDING)) ? Number(row.CVC_PENDING) : 0);
            }
            return document;
        }

        // --- DEDUPLICATION PASS 2: Group albaranes by factura ---
        // When multiple albaranes share the same factura number, show ONE factura entry
        // with the summed amount (matching the factura PDF total).
        const facturaGroups = new Map(); // facturaKey -> [rows]
        const noFacturaRows = [];
        uniqueRows.forEach(row => {
            const numFactura = parseInt(row.NUMEROFACTURA) || 0;
            if (numFactura > 0) {
                const serieF = (row.SERIEFACTURA || '').trim();
                const ejercicioF = parseInt(row.EJERCICIOFACTURA) || 0;
                const subempresa = String(row.SUBEMPRESAALBARAN || '').trim();
                const fKey = `F-${subempresa}-${ejercicioF}-${serieF}-${numFactura}`;
                if (!facturaGroups.has(fKey)) {
                    facturaGroups.set(fKey, []);
                }
                facturaGroups.get(fKey).push(row);
            } else {
                noFacturaRows.push(row);
            }
        });

        const documents = [];

        // Add grouped factura entries
        for (const [fKey, fRows] of facturaGroups.entries()) {
            // CAC repeats the invoice header amount once for every constituent
            // albaran. Use that header exactly once; only sum CPC amounts when
            // CAC did not provide a header amount.
            const invoiceAmounts = [...new Set(fRows
                .filter((row) => row.IMPORTETOTAL_FACTURA !== null && row.IMPORTETOTAL_FACTURA !== undefined && row.IMPORTETOTAL_FACTURA !== '')
                .map((row) => Number(row.IMPORTETOTAL_FACTURA))
                .filter(Number.isFinite)
                .map((amount) => Number(amount.toFixed(2))))];
            // CAC can disagree across constituent albaranes (legacy ERP noise).
            // Never 503 the whole client history: prefer a single CAC header when
            // unanimous, otherwise fall back to summing CPC albaran totals.
            let totalAmount;
            if (invoiceAmounts.length === 1) {
                totalAmount = invoiceAmounts[0];
            } else {
                if (invoiceAmounts.length > 1) {
                    logger.warn(
                        `[REPARTIDOR] Ambiguous invoice header for ${fKey}: ${invoiceAmounts.join(',')}; using CPC sum`,
                    );
                }
                totalAmount = fRows.reduce(
                    (sum, row) => sum + (Number.isFinite(Number(row.IMPORTETOTAL)) ? Number(row.IMPORTETOTAL) : 0),
                    0,
                );
            }

            // Use the most recent row for display metadata (date, status, etc.)
            const primaryRow = fRows[0]; // Already sorted by date DESC
            const canonicalConfirmationRow = fRows.find((row) => row.CANONICAL_CONFIRMATION_ID != null);
            const cobroRow = fRows.find((row) => row.CANONICAL_COBRADO === true)
                || canonicalConfirmationRow;
            const referenceRow = fRows.find((row) => !!row.CANONICAL_FIRMA_EVIDENCE_ID)
                || fRows.find((row) => !!row.FIRMA_PATH)
                || fRows.find((row) => String(row.LEGACY_FIRMA_NOMBRE || '').trim())
                || cobroRow
                || primaryRow;

            const statuses = fRows.map(r => computeRowStatus(r));
            let bestStatus = 'pending';
            if (statuses.every((status) => status === 'delivered')) bestStatus = 'delivered';
            else if (statuses.includes('no_delivered')) bestStatus = 'no_delivered';
            else if (statuses.includes('partial')) bestStatus = 'partial';
            else if (statuses.includes('pending')) bestStatus = 'pending';
            else if (statuses.includes('en_ruta')) bestStatus = 'en_ruta';

            const pendingAvailable = fRows.every((row) => Number(row.CVC_PRESENT || 0) === 1);
            const pendingAmount = pendingAvailable
                ? fRows.reduce((sum, row) => sum + (Number.isFinite(Number(row.CVC_PENDING)) ? Number(row.CVC_PENDING) : 0), 0)
                : undefined;

            const albaranes = fRows.map(r => {
                const s = (r.SERIEALBARAN || 'A').trim();
                return {
                    subempresa: String(r.SUBEMPRESAALBARAN || '').trim(),
                    serie: s,
                    terminal: r.TERMINALALBARAN,
                    numero: r.NUMEROALBARAN,
                    ejercicio: r.EJERCICIOALBARAN,
                    amount: Number.isFinite(Number(r.IMPORTETOTAL)) ? Number(r.IMPORTETOTAL) : 0
                };
            });

            documents.push(buildDocument(primaryRow, {
                type: 'factura',
                number: parseInt(primaryRow.NUMEROFACTURA),
                amount: totalAmount,
                status: bestStatus,
                pendingAvailability: pendingAvailable ? 'AVAILABLE' : 'UNAVAILABLE',
                pending: pendingAmount,
                referenceRow,
                confirmationId: canonicalConfirmationRow?.CANONICAL_CONFIRMATION_ID == null
                    ? undefined
                    : String(canonicalConfirmationRow.CANONICAL_CONFIRMATION_ID),
                cobroId: cobroRow?.CANONICAL_COBRO_ID == null
                    ? undefined
                    : String(cobroRow.CANONICAL_COBRO_ID),
                cobrado: cobroRow?.CANONICAL_COBRADO === true,
                importeCobrado: Number.isFinite(Number(cobroRow?.CANONICAL_IMPORTE_COBRADO))
                    ? Number(cobroRow.CANONICAL_IMPORTE_COBRADO)
                    : null,
                importePendienteCobro: Number.isFinite(Number(cobroRow?.CANONICAL_IMPORTE_PENDIENTE_COBRO))
                    ? Number(cobroRow.CANONICAL_IMPORTE_PENDIENTE_COBRO)
                    : null,
                formaPagoCobro: cobroRow?.CANONICAL_FORMA_PAGO_COBRO
                    ? String(cobroRow.CANONICAL_FORMA_PAGO_COBRO)
                    : null,
                cobroParcial: cobroRow?.CANONICAL_COBRO_PARCIAL === true,
                albaranes: albaranes.length > 1 ? albaranes : undefined
            }));

            if (fRows.length > 1) {
                logger.info(`[REPARTIDOR] Factura ${fKey}: grouped ${fRows.length} albaranes, total=${totalAmount.toFixed(2)}`);
            }
        }

        // Add non-factura albaranes as individual entries
        noFacturaRows.forEach(row => {
            documents.push(buildDocument(row));
        });

        // Sort by date DESC, then number DESC
        documents.sort((a, b) => {
            if (a.date !== b.date) return b.date.localeCompare(a.date);
            return (b.number || 0) - (a.number || 0);
        });

        res.json({
            success: true,
            clientId,
            total: totalDocuments,
            deliveryStatusAvailability: dsAvailLabel,
            pagination: {
                limit: pageLimit,
                offset: pageOffset,
                hasMore: pageOffset + documents.length < totalDocuments,
                nextOffset: pageOffset + documents.length
            },
            documents
        });

    } catch (error) {
        logger.error(`[REPARTIDOR] Error in history/documents: ${String(error?.message || error).slice(0, 240)}`);
        sendRouteError(res, 503, 'REPARTIDOR_DOCUMENTS_FAILED');
    }
});

// =============================================================================
// GET /history/objectives/:repartidorId
// Seguimiento del objetivo 30% por mes
// =============================================================================
router.get('/history/objectives/:repartidorId', verifyToken, async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { clientId } = req.query;
        const normalizedClientId = typeof clientId === 'string' ? clientId.trim() : '';

        logger.info(`[REPARTIDOR] Getting objectives for ${repartidorId}${normalizedClientId ? ` client ${normalizedClientId}` : ''}`);
        const cleanRepartidorIds = authorizedRepartidorIds(req, res, repartidorId);
        if (!cleanRepartidorIds) return;
        const rows = await repartidorDb.getObjectives(cleanRepartidorIds, normalizedClientId);

        const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

        const objectives = rows.map(row => {
            const collectable = parseFloat(row.TOTAL_COBRABLE) || 0;
            const collected = parseFloat(row.TOTAL_COBRADO) || 0;
            const percentage = collectable > 0 ? (collected / collectable) * 100 : 0;

            return {
                month: `${months[row.MES - 1]} ${row.ANO}`,
                year: row.ANO,
                monthNum: row.MES,
                collectable,
                collected,
                percentage: parseFloat(percentage.toFixed(2)),
                thresholdMet: percentage >= REPARTIDOR_CONFIG.threshold
            };
        });

        res.json({
            success: true,
            objectives
        });

    } catch (_error) {
        logger.error('[REPARTIDOR] Error in history/objectives');
        sendRouteError(res, 503, 'REPARTIDOR_OBJECTIVES_FAILED');
    }
});

// =============================================================================
// GET /history/objectives-detail/:repartidorId
// Desglose jerárquico: Año → Cliente → FI1 → FI2 → FI3 → FI4 → Productos
// =============================================================================
router.get('/history/objectives-detail/:repartidorId', verifyToken, async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { year, clientId, limit, offset } = req.query;

        const yearResult = parseBoundedInt(year, { min: 2000, max: 2100, name: 'YEAR', fallback: new Date().getFullYear() });
        if (yearResult.error) return sendRouteError(res, 422, yearResult.error);
        const selectedYear = yearResult.value;
        const paginationInput = parsePagination({ limit, offset }, 100, 1000000);
        const paginationError = paginationInput.limit.error || paginationInput.offset.error;
        if (paginationError) return sendRouteError(res, 422, paginationError);
        const repartidorIdList = authorizedRepartidorIds(req, res, repartidorId);
        if (!repartidorIdList) return;

        const repartidorKey = repartidorIdList.join(',');

        logger.info(`[REPARTIDOR] Objectives detail for ${repartidorId}, year ${selectedYear}${clientId ? `, client ${clientId}` : ''}`);

        const pageLimit = paginationInput.limit.value;
        const pageOffset = paginationInput.offset.value;
        const clientPage = await repartidorDb.getObjectivesDetailClients(
            repartidorIdList,
            selectedYear,
            clientId,
            { limit: pageLimit, offset: pageOffset }
        );
        const clientRows = Array.isArray(clientPage.rows) ? clientPage.rows : [];
        const total = Number(clientPage.total || 0);
        if (clientRows.length === 0) {
            const completeScope = total === 0 && pageOffset === 0;
            return res.json({
                success: true, clients: [], year: selectedYear,
                pageTotal: { sales: 0, cost: 0, units: 0, margin: 0 },
                grandTotal: completeScope ? { sales: 0, cost: 0, units: 0, margin: 0 } : null,
                scopeTotalAvailability: completeScope ? 'COMPLETE' : 'PAGED',
                pagination: { limit: pageLimit, offset: pageOffset, total, hasMore: false, nextOffset: null }
            });
        }

        const clientNames = {};
        clientRows.forEach(r => {
            const code = (r.CLIENT_CODE || '').trim();
            clientNames[code] = (r.CLIENT_NAME || '').trim() || `CLIENTE ${code}`;
        });

        const allCodes = Object.keys(clientNames);
        const rows = await repartidorDb.getObjectivesDetailLaclae(allCodes, selectedYear);

        // 3. Load FI names from metadata cache
        let fi1Names = {}, fi2Names = {}, fi3Names = {}, fi4Names = {};
        try {
            const { isCacheReady, getCachedFi1Names, getCachedFi2Names, getCachedFi3Names, getCachedFi4Names } = require('../services/metadataCache');
            if (isCacheReady()) {
                fi1Names = getCachedFi1Names() || {};
                fi2Names = getCachedFi2Names() || {};
                fi3Names = getCachedFi3Names() || {};
                fi4Names = getCachedFi4Names() || {};
            } else {
                const { fi1Rows, fi2Rows, fi3Rows, fi4Rows } = await repartidorDb.getFiFilterCatalog();
                fi1Rows.forEach(r => { fi1Names[(r.CODIGOFILTRO || '').trim()] = (r.DESCRIPCIONFILTRO || '').trim(); });
                fi2Rows.forEach(r => { fi2Names[(r.CODIGOFILTRO || '').trim()] = (r.DESCRIPCIONFILTRO || '').trim(); });
                fi3Rows.forEach(r => { fi3Names[(r.CODIGOFILTRO || '').trim()] = (r.DESCRIPCIONFILTRO || '').trim(); });
                fi4Rows.forEach(r => { fi4Names[(r.CODIGOFILTRO || '').trim()] = (r.DESCRIPCIONFILTRO || '').trim(); });
            }
        } catch (e) {
            logger.warn(`[REPARTIDOR] Could not load FI names: ${e.message}`);
        }

        // 4. Build hierarchy: Client → FI1 → FI2 → FI3 → FI4 → Products
        const clientMap = new Map();

        clientRows.forEach(row => {
            const code = String(row.CLIENT_CODE || '').trim();
            if (!code) return;
            clientMap.set(code, {
                code,
                name: clientNames[code] || `CLIENTE ${code}`,
                totalSales: 0, totalCost: 0, totalUnits: 0,
                productCount: new Set(),
                families: new Map()
            });
        });

        rows.forEach(row => {
            const cCode = (row.CLIENT_CODE || '').trim();
            const pCode = (row.PRODUCT_CODE || '').trim();
            const pName = (row.PRODUCT_NAME || '').trim() || 'Sin nombre';
            const unitType = (row.UNIT_TYPE || '').trim();
            const month = parseInt(row.MONTH);
            const sales = parseFloat(row.SALES) || 0;
            const cost = parseFloat(row.COST) || 0;
            const units = parseFloat(row.UNITS) || 0;
            const fi1 = (row.FI1_CODE || '').trim() || 'SIN_CAT';
            const fi2 = (row.FI2_CODE || '').trim() || 'General';
            const fi3 = (row.FI3_CODE || '').trim() || '';
            const fi4 = (row.FI4_CODE || '').trim() || '';

            // Client level
            if (!clientMap.has(cCode)) {
                clientMap.set(cCode, {
                    code: cCode,
                    name: clientNames[cCode] || `CLIENTE ${cCode}`,
                    totalSales: 0, totalCost: 0, totalUnits: 0,
                    productCount: new Set(),
                    families: new Map()
                });
            }
            const client = clientMap.get(cCode);
            client.totalSales += sales;
            client.totalCost += cost;
            client.totalUnits += units;
            client.productCount.add(pCode);

            // FI1 level
            if (!client.families.has(fi1)) {
                client.families.set(fi1, {
                    code: fi1,
                    name: fi1Names[fi1] ? `${fi1} - ${fi1Names[fi1]}` : (fi1 === 'SIN_CAT' ? 'Sin Categoría' : fi1),
                    totalSales: 0, totalCost: 0, totalUnits: 0,
                    children: new Map()
                });
            }
            const fi1Level = client.families.get(fi1);
            fi1Level.totalSales += sales;
            fi1Level.totalCost += cost;
            fi1Level.totalUnits += units;

            // FI2 level
            if (!fi1Level.children.has(fi2)) {
                fi1Level.children.set(fi2, {
                    code: fi2,
                    name: fi2Names[fi2] ? `${fi2} - ${fi2Names[fi2]}` : fi2,
                    totalSales: 0, totalCost: 0, totalUnits: 0,
                    children: new Map()
                });
            }
            const fi2Level = fi1Level.children.get(fi2);
            fi2Level.totalSales += sales;
            fi2Level.totalCost += cost;
            fi2Level.totalUnits += units;

            // FI3 level (skip if empty)
            const fi3Key = fi3 || '_default';
            if (!fi2Level.children.has(fi3Key)) {
                fi2Level.children.set(fi3Key, {
                    code: fi3 || '',
                    name: fi3 && fi3Names[fi3] ? `${fi3} - ${fi3Names[fi3]}` : (fi3 || 'General'),
                    totalSales: 0, totalCost: 0, totalUnits: 0,
                    children: new Map()
                });
            }
            const fi3Level = fi2Level.children.get(fi3Key);
            fi3Level.totalSales += sales;
            fi3Level.totalCost += cost;
            fi3Level.totalUnits += units;

            // FI4 level (skip if empty)
            const fi4Key = fi4 || '_default';
            if (!fi3Level.children.has(fi4Key)) {
                fi3Level.children.set(fi4Key, {
                    code: fi4 || '',
                    name: fi4 && fi4Names[fi4] ? `${fi4} - ${fi4Names[fi4]}` : (fi4 || 'General'),
                    totalSales: 0, totalCost: 0, totalUnits: 0,
                    products: new Map()
                });
            }
            const fi4Level = fi3Level.children.get(fi4Key);
            fi4Level.totalSales += sales;
            fi4Level.totalCost += cost;
            fi4Level.totalUnits += units;

            // Product level
            if (!fi4Level.products.has(pCode)) {
                fi4Level.products.set(pCode, {
                    code: pCode, name: pName, unitType,
                    totalSales: 0, totalCost: 0, totalUnits: 0,
                    monthlyData: {}
                });
            }
            const product = fi4Level.products.get(pCode);
            product.totalSales += sales;
            product.totalCost += cost;
            product.totalUnits += units;
            product.monthlyData[month] = (product.monthlyData[month] || 0) + sales;
        });

        // 5. Convert Maps to arrays for JSON, sorted by sales desc
        const compareHierarchyNodes = (a, b) => {
            const salesDelta = (Number(b.totalSales) || 0) - (Number(a.totalSales) || 0);
            if (salesDelta !== 0) return salesDelta;
            const codeDelta = String(a.code || '').localeCompare(String(b.code || ''), 'es', { numeric: true, sensitivity: 'base' });
            if (codeDelta !== 0) return codeDelta;
            return String(a.name || '').localeCompare(String(b.name || ''), 'es', { numeric: true, sensitivity: 'base' });
        };
        const mapToArray = (map) => Array.from(map.values()).sort(compareHierarchyNodes);

        const clients = mapToArray(clientMap).map(client => ({
            code: client.code,
            name: client.name,
            totalSales: client.totalSales,
            totalCost: client.totalCost,
            totalUnits: client.totalUnits,
            productCount: client.productCount.size,
            margin: client.totalSales > 0 ? ((client.totalSales - client.totalCost) / client.totalSales * 100) : 0,
            families: mapToArray(client.families).map(fi1 => ({
                code: fi1.code, name: fi1.name,
                totalSales: fi1.totalSales, totalCost: fi1.totalCost, totalUnits: fi1.totalUnits,
                children: mapToArray(fi1.children).map(fi2 => ({
                    code: fi2.code, name: fi2.name,
                    totalSales: fi2.totalSales, totalCost: fi2.totalCost, totalUnits: fi2.totalUnits,
                    children: mapToArray(fi2.children).map(fi3 => ({
                        code: fi3.code, name: fi3.name,
                        totalSales: fi3.totalSales, totalCost: fi3.totalCost, totalUnits: fi3.totalUnits,
                        children: mapToArray(fi3.children).map(fi4 => ({
                            code: fi4.code, name: fi4.name,
                            totalSales: fi4.totalSales, totalCost: fi4.totalCost, totalUnits: fi4.totalUnits,
                            products: Array.from(fi4.products.values()).sort(compareHierarchyNodes)
                        }))
                    }))
                }))
            }))
        }));

        // Totals for this deterministic client page. Never label a partial
        // fleet page as a global total.
        let grandSales = 0, grandCost = 0, grandUnits = 0;
        clients.forEach(c => { grandSales += c.totalSales; grandCost += c.totalCost; grandUnits += c.totalUnits; });
        const pageTotal = { sales: grandSales, cost: grandCost, units: grandUnits, margin: grandSales > 0 ? ((grandSales - grandCost) / grandSales * 100) : 0 };
        const hasMore = pageOffset + clientRows.length < total;
        const completeScope = pageOffset === 0 && !hasMore;

        logger.info(`[REPARTIDOR] Objectives detail: ${clients.length} clients, ${rows.length} data rows`);

        res.json({
            success: true,
            year: selectedYear,
            pageTotal,
            grandTotal: completeScope ? pageTotal : null,
            scopeTotalAvailability: completeScope ? 'COMPLETE' : 'PAGED',
            clients,
            pagination: {
                limit: pageLimit, offset: pageOffset, total, hasMore,
                nextOffset: hasMore ? pageOffset + clientRows.length : null
            }
        });

    } catch (_error) {
        logger.error('[REPARTIDOR] Error in objectives-detail');
        sendRouteError(res, 503, 'REPARTIDOR_OBJECTIVES_DETAIL_FAILED');
    }
});

// =============================================================================
// GET /history/signature
// Retrieve real signature (base64) for a given albaran
// =============================================================================
router.get('/history/signature', verifyToken, async (req, res) => {
    try {
        const { ejercicio, serie, terminal, numero } = req.query;
        if (!ejercicio || !numero) {
            return res.json({ success: true, hasSignature: false });
        }

        const albId = `${ejercicio}-${(serie || 'A').trim()}-${terminal || '0'}-${numero}`;
        logger.info(`[REPARTIDOR] Getting signature for albaran ${albId}`);
        let signatureSource = null;

        let firmaPath = null;
        const dsOldAvail = isDeliveryStatusAvailable() && !isDeliveryStatusNewSchema();
        if (dsOldAvail) {
            const dsRows = await repartidorDb.getDeliveryStatusFirmaPath(albId);
            logger.info(`[REPARTIDOR] Step 1 DELIVERY_STATUS: ${dsRows.length} rows for ID='${albId}'`);
            if (dsRows.length > 0 && dsRows[0].FIRMA_PATH) {
                firmaPath = dsRows[0].FIRMA_PATH;
            }
        }

        let firmaBase64 = null;
        let firmante = null;
        let fechaFirma = null;
        let receptorNombre = null;
        let receptorApellidos = null;
        let receptorDni = null;
        const firmaRows = await repartidorDb.getRepartidorFirmasByAlbaran(
            numero, ejercicio, serie, terminal,
        );
        if (firmaRows.length > 0) {
            firmaBase64 = firmaRows[0].FIRMABASE64;
            firmante = (firmaRows[0].FIRMANOMBRE || '').trim() || null;
            receptorDni = (firmaRows[0].FIRMADNI || '').trim() || null;
            fechaFirma = (firmaRows[0].ANO > 0)
                ? `${firmaRows[0].ANO}-${String(firmaRows[0].MES).padStart(2, '0')}-${String(firmaRows[0].DIA).padStart(2, '0')} ${String(firmaRows[0].HORA).padStart(6, '0').substring(0, 2)}:${String(firmaRows[0].HORA).padStart(6, '0').substring(2, 4)}`
                : null;
            if (firmaBase64) signatureSource = 'REPARTIDOR_FIRMAS';
            else if (firmante) signatureSource = 'REPARTIDOR_FIRMAS_NAME_ONLY';
            logger.info(`[REPARTIDOR] Step 2 REPARTIDOR_FIRMAS: found row, hasBase64=${!!firmaBase64}`);
        } else {
            logger.info(`[REPARTIDOR] Step 2 REPARTIDOR_FIRMAS: 0 rows for numero=${numero}, ejercicio=${ejercicio}, serie='${(serie || 'A').trim()}'`);
        }
        // 3. If no base64, try reading from FIRMA_PATH file
        if (!firmaBase64 && firmaPath) {
            try {
                const pathsToTry = [];

                // If FIRMA_PATH is an absolute path, try it directly first
                if (path.isAbsolute(firmaPath)) {
                    pathsToTry.push(firmaPath);
                }
                // Try multiple base paths for relative paths
                const basePaths = [
                    path.join(__dirname, '../../uploads'),
                    path.join(__dirname, '../../uploads/photos')
                ];
                for (const basePath of basePaths) {
                    pathsToTry.push(path.join(basePath, firmaPath));
                }

                for (const fullPath of pathsToTry) {
                    if (fs.existsSync(fullPath)) {
                        const fileBuffer = await fsPromises.readFile(fullPath);
                        if (fileBuffer.length > 50) {
                            firmaBase64 = fileBuffer.toString('base64');
                            signatureSource = 'FILE';
                            logger.info(`[REPARTIDOR] Found signature file at ${fullPath} (${fileBuffer.length} bytes)`);
                            break;
                        } else {
                            logger.warn(`[REPARTIDOR] Signature file too small (${fileBuffer.length}B): ${fullPath}`);
                        }
                    }
                }
                if (!firmaBase64) {
                    logger.warn(`[REPARTIDOR] Signature file not found for path: ${firmaPath} — tried: ${pathsToTry.join(', ')}`);
                }
            } catch (e) {
                logger.warn('[REPARTIDOR] Stored signature read failed');
            }
        }

        try {
            const canonical = await repartidorDb.getCanonicalConfirmationSignature({
                year: ejercicio,
                serie,
                terminal,
                number: numero,
                ownerIds: req.documentOwnerId ? [req.documentOwnerId] : [],
            });
            if (canonical) {
                receptorNombre = canonical.receptorNombre || receptorNombre;
                receptorApellidos = canonical.receptorApellidos || receptorApellidos;
                receptorDni = canonical.receptorDni || receptorDni;
                const fullName = [canonical.receptorNombre, canonical.receptorApellidos]
                    .filter(Boolean).join(' ').trim();
                if (fullName) firmante = fullName;
                if (canonical.base64) {
                    firmaBase64 = canonical.base64;
                    signatureSource = 'CANONICAL_CONFIRMATION';
                } else if (!firmaBase64 && canonical.hasSignature) {
                    signatureSource = signatureSource || 'CANONICAL_CONFIRMATION';
                }
            }
        } catch (_error) {
            logger.warn('[REPARTIDOR] Canonical confirmation signature lookup failed');
        }

        // 4. CACFIRMAS (legacy ERP signatures) — last resort
        if (!firmaBase64) {
            try {
            const cacRows = await repartidorDb.getCacFirmasDetailed(ejercicio, serie, terminal, numero);
            logger.info(`[REPARTIDOR] Step 4 CACFIRMAS: ${cacRows.length} rows for ej=${ejercicio}, serie='${(serie || 'A').trim()}', term=${terminal || 0}, num=${numero}`);

            // Try to find one with actual base64 data
            for (const cacRow of cacRows) {
                const rawB64 = cacRow.FIRMABASE64;
                const rawLen = rawB64 ? String(rawB64).length : 0;
                const b64Len = parseInt(cacRow.FIRMA_LEN, 10) || rawLen;
                const nombre = (cacRow.FIRMANOMBRE || '').trim();
                logger.info(`[REPARTIDOR] CACFIRMAS row: len=${b64Len}, name='${nombre}', hasData=${!!rawB64 && b64Len > 10}`);

                if (rawB64 && b64Len > 10) {
                    let b64 = rawB64.toString();
                    b64 = b64.replace(/^data:image\/\w+;base64,/, '');
                    firmaBase64 = b64;
                    signatureSource = 'CACFIRMAS';
                    if (!firmante && nombre.length > 0) firmante = nombre;
                    if (!fechaFirma && cacRow.ANO > 0) {
                        fechaFirma = `${cacRow.ANO}-${String(cacRow.MES).padStart(2, '0')}-${String(cacRow.DIA).padStart(2, '0')} ${String(cacRow.HORA).padStart(6, '0').substring(0, 2)}:${String(cacRow.HORA).padStart(6, '0').substring(2, 4)}`;
                    }
                    logger.info(`[REPARTIDOR] Found legacy signature in CACFIRMAS for ${albId}`);
                    break;
                }
            }

            // If no base64 but we have rows with FIRMANOMBRE, report as name-only signature
            if (!firmaBase64 && cacRows.length > 0) {
                const nameRow = cacRows.find(r => (r.FIRMANOMBRE || '').trim().length > 0);
                if (nameRow) {
                    firmante = (nameRow.FIRMANOMBRE || '').trim();
                    signatureSource = 'CACFIRMAS_NAME_ONLY';
                    if (!fechaFirma && nameRow.ANO > 0) {
                        fechaFirma = `${nameRow.ANO}-${String(nameRow.MES).padStart(2, '0')}-${String(nameRow.DIA).padStart(2, '0')} ${String(nameRow.HORA).padStart(6, '0').substring(0, 2)}:${String(nameRow.HORA).padStart(6, '0').substring(2, 4)}`;
                    }
                    logger.info(`[REPARTIDOR] CACFIRMAS name-only signature: '${firmante}' for ${albId}`);
                } else {
                    logger.info(`[REPARTIDOR] CACFIRMAS: rows exist but no FIRMABASE64 and no FIRMANOMBRE`);
                }
            } else if (cacRows.length === 0) {
                logger.info(`[REPARTIDOR] CACFIRMAS: NO row at all for this albaran`);
            }
            } catch (cacError) {
                logger.warn(`[REPARTIDOR] Step 4 CACFIRMAS skipped: ${cacError.message}`);
            }
        }

        const receptorFull = [receptorNombre, receptorApellidos].filter(Boolean).join(' ').trim();
        const hasSignature = !!(firmaBase64 || firmaPath || signatureSource || receptorFull || receptorDni);

        logger.info(`[REPARTIDOR] Signature result for ${albId}: hasSignature=${hasSignature}, source=${signatureSource || 'none'}, hasBase64=${!!firmaBase64}, firmante='${firmante || ''}'`);

        // Sanitize source — never expose server paths to client
        const safeSource = signatureSource ? signatureSource.replace(/FILE:.*/, 'FILE').replace(/\/opt.*/, '') : null;

        res.json({
            success: true,
            hasSignature,
            signature: hasSignature ? {
                base64: firmaBase64 || null,
                path: firmaPath ? 'stored' : null,
                firmante: firmante || receptorFull || null,
                nombre: receptorNombre || null,
                apellidos: receptorApellidos || null,
                dni: receptorDni || null,
                fecha: fechaFirma || null,
                source: safeSource || null
            } : null
        });

    } catch (error) {
        logger.error('[REPARTIDOR] History signature request failed');
        sendRouteError(res, 503, 'REPARTIDOR_SIGNATURE_FAILED');
    }
});

// =============================================================================
// GET /debug/signatures - Find albaranes with actual signatures in CACFIRMAS
// Temporary diagnostic endpoint
// =============================================================================
router.get('/debug/signatures', verifyToken, async (req, res) => {
    try {
        const debugEnabled = process.env.NODE_ENV !== 'production'
            && process.env.ENABLE_REPARTIDOR_SIGNATURE_DEBUG === 'true';
        if (!debugEnabled) return res.sendStatus(404);
        if (String(req.user?.role || '').trim().toUpperCase() !== 'ADMIN') {
            return sendRouteError(res, 403, 'DEBUG_ACCESS_DENIED');
        }
        // Find recent albaranes that have signatures in CACFIRMAS
        const rows = await repartidorDb.getDebugCacSignatures();

        const signatures = rows.map(r => ({
            albaran: `${r.EJERCICIOALBARAN}-${r.SERIE}-${r.TERMINALALBARAN}-${r.NUMEROALBARAN}`,
            cliente: `${r.CLIENTE} - ${r.NOMBRE_CLIENTE}`,
            firmante: r.FIRMANTE || 'N/A',
            fecha: r.ANO > 0 ? `${r.DIA}/${r.MES}/${r.ANO}` : 'N/A',
            firmaSize: r.FIRMA_SIZE || 0
        }));

        logger.info(`[REPARTIDOR] Debug: Found ${signatures.length} albaranes with signatures in CACFIRMAS`);
        res.json({
            success: true,
            total: signatures.length,
            signatures,
            note: 'These are albaranes with actual Base64 signatures in CACFIRMAS'
        });
    } catch (error) {
        logger.error('[REPARTIDOR] Debug signatures failed');
        sendRouteError(res, 503, 'DEBUG_SIGNATURES_FAILED');
    }
});

// =============================================================================
// GET /history/delivery-summary/:repartidorId
// Summary of deliveries: totals entregados/pendientes by date range
// =============================================================================
router.get('/history/delivery-summary/:repartidorId', verifyToken, async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { year, month } = req.query;

        const yearResult = parseBoundedInt(year, { min: 2000, max: 2100, name: 'YEAR', fallback: new Date().getFullYear() });
        const monthResult = parseBoundedInt(month, { min: 1, max: 12, name: 'MONTH', fallback: new Date().getMonth() + 1 });
        if (yearResult.error || monthResult.error) return sendRouteError(res, 422, yearResult.error || monthResult.error);
        const selectedYear = yearResult.value;
        const selectedMonth = monthResult.value;
        const repartidorIdList = authorizedRepartidorIds(req, res, repartidorId);
        if (!repartidorIdList) return;

        // Only include days up to today if viewing current month/year
        // This prevents future pre-loaded albaranes from inflating the % entrega
        const now = new Date();
        const isCurrentPeriod = selectedYear === now.getFullYear() && selectedMonth === (now.getMonth() + 1);
        const dayFilter = isCurrentPeriod ? `AND OPP.DIAREPARTO <= ?` : '';
        const dayFilterParams = isCurrentPeriod ? [now.getDate()] : [];

        logger.info(`[REPARTIDOR] Delivery summary for ${repartidorId}, ${selectedMonth}/${selectedYear}${isCurrentPeriod ? ` (capped to day ${now.getDate()})` : ''}`);

        const rows = await repartidorDb.getDeliverySummary(
            selectedYear,
            selectedMonth,
            dayFilterParams,
            repartidorIdList,
        );

        let totalAlbaranes = 0, totalEntregados = 0, totalNoEntregados = 0, totalParciales = 0, totalImporte = 0;

        const daily = rows.map(row => {
            const albs = parseInt(row.TOTAL_ALBARANES) || 0;
            const ent = parseInt(row.ENTREGADOS) || 0;
            const noEnt = parseInt(row.NO_ENTREGADOS) || 0;
            const parc = parseInt(row.PARCIALES) || 0;
            const imp = parseFloat(row.IMPORTE_TOTAL) || 0;
            if ([albs, ent, noEnt, parc].some((value) => value < 0) || ent + noEnt + parc > albs) {
                throw new Error('delivery status invariant violated');
            }

            totalAlbaranes += albs;
            totalEntregados += ent;
            totalNoEntregados += noEnt;
            totalParciales += parc;
            totalImporte += imp;

            return {
                day: row.DIA,
                date: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(row.DIA).padStart(2, '0')}`,
                total: albs,
                delivered: ent,
                notDelivered: noEnt,
                partial: parc,
                pending: Math.max(0, albs - ent - noEnt - parc),
                amount: imp
            };
        });

        const pendientesRaw = totalAlbaranes - totalEntregados - totalNoEntregados - totalParciales;
        res.json({
            success: true,
            period: { year: selectedYear, month: selectedMonth },
            summary: {
                totalAlbaranes,
                entregados: Math.min(totalEntregados, totalAlbaranes),
                noEntregados: totalNoEntregados,
                parciales: totalParciales,
                pendientes: Math.max(0, pendientesRaw),
                importeTotal: parseFloat(totalImporte.toFixed(2))
            },
            daily
        });

    } catch (_error) {
        logger.error('[REPARTIDOR] Error in delivery-summary');
        sendRouteError(res, 503, 'REPARTIDOR_DELIVERY_SUMMARY_FAILED');
    }
});

// =============================================================================
// GET /document/albaran/:year/:serie/:terminal/:number/pdf
// Generate Albaran PDF with optional embedded signature
// =============================================================================
router.get('/document/albaran/:year/:serie/:terminal/:number/pdf', verifyToken, async (req, res) => {
    try {
        const { year, terminal, number } = req.params;
        const parsedYear = parseInt(year);
        const parsedTerminal = parseInt(terminal);
        const parsedNumber = parseInt(number);
        if (!parsedYear || !parsedNumber) {
            return res.status(400).json({ success: false, error: 'Parámetros year/number/terminal inválidos' });
        }
        const SENTINEL_SERIES = new Set(['UNK', 'NONE', 'NULL', 'N/A', '0', 'undefined', 'null']);
        const rawSerie = req.params.serie || '';
        const serie = SENTINEL_SERIES.has(rawSerie.toUpperCase()) ? '' : rawSerie.replace(/[^A-Z0-9]/gi, '').substring(0, 3);

        logger.info(`[PDF] Generating Albaran PDF: ${parsedYear}-${serie}-${parsedTerminal}-${parsedNumber}`);

        const documentPdfCacheKey = req.documentOwnerId
            ? 'repartidor:document-pdf:' + REPARTIDOR_PDF_CACHE_VERSION + ':albaran:' + parsedYear + ':' + serie + ':' + parsedTerminal + ':' + parsedNumber
                + ':owner:' + String(req.documentOwnerId).replace(/[^A-Za-z0-9_-]/g, '')
            : null;
        const sendPdf = (pdfBuffer, fileName) => {
            res.set({
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
                'Content-Length': pdfBuffer.length,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            return res.send(pdfBuffer);
        };
        if (documentPdfCacheKey && typeof redisCache?.get === 'function') {
            try {
                const cached = await redisCache.get('document', documentPdfCacheKey);
                if (cached?.pdfBase64 && cached.fileName) {
                    return sendPdf(Buffer.from(cached.pdfBase64, 'base64'), cached.fileName);
                }
            } catch (_cacheError) {
                logger.warn('[PDF] Albaran cache read unavailable');
            }
        }

        // 1. Fetch Header from CAC + IVA breakdown from CPC
        const headers = await repartidorDb.getAlbaranPdfHeader(parsedNumber, serie, parsedYear, parsedTerminal);

        if (!headers || headers.length === 0) {
            return res.status(404).json({ success: false, error: 'Albarán no encontrado' });
        }        if (!headers || headers.length === 0) {
            return res.status(404).json({ success: false, error: 'Albarán no encontrado' });
        }
        const header = {
            ...headers[0],
            clienteNombre: headers[0].NOMBRECLIENTEFACTURA,
            nombreComercial: headers[0].NOMBRECOMERCIALFACTURA || headers[0].NOMBRECLIENTEFACTURA,
            nombreFiscal: headers[0].NOMBREFISCALFACTURA || headers[0].NOMBRECLIENTEFACTURA,
            clienteId: headers[0].CODIGOCLIENTEFACTURA,
            clienteDireccion: headers[0].DIRECCIONCLIENTEFACTURA,
            clientePoblacion: headers[0].POBLACIONCLIENTEFACTURA,
            clienteNif: headers[0].CIFCLIENTEFACTURA,
            serie: headers[0].SERIEALBARAN,
            numero: headers[0].NUMEROALBARAN,
            total: parseFloat(headers[0].IMPORTETOTAL) || 0,
        };

        header.IVA_BREAKDOWN = {};
        for (let slot = 1; slot <= 5; slot++) {
            header.IVA_BREAKDOWN[`BI${slot}`] = headers[0][`IMPORTEBASEIMPONIBLE${slot}`] || 0;
            header.IVA_BREAKDOWN[`IVA${slot}_PCT`] = headers[0][`PORCENTAJEIVA${slot}`] || 0;
            header.IVA_BREAKDOWN[`IVA${slot}_IMP`] = headers[0][`IMPORTEIVA${slot}`] || 0;
        }

        // Legacy fallback: old CPC headers may carry IVA breakdown when CAC slots are empty.
        try {
            const hasCacBreakdown = Object.values(header.IVA_BREAKDOWN)
                .some(value => Math.abs(parseFloat(value) || 0) > 0);
            const ivaRows = await repartidorDb.getCpcIvaBreakdown(year, serie, terminal, number);
            if (!hasCacBreakdown && ivaRows.length > 0) {
                header.IVA_BREAKDOWN = ivaRows[0];
            }
        } catch (e) {
            logger.warn('[PDF] Albaran IVA lookup failed');
        }

        // 2. Fetch Lines from LAC
        const lines = await repartidorDb.getAlbaranLines(parsedYear, serie, parsedTerminal, parsedNumber);

        // 3. Try to get signature - comprehensive cascade lookup
        let signatureBase64 = null;
        let signatureSource = null;
        const albId = `${parsedYear}-${serie}-${parsedTerminal}-${parsedNumber}`;

        // Step 3a: Check DELIVERY_STATUS for FIRMA_PATH (OLD schema only)
        try {
            const dsOldAvail = isDeliveryStatusAvailable() && !isDeliveryStatusNewSchema();
            if (dsOldAvail) {
                const dsRows = await repartidorDb.getDeliveryStatusFirmaPath(albId);
                if (dsRows.length > 0 && dsRows[0].FIRMA_PATH) {
                    const basePaths = [
                        path.join(__dirname, '../../uploads'),
                        path.join(__dirname, '../../uploads/photos')
                    ];
                    for (const basePath of basePaths) {
                        const fullPath = path.join(basePath, dsRows[0].FIRMA_PATH);
                        if (fs.existsSync(fullPath)) {
                            signatureBase64 = (await fsPromises.readFile(fullPath)).toString('base64');
                            signatureSource = 'FILE';
                            logger.info(`[PDF] Found signature file at ${fullPath}`);
                            break;
                        }
                    }
                }
            }
        } catch (e) {
            logger.warn('[PDF] Albaran stored signature lookup failed');
        }

        // Step 3b: Try REPARTIDOR_FIRMAS if no file signature
        if (!signatureBase64) {
            try {
                const firmaRows = await repartidorDb.getRepartidorFirmaBase64ByAlbaran(
                    parsedNumber, parsedYear, serie, parsedTerminal,
                );
                if (firmaRows.length > 0 && firmaRows[0].FIRMABASE64) {
                    signatureBase64 = firmaRows[0].FIRMABASE64;
                    signatureSource = 'REPARTIDOR_FIRMAS';
                    logger.info(`[PDF] Using signature from REPARTIDOR_FIRMAS`);
                }
            } catch (e) {
                logger.warn('[PDF] Albaran app signature lookup failed');
            }
        }

        let receptorNombre = '';
        let receptorApellidos = '';
        let receptorDni = '';
        try {
            const canonical = await repartidorDb.getCanonicalConfirmationSignature({
                year: parsedYear,
                serie,
                terminal: parsedTerminal,
                number: parsedNumber,
                ownerIds: req.documentOwnerId ? [req.documentOwnerId] : [],
            });
            if (canonical) {
                receptorNombre = canonical.receptorNombre || '';
                receptorApellidos = canonical.receptorApellidos || '';
                receptorDni = canonical.receptorDni || '';
                if (canonical.base64) {
                    signatureBase64 = canonical.base64;
                    signatureSource = 'CANONICAL_CONFIRMATION';
                }
            }
        } catch (e) {
            logger.warn('[PDF] Canonical confirmation signature lookup failed');
        }

        // Step 3c: Try CACFIRMAS (legacy ERP signatures) as last resort
        if (!signatureBase64) {
            try {
                const cacRows = await repartidorDb.getCacFirmaBase64(parsedYear, serie, parsedTerminal, parsedNumber);
                if (cacRows.length > 0 && cacRows[0].FIRMABASE64) {
                    let b64 = cacRows[0].FIRMABASE64;
                    b64 = b64.replace(/^data:image\/\w+;base64,/, '');
                    signatureBase64 = b64;
                    signatureSource = 'CACFIRMAS';
                    logger.info(`[PDF] Using legacy signature from CACFIRMAS`);
                }
            } catch (e) {
                logger.warn('[PDF] Albaran legacy signature lookup failed');
            }
        }

        logger.info(`[PDF] Signature for ${albId}: ${signatureBase64 ? 'FOUND' : 'NOT FOUND'}`);

        // 4. Generate PDF with optional signature (documentType = albaran)
        const buffer = await generateInvoicePDF({
            header,
            lines,
            signatureBase64,
            signatureSource,
            documentType: 'albaran',
            receptorNombre,
            receptorApellidos,
            receptorDni,
        });

        const safeFilename = `Albaran_${parsedYear}_${serie}_${parsedNumber}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');
        if (documentPdfCacheKey && typeof redisCache?.set === 'function') {
            try {
                await redisCache.set('document', documentPdfCacheKey, {
                    pdfBase64: buffer.toString('base64'),
                    fileName: safeFilename,
                }, REPARTIDOR_DOCUMENT_PDF_CACHE_TTL);
            } catch (_cacheError) {
                logger.warn('[PDF] Albaran cache write unavailable');
            }
        }
        return sendPdf(buffer, safeFilename);

    } catch (e) {
        logger.error('[PDF] Albaran generation failed');
        sendRouteError(res, 503, 'DOCUMENT_PDF_FAILED');
    }
});

// =============================================================================
// GET /config
// Get commission configuration
// =============================================================================
router.get('/config', verifyToken, (req, res) => {
    res.json({
        success: true,
        config: {
            threshold: REPARTIDOR_CONFIG.threshold,
            tiers: REPARTIDOR_CONFIG.tiers.map((t, i) => ({
                tier: i + 1,
                min: t.min,
                max: t.max,
                rate: t.pct
            }))
        }
    });
});

// Legacy writes are retired above; the following endpoint is read-only.
// =============================================================================
// POST /entregas/:entregaId/lineas
// Guardar estado de líneas de artículos
// =============================================================================
// =============================================================================
// POST /cobros
// Registrar un cobro realizado
// =============================================================================
// =============================================================================
// GET /entregas/:entregaId/firma
// Obtener firma de una entrega
// =============================================================================
router.get('/entregas/:entregaId/firma', verifyToken, async (req, res) => {
    try {
        const { entregaId } = req.params;

        const rows = await repartidorDb.getEntregaFirma(entregaId);

        if (rows.length === 0) {
            return res.json({ success: true, hasSignature: false });
        }

        const fechaFirma = (rows[0].ANO > 0)
            ? `${rows[0].ANO}-${String(rows[0].MES).padStart(2, '0')}-${String(rows[0].DIA).padStart(2, '0')} ${String(rows[0].HORA).padStart(6, '0').substring(0, 2)}:${String(rows[0].HORA).padStart(6, '0').substring(2, 4)}`
            : null;

        res.json({
            success: true,
            hasSignature: true,
            signature: {
                base64: rows[0].FIRMABASE64,
                firmante: rows[0].FIRMANOMBRE,
                fecha: fechaFirma
            }
        });

    } catch (error) {
        logger.error('[REPARTIDOR] Delivery signature request failed');
        sendRouteError(res, 503, 'REPARTIDOR_SIGNATURE_FAILED');
    }
});

// =============================================================================
// GET /rutero/order/:repartidorId?date=YYYY-MM-DD
// Day-scoped saved route order (not permanent weekday).
// =============================================================================
router.get('/rutero/order/:repartidorId', verifyToken, async (req, res) => {
  try {
    const repartidorId = authorizeSingleRepartidorId(req, res, req.params.repartidorId);
    if (!repartidorId) return;
    const fecha = parseRouteDate(req.query.date);
    if (!fecha) return sendRouteError(res, 422, 'DATE_INVALID');
    const state = await ruteroOrdenRepo.readOrderState(repartidorId, fecha);
    return res.json({ success: true, orden: state.orden, revision: state.revision });
  } catch (error) {
    if (error?.code === 'RUTERO_ORDEN_SCHEMA_UNAVAILABLE') return sendRouteError(res, 503, error.code);
    if (error?.statusCode) return sendRouteError(res, error.statusCode, error.code || 'RUTERO_ORDER_READ_FAILED');

    logger.error('[REPARTIDOR] Rutero order read failed');
    return sendRouteError(res, 503, 'RUTERO_ORDER_READ_FAILED');
  }
});

// =============================================================================
// PUT /rutero/order/:repartidorId  { date, orden: [{documentId, cliente?, posicion}] }
// =============================================================================
router.put('/rutero/order/:repartidorId', verifyToken, async (req, res) => {
  try {
    const repartidorId = authorizeSingleRepartidorId(req, res, req.params.repartidorId);
    if (!repartidorId) return;
    const body = req.body || {};
    const fecha = parseRouteDate(body.date);
    if (!fecha) return sendRouteError(res, 422, 'DATE_INVALID');
    const parsed = normalizeOrdenPayload(body.orden);
    if (parsed.error) return sendRouteError(res, 422, parsed.error);
    const updatedBy = String(req.user?.code || req.user?.id || req.user?.user || '').trim();
    const orden = await ruteroOrdenRepo.replaceOrder(
      repartidorId,
      fecha,
      parsed.value,
      updatedBy,
      body.baseRevision,
    );
    return res.json({ success: true, orden: orden.orden, revision: orden.revision });
  } catch (error) {
    if (error?.code === 'RUTERO_ORDEN_SCHEMA_UNAVAILABLE') return sendRouteError(res, 503, error.code);
    if (error?.statusCode) return sendRouteError(res, error.statusCode, error.code || 'RUTERO_ORDER_WRITE_FAILED');
    logger.error('[REPARTIDOR] Rutero order write failed');
    return sendRouteError(res, 503, 'RUTERO_ORDER_WRITE_FAILED');
  }
});

// =============================================================================
// POST /rutero/order/:repartidorId/optimize
// Suggest early→late order by CRUT preferred windows (does not persist).
// Body: { date, stops: [{documentId, cliente}] } or { date, documentIds, clientes }
// =============================================================================
router.post('/rutero/order/:repartidorId/optimize', verifyToken, async (req, res) => {
  try {
    const repartidorId = authorizeSingleRepartidorId(req, res, req.params.repartidorId);
    if (!repartidorId) return;
    const parsed = normalizeOptimizeStopsPayload(req.body || {});
    if (parsed.error) return sendRouteError(res, 422, parsed.error);

    const strategy = String(req.body?.strategy || 'balanced').trim().toLowerCase();
    if (!['windows_first', 'balanced', 'distance_first'].includes(strategy)) return sendRouteError(res, 422, 'RUTERO_STRATEGY_INVALID');
    const origin = parseRuteroOrigin(req.body?.origin);
    if (origin.error) return sendRouteError(res, 422, origin.error);
    const departure = parseRuteroDepartureMinute(
      req.body?.departureMinute ?? req.body?.horaSalidaMinute,
    );
    if (departure.error) return sendRouteError(res, 422, departure.error);
    const diagnostics = [];

    const clientCodes = parsed.stops.map((s) => s.cliente).filter(Boolean);
    const [windowsByCliente, geoByCliente] = await Promise.all([
      ruteroOrdenRepo.fetchClientWindows(clientCodes).catch(() => {
        logger.warn('[REPARTIDOR] CRUT windows unavailable for optimize');
        diagnostics.push('client_windows_unavailable');
        return new Map();
      }),
      ruteroOrdenRepo.fetchClientGeo(clientCodes).catch(() => {
        logger.warn('[REPARTIDOR] GEO unavailable for optimize');
        diagnostics.push('client_geo_unavailable');
        return new Map();
      }),
    ]);

    const departureMinute = resolveDepartureMinute({
      departureMinute: req.body?.departureMinute ?? req.body?.horaSalidaMinute,
    });
    const packed = optimizeRoutePackage(parsed.stops, parsed.date, windowsByCliente, {
      geoByCliente,
      departureMinute,
      origin: origin.value,
      strategy,
    });



    return res.json({
      success: true,
      repartidorId,
      date: parsed.date,
      algorithm: packed.algorithm,
      explanation: packed.explanation,
      summary: packed.summary,
      diagnostics,
      departureMinute,
      departureLabel: formatMinuteLabel(departureMinute),
      orden: packed.orden,
    });
  } catch (error) {
    logger.error('[REPARTIDOR] Rutero optimize failed');

    return sendRouteError(res, 503, 'RUTERO_OPTIMIZE_FAILED');
  }
});

// =============================================================================
// GET /rutero/stops-geo/:repartidorId?date=YYYY-MM-DD&clientes=c1,c2
// Lat/lng + hour windows + observaciones for day stops.
// =============================================================================
router.get('/rutero/stops-geo/:repartidorId', verifyToken, async (req, res) => {
  try {
    const repartidorId = authorizeSingleRepartidorId(req, res, req.params.repartidorId);
    if (!repartidorId) return;
    const fecha = parseRouteDate(req.query.date);
    if (!fecha) return sendRouteError(res, 422, 'DATE_INVALID');

    const diagnostics = [];
    let savedOrden = [];
    try {
      savedOrden = await ruteroOrdenRepo.listOrder(repartidorId, fecha);
    } catch (error) {
      diagnostics.push('saved_route_order_unavailable');
      if (error?.code !== 'RUTERO_ORDEN_SCHEMA_UNAVAILABLE') {
        logger.warn('[REPARTIDOR] stops-geo saved order unavailable');
      }
    }

    const queryClientes = String(req.query.clientes || '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    const clientCodes = ruteroOrdenRepo.uniqueClientCodes([
      ...savedOrden.map((row) => row.cliente),
      ...queryClientes,
    ]);

    const [windowsByCliente, geoByCliente] = await Promise.all([
      ruteroOrdenRepo.fetchClientWindows(clientCodes).catch(() => {
        diagnostics.push('client_windows_unavailable');
        return new Map();
      }),
      ruteroOrdenRepo.fetchClientGeo(clientCodes).catch(() => {
        diagnostics.push('client_geo_unavailable');
        return new Map();
      }),
    ]);

    const departureMinute = resolveDepartureMinute({});
    const baseStops = clientCodes.map((cliente, index) => {
      const windowRow = windowsByCliente.get(cliente) || null;
      const geo = geoByCliente.get(cliente) || null;
      const saved = savedOrden.find((row) => row.cliente === cliente);
      return {
        cliente,
        documentId: saved?.documentId || null,
        posicion: saved?.posicion ?? index,
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
        geoSource: geo?.source || null,
        hasGps: Boolean(geo),
        preferredMinute: preferredStartMinute(windowRow),
        preferredLabel: formatMinuteLabel(preferredStartMinute(windowRow)),
        windowLabel: buildWindowLabel(windowRow),
        observaciones: windowRow?.observacionesReparto || null,
        closedDay: isClosedOnDate(windowRow, fecha),
        horaRepartoDesde: windowRow?.horaRepartoDesde ?? null,
        horaRepartoHasta: windowRow?.horaRepartoHasta ?? null,
        horaVisita: windowRow?.horaVisita ?? null,
      };
    });

    // Prefer saved order positions when present, then annotate ETA timeline.
    const orderedForEta = [...baseStops].sort((a, b) => {
      const pa = Number.isFinite(a.posicion) ? a.posicion : 9999;
      const pb = Number.isFinite(b.posicion) ? b.posicion : 9999;
      return pa - pb;
    });
    const stops = annotateRouteTimeline(orderedForEta, {
      departureMinute,
      origin: null,
    });

    return res.json({
      success: true,
      repartidorId,
      date: fecha,
      departureMinute,
      departureLabel: formatMinuteLabel(departureMinute),
      diagnostics,
      stops,
      stats: {
        total: stops.length,
        withGps: stops.filter((s) => s.hasGps).length,
        missingGps: stops.filter((s) => !s.hasGps).length,
        windowed: stops.filter((s) => s.preferredMinute !== null || s.endMinute !== null).length,
        conflicts: stops.filter((s) => s.conflict).length,
      },
    });
  } catch (error) {
    logger.error('[REPARTIDOR] Rutero stops-geo failed');
    return sendRouteError(res, 503, 'RUTERO_STOPS_GEO_FAILED');
  }
});

// =============================================================================
// GET /rutero/week/:repartidorId
// Resumen semanal para el calendario (LUN 30, MAR 31...)
// Estado basado en cobros de CONTADO, REPOSICION, MENSUAL
// =============================================================================
router.get('/rutero/week/:repartidorId', verifyToken, async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { date } = req.query; // Fecha de referencia (ej. hoy)
        const dateResult = parseIsoDate(date, 'DATE');
        if (dateResult.error) return sendRouteError(res, 422, dateResult.error);

        // Always build from YYYY-MM-DD. Full ISO timestamps must not be spliced
        // again (`...T00:00:00.000T12:00:00` → Invalid Date → 503).
        const dateYmd = dateResult.value == null
            ? null
            : String(dateResult.value).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
        const refDate = dateYmd ? new Date(`${dateYmd}T12:00:00`) : new Date();
        if (Number.isNaN(refDate.getTime())) {
            return sendRouteError(res, 422, 'DATE_INVALID');
        }
        const currentDay = refDate.getDate();

        // Calculate start/end of week (Monday to Sunday)
        const dayOfWeek = refDate.getDay() || 7; // 1 (Mon) to 7 (Sun)
        const startOfWeek = new Date(refDate);
        startOfWeek.setDate(currentDay - dayOfWeek + 1);

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);

        // Generate array of expected dates
        const weekDays = [];
        const d = new Date(startOfWeek);
        while (d <= endOfWeek) {
            weekDays.push({
                sday: d.getDate(),
                smonth: d.getMonth() + 1,
                syear: d.getFullYear(),
                formatted: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
            });
            d.setDate(d.getDate() + 1);
        }

        const repartidorIdList = authorizedRepartidorIds(req, res, repartidorId);
        if (!repartidorIdList) return;

        const weekStartNum = weekDays[0].syear * 10000 + weekDays[0].smonth * 100 + weekDays[0].sday;
        const weekEndNum = weekDays[6].syear * 10000 + weekDays[6].smonth * 100 + weekDays[6].sday;

        const rows = await repartidorDb.getRuteroWeek(weekStartNum, weekEndNum, repartidorIdList);

        // Map results to weekDays
        const days = weekDays.map(wd => {
            const row = rows.find(r => r.ANO === wd.syear && r.MES === wd.smonth && r.DIA === wd.sday);

            const totalAlbaranes = row ? parseInt(row.TOTAL_ALBARANES) : 0;
            const entregados = row ? parseInt(row.ENTREGADOS) : 0;

            // Status Logic:
            // 0 albaranes -> 'none' (Gray)
            // all completed -> 'good' (Green)
            // some pending -> 'bad' (Red)
            let status = 'none';
            if (totalAlbaranes > 0) {
                if (entregados >= totalAlbaranes) {
                    status = 'good';
                } else {
                    status = 'bad';
                }
            }

            return {
                date: wd.formatted,
                day: wd.sday,
                dayName: ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'][new Date(wd.formatted).getDay()],
                clients: totalAlbaranes,
                completed: entregados,
                status: status
            };
        });

        res.json({
            success: true,
            days
        });

    } catch (_error) {
        logger.error('[REPARTIDOR] Error in /rutero/week');
        sendRouteError(res, 503, 'REPARTIDOR_WEEK_FAILED');
    }
});


// =============================================================================
// GET /history/:repartidorId
// Retrieve historical deliveries with filtering
// =============================================================================
router.get('/history/:repartidorId', verifyToken, async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { startDate, endDate, search, limit, offset } = req.query;

        if (!startDate || !endDate) return sendRouteError(res, 400, 'DATE_RANGE_REQUIRED');
        const startResult = parseIsoDate(startDate, 'START_DATE');
        const endResult = parseIsoDate(endDate, 'END_DATE');
        const pagination = parsePagination({ limit, offset });
        const validationError = startResult.error || endResult.error || pagination.limit.error || pagination.offset.error;
        if (validationError) return sendRouteError(res, 422, validationError);
        if (startResult.value > endResult.value) return sendRouteError(res, 422, 'DATE_RANGE_INVALID');

        const startInt = startResult.value;
        const endInt = endResult.value;
        const repartidorIdList = authorizedRepartidorIds(req, res, repartidorId);
        if (!repartidorIdList) return;

        logger.info(`[REPARTIDOR] History for ${repartidorId} from ${startInt} to ${endInt}`);

        const rows = await repartidorDb.getHistoryDeliveries({
            startInt,
            endInt,
            repartidorIdList,
            search,
            offset: pagination.offset.value,
            limit: pagination.limit.value,
        });

        res.json({
            success: true,
            count: rows.length,
            pagination: { limit: pagination.limit.value, offset: pagination.offset.value },
            data: rows
        });
    } catch (_error) {
        logger.error('[REPARTIDOR] Error in /history');
        sendRouteError(res, 503, 'REPARTIDOR_HISTORY_FAILED');
    }
});

// =============================================================================
// GET /document/invoice/:year/:serie/:number/pdf
// Generate formal Invoice PDF
// =============================================================================
router.get('/document/invoice/:year/:serie/:number/pdf', verifyToken, async (req, res) => {
    try {
        const { year, number } = req.params;
        const { albaranNumber, albaranSerie, albaranTerminal, albaranYear } = req.query;

        const parsedYear = parseInt(req.params.year);
        const parsedNumber = parseInt(req.params.number);
        if (!parsedYear || !parsedNumber) {
            return res.status(400).json({ success: false, error: 'Parámetros year/number inválidos' });
        }
        const SENTINEL_SERIES = new Set(['UNK', 'NONE', 'NULL', 'N/A', '0', 'undefined', 'null']);
        const rawSerie = req.params.serie || '';
        const serie = SENTINEL_SERIES.has(rawSerie.toUpperCase()) ? '' : rawSerie.replace(/[^A-Z0-9]/gi, '').substring(0, 3);

        logger.info(`[PDF] Generating Invoice PDF: ${year}-${serie}-${number} (albaran fallback: ${albaranNumber || 'none'})`);

        let headers = await repartidorDb.getInvoiceHeaderByFactura(parsedNumber, serie, parsedYear);

        const parsedAlbaranNumber = parseInt(albaranNumber);
        const parsedAlbaranYear = parseInt(albaranYear || year);
        const parsedAlbaranTerminal = parseInt(albaranTerminal || 0);
        const albaranSerieNorm = albaranNumber
            ? (SENTINEL_SERIES.has((albaranSerie || '').toUpperCase()) ? '' : (albaranSerie || '').replace(/[^A-Z0-9]/gi, '').substring(0, 3))
            : null;

        if ((!headers || headers.length === 0) && parsedAlbaranNumber) {
            logger.info(`[PDF] Factura query returned 0 rows, trying albaran fallback: ${parsedAlbaranYear}-${albaranSerieNorm}-${parsedAlbaranTerminal}-${parsedAlbaranNumber}`);
            headers = await repartidorDb.getInvoiceHeaderByAlbaran(
                parsedAlbaranNumber, albaranSerieNorm, parsedAlbaranYear, parsedAlbaranTerminal,
            );
        }
        // 1C. Last resort: Try factura number as albaran number (Flutter may pass albaran number)
        if (!headers || headers.length === 0) {
            logger.info(`[PDF] Both queries failed, trying albaran-as-number fallback: ${parsedYear}-${serie}-${parsedNumber}`);
            headers = await repartidorDb.getInvoiceHeaderByAlbaranNoTerminal(parsedNumber, serie, parsedYear);
        }
        if (!headers || headers.length === 0) {
            logger.warn(`[PDF] Invoice not found for any query combination: ${year}-${serie}-${number}`);
            return res.status(404).json({ success: false, error: 'Factura no encontrada (CAC)' });
        }
        const header = {
            ...headers[0],
            clienteNombre: headers[0].NOMBRECLIENTEFACTURA,
            nombreComercial: headers[0].NOMBRECOMERCIALFACTURA || headers[0].NOMBRECLIENTEFACTURA,
            nombreFiscal: headers[0].NOMBREFISCALFACTURA || headers[0].NOMBRECLIENTEFACTURA,
            clienteId: headers[0].CODIGOCLIENTEFACTURA,
            clienteDireccion: headers[0].DIRECCIONCLIENTEFACTURA,
            clientePoblacion: headers[0].POBLACIONCLIENTEFACTURA,
            clienteNif: headers[0].CIFCLIENTEFACTURA,
        };
        const actualEjAlb = header.EJERCICIOALBARAN;
        const actualSerieAlb = (header.SERIEALBARAN || '').toString().trim();
        const actualTermAlb = header.TERMINALALBARAN || 0;
        const actualNumAlb = header.NUMEROALBARAN;

        logger.info(`[PDF] Found CAC header: albaran=${actualEjAlb}-${actualSerieAlb}-${actualTermAlb}-${actualNumAlb}, factura=${header.EJERCICIOFACTURA}-${(header.SERIEFACTURA || '').toString().trim()}-${header.NUMEROFACTURA}`);

        // Fetch IVA breakdown from CPC
        try {
            const ivaRows = await repartidorDb.getCpcIvaBreakdown(actualEjAlb, actualSerieAlb, actualTermAlb, actualNumAlb);
            if (ivaRows.length > 0) {
                header.IVA_BREAKDOWN = ivaRows[0];
            }
        } catch (e) {
            logger.warn('[PDF] Invoice IVA lookup failed');
        }

        // 2. Fetch Lines - use albaran fields from found header for reliable join
        const lines = await repartidorDb.getAlbaranLines(actualEjAlb, actualSerieAlb, actualTermAlb, actualNumAlb);

        // 3. Try to get signature - comprehensive cascade (same as albaran PDF)
        let signatureBase64 = null;
        let signatureSource = null;
        const albId = `${actualEjAlb}-${actualSerieAlb}-${actualTermAlb}-${actualNumAlb}`;

        // Step 3a: DELIVERY_STATUS (OLD schema only)
        try {
            const dsOldAvail = isDeliveryStatusAvailable() && !isDeliveryStatusNewSchema();
            if (dsOldAvail) {
                const dsRows = await repartidorDb.getDeliveryStatusFirmaPath(albId);
                if (dsRows.length > 0 && dsRows[0].FIRMA_PATH) {
                    const basePaths = [
                        path.join(__dirname, '../../uploads'),
                        path.join(__dirname, '../../uploads/photos')
                    ];
                    for (const basePath of basePaths) {
                        const fullPath = path.join(basePath, dsRows[0].FIRMA_PATH);
                        if (fs.existsSync(fullPath)) {
                            signatureBase64 = (await fsPromises.readFile(fullPath)).toString('base64');
                            signatureSource = 'FILE';
                            break;
                        }
                    }
                }
            }
        } catch (e) { logger.warn('[PDF] Invoice stored signature lookup failed'); }

        // Step 3b: REPARTIDOR_FIRMAS
        if (!signatureBase64) {
            try {
                const firmaRows = await repartidorDb.getRepartidorFirmaBase64ByAlbaran(
                    actualNumAlb, actualEjAlb, actualSerieAlb, actualTermAlb,
                );
                if (firmaRows.length > 0 && firmaRows[0].FIRMABASE64) {
                    signatureBase64 = firmaRows[0].FIRMABASE64;
                    signatureSource = 'REPARTIDOR_FIRMAS';
                }
            } catch (e) { logger.warn('[PDF] Invoice app signature lookup failed'); }
        }

        let receptorNombre = '';
        let receptorApellidos = '';
        let receptorDni = '';
        try {
            const canonical = await repartidorDb.getCanonicalConfirmationSignature({
                year: actualEjAlb,
                serie: actualSerieAlb,
                terminal: actualTermAlb,
                number: actualNumAlb,
                ownerIds: req.documentOwnerId ? [req.documentOwnerId] : [],
            });
            if (canonical) {
                receptorNombre = canonical.receptorNombre || '';
                receptorApellidos = canonical.receptorApellidos || '';
                receptorDni = canonical.receptorDni || '';
                if (canonical.base64) {
                    signatureBase64 = canonical.base64;
                    signatureSource = 'CANONICAL_CONFIRMATION';
                }
            }
        } catch (e) { logger.warn('[PDF] Invoice canonical confirmation signature lookup failed'); }

        // Step 3c: CACFIRMAS legacy
        if (!signatureBase64) {
            try {
                const cacRows = await repartidorDb.getCacFirmaBase64(actualEjAlb, actualSerieAlb, actualTermAlb, actualNumAlb);
                if (cacRows.length > 0 && cacRows[0].FIRMABASE64) {
                    let b64 = cacRows[0].FIRMABASE64.toString();
                    b64 = b64.replace(/^data:image\/\w+;base64,/, '');
                    signatureBase64 = b64;
                    signatureSource = 'CACFIRMAS';
                }
            } catch (e) { logger.warn('[PDF] Invoice legacy signature lookup failed'); }
        }

        logger.info(`[PDF] Invoice signature for ${albId}: ${signatureBase64 ? 'FOUND' : 'NOT FOUND'}`);

        // 4. Generate PDF with signature (documentType = factura)
        const buffer = await generateInvoicePDF({
            header,
            lines,
            signatureBase64,
            signatureSource,
            documentType: 'factura',
            receptorNombre,
            receptorApellidos,
            receptorDni,
        });

        // 5. Send Response
        const factNum = header.NUMEROFACTURA || number;
        const factSerie = (header.SERIEFACTURA || serie || '').toString().trim();
        const safeFilename = `Factura_${year}_${factSerie}_${factNum}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
            'Content-Length': buffer.length,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.send(buffer);

    } catch (e) {
        logger.error('[PDF] Invoice generation failed');
        sendRouteError(res, 503, 'DOCUMENT_PDF_FAILED');
    }
});


// =============================================================================
// GET /history/clients/:repartidorId
// Get clients with delivery history from OPP + client info from CLI
// Uses ONLY columns verified to exist: OPP.CODIGOREPARTIDOR, CLI.CODIGOCLIENTE,
// CLI.NOMBRECLIENTE, CLI.NOMBREALTERNATIVO, CLI.DIRECCION, CLI.ANOBAJA
// =============================================================================
router.get('/history/clients/:repartidorId', verifyToken, async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { search, limit, offset } = req.query;
        const pagination = parsePagination({ limit, offset }, REPARTIDOR_READ_PAGE_MAX, 1000000);
        const validationError = pagination.limit.error || pagination.offset.error;
        if (validationError) return sendRouteError(res, 422, validationError);

        const repartidorIdList = authorizedRepartidorIds(req, res, repartidorId);
        if (!repartidorIdList) return;

        const rows = await repartidorDb.getHistoryClients({
            repartidorIdList,
            search,
            limit: pagination.limit.value,
            offset: pagination.offset.value,
        });
        logger.info(`[REPARTIDOR] Found ${rows.length} client rows for ${repartidorId}`);

        // A fleet client card is owner-specific. The same ERP client assigned
        // to two drivers must remain two isolated drill-down targets.
        const seen = new Map();
        rows.forEach(r => {
            const id = (r.ID || '').trim();
            const owner = canonicalRepartidorCode(r.OWNER_ID);
            if (!id || !owner) return;
            const cardKey = `${owner}:${id}`;
            const existing = seen.get(cardKey);
            const lv = r.LAST_VISIT || 0;
            if (!existing || lv > existing.LAST_VISIT) {
                seen.set(cardKey, r);
            }
        });

        const sortedClients = Array.from(seen.values())
            .sort((a, b) => (Number(b.LAST_VISIT) - Number(a.LAST_VISIT)) || String(a.ID).localeCompare(String(b.ID)));
        const hasMore = sortedClients.length > pagination.limit.value;
        const clients = sortedClients
            .slice(0, pagination.limit.value)
            .map(r => {
            const id = (r.ID || '').trim();
            const lv = r.LAST_VISIT || 0;
            const lvYear = Math.floor(lv / 10000);
            const lvMonth = Math.floor((lv % 10000) / 100);
            const lvDay = lv % 100;
            const lastVisitStr = lv > 0
                ? `${String(lvDay).padStart(2, '0')}/${String(lvMonth).padStart(2, '0')}/${lvYear}`
                : null;

            return {
                id,
                name: (r.NAME || '').trim() || `CLIENTE ${id}`,
                address: (r.ADDRESS || '').trim(),
                totalDocuments: parseInt(r.TOTAL_DOCS) || 0,
                totalAmount: parseFloat(r.TOTAL_AMOUNT) || 0,
                lastVisit: lastVisitStr,
                repCode: canonicalRepartidorCode(r.OWNER_ID),
                repName: null
            };
        });

        res.json({
            success: true,
            clients,
            pagination: { limit: pagination.limit.value, offset: pagination.offset.value, hasMore }
        });
    } catch (_error) {
        logger.error('[REPARTIDOR] Error getting history clients');
        sendRouteError(res, 503, 'REPARTIDOR_CLIENTS_FAILED');
    }
});

// =============================================================================
// GET /history/legacy-signature/:id
// Returns the Base64 signature from CACFIRMAS as an image
// =============================================================================
router.get('/history/legacy-signature/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params; // Format: YEAR-SERIES-TERMINAL-NUMBER
        const parts = id.split('-');
        if (parts.length < 4) return res.status(400).send('Invalid ID format');

        const [year, series, terminal, number] = parts;

        const rows = await repartidorDb.getLegacySignatureBase64(year, series, terminal, number);
        if (rows.length === 0 || !rows[0].FIRMABASE64) {
            return sendRouteError(res, 404, 'SIGNATURE_NOT_FOUND');
        }

        let base64Image = rows[0].FIRMABASE64;
        base64Image = base64Image.replace(/^data:image\/\w+;base64,/, "");
        const imgBuffer = Buffer.from(base64Image, 'base64');

        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': imgBuffer.length
        });
        res.end(imgBuffer);

    } catch (error) {
        logger.error('[REPARTIDOR] Legacy signature request failed');
        sendRouteError(res, 503, 'REPARTIDOR_SIGNATURE_FAILED');
    }
});

// =============================================================================
// POST /document/send-email
// Server-side email sending with PDF attachment for repartidor documents
// =============================================================================
router.post('/document/send-email', verifyToken, async (req, res) => {
    try {
        const { destinatario, asunto, cuerpo } = req.documentEmail || {};
        const key = req.documentOwnershipKey;
        if (!key) {
            return sendRouteError(res, 422, 'DOCUMENT_KEY_INVALID');
        }
        const isAlbaran = Object.prototype.hasOwnProperty.call(key, 'terminal');
        let headers;
        let lines = [];
        if (isAlbaran) {
            headers = await repartidorDb.getAlbaranPdfHeader(key.number, key.series, key.year, key.terminal);
            if (headers && headers.length) {
                lines = await repartidorDb.getAlbaranLines(key.year, key.series, key.terminal, key.number);
            }
        } else {
            headers = await repartidorDb.getInvoiceHeaderByFactura(key.number, key.series, key.year);
        }
        if (!headers || headers.length === 0) {
            return sendRouteError(res, 404, 'DOCUMENT_NOT_FOUND');
        }
        const header = headers[0];
        const pdfBuffer = await generateInvoicePDF({
            header,
            lines: lines || [],
            documentType: isAlbaran ? 'albaran' : 'factura',
        });
        const label = isAlbaran ? 'Albarán' : 'Factura';
        const filename = `${isAlbaran ? 'Albaran' : 'Factura'}_${key.series}-${key.number}.pdf`
            .replace(/[^a-zA-Z0-9._-]/g, '_');
        const htmlBody = isAlbaran
            ? generateDeliveryEmailHtml({
                numero: key.number,
                serie: key.series,
                fecha: '',
                total: header.IMPORTETOTAL || header.TOTALFACTURA || '',
                clienteNombre: header.NOMBRECLIENTEFACTURA || '',
                customBody: cuerpo,
            })
            : generateInvoiceEmailHtml({
                serie: key.series,
                numero: key.number,
                fecha: '',
                total: header.IMPORTETOTAL || header.TOTALFACTURA || '',
                clienteNombre: header.NOMBRECLIENTEFACTURA || '',
                customBody: cuerpo,
            });
        const delivery = resolveRepartoEmailDelivery({
            recipients: [destinatario],
            mode: 'manual',
        });
        const effectiveRecipient = delivery.effectiveRecipients[0];
        if (!effectiveRecipient) {
            throw new RepartoEmailDeliveryPolicyError(
                'El destinatario efectivo no es valido',
                'REPARTO_EMAIL_RECIPIENT_REQUIRED',
            );
        }
        const logicalKey = `document:${isAlbaran ? 'albaran' : 'factura'}:${key.year}:${key.series}:${key.terminal || ''}:${key.number}`;
        const expectedMessageId = buildRepartoMessageId({
            kind: 'document',
            identity: logicalKey,
            recipient: effectiveRecipient,
        });
        const result = await sendEmailWithPdf({
            to: effectiveRecipient,
            subject: asunto || `${label} ${key.series}-${key.number} - Granja Mari Pepa`,
            htmlBody,
            pdfBuffer,
            messageId: expectedMessageId,
            pdfFilename: filename,
        });
        const messageId = String(result?.messageId || '').trim();
        if (!messageId) {
            return sendRouteError(res, 503, 'DOCUMENT_EMAIL_MESSAGE_ID_REQUIRED');
        }
        try {
            await repartidorDb.recordDocumentEmailLedger({
                operatorId: req.user?.id || req.user?.code || '',
                ownerId: req.documentOwnerId || '',
                payloadPreview: `logicalKey=${logicalKey};messageId=${messageId}`,
            });
        } catch (_ledgerError) {
            logger.warn('[REPARTIDOR] Document email ledger write failed after send');
            return sendRouteError(res, 503, 'EMAIL_DELIVERY_LEDGER_REQUIRED');
        }
        return res.json({
            success: true,
            message: 'Email enviado correctamente',
            messageId,
            ledgerWritten: true,
            deliveryPolicy: delivery.policy,
        });
    } catch (error) {
        if (error instanceof RepartoEmailDeliveryPolicyError) {
            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                error: error.message,
            });
        }
        logger.error('[REPARTIDOR] Document email send failed');
        return sendRouteError(res, 503, 'EMAIL_DELIVERY_FAILED');
    }
});

// =============================================================================
// WhatsApp gateway admin (Baileys QR pairing — JEFE_VENTAS / ADMIN)
// =============================================================================
router.get('/whatsapp/gateway/status', verifyToken, requireJefeVentas, (req, res) => {
    return res.json({ success: true, gateway: whatsappGateway.getStatus() });
});

router.get('/whatsapp/gateway/qr', verifyToken, requireJefeVentas, async (req, res) => {
    try {
        if (!whatsappGateway.baileys.isConfigured()) {
            return sendRouteError(res, 503, 'WHATSAPP_BAILEYS_DISABLED');
        }
        const payload = await whatsappGateway.baileys.getQrDataUrl();
        return res.json({ success: true, ...payload });
    } catch (error) {
        logger.error('[REPARTIDOR] WhatsApp QR failed', { code: error.code || null });
        return sendRouteError(res, 503, error.code || 'WHATSAPP_QR_FAILED');
    }
});

router.post('/whatsapp/gateway/start', verifyToken, requireJefeVentas, async (req, res) => {
    try {
        if (!whatsappGateway.baileys.isConfigured()) {
            return sendRouteError(res, 503, 'WHATSAPP_BAILEYS_DISABLED');
        }
        await whatsappGateway.baileys.startSocket({ forceNewQr: req.body?.forceNewQr === true });
        return res.json({ success: true, gateway: whatsappGateway.getStatus() });
    } catch (error) {
        logger.error('[REPARTIDOR] WhatsApp start failed', { code: error.code || null });
        return sendRouteError(res, 503, error.code || 'WHATSAPP_START_FAILED');
    }
});

// =============================================================================
// POST /document/share/whatsapp
// Corporate bot (Baileys free / Cloud API) when ready; otherwise local share.
// =============================================================================
router.post('/document/share/whatsapp', verifyToken, async (req, res) => {
    const phone = String(req.body?.telefono || '').replace(/\D/g, '');
    if (!/^\d{7,15}$/.test(phone)) {
        return sendRouteError(res, 422, 'PHONE_INVALID');
    }
    const key = req.documentOwnershipKey;
    if (!key) {
        return sendRouteError(res, 422, 'DOCUMENT_KEY_INVALID');
    }
    const documentType = Object.prototype.hasOwnProperty.call(key, 'terminal') ? 'Albaran' : 'Factura';
    const reference = `${key.series}-${key.number}`;
    const clienteNombre = String(req.body?.clienteNombre || '').trim();
    const caption = String(req.body?.mensaje || req.body?.message || '')
        .trim()
        .slice(0, 900)
        || `Granja Mari Pepa\n\n${documentType}: ${reference}`;

    // Default / fallback: deep-link + OS share (no corporate send).
    const localPayload = {
        success: true,
        whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(caption)}`,
        message: caption,
        localShare: true,
        sent: false,
        deliveryConfirmed: false,
        shareMode: 'LOCAL_USER_ACTION',
    };

    if (!whatsappGateway.isBotConfigured()) {
        return res.json(localPayload);
    }

    try {
        // If Baileys enabled but not paired yet, and no Cloud — return typed error
        // so the app can show "gateway no emparejado" instead of fake local success
        // only when the caller explicitly asked for bot-only. Prefer bot when ready;
        // if pending and cloud absent, attempt send (throws NOT_PAIRED) and map below.
        if (!whatsappGateway.isBotReady() && whatsappGateway.baileys.isConfigured() && !whatsappGateway.cloud.isConfigured()) {
            return sendRouteError(res, 503, 'WHATSAPP_BAILEYS_NOT_PAIRED');
        }

        const isAlbaran = Object.prototype.hasOwnProperty.call(key, 'terminal');
        let headers;
        let lines = [];
        if (isAlbaran) {
            headers = await repartidorDb.getAlbaranPdfHeader(key.number, key.series, key.year, key.terminal);
            if (headers && headers.length) {
                lines = await repartidorDb.getAlbaranLines(key.year, key.series, key.terminal, key.number);
            }
        } else {
            headers = await repartidorDb.getInvoiceHeaderByFactura(key.number, key.series, key.year);
        }
        if (!headers || headers.length === 0) {
            return sendRouteError(res, 404, 'DOCUMENT_NOT_FOUND');
        }
        const header = headers[0];
        const pdfBuffer = await generateInvoicePDF({
            header,
            lines: lines || [],
            documentType: isAlbaran ? 'albaran' : 'factura',
        });
        const filename = `${isAlbaran ? 'Albaran' : 'Factura'}_${key.series}-${key.number}.pdf`
            .replace(/[^a-zA-Z0-9._-]/g, '_');

        const result = await whatsappGateway.sendDocumentFromBot({
            telefono: phone,
            pdfBuffer,
            filename,
            caption,
            bodyParams: [
                reference,
                clienteNombre || header.NOMBRECLIENTEFACTURA || documentType,
            ],
        });

        return res.json({
            success: true,
            localShare: false,
            sent: true,
            deliveryConfirmed: true,
            shareMode: 'BOT_GATEWAY',
            provider: result.provider,
            mode: result.mode,
            messageId: result.messageId,
            message: caption,
        });
    } catch (error) {
        logger.error('[REPARTIDOR] WhatsApp gateway send failed', {
            code: error.code || null,
            status: error.status || null,
        });
        if (error.code === 'PHONE_INVALID') {
            return sendRouteError(res, 422, 'PHONE_INVALID');
        }
        if (error.code === 'WHATSAPP_BAILEYS_NOT_PAIRED') {
            return sendRouteError(res, 503, 'WHATSAPP_BAILEYS_NOT_PAIRED');
        }
        if (error.code === 'WHATSAPP_NUMBER_NOT_REGISTERED') {
            return sendRouteError(res, 422, 'WHATSAPP_NUMBER_NOT_REGISTERED');
        }
        return sendRouteError(res, 503, 'WHATSAPP_DELIVERY_FAILED');
    }
});

module.exports = router;
module.exports.repartidorBreaker = repartidorBreaker;
