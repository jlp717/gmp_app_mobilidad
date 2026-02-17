/**
 * FACTURAS ROUTES
 * ================
 * Endpoints for invoices in commercial profile
 * All inputs validated via Joi schemas before reaching service layer.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { facturasService } from '../services/facturas.service';
import { requireAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { schemas } from '../utils/validators';
import { logger } from '../utils/logger';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/facturas
 */
router.get('/', validate(schemas.facturasQuery, 'query'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const params = {
            vendedorCodes: req.query.vendedorCodes as string,
            year: req.query.year ? Number(req.query.year) : undefined,
            month: req.query.month ? Number(req.query.month) : undefined,
            search: req.query.search as string | undefined,
            clientId: req.query.clientId as string | undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
            offset: req.query.offset ? Number(req.query.offset) : undefined,
        };

        const result = await facturasService.getFacturas(params);

        res.json({
            success: true,
            facturas: result.facturas,
            total: result.total,
            paginacion: result.paginacion,
            year: params.year || new Date().getFullYear()
        });
    } catch (error) {
        logger.error('Error en GET /facturas:', error);
        next(error);
    }
});

/**
 * GET /api/facturas/years
 */
router.get('/years', validate(schemas.facturasYearsQuery, 'query'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const vendedorCodes = req.query.vendedorCodes as string;
        const years = await facturasService.getAvailableYears(vendedorCodes);

        res.json({ success: true, years });
    } catch (error) {
        logger.error('Error en GET /facturas/years:', error);
        next(error);
    }
});

/**
 * GET /api/facturas/summary
 */
router.get('/summary', validate(schemas.facturasSummaryQuery, 'query'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const params = {
            vendedorCodes: req.query.vendedorCodes as string,
            year: req.query.year ? Number(req.query.year) : undefined,
            month: req.query.month ? Number(req.query.month) : undefined
        };

        const summary = await facturasService.getSummary(params);

        res.json({ success: true, summary });
    } catch (error) {
        logger.error('Error en GET /facturas/summary:', error);
        next(error);
    }
});

/**
 * GET /api/facturas/:serie/:numero/:ejercicio
 */
router.get('/:serie/:numero/:ejercicio', validate(schemas.facturaDetailParams, 'params'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { serie, numero, ejercicio } = req.params;

        const factura = await facturasService.getFacturaDetail(
            serie,
            parseInt(numero),
            parseInt(ejercicio)
        );

        res.json({ success: true, factura });
    } catch (error: any) {
        if (error.message === 'Factura no encontrada') {
            res.status(404).json({ success: false, error: 'Factura no encontrada' });
            return;
        }
        logger.error('Error en GET /facturas/:serie/:numero/:ejercicio:', error);
        next(error);
    }
});

/**
 * POST /api/facturas/share/whatsapp
 */
router.post('/share/whatsapp', validate(schemas.shareWhatsapp, 'body'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { serie, numero, ejercicio, telefono, clienteNombre } = req.body;

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
        logger.error('Error en POST /facturas/share/whatsapp:', error);
        next(error);
    }
});

/**
 * POST /api/facturas/share/email
 */
router.post('/share/email', validate(schemas.shareEmail, 'body'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { serie, numero, ejercicio, destinatario, clienteNombre } = req.body;

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
        logger.error('Error en POST /facturas/share/email:', error);
        next(error);
    }
});

export default router;
