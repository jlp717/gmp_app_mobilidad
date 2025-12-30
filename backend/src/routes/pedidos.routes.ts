/**
 * RUTAS DE PEDIDOS
 * Gestión de pedidos desde la app móvil
 */

import { Router, Request, Response } from 'express';
import { optionalAuth } from '../middleware/auth.middleware';
import { generalLimiter } from '../middleware/security.middleware';
import { asyncHandler } from '../middleware/error.middleware';
import { logger } from '../utils/logger';

const router = Router();

interface LineaPedido {
  codigoArticulo: string;
  descripcion?: string;
  cantidad: number;
  precio: number;
  descuento?: number;
}

interface PedidoRequest {
  codigoCliente: string;
  lineas: LineaPedido[];
  observaciones?: string;
  fecha?: string;
}

/**
 * POST /api/pedidos
 * Crear un pedido nuevo desde la app móvil
 */
router.post('/', optionalAuth, generalLimiter, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { codigoCliente, lineas, observaciones } = req.body as PedidoRequest;

  // Validar datos mínimos
  if (!codigoCliente) {
    res.status(400).json({
      success: false,
      error: 'Código de cliente requerido',
    });
    return;
  }

  if (!lineas || !Array.isArray(lineas) || lineas.length === 0) {
    res.status(400).json({
      success: false,
      error: 'El pedido debe tener al menos una línea',
    });
    return;
  }

  // Calcular total
  const total = lineas.reduce((sum, linea) => {
    const subtotal = (linea.cantidad || 0) * (linea.precio || 0);
    const descuento = linea.descuento ? subtotal * (linea.descuento / 100) : 0;
    return sum + (subtotal - descuento);
  }, 0);

  // Generar número de pedido temporal
  const numeroPedido = `PED-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

  // Log del pedido recibido
  logger.info('Pedido recibido:', {
    numeroPedido,
    cliente: codigoCliente,
    lineas: lineas.length,
    total: total.toFixed(2),
    observaciones: observaciones || 'Sin observaciones',
  });

  // Respuesta exitosa
  // TODO: En producción, guardar en base de datos
  const pedido = {
    numeroPedido,
    codigoCliente,
    fecha: new Date().toISOString().split('T')[0],
    hora: new Date().toTimeString().split(' ')[0],
    lineas: lineas.map((l, idx) => ({
      numero: idx + 1,
      codigoArticulo: l.codigoArticulo,
      descripcion: l.descripcion || '',
      cantidad: l.cantidad,
      precio: l.precio,
      descuento: l.descuento || 0,
      subtotal: (l.cantidad || 0) * (l.precio || 0) * (1 - (l.descuento || 0) / 100),
    })),
    totalLineas: lineas.length,
    totalUnidades: lineas.reduce((sum, l) => sum + (l.cantidad || 0), 0),
    totalImporte: total,
    observaciones: observaciones || '',
    estado: 'PENDIENTE',
    creadoDesde: 'APP_MOVIL',
  };

  res.status(201).json({
    success: true,
    pedido,
    mensaje: 'Pedido creado correctamente',
  });
}));

/**
 * GET /api/pedidos
 * Lista de pedidos (pendientes de sincronizar)
 */
router.get('/', optionalAuth, generalLimiter, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { codigoCliente, estado, desde, hasta } = req.query;

  logger.info('Consulta pedidos:', { codigoCliente, estado, desde, hasta });

  // Por ahora devolver lista vacía - en producción consultaría la BD
  res.json({
    success: true,
    data: [],
    total: 0,
    mensaje: 'No hay pedidos pendientes',
  });
}));

/**
 * GET /api/pedidos/:numeroPedido
 * Detalle de un pedido específico
 */
router.get('/:numeroPedido', optionalAuth, generalLimiter, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { numeroPedido } = req.params;

  logger.info('Consulta pedido:', { numeroPedido });

  // Por ahora devolver not found - en producción buscaría en BD
  res.status(404).json({
    success: false,
    error: 'Pedido no encontrado',
    numeroPedido,
  });
}));

export default router;
