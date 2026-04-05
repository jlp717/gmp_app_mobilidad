/**
 * RUTAS DE AUTENTICACIÓN
 */

import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { requireAuth, requireOwnership } from '../middleware/auth.middleware';
import { validateLogin, validateRefreshToken } from '../middleware/validation.middleware';
import { loginRateLimiter, generalLimiter } from '../middleware/security.middleware';

const router = Router();

// Rutas públicas
router.post('/login', loginRateLimiter, validateLogin, authController.login);
router.post('/refresh', generalLimiter, validateRefreshToken, authController.refreshToken);
router.get('/health', authController.healthCheck);

// Rutas protegidas
router.post('/logout', requireAuth, authController.logout);
router.get('/perfil', requireAuth, authController.obtenerPerfil);
router.get('/facturas/:codigoCliente', requireAuth, requireOwnership, authController.obtenerFacturas);
router.get('/estadisticas/:codigoCliente', requireAuth, requireOwnership, authController.obtenerEstadisticas);
router.get('/top-productos/:codigoCliente', requireAuth, requireOwnership, authController.obtenerTopProductos);

export default router;
