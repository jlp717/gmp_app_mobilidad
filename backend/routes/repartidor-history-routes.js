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

const REPARTIDOR_CONFIG = {
    threshold: 30.0,
    tiers: [
        { min: 100.01, max: 103.00, pct: 1.0 },
        { min: 103.01, max: 106.00, pct: 1.3 },
        { min: 106.01, max: 110.00, pct: 1.6 },
        { min: 110.01, max: 999.99, pct: 2.0 }
    ]
};

function mountRepartidorHistoryRoutes(router) {
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
    configureRepartidorPdfTimeout(req, res);
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

}

module.exports = { mountRepartidorHistoryRoutes };
