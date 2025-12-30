/**
 * CONTROLADOR DE DASHBOARD
 * 
 * Endpoints para el dashboard del vendedor con datos reales
 */

import { Request, Response, NextFunction } from 'express';
import { dashboardService } from '../services/dashboard.service';
import { logger } from '../utils/logger';

interface VendedorUser {
  codigoVendedor: string;
  nombreVendedor: string;
  [key: string]: unknown;
}

interface AuthenticatedRequest extends Request {
  vendedor?: VendedorUser;
}

export const dashboardController = {
  /**
   * GET /api/dashboard
   * Obtiene todos los datos del dashboard para el vendedor autenticado
   */
  async getDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const codigoVendedor = req.vendedor?.codigoVendedor || req.query.vendedor as string;

      if (!codigoVendedor) {
        res.status(400).json({
          success: false,
          message: 'Código de vendedor requerido',
        });
        return;
      }

      logger.info(`Obteniendo dashboard para vendedor: ${codigoVendedor}`);

      const data = await dashboardService.getDashboardVendedor(codigoVendedor);

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      logger.error('Error en getDashboard:', error);
      next(error);
    }
  },

  /**
   * GET /api/dashboard/ventas-mensuales
   * Obtiene ventas mensuales para gráfico de evolución
   */
  async getVentasMensuales(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const codigoVendedor = req.vendedor?.codigoVendedor || req.query.vendedor as string;
      const anio = req.query.anio ? parseInt(req.query.anio as string) : undefined;

      if (!codigoVendedor) {
        res.status(400).json({
          success: false,
          message: 'Código de vendedor requerido',
        });
        return;
      }

      const data = await dashboardService.getVentasMensuales(codigoVendedor, anio);

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      logger.error('Error en getVentasMensuales:', error);
      next(error);
    }
  },

  /**
   * GET /api/dashboard/top-clientes
   * Obtiene los mejores clientes del vendedor
   */
  async getTopClientes(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const codigoVendedor = req.vendedor?.codigoVendedor || req.query.vendedor as string;
      const limite = req.query.limite ? parseInt(req.query.limite as string) : 10;

      if (!codigoVendedor) {
        res.status(400).json({
          success: false,
          message: 'Código de vendedor requerido',
        });
        return;
      }

      const data = await dashboardService.getTopClientes(codigoVendedor, limite);

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      logger.error('Error en getTopClientes:', error);
      next(error);
    }
  },
};
