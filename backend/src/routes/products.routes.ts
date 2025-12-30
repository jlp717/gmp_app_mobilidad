/**
 * RUTAS DE PRODUCTOS
 */

import { Router } from 'express';
import * as productsController from '../controllers/products.controller';
import { optionalAuth } from '../middleware/auth.middleware';
import { validateProductos, validateProducto } from '../middleware/validation.middleware';
import { generalLimiter } from '../middleware/security.middleware';

const router = Router();

// Rutas públicas (catálogo general)
router.get('/public/productos', generalLimiter, productsController.obtenerProductosPublicos);
router.get('/public/productos/familias', generalLimiter, productsController.obtenerFamiliasPublicas);
router.get('/public/productos/:codigo', generalLimiter, validateProducto, productsController.obtenerProductoPublico);

// Rutas principales - sin autenticación estricta para sincronización móvil
router.get('/familias', optionalAuth, generalLimiter, productsController.obtenerFamilias);
router.get('/', optionalAuth, generalLimiter, validateProductos, productsController.obtenerProductos);
router.get('/:codigo', optionalAuth, generalLimiter, validateProducto, productsController.obtenerProducto);

export default router;
