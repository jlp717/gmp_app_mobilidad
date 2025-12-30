/**
 * CONTROLADOR DE AUTENTICACIÓN PARA VENDEDORES/COMERCIALES
 * Maneja endpoints de login, logout, refresh y perfil
 */

import { Request, Response } from 'express';
import { authService } from '../services/auth.service';
import { logger, createRequestLogger } from '../utils/logger';
import { asyncHandler } from '../middleware/error.middleware';

/**
 * POST /api/auth/login
 * Login de vendedor/comercial (código o nombre + PIN)
 * Ejemplos:
 *   - usuario: "02", password: "0397" (BARTOLO)
 *   - usuario: "BARTOLO", password: "0397"
 */
export const login = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || '';
  const log = createRequestLogger(requestId);

  // Aceptar varios formatos
  const usuario = req.body.usuario || req.body.codigoCliente || req.body.codigoVendedor || req.body.codigo;
  const password = req.body.password || req.body.nif || req.body.pin;

  if (!usuario || !password) {
    res.status(400).json({
      success: false,
      error: 'Usuario/código y PIN son requeridos',
    });
    return;
  }

  const metadata = {
    ip: req.ip || 'unknown',
    userAgent: req.get('user-agent') || 'unknown',
  };

  log.info('Intento de login vendedor', { usuario });

  const resultado = await authService.autenticarComercial(usuario, password, metadata);

  if (!resultado.success) {
    log.warn('Login fallido', { usuario, error: resultado.error });
    res.status(401).json({
      success: false,
      error: resultado.error,
      bloqueado: resultado.bloqueado || false,
      requires_reauth: true,
    });
    return;
  }

  // Generar tokens con datos del vendedor
  const tokens = authService.generarTokens(resultado.vendedor!);

  log.info('Login exitoso', { 
    codigoVendedor: resultado.vendedor!.codigoVendedor,
    nombreVendedor: resultado.vendedor!.nombreVendedor 
  });

  res.json({
    success: true,
    mensaje: 'Login exitoso',
    vendedor: resultado.vendedor,
    // También enviar como "usuario" y "cliente" para compatibilidad con el frontend
    usuario: {
      codigoUsuario: resultado.vendedor!.codigoVendedor,
      nombreUsuario: resultado.vendedor!.nombreVendedor,
      subempresa: 'GMP',
    },
    cliente: {
      codigo: resultado.vendedor!.codigoVendedor,
      nombre: resultado.vendedor!.nombreVendedor,
      nombreAlternativo: 'Vendedor',
      nif: resultado.vendedor!.nif,
      direccion: resultado.vendedor!.direccion,
      poblacion: resultado.vendedor!.poblacion,
      provincia: resultado.vendedor!.provincia,
      codigoPostal: '',
      telefono1: resultado.vendedor!.telefono,
      telefono2: '',
      recargo: false,
      exentoIva: false,
      codigoRuta: '',
      activo: true,
    },
    ...tokens,
  });
});

/**
 * POST /api/auth/refresh
 * Refrescar tokens
 */
export const refreshToken = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { refreshToken } = req.body;

  const nuevosPares = await authService.refrescarTokens(refreshToken);

  if (!nuevosPares) {
    res.status(401).json({
      success: false,
      error: 'Refresh token inválido o expirado',
      code: 'INVALID_REFRESH_TOKEN',
    });
    return;
  }

  res.json({
    success: true,
    mensaje: 'Tokens refrescados',
    ...nuevosPares,
  });
});

/**
 * POST /api/auth/logout
 * Cerrar sesión
 */
export const logout = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const codigoUsuario = (req as any).user?.codigoUsuario;

  logger.info(`Logout exitoso: ${codigoUsuario || 'unknown'}`);

  res.json({
    success: true,
    mensaje: 'Logout exitoso',
  });
});

/**
 * GET /api/auth/perfil
 * Obtener perfil del usuario autenticado
 */
export const obtenerPerfil = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user;

  if (!user) {
    res.status(401).json({
      success: false,
      error: 'No autenticado',
    });
    return;
  }

  res.json({
    success: true,
    perfil: {
      codigoUsuario: user.codigoUsuario,
      nombreUsuario: user.nombreUsuario,
      subempresa: user.subempresa,
    },
  });
});

/**
 * GET /api/auth/facturas/:codigoCliente
 * Obtener facturas del cliente (placeholder)
 */
export const obtenerFacturas = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  res.json({
    success: true,
    facturas: [],
    total: 0,
  });
});

/**
 * GET /api/auth/estadisticas/:codigoCliente
 * Obtener estadísticas (placeholder)
 */
export const obtenerEstadisticas = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  res.json({
    success: true,
    estadisticas: {},
  });
});

/**
 * GET /api/auth/top-productos/:codigoCliente
 * Obtener top productos (placeholder)
 */
export const obtenerTopProductos = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  res.json({
    success: true,
    productos: [],
  });
});

/**
 * GET /api/auth/health
 * Health check del servicio de autenticación
 */
export const healthCheck = async (_req: Request, res: Response): Promise<void> => {
  res.json({
    status: 'healthy',
    service: 'auth',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
};

export default {
  login,
  refreshToken,
  logout,
  obtenerPerfil,
  obtenerFacturas,
  obtenerEstadisticas,
  obtenerTopProductos,
  healthCheck,
};
