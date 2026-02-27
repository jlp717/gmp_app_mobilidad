/**
 * FACTURAS ROUTES (CommonJS)
 * ==========================
 * Endpoints for invoices in commercial profile
 * Ported from src/routes/facturas.routes.ts
 */

const express = require('express');
const router = express.Router();
const facturasService = require('../services/facturas.service');
const logger = require('../middleware/logger');
const { sendEmailWithPdf, generateInvoiceEmailHtml, cachePdf, getCachedPdf } = require('../services/emailPdfService');

/**
 * GET /api/facturas
 */
router.get('/', async (req, res, next) => {
    try {
        const params = {
            vendedorCodes: req.query.vendedorCodes,
            year: req.query.year ? parseInt(req.query.year) : undefined,
            month: req.query.month ? parseInt(req.query.month) : undefined,
            search: req.query.search,
            clientId: req.query.clientId,
            clientSearch: req.query.clientSearch,
            docSearch: req.query.docSearch,
            dateFrom: req.query.dateFrom,
            dateTo: req.query.dateTo
        };

        if (!params.vendedorCodes) {
            return res.status(400).json({ success: false, error: 'vendedorCodes is required' });
        }

        const facturas = await facturasService.getFacturas(params);

        res.json({
            success: true,
            facturas,
            count: facturas.length,
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
router.get('/years', async (req, res, next) => {
    try {
        const vendedorCodes = req.query.vendedorCodes;

        if (!vendedorCodes) {
            return res.status(400).json({ success: false, error: 'vendedorCodes is required' });
        }

        const years = await facturasService.getAvailableYears(vendedorCodes);

        res.json({ success: true, years });
    } catch (error) {
        logger.error(`Error en GET /facturas/years: ${error.message}`);
        next(error);
    }
});

/**
 * GET /api/facturas/summary
 */
router.get('/summary', async (req, res, next) => {
    try {
        // FIX #2: Pass dateFrom/dateTo to summary (was missing - caused wrong totals)
        const params = {
            vendedorCodes: req.query.vendedorCodes,
            year: req.query.year ? parseInt(req.query.year) : undefined,
            month: req.query.month ? parseInt(req.query.month) : undefined,
            dateFrom: req.query.dateFrom,
            dateTo: req.query.dateTo
        };
        logger.info(`[FACTURAS] /summary params: vendor=${params.vendedorCodes}, year=${params.year}, dateFrom=${params.dateFrom}, dateTo=${params.dateTo}`);

        if (!params.vendedorCodes) {
            return res.status(400).json({ success: false, error: 'vendedorCodes is required' });
        }

        const summary = await facturasService.getSummary(params);

        res.json({ success: true, summary });
    } catch (error) {
        logger.error(`Error en GET /facturas/summary: ${error.message}`);
        next(error);
    }
});

/**
 * GET /api/facturas/:serie/:numero/:ejercicio
 */
router.get('/:serie/:numero/:ejercicio', async (req, res, next) => {
    try {
        const { serie, numero, ejercicio } = req.params;

        const factura = await facturasService.getFacturaDetail(
            serie,
            parseInt(numero),
            parseInt(ejercicio)
        );

        res.json({ success: true, factura });
    } catch (error) {
        if (error.message === 'Factura no encontrada') {
            return res.status(404).json({ success: false, error: 'Factura no encontrada' });
        }
        logger.error(`Error en GET /facturas/:serie/:numero/:ejercicio: ${error.message}`);
        next(error);
    }
});

/**
 * GET /api/facturas/:serie/:numero/:ejercicio/pdf
 */
router.get('/:serie/:numero/:ejercicio/pdf', async (req, res, next) => {
    try {
        const { serie, numero, ejercicio } = req.params;
        const preview = req.query.preview === 'true';
        const cacheKey = `factura_${serie}_${numero}_${ejercicio}`;

        // Check PDF cache first
        let pdfBuffer = getCachedPdf(cacheKey);

        if (!pdfBuffer) {
            const factura = await facturasService.getFacturaDetail(
                serie,
                parseInt(numero),
                parseInt(ejercicio)
            );

            if (!factura) {
                return res.status(404).json({ success: false, error: 'Factura no encontrada' });
            }

            const pdfService = require('../services/pdf.service');
            pdfBuffer = await pdfService.generateInvoicePDF(factura);

            // Cache for reuse
            cachePdf(cacheKey, pdfBuffer);
        }

        const filename = `Factura_${serie}_${numero}_${ejercicio}.pdf`;
        const disposition = preview ? 'inline' : 'attachment';

        const wasCached = !!getCachedPdf(cacheKey);
        logger.info(`[FACTURAS] PDF serving: ${filename} (${pdfBuffer.length} bytes, cache: ${wasCached ? 'HIT' : 'MISS'})`);

        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', `${disposition}; filename=${filename}`);
        res.set('Content-Length', pdfBuffer.length);
        // FIX: no-store prevents Flutter HTTP client from caching stale/truncated PDF
        // Server-side cache in emailPdfService.js (5min TTL) handles reuse
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');

        res.send(pdfBuffer);
    } catch (error) {
        logger.error(`Error en GET /facturas/${req.params.serie}/${req.params.numero}/${req.params.ejercicio}/pdf: ${error.message}`);
        next(error);
    }
});

/**
 * POST /api/facturas/share/whatsapp
 */
router.post('/share/whatsapp', async (req, res, next) => {
    try {
        const { serie, numero, ejercicio, telefono, clienteNombre } = req.body;

        if (!serie || !numero || !ejercicio || !telefono) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const factura = await facturasService.getFacturaDetail(serie, numero, ejercicio);

        const message = facturasService.generateWhatsAppMessage(
            serie,
            numero,
            factura.header.fecha,
            factura.header.total,
            clienteNombre || factura.header.clienteNombre
        );

        const phoneClean = telefono.replace(/\D/g, '');
        const whatsappUrl = `https://wa.me/${phoneClean}?text=${encodeURIComponent(message)}`;

        res.json({
            success: true,
            whatsappUrl,
            message
        });
    } catch (error) {
        logger.error(`Error en POST /facturas/share/whatsapp: ${error.message}`);
        next(error);
    }
});

/**
 * POST /api/facturas/send-email
 * Server-side email sending with PDF attachment via Nodemailer
 */
router.post('/send-email', async (req, res, next) => {
    try {
        const { serie, numero, ejercicio, destinatario, asunto, cuerpo, clienteNombre } = req.body;

        if (!serie || !numero || !ejercicio || !destinatario) {
            return res.status(400).json({ success: false, error: 'Campos requeridos: serie, numero, ejercicio, destinatario' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(destinatario)) {
            return res.status(400).json({ success: false, error: 'Email destinatario inválido' });
        }

        // Get or generate PDF (with cache)
        const cacheKey = `factura_${serie}_${numero}_${ejercicio}`;
        let pdfBuffer = getCachedPdf(cacheKey);

        if (!pdfBuffer) {
            const factura = await facturasService.getFacturaDetail(serie, parseInt(numero), parseInt(ejercicio));
            if (!factura) {
                return res.status(404).json({ success: false, error: 'Factura no encontrada' });
            }

            const pdfService = require('../services/pdf.service');
            pdfBuffer = await pdfService.generateInvoicePDF(factura);
            cachePdf(cacheKey, pdfBuffer);
        }

        // Get factura details for email template
        const factura = await facturasService.getFacturaDetail(serie, parseInt(numero), parseInt(ejercicio));

        const emailSubject = asunto || `Factura ${serie}-${numero} - Granja Mari Pepa`;
        const htmlBody = generateInvoiceEmailHtml({
            serie,
            numero,
            fecha: factura.header.fecha,
            total: factura.header.total,
            clienteNombre: clienteNombre || factura.header.clienteNombre,
            customBody: cuerpo
        });

        const pdfFilename = `Factura_${serie}_${numero}_${ejercicio}.pdf`;

        const result = await sendEmailWithPdf({
            to: destinatario,
            subject: emailSubject,
            htmlBody,
            pdfBuffer,
            pdfFilename
        });

        res.json({
            success: true,
            message: `Email enviado correctamente a ${destinatario}`,
            messageId: result.messageId
        });
    } catch (error) {
        logger.error(`Error en POST /facturas/send-email: ${error.message}`);
        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            return res.status(503).json({ success: false, error: 'Error de conexión con servidor de email. Inténtelo de nuevo.' });
        }
        next(error);
    }
});

/**
 * POST /api/facturas/share/email (LEGACY - kept for backward compatibility)
 * Now redirects to send-email
 */
router.post('/share/email', async (req, res, next) => {
    try {
        const { serie, numero, ejercicio, destinatario, clienteNombre } = req.body;

        if (!serie || !numero || !ejercicio || !destinatario) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(destinatario)) {
            return res.status(400).json({ success: false, error: 'Email inválido' });
        }

        // Use the new server-side sending
        const cacheKey = `factura_${serie}_${numero}_${ejercicio}`;
        let pdfBuffer = getCachedPdf(cacheKey);

        if (!pdfBuffer) {
            const factura = await facturasService.getFacturaDetail(serie, parseInt(numero), parseInt(ejercicio));
            const pdfService = require('../services/pdf.service');
            pdfBuffer = await pdfService.generateInvoicePDF(factura);
            cachePdf(cacheKey, pdfBuffer);
        }

        const factura = await facturasService.getFacturaDetail(serie, parseInt(numero), parseInt(ejercicio));
        const emailSubject = `Factura ${serie}-${numero} - Granja Mari Pepa`;
        const htmlBody = generateInvoiceEmailHtml({
            serie, numero,
            fecha: factura.header.fecha,
            total: factura.header.total,
            clienteNombre: clienteNombre || factura.header.clienteNombre
        });

        const result = await sendEmailWithPdf({
            to: destinatario,
            subject: emailSubject,
            htmlBody,
            pdfBuffer,
            pdfFilename: `Factura_${serie}_${numero}_${ejercicio}.pdf`
        });

        res.json({
            success: true,
            message: `Email enviado correctamente a ${destinatario}`,
            messageId: result.messageId
        });
    } catch (error) {
        logger.error(`Error en POST /facturas/share/email: ${error.message}`);
        next(error);
    }
});

module.exports = router;
