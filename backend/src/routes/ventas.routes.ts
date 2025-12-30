/**
 * RUTAS DE VENTAS
 * Endpoints para histórico y estadísticas de ventas
 */

import { Router, Request, Response, NextFunction } from 'express';
import { ventasService } from '../services/ventas.service';
import { requireAuth } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';

const router = Router();

// Aplicar autenticación a todas las rutas de ventas
router.use(requireAuth);

/**
 * GET /api/ventas/historico
 * Obtiene histórico de ventas con filtros
 * 
 * Query params:
 * - cliente: código de cliente
 * - producto: código de producto
 * - desde: fecha inicio (YYYY-MM-DD)
 * - hasta: fecha fin (YYYY-MM-DD)
 * - comercial: código comercial
 * - limit: número máximo de resultados (default: 50)
 * - offset: desplazamiento para paginación
 */
router.get('/historico', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = {
      codigoCliente: req.query.cliente as string | undefined,
      codigoProducto: req.query.producto as string | undefined,
      desde: req.query.desde as string | undefined,
      hasta: req.query.hasta as string | undefined,
      comercial: req.query.comercial as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
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
 * Obtiene estadísticas de ventas para gráficas
 * 
 * Query params:
 * - tipo: 'diario' | 'semanal' | 'mensual' | 'anual'
 * - desde: fecha inicio
 * - hasta: fecha fin
 * - cliente: código cliente
 * - producto: código producto
 * - comercial: código comercial
 * - agrupacion: 'cliente' | 'producto' | 'categoria' | 'comercial'
 */
router.get('/estadisticas', async (req: Request, res: Response, next: NextFunction) => {
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
 * Obtiene ventas agrupadas por semanas (para gráficas de tendencia)
 * 
 * Query params:
 * - semanas: número de semanas a obtener (default: 12)
 * - cliente: código cliente
 * - comercial: código comercial
 */
router.get('/semanales', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = {
      semanas: req.query.semanas ? parseInt(req.query.semanas as string) : undefined,
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
