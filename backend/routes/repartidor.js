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

const {
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
    canonicalRepartoMutationRequired
} = require('./repartidor-route-context');

const { mountRepartidorHistoryRoutes } = require('./repartidor-history-routes');
const { mountRepartidorDocumentRoutes } = require('./repartidor-document-routes');


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

mountRepartidorHistoryRoutes(router);
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
    const state = await ruteroOrderWorkflow.readOrder(repartidorId, fecha);
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
    const updatedBy = String(req.user?.code || req.user?.id || req.user?.user || '').trim();
    const orden = await ruteroOrderWorkflow.saveOrder(repartidorId, body, updatedBy);
    return res.json({ success: true, orden: orden.orden, revision: orden.revision });
  } catch (error) {
    if (error?.code === 'RUTERO_ORDEN_SCHEMA_UNAVAILABLE') return sendRouteError(res, 503, error.code);
    if (error?.statusCode) return sendRouteError(res, error.statusCode, error.code || 'RUTERO_ORDER_WRITE_FAILED');
    logger.error('[REPARTIDOR] Rutero order write failed');
    return sendRouteError(res, 503, 'RUTERO_ORDER_WRITE_FAILED');
  }
});

// =============================================================================
// Move one or more stops to another day in the same natural week.
router.post('/rutero/order/:repartidorId/move', verifyToken, async (req, res) => {
  const repartidorId = authorizeSingleRepartidorId(req, res, req.params.repartidorId);
  if (!repartidorId) return;
  try {
    const updatedBy = String(req.user?.code || req.user?.id || req.user?.user || '').trim();
    const result = await ruteroOrderWorkflow.moveDay(repartidorId, req.body || {}, updatedBy);
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendRouteError(res, error.statusCode || 503, error.code || 'RUTERO_DAY_MOVE_UNAVAILABLE');
  }
});
// =============================================================================
// GPS TRACKING
// Explicit session lifecycle. Samples are owner-scoped, bounded and idempotent.
router.post('/rutero/tracking/:repartidorId/start', verifyToken, async (req, res) => {
  const repartidorId = authorizeSingleRepartidorId(req, res, req.params.repartidorId);
  if (!repartidorId) return;
  try {
    const routeDate = parseRouteDate(req.body?.date ?? req.body?.routeDate);
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!routeDate) return sendRouteError(res, 422, 'DATE_INVALID');
    if (!sessionId) return sendRouteError(res, 422, 'TRACKING_SESSION_INVALID');
    const result = await trackingRepo.createSession({
      repartidorId,
      sessionId,
      routeDate,
      updatedBy: req.user?.code || req.user?.id || req.user?.user,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendRouteError(res, error.statusCode || 503, error.code || 'RUTERO_TRACKING_START_FAILED');
  }
});

router.post('/rutero/tracking/:repartidorId/samples', verifyToken, async (req, res) => {
  const repartidorId = authorizeSingleRepartidorId(req, res, req.params.repartidorId);
  if (!repartidorId) return;
  try {
    const routeDate = parseRouteDate(req.body?.date ?? req.body?.routeDate);
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!routeDate) return sendRouteError(res, 422, 'DATE_INVALID');
    const result = await trackingRepo.appendSamples({
      repartidorId,
      sessionId,
      routeDate,
      samples: req.body?.samples,
      updatedBy: req.user?.code || req.user?.id || req.user?.user,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendRouteError(res, error.statusCode || 503, error.code || 'RUTERO_TRACKING_SAMPLES_FAILED');
  }
});

router.post('/rutero/tracking/:repartidorId/stop', verifyToken, async (req, res) => {
  const repartidorId = authorizeSingleRepartidorId(req, res, req.params.repartidorId);
  if (!repartidorId) return;
  try {
    const routeDate = parseRouteDate(req.body?.date ?? req.body?.routeDate);
    const sessionId = String(req.body?.sessionId || '').trim();
    const eventId = String(req.body?.eventId || '').trim();
    if (!routeDate) return sendRouteError(res, 422, 'DATE_INVALID');
    const result = await trackingRepo.stopSession({
      repartidorId,
      sessionId,
      routeDate,
      eventId: eventId || 'stop-' + Date.now(),
      updatedBy: req.user?.code || req.user?.id || req.user?.user,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendRouteError(res, error.statusCode || 503, error.code || 'RUTERO_TRACKING_STOP_FAILED');
  }
});

router.get('/rutero/tracking/:repartidorId/latest', verifyToken, async (req, res) => {
  const repartidorId = authorizeSingleRepartidorId(req, res, req.params.repartidorId);
  if (!repartidorId) return;
  try {
    const routeDate = parseRouteDate(req.query.date ?? req.query.routeDate);
    if (!routeDate) return sendRouteError(res, 422, 'DATE_INVALID');
    const position = await trackingRepo.latestPosition({ repartidorId, routeDate });
    return res.json({ success: true, position });
  } catch (error) {
    return sendRouteError(res, error.statusCode || 503, error.code || 'RUTERO_TRACKING_LATEST_FAILED');
  }
});



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

mountRepartidorDocumentRoutes(router);

module.exports = router;
module.exports.repartidorBreaker = repartidorBreaker;
