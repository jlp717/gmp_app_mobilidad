/**
 * RUTAS DE PROMOCIONES
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { generalLimiter } from '../middleware/security.middleware';
import { promocionesService } from '../services/promociones.service';
import { asyncHandler } from '../middleware/error.middleware';
import { Request, Response } from 'express';

const router = Router();

/**
 * GET /api/promociones
 * Obtener todas las promociones activas
 */
router.get('/', requireAuth, generalLimiter, asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const promociones = await promocionesService.obtenerPromocionesActivas();

  res.json({
    success: true,
    promociones,
    total: promociones.length,
  });
}));

/**
 * GET /api/promociones/:codigo
 * Obtener detalle de una promoción
 */
router.get('/:codigo', requireAuth, generalLimiter, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { codigo } = req.params;
  const promocion = await promocionesService.obtenerPromocion(codigo);

  if (!promocion) {
    res.status(404).json({
      success: false,
      error: 'Promoción no encontrada',
    });
    return;
  }

  res.json({
    success: true,
    promocion,
  });
}));

/**
 * POST /api/promociones/:codigo/aplicar
 * Aplicar una promoción a un carrito/pedido
 */
router.post('/:codigo/aplicar', requireAuth, generalLimiter, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { codigo } = req.params;
  const { lineas, codigoCliente } = req.body;

  const resultado = await promocionesService.aplicarPromocion(codigo, lineas, codigoCliente);

  if (!resultado.aplicable) {
    res.status(400).json({
      success: false,
      error: resultado.mensaje,
    });
    return;
  }

  res.json({
    success: true,
    resultado,
  });
}));

/**
 * POST /api/promociones/calcular
 * Calcular todas las promociones aplicables a un conjunto de líneas
 */
router.post('/calcular', requireAuth, generalLimiter, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { lineas, codigoCliente } = req.body;

  const promocionesAplicables = await promocionesService.calcularPromocionesAplicables(lineas, codigoCliente);

  res.json({
    success: true,
    promociones: promocionesAplicables,
    total: promocionesAplicables.length,
  });
}));

export default router;
