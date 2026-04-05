/**
 * COMMISSIONS ROUTES - Refactored from legacy commissions.js (1087 lines → ~90 lines)
 *
 * Endpoints:
 *   GET  /api/commissions/summary         - Commission breakdown by vendor/year
 *   POST /api/commissions/pay             - Record commission payment
 *   GET  /api/commissions/excluded-vendors - List excluded vendor codes
 *
 * SECURITY: Joi validation + parameterized queries via service layer.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { commissionsService } from '../services/commissions.service';
import { validate } from '../middleware/validation.middleware';
import { schemas } from '../utils/validators';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { generalLimiter } from '../middleware/security.middleware';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /api/commissions/summary
 * Full commission breakdown for one or many vendors across one or more years.
 */
router.get('/summary',
  requireAuth,
  generalLimiter,
  validate(schemas.commissionsSummaryQuery, 'query'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorCode = req.query.vendedorCode as string;
      const yearParam = req.query.year as string | undefined;

      // Parse years (supports comma-separated)
      const currentYear = new Date().getFullYear();
      let years: number[];
      if (yearParam) {
        years = yearParam.split(',')
          .map(y => parseInt(y.trim(), 10))
          .filter(n => !isNaN(n) && n >= 2020 && n <= currentYear + 1);
      } else {
        years = [currentYear];
      }
      if (years.length === 0) years = [currentYear];

      const result = await commissionsService.getSummary(vendorCode, years);

      res.json({ success: true, ...result });
    } catch (error) {
      logger.error('Error en GET /commissions/summary:', error);
      next(error);
    }
  },
);

/**
 * POST /api/commissions/pay
 * Register a commission payment (admin only).
 */
router.post('/pay',
  requireAuth,
  generalLimiter,
  validate(schemas.commissionsPayBody, 'body'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { vendedorCode, year, month, amount, generatedAmount, observaciones, adminCode, objetivoMes, ventasSobreObjetivo } = req.body;

      // Verify admin authorization
      const callerCode = adminCode || req.user?.codigoVendedor || '';
      const isAuthorized = await commissionsService.verifyAdminAuth(callerCode);
      if (!isAuthorized) {
        logger.warn(`[COMMISSIONS] Unauthorized payment attempt by: ${callerCode}`);
        res.status(403).json({ success: false, error: 'No tienes permisos para registrar pagos.' });
        return;
      }

      const result = await commissionsService.recordPayment({
        vendedorCode, year, month: month || 0,
        amount: parseFloat(amount), generatedAmount: parseFloat(generatedAmount) || 0,
        observaciones, adminCode: callerCode,
        objetivoMes: parseFloat(objetivoMes) || 0,
        ventasSobreObjetivo: parseFloat(ventasSobreObjetivo) || 0,
      });

      res.json(result);
    } catch (error) {
      logger.error('Error en POST /commissions/pay:', error);
      next(error);
    }
  },
);

/**
 * GET /api/commissions/excluded-vendors
 * Returns list of vendor codes excluded from commissions.
 */
router.get('/excluded-vendors',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const excludedVendors = await commissionsService.getExcludedVendors();
      res.json({ success: true, excludedVendors });
    } catch (error) {
      logger.error('Error en GET /commissions/excluded-vendors:', error);
      res.json({ success: true, excludedVendors: ['3', '13', '93', '80'] });
    }
  },
);

export default router;
