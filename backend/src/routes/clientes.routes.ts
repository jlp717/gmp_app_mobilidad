/**
 * RUTAS DE CLIENTES
 */

import { Router } from 'express';
import { requireAuth, optionalAuth } from '../middleware/auth.middleware';
import { generalLimiter } from '../middleware/security.middleware';
import { clienteService } from '../services/cliente.service';
import { asyncHandler } from '../middleware/error.middleware';
import { Request, Response } from 'express';

const router = Router();

/**
 * GET /api/clientes
 * Lista general de clientes (para sincronización móvil)
 */
router.get('/', optionalAuth, generalLimiter, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { limit, offset, search, dia } = req.query;
  
  const resultado = await clienteService.listarClientes({
    limit: limit ? parseInt(limit as string, 10) : 500,
    offset: offset ? parseInt(offset as string, 10) : 0,
    search: search as string,
    diaVisita: dia as string,
  });

  res.json({
    success: true,
    data: resultado.clientes,
    total: resultado.total,
    limit: resultado.limit,
    offset: resultado.offset,
  });
}));

/**
 * GET /api/clientes/:codigo
 * Obtener datos del cliente
 */
router.get('/:codigo', optionalAuth, generalLimiter, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { codigo } = req.params;
  const resultado = await clienteService.obtenerCliente(codigo);

  if (!resultado.success) {
    res.status(404).json({
      success: false,
      error: resultado.error,
    });
    return;
  }

  res.json({
    success: true,
    cliente: resultado.cliente,
  });
}));

/**
 * GET /api/clientes/:codigo/perfil
 * Obtener perfil completo del cliente
 */
router.get('/:codigo/perfil', requireAuth, generalLimiter, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { codigo } = req.params;
  const perfil = await clienteService.obtenerPerfilCompleto(codigo);

  if (!perfil) {
    res.status(404).json({
      success: false,
      error: 'Cliente no encontrado',
    });
    return;
  }

  res.json({
    success: true,
    perfil,
  });
}));

/**
 * GET /api/clientes/:codigo/facturas
 * Obtener facturas del cliente
 */
router.get('/:codigo/facturas', requireAuth, generalLimiter, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { codigo } = req.params;
  const { limit, offset } = req.query;

  const result = await clienteService.obtenerFacturas(
    codigo,
    limit ? parseInt(limit as string, 10) : undefined,
    offset ? parseInt(offset as string, 10) : undefined,
  );

  res.json({
    success: true,
    facturas: result.facturas,
    total: result.total,
    paginacion: result.paginacion,
  });
}));

/**
 * GET /api/clientes/:codigo/estadisticas
 * Obtener estadísticas del cliente
 */
router.get('/:codigo/estadisticas', requireAuth, generalLimiter, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { codigo } = req.params;

  const estadisticas = await clienteService.obtenerEstadisticasFacturas(codigo);

  res.json({
    success: true,
    estadisticas,
  });
}));

/**
 * GET /api/clientes/:codigo/top-productos
 * Obtener productos más comprados
 */
router.get('/:codigo/top-productos', requireAuth, generalLimiter, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { codigo } = req.params;
  const { limite } = req.query;

  const productos = await clienteService.obtenerTopProductos(
    codigo,
    limite ? parseInt(limite as string, 10) : 10
  );

  res.json({
    success: true,
    productos,
    total: productos.length,
  });
}));

/**
 * GET /api/clientes/:codigo/contacto
 * Obtener datos de contacto del cliente
 */
router.get('/:codigo/contacto', requireAuth, generalLimiter, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { codigo } = req.params;
  const contacto = await clienteService.obtenerDatosContacto(codigo);

  res.json({
    success: true,
    contacto,
  });
}));

/**
 * PUT /api/clientes/:codigo/contacto
 * Actualizar información de contacto del cliente
 */
router.put('/:codigo/contacto', requireAuth, generalLimiter, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { codigo } = req.params;
  const { email, telefono } = req.body;

  const resultado = await clienteService.actualizarDatosContacto(codigo, { email, telefono });

  if (!resultado) {
    res.status(400).json({
      success: false,
      error: 'No se pudo actualizar el contacto',
    });
    return;
  }

  res.json({
    success: true,
    mensaje: 'Contacto actualizado correctamente',
  });
}));

/**
 * GET /api/clientes/rutero
 * Obtener clientes para el rutero
 */
router.get('/rutero/lista', requireAuth, generalLimiter, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { ruta, diaVisita, limit, offset } = req.query;

  const result = await clienteService.obtenerClientesRutero(
    ruta as string | undefined,
    diaVisita as string | undefined,
    limit ? parseInt(limit as string, 10) : undefined,
    offset ? parseInt(offset as string, 10) : undefined,
  );

  res.json({
    success: true,
    clientes: result.clientes,
    total: result.total,
    paginacion: result.paginacion,
  });
}));

export default router;
