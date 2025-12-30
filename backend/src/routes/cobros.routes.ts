/**
 * RUTAS DE COBROS Y PRESUPUESTOS
 */

import { Router } from 'express';
import * as cobrosController from '../controllers/cobros.controller';
import { requireAuth } from '../middleware/auth.middleware';
import {
  validateRegistrarCobro,
  validateCrearPresupuesto
} from '../middleware/validation.middleware';
import { generalLimiter } from '../middleware/security.middleware';

const router = Router();

// COBROS
router.get('/:codigoCliente/pendientes', requireAuth, generalLimiter, cobrosController.obtenerCobrosPendientes);
router.get('/:codigoCliente/resumen', requireAuth, generalLimiter, cobrosController.obtenerResumenCobros);
router.post('/:codigoCliente/registrar', requireAuth, generalLimiter, validateRegistrarCobro, cobrosController.registrarCobro);

// PRESUPUESTOS
router.get('/presupuestos/:codigoCliente', requireAuth, generalLimiter, cobrosController.obtenerPresupuestos);
router.post('/presupuestos/:codigoCliente', requireAuth, generalLimiter, validateCrearPresupuesto, cobrosController.crearPresupuesto);
router.post('/presupuestos/:id/convertir', requireAuth, generalLimiter, cobrosController.convertirPresupuesto);

export default router;
