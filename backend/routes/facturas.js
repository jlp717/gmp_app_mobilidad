/**
 * FACTURAS ROUTES (CommonJS)
 * ==========================
 * Endpoints for invoices in commercial profile
 * Ported from src/routes/facturas.routes.ts
 */

const express = require('express');
const router = express.Router();
const facturasService = require('../services/facturas.service');
const pdfService = require('../services/pdf.service');
const documentPdfService = require('../app/services/pdfService');
const logger = require('../middleware/logger');
const { sendEmailWithPdf, generateInvoiceEmailHtml, generateDeliveryEmailHtml, cachePdf, getCachedPdf } = require('../services/emailPdfService');
const { verifyToken } = require('../middleware/auth');
const { authorizeVendorScope, isFinancialRole, userScopeCodes, normalizeCode } = require('../middleware/vendor-scope');
const { emailLimiter } = require('../middleware/security');

const FACTURA_PDF_CACHE_VERSION = 'v4';
const FACTURA_DEFAULT_LIMIT = 250;
const FACTURA_MAX_LIMIT = 500;
const FACTURA_MAX_OFFSET = 5000;
const configuredFacturaEmailTimeout = parseInt(globalThis['process']['env'].FACTURA_EMAIL_SEND_TIMEOUT_MS, 10);
const FACTURA_EMAIL_SEND_TIMEOUT_MS = Math.min(
    30000,
    Math.max(1000, Number.isFinite(configuredFacturaEmailTimeout) ? configuredFacturaEmailTimeout : 12000)
);

function withFacturaEmailTimeout(promise, timeoutMs = FACTURA_EMAIL_SEND_TIMEOUT_MS) {
    let timeoutId;
    const timeout = new Promise(function (_unused, reject) {
        timeoutId = setTimeout(function () {
            const error = new Error('Factura email send timeout');
            error.code = 'EMAIL_SEND_TIMEOUT';
            error.status = 504;
            reject(error);
        }, timeoutMs);
    });

    return Promise.race([
        Promise.resolve(promise).finally(function () { clearTimeout(timeoutId); }),
        timeout
    ]);
}

function sendEmailFailureResponse(res, error) {
    const timeout = error.code === 'EMAIL_SEND_TIMEOUT';
    const unavailableCodes = ['ECONNREFUSED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ENOTFOUND', 'ECONNRESET', 'CONNECTION', 'TIMEOUT'];
    const status = timeout ? 504 : (unavailableCodes.includes(error.code) ? 503 : 500);

    return res.status(status).json({
        success: false,
        error: 'No se pudo completar el envío de email en este momento.',
        code: timeout ? 'EMAIL_SEND_TIMEOUT' : 'EMAIL_SERVICE_UNAVAILABLE',
        no_retry_reason: 'El envio de correo puede seguir en curso; no reintentar automaticamente sin confirmacion del usuario.'
    });
}

function httpError(message, status) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function isDocumentNotFound(error) {
    return error && (
        error.status === 404 ||
        error.message === 'Factura no encontrada' ||
        error.message === 'Albaran no encontrado' ||
        error.message === 'Documento no encontrado'
    );
}

// =============================================================================
// ASVS V8 / BOLA (H-01): object-level authorization on commercial documents.
// The signed token carries the user's vendor scope (code, vendorCodes,
// vendedorCodes); detail/PDF/share endpoints must never leak a document
// whose vendor is outside that scope. Mirrors commissions.js +
// middleware/vendor-scope.js — no new auth pattern invented here.
// =============================================================================

function isDocumentScopeForbiddenResponse(deniedCodes) {
    return {
        success: false,
        code: 'DOCUMENT_SCOPE_FORBIDDEN',
        error: 'No tienes permisos para acceder a este documento',
        denied: deniedCodes || undefined
    };
}

// Returns true/false, or a Promise<boolean> for the empty-vendor ownership
// lookup; every caller awaits the result either way.
function authorizeDocumentScope(req, document) {
    const user = req.user;
    // Financial roles (jefe/admin) supervise every vendor; allow all documents.
    if (isFinancialRole(user)) return true;

    const allowed = userScopeCodes(user);
    const documentVendor = normalizeCode(document?.detail?.header?.vendedor);
    if (documentVendor && allowed.has(documentVendor)) return true;

    // CFC invoices with empty CODIGOVENDEDOR are list-visible for a vendor when
    // the client owns another CFC invoice of that vendor (appendCfcVendorScopeFilter).
    // Mirror that rule here so list->detail does not 403 on the same document.
    if (document.documentType === 'factura' && !documentVendor) {
        const clienteId = document?.detail?.header?.clienteId;
        const ejercicio = document?.detail?.header?.ejercicio
            || document?.displayEjercicio;
        const vendorCodes = [...allowed];
        if (clienteId && vendorCodes.length > 0) {
            // isFacturaClientOwnedByVendors handles its own errors (returns false).
            return facturasService.isFacturaClientOwnedByVendors(clienteId, vendorCodes, parseInt(ejercicio, 10) || new Date().getFullYear());
        }
    }

    logger.warn(`[facturas] DOCUMENT_SCOPE_FORBIDDEN user=${user?.code || 'unknown'} vendor=${documentVendor || 'empty'} type=${document?.documentType}`);
    return false;
}

/**
 * Scopes a client-supplied vendedorCodes query param against the signed user
 * scope. Returns { vendedorCodes } on success or { status, body } to send.
 * Same contract as commissions.js: ALL is financial-role only.
 */
function scopeVendedorCodesQuery(req) {
    const raw = String(req.query.vendedorCodes || '').trim();
    if (!raw) {
        return { status: 400, body: { success: false, error: 'vendedorCodes is required' } };
    }

    const normalized = raw.toUpperCase();
    if (normalized === 'ALL') {
        if (!isFinancialRole(req.user)) {
            logger.warn(`[facturas] Forbidden ALL request: user=${req.user?.code || 'unknown'}`);
            return {
                status: 403,
                body: {
                    success: false,
                    code: 'VENDOR_SCOPE_FORBIDDEN',
                    error: 'Forbidden: ALL requiere rol financiero'
                }
            };
        }
        return { vendedorCodes: 'ALL' };
    }

    const requested = raw.split(',').map(c => c.trim()).filter(Boolean);
    if (requested.length === 0) {
        return { status: 400, body: { success: false, error: 'vendedorCodes is required' } };
    }

    const scopeCheck = authorizeVendorScope(req, requested);
    if (!scopeCheck.ok) {
        logger.warn(`[facturas] Forbidden scoped request: user=${req.user?.code || 'unknown'} denied=${(scopeCheck.denied || []).join(',')}`);
        return {
            status: 403,
            body: {
                success: false,
                code: 'VENDOR_SCOPE_FORBIDDEN',
                error: 'Forbidden: vendedor fuera de tu alcance',
                denied: scopeCheck.denied
            }
        };
    }

    return { vendedorCodes: raw };
}

function parseRouteInt(value) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRequestedDocumentType(value) {
    const term = String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();

    if (['ALBARAN', 'ALBARANES', 'ALB', 'A'].includes(term)) return 'albaran';
    if (['FACTURA', 'FACTURAS', 'F'].includes(term)) return 'factura';
    return null;
}

function getRequestDocumentType(req) {
    return normalizeRequestedDocumentType(
        req.query.documentType ||
        req.query.tipoDocumento ||
        req.body?.documentType ||
        req.body?.tipoDocumento
    );
}

function buildWhatsAppMessageForDocument(document, clienteNombre) {
    return `Granja Mari Pepa\n\n` +
        `${document.label}: ${document.displaySerie}-${document.displayNumero}\n` +
        `Fecha: ${document.fecha}\n` +
        `Total: ${document.total.toFixed(2)} EUR\n\n` +
        `Cliente: ${clienteNombre || document.clienteNombre}\n\n` +
        `Gracias por su confianza.`;
}

function buildEmailHtmlForDocument(document, clienteNombre, customBody) {
    const params = {
        serie: document.displaySerie,
        numero: document.displayNumero,
        fecha: document.fecha,
        total: document.total,
        clienteNombre: clienteNombre || document.clienteNombre,
        customBody
    };

    return document.documentType === 'albaran'
        ? generateDeliveryEmailHtml(params)
        : generateInvoiceEmailHtml(params);
}

async function resolveAlbaranDocument({ serie, numero, ejercicio, terminal }) {
    const detail = await facturasService.getAlbaranDetailForPdf(serie, numero, ejercicio, terminal);
    const header = detail.header || {};
    const displaySerie = (header.SERIEALBARAN || header.serie || serie || '').toString().trim();
    const displayNumero = header.NUMEROALBARAN || header.numero || numero;
    const displayEjercicio = header.EJERCICIOALBARAN || header.ejercicio || ejercicio;
    const displayTerminal = header.TERMINALALBARAN || header.terminal || 0;

    return {
        documentType: 'albaran',
        label: 'Albaran',
        detail,
        displaySerie,
        displayNumero,
        displayEjercicio,
        displayTerminal,
        fecha: header.fecha || '',
        total: parseFloat(header.total || header.IMPORTETOTAL) || 0,
        clienteNombre: header.clienteNombre || header.NOMBRECLIENTEFACTURA || '',
        filename: `Albaran_${displayEjercicio}_${displaySerie}_${displayTerminal}_${displayNumero}.pdf`
    };
}

async function resolveFacturaDocument({ serie, numero, ejercicio }) {
    const detail = await facturasService.getFacturaDetail(serie, numero, ejercicio);
    const header = detail.header || {};
    const displaySerie = (header.serie || serie || '').toString().trim();
    const displayNumero = header.numero || numero;
    const displayEjercicio = header.ejercicio || ejercicio;

    return {
        documentType: 'factura',
        label: 'Factura',
        detail,
        displaySerie,
        displayNumero,
        displayEjercicio,
        displayTerminal: null,
        fecha: header.fecha || '',
        total: parseFloat(header.total) || 0,
        clienteNombre: header.clienteNombre || '',
        filename: `Factura_${displaySerie}_${displayNumero}_${displayEjercicio}.pdf`
    };
}

async function resolveCommercialDocument({ serie, numero, ejercicio, terminal, requestedType = null }) {
    const parsedNumero = parseRouteInt(numero);
    const parsedEjercicio = parseRouteInt(ejercicio);
    const parsedTerminal = terminal === null || terminal === undefined || terminal === ''
        ? null
        : parseRouteInt(terminal);

    if (!serie || !parsedNumero || parsedNumero <= 0 || parsedNumero >= 900000 || !parsedEjercicio || parsedEjercicio <= 0) {
        throw httpError('Parametros de documento invalidos', 400);
    }

    if (terminal !== null && terminal !== undefined && terminal !== '' && parsedTerminal === null) {
        throw httpError('Terminal de albaran invalido', 400);
    }

    const attempts = requestedType === 'albaran'
        ? ['albaran', 'factura']
        : ['factura', 'albaran'];

    let lastNotFound = null;
    for (const type of attempts) {
        try {
            if (type === 'albaran') {
                return await resolveAlbaranDocument({
                    serie,
                    numero: parsedNumero,
                    ejercicio: parsedEjercicio,
                    terminal: parsedTerminal
                });
            }
            return await resolveFacturaDocument({
                serie,
                numero: parsedNumero,
                ejercicio: parsedEjercicio
            });
        } catch (error) {
            if (!isDocumentNotFound(error)) {
                throw error;
            }
            lastNotFound = error;
        }
    }

    logger.warn(`[facturas] Document not found as factura or albaran: ${serie}-${parsedNumero}-${parsedEjercicio}`);
    throw httpError(lastNotFound?.message || 'Documento no encontrado', 404);
}

// ASVS V8: call authorizeDocumentScope() between resolve and build so a
// forbidden request never triggers the expensive PDF generation.
async function buildCommercialDocumentPdf(document) {
    const cacheKey = [
        'commercial_document',
        document.documentType,
        document.displayEjercicio,
        document.displaySerie,
        document.displayTerminal === null ? 'NA' : document.displayTerminal,
        document.displayNumero,
        FACTURA_PDF_CACHE_VERSION
    ].join(':');

    let pdfBuffer = getCachedPdf(cacheKey);
    const fromCache = !!pdfBuffer;

    if (!pdfBuffer) {
        pdfBuffer = document.documentType === 'albaran'
            ? await documentPdfService.generateInvoicePDF(document.detail)
            : await pdfService.generateInvoicePDF(document.detail);
        cachePdf(cacheKey, pdfBuffer);
    }

    return { ...document, cacheKey, pdfBuffer, fromCache };
}


function clampFacturasLimit(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return FACTURA_DEFAULT_LIMIT;
    return Math.min(FACTURA_MAX_LIMIT, parsed);
}

function clampFacturasOffset(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.min(FACTURA_MAX_OFFSET, parsed);
}

/**
 * GET /api/facturas
 */
router.get('/', verifyToken, async (req, res, next) => {
    try {
        // ASVS V8 / BOLA: vendor codes are user-scoped, not client-trusted.
        const scoped = scopeVendedorCodesQuery(req);
        if (scoped.status) return res.status(scoped.status).json(scoped.body);

        const params = {
            vendedorCodes: scoped.vendedorCodes,
            year: req.query.year ? parseInt(req.query.year) : undefined,
            month: req.query.month ? parseInt(req.query.month) : undefined,
            search: req.query.search,
            clientId: req.query.clientId,
            clientSearch: req.query.clientSearch,
            docSearch: req.query.docSearch,
            documentType: req.query.documentType || req.query.tipoDocumento,
            dateFrom: req.query.dateFrom,
            dateTo: req.query.dateTo,
            limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
            offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined
        };

        const result = await facturasService.getFacturas(params);

        if (result.error && !result.success) {
            logger.warn(`[facturas] Service error: ${result.error}`);
        }

        res.json({
            success: true,
            facturas: result.facturas || result || [],
            count: (result.facturas || result || []).length,
            limit: clampFacturasLimit(params.limit),
            offset: clampFacturasOffset(params.offset),
            year: params.year || new Date().getFullYear()
        });
    } catch (error) {
        logger.error(`Error en GET /facturas: ${error.message}`);
        next(error);
    }
});

/**
 * GET /api/facturas/years
 */
router.get('/years', verifyToken, async (req, res, next) => {
    try {
        // ASVS V8 / BOLA: vendor codes are user-scoped, not client-trusted.
        const scoped = scopeVendedorCodesQuery(req);
        if (scoped.status) return res.status(scoped.status).json(scoped.body);
        const vendedorCodes = scoped.vendedorCodes;

        const years = await facturasService.getAvailableYears(vendedorCodes);

        if (years.length > 0) {
            logger.info(`[facturas/years] OK - ${years.length} years for vendors ${vendedorCodes.substring(0, 20)}`);
        }

        res.json({ success: true, years });
    } catch (error) {
        logger.warn(`[facturas/years] Returning empty years due to: ${error.message.substring(0, 100)}`);
        res.json({ success: true, years: [] });
    }
});

/**
 * GET /api/facturas/summary
 */
router.get('/summary', verifyToken, async (req, res, next) => {
    try {
        // ASVS V8 / BOLA: vendor codes are user-scoped, not client-trusted.
        const scoped = scopeVendedorCodesQuery(req);
        if (scoped.status) return res.status(scoped.status).json(scoped.body);

        const params = {
            vendedorCodes: scoped.vendedorCodes,
            year: req.query.year ? parseInt(req.query.year) : undefined,
            month: req.query.month ? parseInt(req.query.month) : undefined,
            search: req.query.search,
            clientId: req.query.clientId,
            clientSearch: req.query.clientSearch,
            docSearch: req.query.docSearch,
            documentType: req.query.documentType || req.query.tipoDocumento,
            dateFrom: req.query.dateFrom,
            dateTo: req.query.dateTo
        };

        const summary = await facturasService.getSummary(params);

        logger.info(`[facturas/summary] OK - ${summary.totalFacturas} facturas, ${summary.totalImporte}€ total`);

        res.json({ success: true, summary });
    } catch (error) {
        logger.warn(`[facturas/summary] Returning zeros due to: ${error.message.substring(0, 100)}`);
        res.json({
            success: true,
            summary: {
                totalFacturas: 0,
                totalDocumentos: 0,
                totalFacturasEmitidas: 0,
                totalAlbaranes: 0,
                totalImporte: 0,
                totalBase: 0,
                totalIva: 0
            }
        });
    }
});

/**
 * GET /api/facturas/:serie/:numero/:ejercicio
 */
router.get('/:serie/:numero/:ejercicio', verifyToken, async (req, res, next) => {
    try {
        const { serie, numero, ejercicio } = req.params;
        const document = await resolveCommercialDocument({
            serie,
            numero,
            ejercicio,
            terminal: req.query.terminal,
            requestedType: getRequestDocumentType(req)
        });

        // ASVS V8 / BOLA: the document vendor must be inside the signed user scope.
        if (!await authorizeDocumentScope(req, document)) {
            return res.status(403).json(isDocumentScopeForbiddenResponse());
        }

        res.json({
            success: true,
            factura: document.detail,
            documentType: document.documentType,
            tipoDocumento: document.documentType
        });
    } catch (error) {
        if (error.status === 400) {
            return res.status(400).json({ success: false, error: error.message });
        }
        if (isDocumentNotFound(error)) {
            return res.status(404).json({ success: false, error: 'Documento no encontrado' });
        }
        logger.error(`Error en GET /facturas/:serie/:numero/:ejercicio: ${error.message}`);
        next(error);
    }
});

/**
 * GET /api/facturas/:serie/:numero/:ejercicio/pdf
 */
router.get('/:serie/:numero/:ejercicio/pdf', verifyToken, async (req, res, next) => {
    try {
        const { serie, numero, ejercicio } = req.params;
        const preview = req.query.preview === 'true';
        const document = await resolveCommercialDocument({
            serie,
            numero,
            ejercicio,
            terminal: req.query.terminal,
            requestedType: getRequestDocumentType(req)
        });

        // ASVS V8 / BOLA: the document vendor must be inside the signed user scope.
        if (!await authorizeDocumentScope(req, document)) {
            return res.status(403).json(isDocumentScopeForbiddenResponse());
        }

        const pdfDocument = await buildCommercialDocumentPdf(document);
        const pdfBuffer = pdfDocument.pdfBuffer;
        const filename = pdfDocument.filename;
        const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const disposition = preview ? 'inline' : 'attachment';

        logger.info(`[FACTURAS] PDF serving: ${filename} (${pdfBuffer.length} bytes, type: ${document.documentType}, cache: ${pdfDocument.fromCache ? 'HIT' : 'MISS'})`);

        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', `${disposition}; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`);
        res.set('Content-Length', pdfBuffer.length);
        res.set('Accept-Ranges', 'bytes');
        // FIX: no-store prevents Flutter HTTP client from caching stale/truncated PDF
        // Server-side cache in emailPdfService.js (5min TTL) handles reuse
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');

        res.send(pdfBuffer);
    } catch (error) {
        if (error.status === 400) {
            return res.status(400).json({ success: false, error: error.message });
        }
        if (isDocumentNotFound(error)) {
            return res.status(404).json({ success: false, error: 'Documento no encontrado' });
        }
        logger.error(`Error en GET /facturas/${req.params.serie}/${req.params.numero}/${req.params.ejercicio}/pdf: ${error.message}`);
        next(error);
    }
});

/**
 * ASVS V8: third-party delivery of a commercial document is only allowed to
 * the client's own email on file. The document detail does not expose a
 * verified client email (DSEDAC.CLI has no EMAIL column; verified against the
 * living schema), so non-financial roles fail closed per remediation spec.
 */
function authorizeDocumentShareRecipient(req, document, destinatario) {
    if (isFinancialRole(req.user)) return true;
    const clientEmail = String(document?.detail?.header?.clienteEmail || '')
        .trim()
        .toLowerCase();
    if (!clientEmail) return false;
    return clientEmail === String(destinatario || '').trim().toLowerCase();
}

function shareDestinatarioNotAllowedResponse() {
    return {
        success: false,
        code: 'SHARE_DESTINATARIO_NOT_ALLOWED',
        error: 'El envío de este documento a ese destinatario no está permitido para tu perfil.',
        no_retry_reason: 'Solo un Jefe de Ventas puede enviar este documento; no reintentar con el mismo perfil.'
    };
}

function emailDestinatarioNotAllowedResponse() {
    return {
        success: false,
        code: 'EMAIL_DESTINATARIO_NOT_ALLOWED',
        error: 'El envío de este documento a ese destinatario no está permitido para tu perfil.',
        no_retry_reason: 'Solo un Jefe de Ventas puede enviar este documento por email; no reintentar con el mismo perfil.'
    };
}

/**
 * POST /api/facturas/share/whatsapp
 * WhatsApp share with PDF base64 for Flutter to share as document
 */
router.post('/share/whatsapp', verifyToken, async (req, res, next) => {
    try {
        const { serie, numero, ejercicio, telefono, clienteNombre, terminal } = req.body;

        if (!serie || !numero || !ejercicio || !telefono) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const document = await resolveCommercialDocument({
            serie,
            numero,
            ejercicio,
            terminal,
            requestedType: getRequestDocumentType(req)
        });

        // ASVS V8 / BOLA: the document vendor must be inside the signed user scope.
        if (!await authorizeDocumentScope(req, document)) {
            return res.status(403).json(isDocumentScopeForbiddenResponse());
        }
        if (!authorizeDocumentShareRecipient(req, document, telefono)) {
            return res.status(422).json(shareDestinatarioNotAllowedResponse());
        }

        const pdfDocument = await buildCommercialDocumentPdf(document);
        const pdfBuffer = pdfDocument.pdfBuffer;
        const message = buildWhatsAppMessageForDocument(document, clienteNombre);

        const phoneClean = telefono.replace(/\D/g, '');
        const whatsappUrl = `https://wa.me/${phoneClean}?text=${encodeURIComponent(message)}`;

        // Convert PDF to base64 for Flutter to share as document
        const pdfBase64 = pdfBuffer.toString('base64');
        const pdfFilename = document.filename.replace(/[^a-zA-Z0-9._-]/g, '_');

        logger.info(`[FACTURAS] WhatsApp generated: ${document.label} ${document.displaySerie}-${document.displayNumero} to ${phoneClean}`);

        res.json({
            success: true,
            whatsappUrl,
            message,
            pdfBase64,
            pdfFilename,
            mimeType: 'application/pdf'
        });
    } catch (error) {
        if (error.status === 400) {
            return res.status(400).json({ success: false, error: error.message });
        }
        if (isDocumentNotFound(error)) {
            return res.status(404).json({ success: false, error: 'Documento no encontrado' });
        }
        logger.error(`Error en POST /facturas/share/whatsapp: ${error.message}`);
        next(error);
    }
});

/**
 * POST /api/facturas/send-email
 * Server-side email sending with PDF attachment via Nodemailer
 */
router.post('/send-email', verifyToken, emailLimiter, async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
        const { serie, numero, ejercicio, terminal, destinatario, asunto, cuerpo, clienteNombre } = req.body;

        if (!serie || !numero || !ejercicio || !destinatario) {
            return res.status(400).json({ success: false, error: 'Campos requeridos: serie, numero, ejercicio, destinatario' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(destinatario)) {
            return res.status(400).json({ success: false, error: 'Email destinatario inválido' });
        }

        const document = await resolveCommercialDocument({
            serie,
            numero,
            ejercicio,
            terminal,
            requestedType: getRequestDocumentType(req)
        });

        // ASVS V8 / BOLA: the document vendor must be inside the signed user scope.
        if (!await authorizeDocumentScope(req, document)) {
            return res.status(403).json(isDocumentScopeForbiddenResponse());
        }
        // ASVS V8: emails leave our perimeter; only the client's own email or a
        // financial role may receive a commercial document.
        if (!authorizeDocumentShareRecipient(req, document, destinatario)) {
            return res.status(422).json(emailDestinatarioNotAllowedResponse());
        }

        const pdfDocument = await buildCommercialDocumentPdf(document);
        const emailSubject = asunto || `${document.label} ${document.displaySerie}-${document.displayNumero} - Granja Mari Pepa`;
        const htmlBody = buildEmailHtmlForDocument(document, clienteNombre, cuerpo);
        const pdfFilename = document.filename.replace(/[^a-zA-Z0-9._-]/g, '_');

        const result = await withFacturaEmailTimeout(sendEmailWithPdf({
            to: destinatario,
            subject: emailSubject,
            htmlBody,
            pdfBuffer: pdfDocument.pdfBuffer,
            pdfFilename
        }));

        res.json({
            success: true,
            message: `Email enviado correctamente a ${destinatario}`,
            messageId: result.messageId
        });
    } catch (error) {
        if (error.status === 400) {
            return res.status(400).json({ success: false, error: error.message });
        }
        if (isDocumentNotFound(error)) {
            return res.status(404).json({ success: false, error: 'Documento no encontrado' });
        }
        logger.error(`Error en POST /facturas/send-email: ${error.message}`);
        return sendEmailFailureResponse(res, error);
    }
});

/**
 * POST /api/facturas/share/email (LEGACY - kept for backward compatibility)
 * Now redirects to send-email
 */
router.post('/share/email', verifyToken, emailLimiter, async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
        const { serie, numero, ejercicio, terminal, destinatario, clienteNombre } = req.body;

        if (!serie || !numero || !ejercicio || !destinatario) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(destinatario)) {
            return res.status(400).json({ success: false, error: 'Email inválido' });
        }

        const document = await resolveCommercialDocument({
            serie,
            numero,
            ejercicio,
            terminal,
            requestedType: getRequestDocumentType(req)
        });

        // ASVS V8 / BOLA: the document vendor must be inside the signed user scope.
        if (!await authorizeDocumentScope(req, document)) {
            return res.status(403).json(isDocumentScopeForbiddenResponse());
        }
        // ASVS V8: emails leave our perimeter; only the client's own email or a
        // financial role may receive a commercial document.
        if (!authorizeDocumentShareRecipient(req, document, destinatario)) {
            return res.status(422).json(emailDestinatarioNotAllowedResponse());
        }

        const pdfDocument = await buildCommercialDocumentPdf(document);
        const emailSubject = `${document.label} ${document.displaySerie}-${document.displayNumero} - Granja Mari Pepa`;
        const htmlBody = buildEmailHtmlForDocument(document, clienteNombre);
        const pdfFilename = document.filename.replace(/[^a-zA-Z0-9._-]/g, '_');

        const result = await withFacturaEmailTimeout(sendEmailWithPdf({
            to: destinatario,
            subject: emailSubject,
            htmlBody,
            pdfBuffer: pdfDocument.pdfBuffer,
            pdfFilename
        }));

        res.json({
            success: true,
            message: `Email enviado correctamente a ${destinatario}`,
            messageId: result.messageId
        });
    } catch (error) {
        if (error.status === 400) {
            return res.status(400).json({ success: false, error: error.message });
        }
        if (isDocumentNotFound(error)) {
            return res.status(404).json({ success: false, error: 'Documento no encontrado' });
        }
        logger.error(`Error en POST /facturas/share/email: ${error.message}`);
        return sendEmailFailureResponse(res, error);
    }
});

module.exports = router;
