/**
 * RUTAS DE DASHBOARD
 * 
 * Endpoints para datos del dashboard del vendedor
 */

import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller';

const router = Router();

// GET /api/dashboard - Datos completos del dashboard
router.get('/', dashboardController.getDashboard);

// GET /api/dashboard/ventas-mensuales - Evolución mensual
router.get('/ventas-mensuales', dashboardController.getVentasMensuales);

// GET /api/dashboard/top-clientes - Mejores clientes
router.get('/top-clientes', dashboardController.getTopClientes);

export default router;
