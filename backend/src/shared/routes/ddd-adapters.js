/**
 * DDD Route Adapters
 * Bridges DDD modules to Express routes with feature toggle support
 * 
 * Usage: Set USE_DDD_ROUTES=true to enable these routes instead of legacy routes
 * 
 * Caching Strategy:
 * - Product catalog: 5 min (prices/stock change)
 * - Product detail: 2 min (stock changes frequently)
 * - Promotions: 30 min (rarely change)
 * - Order history: 1 min (user-specific)
 * - Albaranes: 2 min (delivery status changes)
 * - Ruta config: 15 min (rarely changes during day)
 * - Commissions: 30 min (calculated data)
 */

const express = require('express');
const logger = require('../../../middleware/logger');
const { Db2PedidosRepository } = require('../../modules/pedidos');
const { Db2CobrosRepository } = require('../../modules/cobros');
const { Db2EntregasRepository } = require('../../modules/entregas');
const { Db2RuteroRepository } = require('../../modules/rutero');
const { Db2AuthRepository } = require('../../modules/auth');
const { Db2ClientRepository } = require('../../modules/clients/infrastructure/db2-client-repository');
const { Db2ConnectionPool } = require('../../core/infrastructure/database/db2-connection-pool');
const { ResponseCache } = require('../../core/infrastructure/cache/response-cache');
const { performanceCache } = require('../../core/infrastructure/cache/performance-cache');
const { cachedQuery } = require('../../../services/query-optimizer');
const { query } = require('../../../config/db');
const { TTL: RedisTTL } = require('../../../services/redis-cache');
const { buildVendedorFilterLACLAE, sanitizeForSQL, MIN_YEAR } = require('../../../utils/common');
const { getClientCodesFromCache } = require('../../../services/laclae');

// TTL constants (milliseconds)
const TTL_MS = {
  PRODUCT_CATALOG: 5 * 60 * 1000,
  PRODUCT_DETAIL: 2 * 60 * 1000,
  PROMOTIONS: 30 * 60 * 1000,
  ORDER_HISTORY: 1 * 60 * 1000,
  ORDER_STATS: 5 * 60 * 1000,
  ALBARANES: 2 * 60 * 1000,
  ALBARAN_DETAIL: 5 * 60 * 1000,
  GAMIFICATION: 5 * 60 * 1000,
  ROUTE_SUMMARY: 2 * 60 * 1000,
  RUTA_CONFIG: 15 * 60 * 1000,
  COMMISSIONS: 30 * 60 * 1000,
  PENDIENTES: 2 * 60 * 1000,
  COBROS_HISTORICO: 5 * 60 * 1000
};

// Shared instances
let dbPool = null;
let responseCache = null;

function getDbPool() {
  if (!dbPool) {
    dbPool = new Db2ConnectionPool();
  }
  return dbPool;
}

function getCache() {
  if (!responseCache) {
    responseCache = new ResponseCache();
  }
  return responseCache;
}

// Cache helper with performance optimization for ALL queries
async function withCache(cache, key, ttlMs, fetchFn, res, req) {
  const isAllQuery = req?.query?.vendedorCodes === 'ALL';

  if (isAllQuery) {
    const perfCacheKey = `ALL:${key}`;
    const role = req?.user?.role || 'COMERCIAL';
    const ttlSec = performanceCache.getTTL(role, true);
    const result = await performanceCache.getOrFetch(perfCacheKey, fetchFn, ttlSec);
    res.set('X-Cache-Source', result.source);
    res.set('X-Cache-Hit', result.cached ? 'true' : 'false');
    res.set('X-Query-Type', 'ALL-OPTIMIZED');
    return res.json(result.data);
  }

  const cached = await cache.get(key);
  if (cached) return res.json(cached);
  const result = await fetchFn();
  await cache.set(key, result, ttlMs);
  return res.json(result);
}

// =============================================================================
// AUTH ROUTES (DDD)
// =============================================================================
function createAuthRoutes() {
  const router = express.Router();
  const repo = new Db2AuthRepository(getDbPool());

  router.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
      }

      const user = await repo.findByCode(username);
      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Credenciales inválidas', code: 'INVALID_CREDENTIALS' });
      }

      const { verifyPassword } = require('../../../middleware/auth');
      if (!user._passwordHash) {
        logger.warn(`[DDD-AUTH] User ${username} has no password hash - login denied`);
        return res.status(401).json({ error: 'Credenciales inválidas', code: 'INVALID_CREDENTIALS' });
      }
      const passwordValid = await verifyPassword(password, user._passwordHash);

      if (!passwordValid) {
        return res.status(401).json({ error: 'Credenciales inválidas', code: 'INVALID_CREDENTIALS' });
      }

      const { signAccessToken, signRefreshToken } = require('../../../middleware/auth');
      const accessToken = signAccessToken({
        id: user.id, user: user.code, role: user.role, isJefeVentas: user.isJefeVentas
      });
      const refreshToken = signRefreshToken({
        id: user.id, user: user.code, role: user.role, isJefeVentas: user.isJefeVentas
      });

      await repo.logLoginAttempt(user.id, true, req.ip);

      // Response format must match legacy auth routes (Flutter expects 'token', not 'accessToken')
      res.json({
        success: true,
        user: {
          id: user.id,
          code: user.code,
          name: user.name,
          role: user.role,
          isJefeVentas: user.isJefeVentas,
          vendedorCode: user.code,
          isRepartidor: user.role === 'REPARTIDOR',
          showCommissions: true
        },
        role: user.role,
        vendedorCodes: user.vendedorCodes || [user.code],
        token: accessToken,
        refreshToken,
        tokenExpiresIn: 3600,
        refreshExpiresIn: 604800
      });
    } catch (error) {
      logger.error(`[DDD-AUTH] Login error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

// =============================================================================
// PEDIDOS ROUTES (DDD) — with caching
// =============================================================================
function createPedidosRoutes() {
  const router = express.Router();
  const repo = new Db2PedidosRepository(getDbPool());
  const cache = getCache();

  router.get('/products', async (req, res) => {
    try {
      const { vendedorCodes, clientCode, family, marca, search, limit, offset } = req.query;
      if (!vendedorCodes) return res.status(400).json({ success: false, error: 'vendedorCodes is required' });
      if (!clientCode) return res.status(400).json({ success: false, error: 'clientCode is required' });

      const cacheKey = `ddd:products:${vendedorCodes}:${clientCode}:${family || ''}:${marca || ''}:${search || ''}:${limit || 50}:${offset || 0}`;
      await withCache(cache, cacheKey, TTL_MS.PRODUCT_CATALOG, async () => {
        const result = await repo.searchProducts({
          vendedorCodes,
          clientCode: String(clientCode).trim(),
          family: family ? String(family).trim() : undefined,
          marca: marca ? String(marca).trim() : undefined,
          search: search ? String(search).trim() : undefined,
          limit: parseInt(limit) || 50,
          offset: parseInt(offset) || 0
        });
        return { success: true, products: result.products, count: result.count };
      }, res, req);
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /products: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/products/:code', async (req, res) => {
    try {
      const { code } = req.params;
      const { clientCode, vendedorCodes } = req.query;
      if (!code) return res.status(400).json({ success: false, error: 'Product code required' });

      const cacheKey = `ddd:product:${code}:${clientCode || ''}:${vendedorCodes || 'ALL'}`;
      await withCache(cache, cacheKey, TTL_MS.PRODUCT_DETAIL, async () => {
        const product = await repo.getProductDetail({
          code: String(code).trim(),
          clientCode: clientCode ? String(clientCode).trim() : undefined,
          vendedorCodes: vendedorCodes || 'ALL'
        });
        if (!product) return { success: false, error: 'Product not found' };
        return { success: true, product };
      }, res);
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /products/:code: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/promotions', async (req, res) => {
    try {
      const { clientCode, vendedorCodes } = req.query;
      if (!clientCode) return res.status(400).json({ success: false, error: 'clientCode is required' });

      const trimmedClient = String(clientCode).trim();
      if (!trimmedClient) return res.status(400).json({ success: false, error: 'clientCode cannot be empty' });

      const cacheKey = `ddd:promotions:${trimmedClient}:${vendedorCodes || 'ALL'}`;
      await withCache(cache, cacheKey, TTL_MS.PROMOTIONS, async () => {
        const result = await repo.getPromotions({
          clientCode: trimmedClient,
          vendedorCodes: vendedorCodes || 'ALL'
        });
        // result is an array of promotion objects from legacy service
        const promotions = Array.isArray(result) ? result : [];
        logger.info(`[DDD-PEDIDOS] Promotions for ${trimmedClient}: ${promotions.length} found`);
        return { success: true, promotions };
      }, res, req);
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /promotions: ${error.message}`);
      res.status(500).json({ success: false, error: 'Error cargando promociones' });
    }
  });

  router.get('/history', async (req, res) => {
    try {
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const { limit, offset } = req.query;
      const cacheKey = `ddd:history:${userId}:${limit || 20}:${offset || 0}`;
      await withCache(cache, cacheKey, TTL_MS.ORDER_HISTORY, async () => {
        const orders = await repo.getOrderHistory({ userId, limit: parseInt(limit) || 20, offset: parseInt(offset) || 0 });
        return { success: true, orders };
      }, res);
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /history: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/stats', async (req, res) => {
    try {
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const cacheKey = `ddd:stats:${userId}`;
      await withCache(cache, cacheKey, TTL_MS.ORDER_STATS, async () => {
        const stats = await repo.getOrderStats({ userId });
        return { success: true, stats };
      }, res);
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /stats: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/cart/add', async (req, res) => {
    try {
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const { clientCode, productCode, quantity, unit } = req.body;
      if (!clientCode || !productCode || !quantity) {
        return res.status(400).json({ success: false, error: 'clientCode, productCode, and quantity required' });
      }

      const result = await repo.addToCart({ userId, clientCode, productCode, quantity, unit });
      cache.invalidatePattern(`ddd:cart:${userId}`);
      res.json({ success: true, cartItem: result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in POST /cart/add: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/confirm', async (req, res) => {
    try {
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const { clientCode, lines, observations } = req.body;
      if (!clientCode || !lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ success: false, error: 'clientCode and lines required' });
      }

      const result = await repo.confirmOrder({ userId, clientCode, lines, observations });

      // Invalidate related caches
      cache.invalidatePattern(`ddd:products:`);
      cache.invalidatePattern(`ddd:history:${userId}`);
      cache.invalidatePattern(`ddd:stats:${userId}`);

      res.json({ success: true, order: result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in POST /confirm: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // =============================================================================
  // MISSING ENDPOINTS (ported from legacy pedidos.js)
  // =============================================================================

  // GET /api/pedidos/client-balance/:clientCode
  router.get('/client-balance/:clientCode', async (req, res) => {
    try {
      const clientCode = String(req.params.clientCode).trim();
      const pedidosService = require('../../../services/pedidos.service');
      const balance = await pedidosService.getClientBalance(clientCode);
      res.json({ success: true, balance });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /client-balance: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/recommendations/:clientCode
  router.get('/recommendations/:clientCode', async (req, res) => {
    try {
      const clientCode = String(req.params.clientCode).trim();
      const vendedorCode = req.query.vendedorCode ? String(req.query.vendedorCode).trim() : undefined;
      if (!vendedorCode) {
        return res.status(400).json({ success: false, error: 'vendedorCode is required' });
      }
      const pedidosService = require('../../../services/pedidos.service');
      const recommendations = await pedidosService.getRecommendations(clientCode, vendedorCode);
      res.json({ success: true, clientHistory: recommendations.clientHistory, similarClients: recommendations.similarClients });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /recommendations: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/orders/stats (alias to /stats for Flutter app compatibility)
  router.get('/orders/stats', async (req, res) => {
    try {
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });
      
      const cacheKey = `ddd:orders-stats:${userId}`;
      await withCache(cache, cacheKey, TTL_MS.ORDER_STATS, async () => {
        const stats = await repo.getOrderStats({ userId });
        return { success: true, stats };
      }, res);
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /orders/stats: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/products/:code/stock
  router.get('/products/:code/stock', async (req, res) => {
    try {
      const { code } = req.params;
      const pedidosService = require('../../../services/pedidos.service');
      const stock = await pedidosService.getProductStock(String(code).trim());
      res.json({ success: true, stock });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /products/:code/stock: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/families
  router.get('/families', async (req, res) => {
    try {
      const pedidosService = require('../../../services/pedidos.service');
      const families = await pedidosService.getProductFamilies();
      res.json({ success: true, families });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /families: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/brands
  router.get('/brands', async (req, res) => {
    try {
      const pedidosService = require('../../../services/pedidos.service');
      const brands = await pedidosService.getProductBrands();
      res.json({ success: true, brands });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /brands: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/client-prices/:clientCode
  router.get('/client-prices/:clientCode', async (req, res) => {
    try {
      const { clientCode } = req.params;
      const pedidosService = require('../../../services/pedidos.service');
      const prices = await pedidosService.getClientPricing(String(clientCode).trim());
      res.json({ success: true, prices });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /client-prices: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/similar-products/:code
  router.get('/similar-products/:code', async (req, res) => {
    try {
      const { code } = req.params;
      const pedidosService = require('../../../services/pedidos.service');
      const similar = await pedidosService.getSimilarProducts(String(code).trim());
      res.json({ success: true, similar });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /similar-products: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/search-products
  router.get('/search-products', async (req, res) => {
    try {
      const { q, limit = 20, vendedorCodes, clientCode } = req.query;
      const pedidosService = require('../../../services/pedidos.service');
      const results = await pedidosService.searchProductsWithStock({
        query: q,
        limit: parseInt(limit) || 20,
        vendedorCodes,
        clientCode
      });
      res.json({ success: true, results });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /search-products: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/product-history/:productCode/:clientCode
  router.get('/product-history/:productCode/:clientCode', async (req, res) => {
    try {
      const { productCode, clientCode } = req.params;
      const pedidosService = require('../../../services/pedidos.service');
      const history = await pedidosService.getProductHistory(String(productCode).trim(), String(clientCode).trim());
      res.json({ success: true, history });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /product-history: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/analytics
  router.get('/analytics', async (req, res) => {
    try {
      const { vendedorCodes } = req.query;
      const pedidosService = require('../../../services/pedidos.service');
      const analytics = await pedidosService.getOrderAnalytics(vendedorCodes || 'ALL');
      res.json({ success: true, analytics });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /analytics: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/pedidos/complementary
  router.post('/complementary', async (req, res) => {
    try {
      const { productCodes, clientCode } = req.body;
      if (!productCodes || !Array.isArray(productCodes) || productCodes.length === 0) {
        return res.status(400).json({ success: false, error: 'productCodes array is required' });
      }
      const pedidosService = require('../../../services/pedidos.service');
      const products = await pedidosService.getComplementaryProducts(productCodes, clientCode);
      res.json({ success: true, products });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in POST /complementary: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/ (order list)
  router.get('/', async (req, res) => {
    try {
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const { limit, offset, estado, vendedorCodes } = req.query;
      const cacheKey = `ddd:orders-list:${userId}:${limit || 20}:${offset || 0}:${estado || 'all'}`;
      await withCache(cache, cacheKey, TTL_MS.ORDER_HISTORY, async () => {
        const pedidosService = require('../../../services/pedidos.service');
        const orders = await pedidosService.getOrders({
          vendedorCodes: vendedorCodes || userId,
          limit: parseInt(limit) || 50,
          offset: parseInt(offset) || 0,
          status: estado ? String(estado).trim() : undefined
        });
        return { success: true, orders };
      }, res, req);
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/:id
  router.get('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const order = await repo.getOrderById(id);
      if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
      res.json({ success: true, order });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /:id: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/pedidos/create
  router.post('/create', async (req, res) => {
    try {
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const { clientCode, lines, observations } = req.body;
      if (!clientCode || !lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ success: false, error: 'clientCode and lines required' });
      }

      const result = await repo.createOrder({ userId, clientCode, lines, observations });
      
      // Invalidate related caches
      cache.invalidatePattern(`ddd:products:`);
      cache.invalidatePattern(`ddd:orders-list:${userId}`);
      cache.invalidatePattern(`ddd:history:${userId}`);
      cache.invalidatePattern(`ddd:stats:${userId}`);

      res.json({ success: true, order: result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in POST /create: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // PUT /api/pedidos/:id/confirm
  router.put('/:id/confirm', async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const result = await repo.confirmOrderById({ orderId: id, userId });

      // Invalidate related caches
      cache.invalidatePattern(`ddd:orders-list:${userId}`);
      cache.invalidatePattern(`ddd:history:${userId}`);
      cache.invalidatePattern(`ddd:stats:${userId}`);

      res.json({ success: true, order: result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in PUT /:id/confirm: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // PUT /api/pedidos/:id/lines
  router.put('/:id/lines', async (req, res) => {
    try {
      const { id } = req.params;
      const pedidosService = require('../../../services/pedidos.service');
      const result = await pedidosService.addOrderLine(parseInt(id), req.body);
      res.json({ success: true, line: result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in PUT /:id/lines: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // PUT /api/pedidos/:id/lines/:lineId
  router.put('/:id/lines/:lineId', async (req, res) => {
    try {
      const { id, lineId } = req.params;
      const pedidosService = require('../../../services/pedidos.service');
      const result = await pedidosService.updateOrderLine(parseInt(id), parseInt(lineId), req.body);
      res.json({ success: true, line: result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in PUT /:id/lines/:lineId: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // PUT /api/pedidos/:id/lines/:lineId/delete
  router.put('/:id/lines/:lineId/delete', async (req, res) => {
    try {
      const { id, lineId } = req.params;
      const pedidosService = require('../../../services/pedidos.service');
      const result = await pedidosService.deleteOrderLine(parseInt(id), parseInt(lineId));
      res.json({ success: true, line: result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in PUT /:id/lines/:lineId/delete: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // PUT /api/pedidos/:id/status
  router.put('/:id/status', async (req, res) => {
    try {
      const { id } = req.params;
      const { estado, userId } = req.body;
      if (!estado) return res.status(400).json({ success: false, error: 'estado required' });

      const result = await repo.updateOrderStatus({ orderId: id, estado, userId: userId || req.user?.code });
      res.json({ success: true, order: result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in PUT /:id/status: ${error.message}`);
      res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, error: error.message });
    }
  });

  // PUT /api/pedidos/:id/cancel
  router.put('/:id/cancel', async (req, res) => {
    try {
      const { id } = req.params;
      const pedidosService = require('../../../services/pedidos.service');
      const result = await pedidosService.cancelOrder(parseInt(id), { userId: req.user?.code });
      res.json({ success: true, order: result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in PUT /:id/cancel: ${error.message}`);
      res.status(error.message.includes('no se puede') ? 409 : 500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/:id/clone
  router.get('/:id/clone', async (req, res) => {
    try {
      const { id } = req.params;
      const pedidosService = require('../../../services/pedidos.service');
      const order = await pedidosService.cloneOrder(parseInt(id));
      res.json({ success: true, order });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /:id/clone: ${error.message}`);
      res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/:id/albaran
  router.get('/:id/albaran', async (req, res) => {
    try {
      const { id } = req.params;
      const pedidosService = require('../../../services/pedidos.service');
      const albaranes = await pedidosService.getOrderAlbaran(parseInt(id));
      res.json({ success: true, albaranes });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /:id/albaran: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/:id/pdf
  router.get('/:id/pdf', async (req, res) => {
    try {
      const { id } = req.params;
      const pedidosService = require('../../../services/pedidos.service');
      const pdf = await pedidosService.generateOrderPdf(parseInt(id));
      res.json({ success: true, pdf });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /:id/pdf: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // DELETE /api/pedidos/:id
  router.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const result = await repo.deleteOrder({ orderId: id, userId });
      res.json({ success: true, order: result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in DELETE /:id: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

// =============================================================================
// COBROS ROUTES (DDD) — with caching
// =============================================================================
function createCobrosRoutes() {
  const router = express.Router();
  const repo = new Db2CobrosRepository(getDbPool());
  const cache = getCache();

  router.get('/:codigoCliente/pendientes', async (req, res) => {
    try {
      const { codigoCliente } = req.params;
      if (!codigoCliente) return res.status(400).json({ success: false, error: 'codigoCliente required' });

      const cacheKey = `ddd:cobros:pendientes:${codigoCliente}`;
      await withCache(cache, cacheKey, TTL_MS.PENDIENTES, async () => {
        const pendientes = await repo.getPendientes(String(codigoCliente).trim());
        return { success: true, pendientes };
      }, res);
    } catch (error) {
      logger.error(`[DDD-COBROS] Error in GET /pendientes: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/register', async (req, res) => {
    try {
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const { clientCode, amount, paymentMethod, reference, observations } = req.body;
      if (!clientCode || !amount || !paymentMethod) {
        return res.status(400).json({ success: false, error: 'clientCode, amount, and paymentMethod required' });
      }

      const result = await repo.registerPayment({ clientCode, amount, paymentMethod, reference, observations, userId });

      // Invalidate cobros caches
      cache.invalidatePattern(`ddd:cobros:pendientes:${clientCode}`);
      cache.invalidatePattern(`ddd:cobros:historico:${clientCode}`);

      res.json({ success: true, payment: result });
    } catch (error) {
      logger.error(`[DDD-COBROS] Error in POST /register: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/:codigoCliente/historico', async (req, res) => {
    try {
      const { codigoCliente } = req.params;
      const { limit, offset } = req.query;

      const cacheKey = `ddd:cobros:historico:${codigoCliente}:${limit || 20}:${offset || 0}`;
      await withCache(cache, cacheKey, TTL_MS.COBROS_HISTORICO, async () => {
        const historico = await repo.getHistorico({
          clientCode: String(codigoCliente).trim(),
          limit: parseInt(limit) || 20,
          offset: parseInt(offset) || 0
        });
        return { success: true, historico };
      }, res);
    } catch (error) {
      logger.error(`[DDD-COBROS] Error in GET /historico: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

// =============================================================================
// ENTREGAS ROUTES (DDD) — with caching
// =============================================================================
function createEntregasRoutes() {
  const router = express.Router();
  const repo = new Db2EntregasRepository(getDbPool());
  const cache = getCache();

  router.get('/albaranes', async (req, res) => {
    try {
      const repartidorId = req.user?.code || req.query.repartidorId;
      if (!repartidorId) return res.status(400).json({ success: false, error: 'repartidorId required' });

      const { date, status } = req.query;
      const cacheKey = `ddd:albaranes:${repartidorId}:${date || ''}:${status || ''}`;
      await withCache(cache, cacheKey, TTL_MS.ALBARANES, async () => {
        const albaranes = await repo.getAlbaranes({ repartidorId, date, status });
        return { success: true, albaranes };
      }, res);
    } catch (error) {
      logger.error(`[DDD-ENTREGAS] Error in GET /albaranes: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/albaranes/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const cacheKey = `ddd:albaran:${id}`;
      await withCache(cache, cacheKey, TTL_MS.ALBARAN_DETAIL, async () => {
        const albaran = await repo.getAlbaranDetail(id);
        if (!albaran) return { success: false, error: 'Albaran not found' };
        return { success: true, albaran };
      }, res);
    } catch (error) {
      logger.error(`[DDD-ENTREGAS] Error in GET /albaranes/:id: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/albaranes/:id/deliver', async (req, res) => {
    try {
      const { id } = req.params;
      const repartidorId = req.user?.code || req.user?.id;
      if (!repartidorId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const { observations, signaturePath, latitude, longitude } = req.body;
      const result = await repo.markDelivered({ albaranId: id, observations, signaturePath, latitude, longitude, repartidorId });

      // Invalidate entregas caches
      cache.invalidatePattern(`ddd:albaranes:${repartidorId}`);
      cache.invalidatePattern(`ddd:albaran:${id}`);
      cache.invalidatePattern(`ddd:summary:${repartidorId}`);

      res.json({ success: true, delivery: result });
    } catch (error) {
      logger.error(`[DDD-ENTREGAS] Error in POST /deliver: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/gamification', async (req, res) => {
    try {
      const repartidorId = req.user?.code || req.query.repartidorId;
      if (!repartidorId) return res.status(400).json({ success: false, error: 'repartidorId required' });

      const cacheKey = `ddd:gamification:${repartidorId}`;
      await withCache(cache, cacheKey, TTL_MS.GAMIFICATION, async () => {
        const stats = await repo.getGamificationStats(repartidorId);
        return { success: true, stats };
      }, res);
    } catch (error) {
      logger.error(`[DDD-ENTREGAS] Error in GET /gamification: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/summary', async (req, res) => {
    try {
      const repartidorId = req.user?.code || req.query.repartidorId;
      if (!repartidorId) return res.status(400).json({ success: false, error: 'repartidorId required' });

      const { date } = req.query;
      const cacheKey = `ddd:summary:${repartidorId}:${date || ''}`;
      await withCache(cache, cacheKey, TTL_MS.ROUTE_SUMMARY, async () => {
        const summary = await repo.getRouteSummary({ repartidorId, date });
        return { success: true, summary };
      }, res);
    } catch (error) {
      logger.error(`[DDD-ENTREGAS] Error in GET /summary: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

// =============================================================================
// RUTERO ROUTES (DDD) — with caching
// =============================================================================
function createRuteroRoutes() {
  const router = express.Router();
  const repo = new Db2RuteroRepository(getDbPool());
  const cache = getCache();

  router.get('/config', async (req, res) => {
    try {
      const { vendorCode, date } = req.query;
      if (!vendorCode) return res.status(400).json({ success: false, error: 'vendorCode required' });

      const cacheKey = `ddd:ruta-config:${vendorCode}:${date || ''}`;
      await withCache(cache, cacheKey, TTL_MS.RUTA_CONFIG, async () => {
        const config = await repo.getRutaConfig({ vendorCode, date });
        return { success: true, config };
      }, res);
    } catch (error) {
      logger.error(`[DDD-RUTERO] Error in GET /config: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.put('/config/:id/order', async (req, res) => {
    try {
      const { id } = req.params;
      const { newOrder } = req.body;
      if (newOrder === undefined || newOrder < 0) {
        return res.status(400).json({ success: false, error: 'newOrder required (>= 0)' });
      }

      const result = await repo.updateOrder({ configId: id, newOrder });

      // Invalidate ruta config cache
      cache.invalidatePattern('ddd:ruta-config:');

      res.json({ success: true, result });
    } catch (error) {
      logger.error(`[DDD-RUTERO] Error in PUT /config/:id/order: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/commissions', async (req, res) => {
    try {
      const { vendorCode, date, role } = req.query;
      if (!vendorCode) return res.status(400).json({ success: false, error: 'vendorCode required' });

      const cacheKey = `ddd:commissions:${vendorCode}:${date || ''}:${role || ''}`;
      await withCache(cache, cacheKey, TTL_MS.COMMISSIONS, async () => {
        const commissions = await repo.getCommissions({ vendorCode, date, role });
        return { success: true, commissions };
      }, res);
    } catch (error) {
      logger.error(`[DDD-RUTERO] Error in GET /commissions: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/summary', async (req, res) => {
    try {
      const { vendorCode, date } = req.query;
      if (!vendorCode) return res.status(400).json({ success: false, error: 'vendorCode required' });

      const cacheKey = `ddd:rutero-summary:${vendorCode}:${date || ''}`;
      await withCache(cache, cacheKey, TTL_MS.ROUTE_SUMMARY, async () => {
        const summary = await repo.getDaySummary({ vendorCode, date });
        return { success: true, summary };
      }, res);
    } catch (error) {
      logger.error(`[DDD-RUTERO] Error in GET /summary: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

// =============================================================================
// CLIENTS ROUTES (DDD) — with forced Redis ALL cache
// =============================================================================
function createClientsRoutes() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const { vendedorCodes, search, limit = 1000, offset = 0 } = req.query;
      const isAllQuery = vendedorCodes === 'ALL' || !vendedorCodes;
      const cacheKey = `ddd:clients:v1:${vendedorCodes || 'all'}:${search || 'none'}:${limit}:${offset}`;
      const role = req?.user?.role || 'COMERCIAL';
      const ttlSec = performanceCache.getTTL(role, isAllQuery);

      const result = await performanceCache.getOrFetch(cacheKey, async () => {
        const vendorFilter = buildVendedorFilterLACLAE(vendedorCodes);
        let clientCodesFilter = '';
        if (vendedorCodes && !search && vendedorCodes !== 'ALL') {
          const cachedClientCodes = getClientCodesFromCache(vendedorCodes);
          if (cachedClientCodes && cachedClientCodes.length > 0) {
            const CHUNK_SIZE = 1000;
            const chunks = [];
            for (let i = 0; i < cachedClientCodes.length; i += CHUNK_SIZE) {
              const chunk = cachedClientCodes.slice(i, i + CHUNK_SIZE).map(c => `'${c}'`).join(',');
              chunks.push(`C.CODIGOCLIENTE IN (${chunk})`);
            }
            clientCodesFilter = `AND (${chunks.join(' OR ')})`;
          }
        }

        let safeSearch = '';
        let searchFilter = '';
        if (search) {
          safeSearch = sanitizeForSQL(search.trim()).toUpperCase();
          searchFilter = `AND(UPPER(C.NOMBRECLIENTE) LIKE '%${safeSearch}%'
                          OR UPPER(C.NOMBREALTERNATIVO) LIKE '%${safeSearch}%'
                          OR C.CODIGOCLIENTE LIKE '%${safeSearch}%'
                          OR UPPER(C.POBLACION) LIKE '%${safeSearch}%')`;
        }

        const clients = await cachedQuery(query, `
          SELECT
            C.CODIGOCLIENTE as code,
            COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE)) as name,
            C.NIF as nif,
            C.DIRECCION as address, C.POBLACION as city, C.PROVINCIA as province,
            C.CODIGOPOSTAL as postalCode, C.TELEFONO1 as phone, C.TELEFONO2 as phone2,
            C.CODIGORUTA as route, C.PERSONACONTACTO as contactPerson,
            COALESCE(S.TOTAL_PURCHASES, 0) as totalPurchases,
            COALESCE(S.NUM_ORDERS, 0) as numOrders,
            COALESCE(S.LAST_PURCHASE_DATE, 0) as lastDateInt,
            COALESCE(S.TOTAL_MARGIN, 0) as totalMargin,
            C.ANOBAJA as yearInactive,
            TRIM(V.NOMBREVENDEDOR) as vendorName,
            LV.LAST_VENDOR as vendorCode
          FROM DSEDAC.CLI C
          LEFT JOIN (
            SELECT LCCDCL as CLIENT_CODE, SUM(LCIMVT) as TOTAL_PURCHASES,
              SUM(LCIMVT - LCIMCT) as TOTAL_MARGIN,
              COUNT(DISTINCT LCAADC || LCMMDC || LCDDDC) as NUM_ORDERS,
              MAX(LCAADC * 10000 + LCMMDC * 100 + LCDDDC) as LAST_PURCHASE_DATE
            FROM DSED.LACLAE
            WHERE LCAADC >= ${MIN_YEAR} AND TPDC = 'LAC'
              AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT')
              AND LCSRAB NOT IN ('N', 'Z')
              ${clientCodesFilter ? clientCodesFilter.replace(/C\.CODIGOCLIENTE/g, 'LCCDCL') : vendorFilter.replace(/L\./g, '')}
            GROUP BY LCCDCL
          ) S ON C.CODIGOCLIENTE = S.CLIENT_CODE
          LEFT JOIN LATERAL (
            SELECT LCCDVD as LAST_VENDOR FROM DSED.LACLAE
            WHERE LCCDCL = ${clientCodesFilter ? 'C.CODIGOCLIENTE' : 'S.CLIENT_CODE'}
              AND LCAADC >= ${MIN_YEAR} AND TPDC = 'LAC'
              AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT')
              AND LCSRAB NOT IN ('N', 'Z')
            ORDER BY LCAADC DESC, LCMMDC DESC, LCDDDC DESC
            FETCH FIRST 1 ROWS ONLY
          ) LV ON 1=1
          LEFT JOIN DSEDAC.VDD V ON LV.LAST_VENDOR = V.CODIGOVENDEDOR
          WHERE C.ANOBAJA = 0 ${clientCodesFilter || `AND LV.LAST_VENDOR IS NOT NULL`} ${searchFilter}
          ORDER BY COALESCE(S.TOTAL_PURCHASES, 0) DESC
          OFFSET ${parseInt(offset)} ROWS FETCH FIRST ${parseInt(limit)} ROWS ONLY
        `, cacheKey, RedisTTL.LONG);

        return { success: true, clients, count: clients.length, isAllQuery };
      }, ttlSec);

      res.set('X-Cache-Source', result.source);
      res.set('X-Query-Type', isAllQuery ? 'ALL-OPTIMIZED' : 'standard');
      res.json(result.data);
    } catch (error) {
      logger.error(`[DDD-CLIENTS] Error: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

// =============================================================================
// COMMISSIONS ROUTES (DDD) — with forced Redis ALL cache
// =============================================================================
function createCommissionsRoutes() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const { vendedorCode, year } = req.query;
      if (!vendedorCode) return res.status(400).json({ success: false, error: 'vendedorCode required' });

      const selectedYear = year || new Date().getFullYear().toString();
      const prevYear = (parseInt(selectedYear) - 1).toString();
      const cacheKey = `ddd:commissions:v1:${vendedorCode}:${selectedYear}`;
      const role = req?.user?.role || 'COMERCIAL';
      const ttlSec = performanceCache.getTTL(role, vendedorCode === 'ALL');

      const result = await performanceCache.getOrFetch(cacheKey, async () => {
        const salesQuery = `
          SELECT L.LCAADC as YEAR, LCMMDC as MONTH, SUM(L.LCIMVT) as SALES
          FROM DSED.LACLAE L
          WHERE L.LCAADC IN (${selectedYear}, ${prevYear})
            AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT')
            AND LCSRAB NOT IN ('N', 'Z') AND TPDC = 'LAC'
            AND R1_T8CDVD = '${vendedorCode.replace(/[^a-zA-Z0-9]/g, '')}'
          GROUP BY L.LCAADC, LCMMDC
          ORDER BY YEAR, MONTH
        `;
        const salesRows = await cachedQuery(query, salesQuery, `${cacheKey}:sales`, RedisTTL.SHORT);

        return { success: true, salesRows, year: selectedYear, vendorCode: vendedorCode };
      }, { role: req?.user?.role || 'COMERCIAL', isAllQuery: vendedorCode === 'ALL' });

      res.set('X-Cache-Source', result.source);
      res.json(result.data);
    } catch (error) {
      logger.error(`[DDD-COMMISSIONS] Error: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

module.exports = {
  createAuthRoutes,
  createPedidosRoutes,
  createCobrosRoutes,
  createEntregasRoutes,
  createRuteroRoutes,
  createClientsRoutes,
  createCommissionsRoutes,
  TTL: TTL_MS
};
