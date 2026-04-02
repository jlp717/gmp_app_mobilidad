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
const logger = require('../../middleware/logger');
const { Db2PedidosRepository } = require('../modules/pedidos');
const { Db2CobrosRepository } = require('../modules/cobros');
const { Db2EntregasRepository } = require('../modules/entregas');
const { Db2RuteroRepository } = require('../modules/rutero');
const { Db2AuthRepository } = require('../modules/auth');
const { Db2ConnectionPool } = require('../core/infrastructure/database/db2-connection-pool');
const { ResponseCache } = require('../core/infrastructure/cache/response-cache');

// TTL constants (milliseconds)
const TTL = {
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

// Cache helper
async function withCache(cache, key, ttl, fetchFn, res) {
  const cached = await cache.get(key);
  if (cached) return res.json(cached);
  const result = await fetchFn();
  await cache.set(key, result, ttl);
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

      const { verifyPassword } = require('../../middleware/auth');
      const passwordValid = user._passwordHash
        ? await verifyPassword(password, user._passwordHash)
        : password === user._passwordHash;

      if (!passwordValid) {
        return res.status(401).json({ error: 'Credenciales inválidas', code: 'INVALID_CREDENTIALS' });
      }

      const { signAccessToken, signRefreshToken } = require('../../middleware/auth');
      const accessToken = signAccessToken({
        id: user.id, user: user.code, role: user.role, isJefeVentas: user.isJefeVentas
      });
      const refreshToken = signRefreshToken({
        id: user.id, user: user.code, role: user.role, isJefeVentas: user.isJefeVentas
      });

      await repo.logLoginAttempt(user.id, true, req.ip);

      res.json({
        success: true,
        user: { id: user.id, code: user.code, name: user.name, role: user.role, isJefeVentas: user.isJefeVentas },
        accessToken, refreshToken, expiresIn: 3600
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
      await withCache(cache, cacheKey, TTL.PRODUCT_CATALOG, async () => {
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
      }, res);
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
      await withCache(cache, cacheKey, TTL.PRODUCT_DETAIL, async () => {
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

      const cacheKey = `ddd:promotions:${clientCode}:${vendedorCodes || 'ALL'}`;
      await withCache(cache, cacheKey, TTL.PROMOTIONS, async () => {
        const result = await repo.getPromotions({
          clientCode: String(clientCode).trim(),
          vendedorCodes: vendedorCodes || 'ALL'
        });
        return { success: true, promotions: result };
      }, res);
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /promotions: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/history', async (req, res) => {
    try {
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const { limit, offset } = req.query;
      const cacheKey = `ddd:history:${userId}:${limit || 20}:${offset || 0}`;
      await withCache(cache, cacheKey, TTL.ORDER_HISTORY, async () => {
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
      await withCache(cache, cacheKey, TTL.ORDER_STATS, async () => {
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
      await withCache(cache, cacheKey, TTL.PENDIENTES, async () => {
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
      await withCache(cache, cacheKey, TTL.COBROS_HISTORICO, async () => {
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
      await withCache(cache, cacheKey, TTL.ALBARANES, async () => {
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
      await withCache(cache, cacheKey, TTL.ALBARAN_DETAIL, async () => {
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
      await withCache(cache, cacheKey, TTL.GAMIFICATION, async () => {
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
      await withCache(cache, cacheKey, TTL.ROUTE_SUMMARY, async () => {
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
      await withCache(cache, cacheKey, TTL.RUTA_CONFIG, async () => {
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
      await withCache(cache, cacheKey, TTL.COMMISSIONS, async () => {
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
      await withCache(cache, cacheKey, TTL.ROUTE_SUMMARY, async () => {
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

module.exports = {
  createAuthRoutes,
  createPedidosRoutes,
  createCobrosRoutes,
  createEntregasRoutes,
  createRuteroRoutes,
  TTL
};
