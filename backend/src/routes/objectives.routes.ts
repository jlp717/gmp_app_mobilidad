/**
 * OBJECTIVES ROUTES - Refactored from legacy objectives.js (1929 lines → ~120 lines)
 *
 * Endpoints:
 *   GET  /api/objectives              - Summary (quota vs actual)
 *   GET  /api/objectives/evolution     - Monthly evolution across years
 *   GET  /api/objectives/matrix        - Product-level analysis per client
 *   GET  /api/objectives/populations   - Distinct cities for filters
 *   GET  /api/objectives/by-client     - Per-client objective progress
 *
 * SECURITY: Joi validation + parameterized queries via service layer.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { objectivesService } from '../services/objectives.service';
import { validate } from '../middleware/validation.middleware';
import { schemas } from '../utils/validators';
import { requireAuth } from '../middleware/auth.middleware';
import { generalLimiter } from '../middleware/security.middleware';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /api/objectives
 * Summary: quota vs actual for a vendor/month.
 */
router.get('/',
  requireAuth,
  generalLimiter,
  validate(schemas.objectivesSummaryQuery, 'query'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await objectivesService.getSummary({
        vendedorCodes: req.query.vendedorCodes as string,
        year: req.query.year ? parseInt(req.query.year as string, 10) : undefined,
        month: req.query.month ? parseInt(req.query.month as string, 10) : undefined,
      });
      res.json(result);
    } catch (error) {
      logger.error('Error en GET /objectives:', error);
      next(error);
    }
  },
);

/**
 * GET /api/objectives/evolution
 * Monthly evolution with seasonal targets and pacing.
 */
router.get('/evolution',
  requireAuth,
  generalLimiter,
  validate(schemas.objectivesEvolutionQuery, 'query'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await objectivesService.getEvolution({
        vendedorCodes: req.query.vendedorCodes as string,
        years: req.query.years as string,
      });
      res.json(result);
    } catch (error) {
      logger.error('Error en GET /objectives/evolution:', error);
      next(error);
    }
  },
);

/**
 * GET /api/objectives/matrix
 * Product-level analysis for a specific client (5-level FI hierarchy).
 */
router.get('/matrix',
  requireAuth,
  generalLimiter,
  validate(schemas.objectivesMatrixQuery, 'query'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await objectivesService.getMatrix({
        clientCode: req.query.clientCode as string,
        years: req.query.years as string,
        startMonth: req.query.startMonth ? parseInt(req.query.startMonth as string, 10) : undefined,
        endMonth: req.query.endMonth ? parseInt(req.query.endMonth as string, 10) : undefined,
        productCode: req.query.productCode as string,
        productName: req.query.productName as string,
        familyCode: req.query.familyCode as string,
        subfamilyCode: req.query.subfamilyCode as string,
        fi1: req.query.fi1 as string,
        fi2: req.query.fi2 as string,
        fi3: req.query.fi3 as string,
        fi4: req.query.fi4 as string,
        fi5: req.query.fi5 as string,
      });
      res.json(result);
    } catch (error) {
      logger.error('Error en GET /objectives/matrix:', error);
      next(error);
    }
  },
);

/**
 * GET /api/objectives/populations
 * Returns distinct cities for dropdown filters.
 */
router.get('/populations',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const populations = await objectivesService.getPopulations();
      res.json(populations);
    } catch (error) {
      logger.error('Error en GET /objectives/populations:', error);
      res.json([]);
    }
  },
);

/**
 * GET /api/objectives/by-client
 * Per-client objective progress with filters.
 */
router.get('/by-client',
  requireAuth,
  generalLimiter,
  validate(schemas.objectivesByClientQuery, 'query'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await objectivesService.getByClient({
        vendedorCodes: req.query.vendedorCodes as string,
        years: req.query.years as string,
        months: req.query.months as string,
        city: req.query.city as string,
        code: req.query.code as string,
        nif: req.query.nif as string,
        name: req.query.name as string,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      });
      res.json(result);
    } catch (error) {
      logger.error('Error en GET /objectives/by-client:', error);
      next(error);
    }
  },
);

export default router;
