/**
 * FACTURAS ROUTES
 * ================
 * Endpoints for invoices in commercial profile
 * Ported from granja_mari_pepa web app
 */

import { Router, Request, Response, NextFunction } from 'express';
import { facturasService } from '../services/facturas.service';
import { requireAuth } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/facturas
 */
router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const params = {
            vendedorCodes: req.query.vendedorCodes as string,
            year: req.query.year ? parseInt(req.query.year as string) : undefined,
            month: req.query.month ? parseInt(req.query.month as string) : undefined,
            search: req.query.search as string | undefined,
            clientId: req.query.clientId as string | undefined
        };

        if (!params.vendedorCodes) {
            res.status(400).json({ success: false, error: 'vendedorCodes is required' });
            return;
        }

        const facturas = await facturasService.getFacturas(params);

        res.json({
            success: true,
            facturas,
            count: facturas.length,
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
router.get('/years', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const vendedorCodes = req.query.vendedorCodes as string;

        if (!vendedorCodes) {
            res.status(400).json({ success: false, error: 'vendedorCodes is required' });
            return;
        }

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
router.get('/summary', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const params = {
            vendedorCodes: req.query.vendedorCodes as string,
            year: req.query.year ? parseInt(req.query.year as string) : undefined,
            month: req.query.month ? parseInt(req.query.month as string) : undefined
        };

        if (!params.vendedorCodes) {
            res.status(400).json({ success: false, error: 'vendedorCodes is required' });
            return;
        }

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
router.get('/:serie/:numero/:ejercicio', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
router.post('/share/whatsapp', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { serie, numero, ejercicio, telefono, clienteNombre } = req.body;

        if (!serie || !numero || !ejercicio || !telefono) {
            res.status(400).json({ success: false, error: 'Missing required fields' });
            return;
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
        logger.error('Error en POST /facturas/share/whatsapp:', error);
        next(error);
    }
});

/**
 * POST /api/facturas/share/email
 */
router.post('/share/email', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { serie, numero, ejercicio, destinatario, clienteNombre } = req.body;

        if (!serie || !numero || !ejercicio || !destinatario) {
            res.status(400).json({ success: false, error: 'Missing required fields' });
            return;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(destinatario)) {
            res.status(400).json({ success: false, error: 'Email inválido' });
            return;
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
        logger.error('Error en POST /facturas/share/email:', error);
        next(error);
    }
});

export default router;
