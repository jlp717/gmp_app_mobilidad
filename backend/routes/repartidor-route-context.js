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
const {
    verifyToken,
    requireJefeVentas: importedRequireJefeVentas,
} = require('../middleware/auth');

// Keep the router fail-closed when a reduced integration harness (or a
// partially loaded auth module) omits the privileged middleware. Production
// auth always supplies the real guard; the fallback only prevents Express
// from mounting a route with an undefined callback.
const requireJefeVentas = typeof importedRequireJefeVentas === 'function'
    ? importedRequireJefeVentas
    : (_req, res) => res.status(503).json({
        success: false,
        code: 'AUTH_GUARD_UNAVAILABLE',
        error: 'El guard de autorizacion no esta disponible',
    });
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
const trackingRepo = require('../repositories/repartidor-rutero-tracking-db2-repository');
const facturasService = require('../services/facturas.service');
const pdfService = require('../services/pdf.service');

const ruteroOrdenRepo = require('../repositories/repartidor-rutero-orden-db2-repository');
const ruteroOrderWorkflow = require('../services/repartidor-rutero-order-workflow');
const {
  optimizeRoutePackage,
  annotateRouteTimeline,
  resolveDepartureMinute,
  normalizeOrigin,
} = require('../services/repartidor-rutero-route-optimizer');
const {
  parseRouteDate,
  normalizeOptimizeStopsPayload,
  preferredStartMinute,
  buildWindowLabel,
  isClosedOnDate,
  formatMinuteLabel,
} = require('../services/repartidor-rutero-orden-service');

const REPARTIDOR_READ_PAGE_MAX = 100;
const REPARTIDOR_PDF_REQUEST_TIMEOUT_MS = Math.min(
    120000,
    Math.max(5000, Number.parseInt(process.env.REPARTIDOR_PDF_REQUEST_TIMEOUT_MS || '30000', 10) || 30000),
);

function configureRepartidorPdfTimeout(req, res) {
    // The ERP/DB2 fallback chain can otherwise leave a client spinner alive
    // indefinitely when a catalog or PDF dependency is unavailable.
    if (typeof req?.setTimeout === 'function') req.setTimeout(REPARTIDOR_PDF_REQUEST_TIMEOUT_MS);
    if (typeof res?.setTimeout === 'function') res.setTimeout(REPARTIDOR_PDF_REQUEST_TIMEOUT_MS);
}

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

module.exports = {
    configureRepartidorPdfTimeout,
    normalizedRole,
    isRepartoPrivileged,
    canonicalRepartidorCode,
    authorizeSingleRepartidorId,
    sendRouteError,
    parseBoundedInt,
    parseRuteroOrigin,
    parseRuteroDepartureMinute,
    parseIsoDate,
    parsePagination,
    authorizedRepartidorIds,
    parseAlbaranOwnershipKey,
    parseInvoiceOwnershipKey,
    resolveAlbaranOwners,
    resolveInvoiceOwners,
    resolveDeliveryOwners,
    rawRepartidorId,
    hintedRepartidorId,
    uniqueActorCodes,
    normalizeVendorCode,
    actorVendorCodes,
    vendorCodesIntersect,
    authorizeResolvedOwner,
    documentOwnershipGuard,
    prevalidateStrictDocumentOwner,
    strictRepartoDocumentOwner,
    albaranQueryOwnership,
    albaranParamOwnership,
    invoiceParamOwnership,
    documentBodyOwnership,
    validateDocumentEmailRequest,
    deliveryOwnership,
    legacySignatureOwnership,
    canonicalRepartoMutationRequired,
};
