/**
 * RUTAS DE VENTAS
 * Endpoints para histórico y estadísticas de ventas
 * All inputs validated via Joi schemas.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { ventasService } from '../services/ventas.service';
import { requireAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { schemas } from '../utils/validators';
import { logger } from '../utils/logger';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/ventas/historico
 */
router.get('/historico', validate(schemas.ventasHistoricoQuery, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = {
      codigoCliente: req.query.cliente as string | undefined,
      codigoProducto: req.query.producto as string | undefined,
      desde: req.query.desde as string | undefined,
      hasta: req.query.hasta as string | undefined,
      comercial: req.query.comercial as string | undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    };

    const result = await ventasService.getHistorico(params);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error('Error en GET /ventas/historico:', error);
    next(error);
  }
});

/**
 * GET /api/ventas/estadisticas
 */
router.get('/estadisticas', validate(schemas.ventasEstadisticasQuery, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = {
      tipo: req.query.tipo as 'diario' | 'semanal' | 'mensual' | 'anual' | undefined,
      desde: req.query.desde as string | undefined,
      hasta: req.query.hasta as string | undefined,
      codigoCliente: req.query.cliente as string | undefined,
      codigoProducto: req.query.producto as string | undefined,
      comercial: req.query.comercial as string | undefined,
      agrupacion: req.query.agrupacion as 'cliente' | 'producto' | 'categoria' | 'comercial' | undefined,
    };

    const result = await ventasService.getEstadisticas(params);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error('Error en GET /ventas/estadisticas:', error);
    next(error);
  }
});

/**
 * GET /api/ventas/semanales
 */
router.get('/semanales', validate(schemas.ventasSemanalesQuery, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = {
      semanas: req.query.semanas ? Number(req.query.semanas) : undefined,
      codigoCliente: req.query.cliente as string | undefined,
      comercial: req.query.comercial as string | undefined,
    };

    const result = await ventasService.getVentasSemanales(params);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error('Error en GET /ventas/semanales:', error);
    next(error);
  }
});

export default router;
