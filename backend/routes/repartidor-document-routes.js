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

function mountRepartidorDocumentRoutes(router) {
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
    configureRepartidorPdfTimeout(req, res);
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
// GET /recipient-suggestion
// Returns the latest complete recipient for this client/driver pair.
// =============================================================================
router.get('/recipient-suggestion', verifyToken, async (req, res) => {
    const clientCode = String(req.query?.cliente || '').trim();
    if (!clientCode || clientCode.length > 40 || /[\u0000-\u001F\u007F]/.test(clientCode)) {
        return sendRouteError(res, 422, 'CLIENTE_INVALID');
    }

    const ownerId = authorizeSingleRepartidorId(
        req,
        res,
        req.query?.repartidorId,
    );
    if (!ownerId) return;

    // Recipient identity is personal data. A suggestion is always scoped to
    // one concrete driver/client pair; never cache or aggregate it across a
    // privileged user's fleet selector.
    res.set('Cache-Control', 'private, no-store');

    try {
        const suggestion = await repartidorDb.getRecipientSuggestion({
            clientCode,
            ownerIds: [ownerId],
        });
        return res.json({ success: true, suggestion });
    } catch (error) {
        logger.error(`[REPARTIDOR] Recipient suggestion failed: ${String(error?.message || error).slice(0, 240)}`);
        return sendRouteError(res, 503, 'REPARTIDOR_RECIPIENT_SUGGESTION_FAILED');
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


}

module.exports = { mountRepartidorDocumentRoutes };
