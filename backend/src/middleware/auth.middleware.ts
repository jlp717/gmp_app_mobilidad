/**
 * MIDDLEWARE DE AUTENTICACIÓN
 * Verifica tokens JWT y autorización por roles para vendedores/comerciales
 */

import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { logger } from '../utils/logger';

// Extender Request para incluir usuario autenticado (vendedor)
declare global {
  namespace Express {
    interface Request {
      user?: {
        codigoVendedor: string;
        nombreVendedor: string;
        jti: string;
      };
      requestId?: string;
    }
  }
}

/**
 * Middleware que requiere autenticación JWT
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'Token de autenticación requerido',
        code: 'MISSING_TOKEN',
      });
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = authService.verificarAccessToken(token);

    if (!decoded) {
      res.status(401).json({
        success: false,
        error: 'Token inválido o expirado',
        code: 'INVALID_TOKEN',
      });
      return;
    }

    // Agregar vendedor al request
    req.user = {
      codigoVendedor: decoded.codigoVendedor,
      nombreVendedor: decoded.nombreVendedor,
      jti: decoded.jti,
    };

    next();
  } catch (error) {
    logger.error('Error en autenticación:', error);
    res.status(401).json({
      success: false,
      error: 'Error de autenticación',
      code: 'AUTH_ERROR',
    });
  }
}

/**
 * Middleware que verifica ownership del recurso
 * El vendedor solo puede acceder a sus propios datos
 */
export function requireOwnership(req: Request, res: Response, next: NextFunction): void {
  try {
    const { codigoVendedor } = req.params;
    const vendedorAutenticado = req.user?.codigoVendedor;

    if (!vendedorAutenticado) {
      res.status(401).json({
        success: false,
        error: 'No autenticado',
        code: 'NOT_AUTHENTICATED',
      });
      return;
    }

    // Comparar códigos normalizados
    const codigoNormalizado = String(codigoVendedor).trim().toUpperCase();
    const usuarioNormalizado = String(vendedorAutenticado).trim().toUpperCase();

    if (codigoNormalizado !== usuarioNormalizado) {
      logger.warn(`Intento de acceso no autorizado: ${vendedorAutenticado} -> ${codigoVendedor}`);
      res.status(403).json({
        success: false,
        error: 'No tienes permiso para acceder a este recurso',
        code: 'FORBIDDEN',
      });
      return;
    }

    next();
  } catch (error) {
    logger.error('Error verificando ownership:', error);
    res.status(500).json({
      success: false,
      error: 'Error verificando permisos',
    });
  }
}

/**
 * Middleware opcional de autenticación
 * No falla si no hay token, pero lo verifica si existe
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = authService.verificarAccessToken(token);

    if (decoded) {
      req.user = {
        codigoVendedor: decoded.codigoVendedor,
        nombreVendedor: decoded.nombreVendedor,
        jti: decoded.jti,
      };
    }

    next();
  } catch {
    // Token inválido, continuar sin usuario
    next();
  }
}

/**
 * Middleware de autorización por roles
 * @param _rolesPermitidos - Array de roles que pueden acceder
 */
export function requireRole(..._rolesPermitidos: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Por ahora, todos los vendedores autenticados tienen el mismo rol
    // En el futuro se puede expandir para roles: comercial, administrador, supervisor
    
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'No autenticado',
        code: 'NOT_AUTHENTICATED',
      });
      return;
    }

    // TODO: Implementar verificación de roles cuando se agregue la tabla de roles
    // Por ahora, permitir acceso si está autenticado
    next();
  };
}

export default {
  requireAuth,
  requireOwnership,
  optionalAuth,
  requireRole,
};
