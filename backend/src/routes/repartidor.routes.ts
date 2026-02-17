/**
 * REPARTIDOR ROUTES - Refactored from legacy repartidor.js (2200 lines → ~130 lines)
 *
 * Endpoints:
 *   GET  /api/repartidor/collections/summary/:repartidorId  - Collection summary with 30% commission
 *   GET  /api/repartidor/collections/daily/:repartidorId     - Daily collection accumulation
 *   GET  /api/repartidor/history/documents/:clientId         - Client document history
 *   GET  /api/repartidor/history/objectives/:repartidorId    - Historical 30% threshold tracking
 *   GET  /api/repartidor/config                              - Commission tier configuration
 *
 * POST endpoints (entregas, firma, cobros) remain in entregas routes.
 * PDF generation endpoints remain in legacy repartidor.js.
 *
 * SECURITY: Joi validation + parameterized queries via service layer.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { repartidorService } from '../services/repartidor.service';
import { validate } from '../middleware/validation.middleware';
import { schemas } from '../utils/validators';
import { requireAuth } from '../middleware/auth.middleware';
import { generalLimiter } from '../middleware/security.middleware';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /api/repartidor/collections/summary/:repartidorId
 * Collection summary per client with 30% threshold commission.
 */
router.get('/collections/summary/:repartidorId',
  requireAuth,
  generalLimiter,
  validate(schemas.repartidorIdParam, 'params'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await repartidorService.getCollectionsSummary({
        repartidorIds: req.params.repartidorId,
        year: req.query.year ? parseInt(req.query.year as string, 10) : undefined,
        month: req.query.month ? parseInt(req.query.month as string, 10) : undefined,
      });
      res.json(result);
    } catch (error) {
      logger.error('Error en GET /repartidor/collections/summary:', error);
      next(error);
    }
  },
);

/**
 * GET /api/repartidor/collections/daily/:repartidorId
 * Daily collection accumulation for a month.
 */
router.get('/collections/daily/:repartidorId',
  requireAuth,
  generalLimiter,
  validate(schemas.repartidorIdParam, 'params'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await repartidorService.getCollectionsDaily({
        repartidorId: req.params.repartidorId,
        year: req.query.year ? parseInt(req.query.year as string, 10) : undefined,
        month: req.query.month ? parseInt(req.query.month as string, 10) : undefined,
      });
      res.json(result);
    } catch (error) {
      logger.error('Error en GET /repartidor/collections/daily:', error);
      next(error);
    }
  },
);

/**
 * GET /api/repartidor/history/documents/:clientId
 * Client document history with deduplication & status cascade.
 */
router.get('/history/documents/:clientId',
  requireAuth,
  generalLimiter,
  validate(schemas.clientIdParam, 'params'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await repartidorService.getDocumentHistory({
        clientId: req.params.clientId,
        repartidorId: req.query.repartidorId as string,
        year: req.query.year ? parseInt(req.query.year as string, 10) : undefined,
        dateFrom: req.query.dateFrom as string,
        dateTo: req.query.dateTo as string,
      });
      res.json(result);
    } catch (error) {
      logger.error('Error en GET /repartidor/history/documents:', error);
      next(error);
    }
  },
);

/**
 * GET /api/repartidor/history/objectives/:repartidorId
 * Historical monthly 30% threshold tracking.
 */
router.get('/history/objectives/:repartidorId',
  requireAuth,
  generalLimiter,
  validate(schemas.repartidorIdParam, 'params'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await repartidorService.getHistoricalObjectives({
        repartidorIds: req.params.repartidorId,
        clientId: req.query.clientId as string,
      });
      res.json(result);
    } catch (error) {
      logger.error('Error en GET /repartidor/history/objectives:', error);
      next(error);
    }
  },
);

/**
 * GET /api/repartidor/config
 * Returns commission tier configuration.
 */
router.get('/config',
  requireAuth,
  (_req: Request, res: Response): void => {
    res.json(repartidorService.getConfig());
  },
);

export default router;
