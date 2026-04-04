/**
 * Pedidos Routes - Production Grade v4.0.0
 * Placeholder — delegates to existing pedidos.service.js
 * @agent Backend TS - TypeScript wrapper around legacy service
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';

const router = Router();

// Import legacy service (will be fully migrated in next phase)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pedidosService = require('../../../services/pedidos.service');

router.get('/products', async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientCode } = req.query;
    if (!clientCode) {
      res.status(400).json({ error: 'clientCode query parameter is required' });
      return;
    }
    const products = await pedidosService.getProducts(String(clientCode));
    res.json({ success: true, data: products });
  } catch (error) {
    logger.error('Get products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/products/:code', async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientCode } = req.query;
    if (!clientCode) {
      res.status(400).json({ error: 'clientCode query parameter is required' });
      return;
    }
    const product = await pedidosService.getProductDetail(String(clientCode), req.params.code);
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json({ success: true, data: product });
  } catch (error) {
    logger.error('Get product detail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/promotions', async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientCode } = req.query;
    const promotions = await pedidosService.getActivePromotions(clientCode ? String(clientCode) : undefined);
    res.json({ success: true, data: promotions });
  } catch (error) {
    logger.error('Get promotions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/create', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const order = await pedidosService.createOrder({ ...req.body, userId: user.vendedorCode });
    res.json({ success: true, data: order });
  } catch (error) {
    logger.error('Create order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/orders', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const orders = await pedidosService.getOrders(user.vendedorCode);
    res.json({ success: true, data: orders });
  } catch (error) {
    logger.error('Get orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as pedidosRoutes };
