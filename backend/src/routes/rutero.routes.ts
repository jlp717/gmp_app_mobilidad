/**
 * RUTAS DE RUTERO
 * Endpoints para gestión del rutero de visitas
 */

import { Router, Request, Response, NextFunction } from 'express';
import { ruteroService } from '../services/rutero.service';
import { requireAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { schemas } from '../utils/validators';
import { logger } from '../utils/logger';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/rutero
 */
router.get('/', validate(schemas.ruteroQuery, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dia = req.query.dia as string | undefined;
    const clientes = await ruteroService.getRuteroDia(dia);

    res.json({
      success: true,
      dia: dia || obtenerDiaActual(),
      total: clientes.length,
      data: clientes,
    });
  } catch (error) {
    logger.error('Error en GET /rutero:', error);
    next(error);
  }
});

/**
 * GET /api/rutero/semana
 * Obtiene el rutero completo de la semana
 */
router.get('/semana', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rutero = await ruteroService.getRuteroSemana();

    res.json({
      success: true,
      data: rutero,
      resumen: {
        lunes: rutero.lunes.length,
        martes: rutero.martes.length,
        miercoles: rutero.miercoles.length,
        jueves: rutero.jueves.length,
        viernes: rutero.viernes.length,
        sabado: rutero.sabado.length,
        domingo: rutero.domingo.length,
      },
    });
  } catch (error) {
    logger.error('Error en GET /rutero/semana:', error);
    next(error);
  }
});

/**
 * GET /api/rutero/resumen
 * Obtiene un resumen del rutero (conteo por día)
 */
router.get('/resumen', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const resumen = await ruteroService.getResumenRutero();

    res.json({
      success: true,
      data: resumen,
    });
  } catch (error) {
    logger.error('Error en GET /rutero/resumen:', error);
    next(error);
  }
});

/**
 * GET /api/rutero/hoy
 * Alias para obtener el rutero de hoy
 */
router.get('/hoy', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const clientes = await ruteroService.getRuteroDia();

    res.json({
      success: true,
      dia: obtenerDiaActual(),
      fecha: new Date().toISOString().split('T')[0],
      total: clientes.length,
      data: clientes,
    });
  } catch (error) {
    logger.error('Error en GET /rutero/hoy:', error);
    next(error);
  }
});

/**
 * Helper: Obtiene el nombre del día actual
 */
function obtenerDiaActual(): string {
  const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  return dias[new Date().getDay()];
}

export default router;
