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
            clientId: req.query.clientId
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
        const params = {
            vendedorCodes: req.query.vendedorCodes,
            year: req.query.year ? parseInt(req.query.year) : undefined,
            month: req.query.month ? parseInt(req.query.month) : undefined
        };

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

        const factura = await facturasService.getFacturaDetail(
            serie,
            parseInt(numero),
            parseInt(ejercicio)
        );

        if (!factura) {
            return res.status(404).json({ success: false, error: 'Factura no encontrada' });
        }

        const pdfService = require('../services/pdf.service');
        const pdfBuffer = await pdfService.generateInvoicePDF(factura);

        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', `attachment; filename=Factura_${serie}_${numero}_${ejercicio}.pdf`);
        res.set('Content-Length', pdfBuffer.length);

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
 * POST /api/facturas/share/email
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

        const factura = await facturasService.getFacturaDetail(serie, numero, ejercicio);

        const subject = `Factura ${serie}-${numero} - Granja Mari Pepa`;
        const body = `Factura: ${serie}-${numero}\nFecha: ${factura.header.fecha}\nTotal: ${factura.header.total.toFixed(2)} €\n\nCliente: ${clienteNombre || factura.header.clienteNombre}`;

        const mailtoUrl = `mailto:${destinatario}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

        res.json({
            success: true,
            message: `Preparado para enviar a ${destinatario}`,
            mailtoUrl
        });
    } catch (error) {
        logger.error(`Error en POST /facturas/share/email: ${error.message}`);
        next(error);
    }
});

module.exports = router;
