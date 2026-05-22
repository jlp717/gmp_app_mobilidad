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
const { query, queryWithParams } = require('../../../config/db');
const { TTL: RedisTTL } = require('../../../services/redis-cache');
const { buildVendedorFilterLACLAE, sanitizeForSQL, MIN_YEAR, getVendorVisibilityScope } = require('../../../utils/common');
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

function normalizeOrderResponse(result) {
  const order = result || {};
  const header = order.header || order;
  return {
    order,
    header,
    lines: Array.isArray(order.lines) ? order.lines : [],
    id: header && header.id != null ? header.id : order.id,
  };
}

function normalizeNumericCode(value) {
  const raw = String(value || '').trim();
  if (!/^\d+$/.test(raw)) return null;
  return raw.replace(/^0+/, '') || '0';
}

function salesCodesMatch(left, right) {
  const leftCode = String(left || '').trim();
  const rightCode = String(right || '').trim();
  if (leftCode === rightCode) return true;
  const leftNumeric = normalizeNumericCode(leftCode);
  const rightNumeric = normalizeNumericCode(rightCode);
  return leftNumeric !== null && rightNumeric !== null && leftNumeric === rightNumeric;
}

function isPrivilegedSalesUser(req) {
  return req.user?.isJefeVentas === true || req.user?.role === 'JEFE_VENTAS' || req.user?.role === 'ADMIN';
}

function canAccessVendedorCodes(req, vendedorCodes) {
  if (isPrivilegedSalesUser(req)) return true;
  const userCode = req.user?.code || req.user?.id;
  const requested = String(vendedorCodes || userCode || '').trim();
  if (!requested || requested.toUpperCase() === 'ALL') return false;
  return requested.split(',').map((code) => code.trim()).filter(Boolean)
    .every((code) => salesCodesMatch(code, userCode));
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

      // PIN auth: DB2 CODIGOPIN is plaintext (bcrypt migration pending DB schema change)
      // If hash starts with $2b$ it's bcrypt, otherwise compare as plaintext
      const dbPin = user._passwordHash.trim();
      let passwordValid = false;
      if (dbPin.startsWith('$2b$')) {
        passwordValid = await verifyPassword(password, dbPin);
      } else {
        passwordValid = (dbPin === password.trim());
      }

      if (!passwordValid) {
        return res.status(401).json({ error: 'Credenciales inválidas', code: 'INVALID_CREDENTIALS' });
      }

      const { signAccessToken, signRefreshToken, registerSession } = require('../../../middleware/auth');
      const accessToken = signAccessToken({
        id: user.id, user: user.code, role: user.role, isJefeVentas: user.isJefeVentas
      });
      const refreshToken = signRefreshToken({
        id: user.id, user: user.code, role: user.role, isJefeVentas: user.isJefeVentas
      });
      registerSession(
        user.id,
        refreshToken,
        req.get('user-agent') || 'unknown',
        req.ip || 'unknown'
      );

      await repo.logLoginAttempt(user.id, true, req.ip);

      // Expand vendedorCodes for JEFE_VENTAS (same as legacy: all GMP vendors)
      let vendedorCodes = [user.code];
      if (user.isJefeVentas) {
        try {
          const allVendedores = await getDbPool().execute(
            `SELECT DISTINCT TRIM(CODIGOVENDEDOR) as CODE FROM DSEDAC.VDC WHERE SUBEMPRESA = 'GMP'`
          );
          const orphans = ['82', '20', 'UNK'];
          const existingCodes = new Set(allVendedores.map(v => v.CODE));
          orphans.forEach(o => existingCodes.add(o));
          vendedorCodes = Array.from(existingCodes);
        } catch (e) {
          logger.warn(`[DDD-AUTH] Could not expand vendedorCodes for JEFE_VENTAS: ${e.message}`);
        }
      } else {
        vendedorCodes = getVendorVisibilityScope(user.code);
      }

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
        vendedorCodes,
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

  // Lightweight token validation — JWT check only, no DB query.
  // Used by Flutter on startup to verify stored tokens are still valid
  // (guards against ephemeral JWT secrets being regenerated on server restart).
  const { verifyToken: _verifyToken } = require('../../../middleware/auth');
  router.get('/validate', _verifyToken, (req, res) => {
    res.json({ valid: true, usuario: req.user.code });
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
      const { vendedorCodes, clientCode, family, marca, prefamily, search, limit, offset } = req.query;
      if (!vendedorCodes) return res.status(400).json({ success: false, error: 'vendedorCodes is required' });
      if (!clientCode) return res.status(400).json({ success: false, error: 'clientCode is required' });

      const cacheKey = `ddd:products:${vendedorCodes}:${clientCode}:${family || ''}:${marca || ''}:${prefamily || ''}:${search || ''}:${limit || 50}:${offset || 0}`;
      await withCache(cache, cacheKey, TTL_MS.PRODUCT_CATALOG, async () => {
        const result = await repo.searchProducts({
          vendedorCodes,
          clientCode: String(clientCode).trim(),
          family: family ? String(family).trim() : undefined,
          marca: marca ? String(marca).trim() : undefined,
          prefamily: prefamily ? String(prefamily).trim() : undefined,
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

      // Use vendedorCodes from query if privileged user, otherwise own code
      const vendedorCodes = req.query.vendedorCodes || userId;
      const dateFrom = req.query.dateFrom ? String(req.query.dateFrom).trim() : undefined;
      const dateTo = req.query.dateTo ? String(req.query.dateTo).trim() : undefined;

      const cacheKey = `ddd:stats:${vendedorCodes}:${dateFrom || ''}:${dateTo || ''}`;
      await withCache(cache, cacheKey, TTL_MS.ORDER_STATS, async () => {
        const pedidosService = require('../../../services/pedidos.service');
        const stats = await pedidosService.getOrderStats(vendedorCodes, dateFrom, dateTo);
        return { success: true, stats };
      }, res, req);
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

      // Use vendedorCodes from query if privileged user, otherwise own code
      const vendedorCodes = req.query.vendedorCodes || userId;
      const dateFrom = req.query.dateFrom ? String(req.query.dateFrom).trim() : undefined;
      const dateTo = req.query.dateTo ? String(req.query.dateTo).trim() : undefined;

      const cacheKey = `ddd:orders-stats:${vendedorCodes}:${dateFrom || ''}:${dateTo || ''}`;
      await withCache(cache, cacheKey, TTL_MS.ORDER_STATS, async () => {
        const pedidosService = require('../../../services/pedidos.service');
        const stats = await pedidosService.getOrderStats(vendedorCodes, dateFrom, dateTo);
        return { success: true, stats };
      }, res, req);
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

  // GET /api/pedidos/product-comparative/:productCode
  router.get('/product-comparative/:productCode', async (req, res) => {
    try {
      const productCode = String(req.params.productCode || '').trim();
      if (!productCode) {
        return res.status(400).json({ success: false, error: 'productCode requerido' });
      }
      const clientCode = String(req.query.clientCode || '').trim();
      const vendedorCode = String(req.query.vendedorCode || '').trim();
      const now = new Date();
      const currentYear = now.getFullYear();
      const previousYear = currentYear - 1;

      const where = [`TRIM(L.LCCDRF) = ?`, `L.LCTPVT IN ('CC','VC')`,
                     `L.LCCLLN IN ('VT','AB')`, `L.LCSRAB NOT IN ('N','Z','G','D')`];
      const params = [productCode];
      if (clientCode) { where.push('TRIM(L.LCCDCL) = ?'); params.push(clientCode); }
      if (vendedorCode && vendedorCode.toUpperCase() !== 'ALL') { where.push('TRIM(L.LCCDVD) = ?'); params.push(vendedorCode); }
      const whereSql = where.join(' AND ');

      const { queryWithParams } = require('../../../config/db');

      const sqlByMonth = `
          SELECT L.LCAADC AS YEAR, L.LCMMDC AS MONTH,
              COALESCE(SUM(L.LCCTEV), 0) AS ENVASES,
              COALESCE(SUM(L.LCCTUD), 0) AS UNIDADES,
              COALESCE(SUM(L.LCIMVT), 0) AS IMPORTE
          FROM DSED.LACLAE L
          WHERE ${whereSql} AND L.LCAADC IN (?, ?)
          GROUP BY L.LCAADC, L.LCMMDC
          ORDER BY L.LCAADC, L.LCMMDC
      `;
      const sqlProductName = `
          SELECT TRIM(DESCRIPCIONARTICULO) AS NAME
          FROM DSEDAC.ART WHERE TRIM(CODIGOARTICULO) = ?
          FETCH FIRST 1 ROW ONLY
      `;

      const [rows, nameRows] = await Promise.all([
        queryWithParams(sqlByMonth, [...params, currentYear, previousYear], []),
        queryWithParams(sqlProductName, [productCode], []),
      ]);

      const empty = () => Array.from({ length: 12 }, (_, i) => ({ m: i + 1, envases: 0, unidades: 0, importe: 0 }));
      const monthlyCurrent = empty();
      const monthlyPrevious = empty();
      for (const r of (rows || [])) {
        const y = parseInt(r.YEAR);
        const m = parseInt(r.MONTH);
        if (!m || m < 1 || m > 12) continue;
        const slot = y === currentYear ? monthlyCurrent : (y === previousYear ? monthlyPrevious : null);
        if (!slot) continue;
        slot[m - 1] = { m, envases: parseFloat(r.ENVASES) || 0, unidades: parseFloat(r.UNIDADES) || 0, importe: parseFloat(r.IMPORTE) || 0 };
      }

      const sumKey = (arr, key) => arr.reduce((s, x) => s + (x[key] || 0), 0);
      const totalEnvCur = sumKey(monthlyCurrent, 'envases');
      const totalImpCur = sumKey(monthlyCurrent, 'importe');
      const totalEnvPrev = sumKey(monthlyPrevious, 'envases');
      const totalImpPrev = sumKey(monthlyPrevious, 'importe');

      const monthsClosed = now.getMonth();
      const partialDay = now.getDate();
      const daysInCurrentMonth = new Date(currentYear, monthsClosed + 1, 0).getDate();
      const accum = (arr) => {
        let s = 0;
        for (let i = 0; i < monthsClosed; i++) s += arr[i].envases;
        s += arr[monthsClosed].envases * (partialDay / daysInCurrentMonth);
        return s;
      };

      res.json({
        success: true, code: productCode,
        name: (nameRows?.[0]?.NAME || '').trim(),
        filters: { clientCode: clientCode || null, vendedorCode: vendedorCode || null },
        currentYear:  { year: currentYear, total: totalEnvCur, totalImporte: totalImpCur, monthly: monthlyCurrent },
        previousYear: { year: previousYear, total: totalEnvPrev, totalImporte: totalImpPrev, monthly: monthlyPrevious },
        variation: {
          envasesPct: totalEnvPrev > 0 ? ((totalEnvCur - totalEnvPrev) / totalEnvPrev) * 100 : null,
          importePct: totalImpPrev > 0 ? ((totalImpCur - totalImpPrev) / totalImpPrev) * 100 : null,
          ytdEnvasesPct: (() => { const c = accum(monthlyCurrent), p = accum(monthlyPrevious); return p > 0 ? ((c - p) / p) * 100 : null; })(),
        },
      });
    } catch (error) {
      const odbc0 = error.odbcErrors && error.odbcErrors[0];
      const odbcMsg = odbc0 ? `${odbc0.state} (${odbc0.code}): ${odbc0.message}` : '';
      logger.error(`[DDD-PEDIDOS] product-comparative error: ${error.message} | ODBC: ${odbcMsg}`);
      res.status(500).json({ success: false, error: 'Error obteniendo comparativa de producto' });
    }
  });

  // GET /api/pedidos/similar-products/:code
  router.get('/similar-products/:code', async (req, res) => {
    try {
      const { code } = req.params;
      const pedidosService = require('../../../services/pedidos.service');
      const similar = await pedidosService.getSimilarProducts(String(code).trim());
      // Flutter expects 'alternatives' key
      res.json({ success: true, alternatives: similar });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /similar-products: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/search-products
  router.get('/search-products', async (req, res) => {
    try {
      const { q, limit = 20, vendedorCodes, clientCode } = req.query;
      const searchTerm = q ? String(q).trim() : '';
      if (!searchTerm || searchTerm.length < 2) {
        return res.json({ success: true, products: [] });
      }

      const pedidosService = require('../../../services/pedidos.service');
      const results = await pedidosService.searchProductsWithStock(searchTerm, parseInt(limit) || 20);
      // Flutter expects 'products' key
      res.json({ success: true, products: results });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /search-products: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/product-history/:productCode/:clientCode
  router.get('/product-history/:productCode/:clientCode', async (req, res) => {
    try {
      const { productCode, clientCode } = req.params;

      // Query LACLAE for purchase history of this product by this client (3 years)
      const { queryWithParams } = require('../../../config/db');
      const currentYear = new Date().getFullYear();

      const sql = `
        SELECT
          L.LCAADC AS YEAR,
          L.LCMMDC AS MONTH,
          COALESCE(SUM(L.LCIMVT), 0) AS SALES,
          COALESCE(SUM(L.LCIMCT), 0) AS COST,
          COALESCE(SUM(L.LCCTUD), 0) AS UNITS
        FROM DSEDAC.LAC L
        WHERE TRIM(L.LCCDCL) = ?
          AND TRIM(L.CODIGOARTICULO) = ?
          AND L.LCAADC >= ?
          AND L.LCTPVT IN ('CC', 'VC')
          AND L.LCCLLN IN ('AB', 'VT')
        GROUP BY L.LCAADC, L.LCMMDC
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC
      `;

      const rows = await queryWithParams(sql, [clientCode, productCode, currentYear - 2], false);

      // Group by year for Flutter's expected format
      const years = {};
      let grandTotalSales = 0;
      let grandTotalCost = 0;
      let grandTotalUnits = 0;

      for (const row of rows) {
        const year = String(row.YEAR);
        const month = parseInt(row.MONTH) || 0;
        const sales = parseFloat(row.SALES) || 0;
        const cost = parseFloat(row.COST) || 0;
        const units = parseFloat(row.UNITS) || 0;

        grandTotalSales += sales;
        grandTotalCost += cost;
        grandTotalUnits += units;

        if (!years[year]) {
          years[year] = { months: {} };
        }
        years[year].months[month] = {
          sales,
          cost,
          units,
          margin: sales - cost,
          marginPct: sales > 0 ? ((sales - cost) / sales * 100) : 0,
        };
      }

      // Add totals per year
      for (const year of Object.keys(years)) {
        const months = years[year].months;
        let ySales = 0, yCost = 0, yUnits = 0;
        for (const m of Object.values(months)) {
          ySales += m.sales || 0;
          yCost += m.cost || 0;
          yUnits += m.units || 0;
        }
        years[year].totals = {
          sales: ySales,
          cost: yCost,
          units: yUnits,
          margin: ySales - yCost,
          marginPct: ySales > 0 ? ((ySales - yCost) / ySales * 100) : 0,
          envases: 0, // Not available in LAC
          cajas: 0,   // Not available in LAC
        };
      }

      res.json({
        success: true,
        years,
        grandTotal: {
          sales: grandTotalSales,
          cost: grandTotalCost,
          units: grandTotalUnits,
          margin: grandTotalSales - grandTotalCost,
          marginPct: grandTotalSales > 0 ? ((grandTotalSales - grandTotalCost) / grandTotalSales * 100) : 0,
          envases: 0,
          cajas: 0,
        },
      });
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
      const vc = vendedorCodes ? String(vendedorCodes).trim() : 'ALL';
      const analytics = await pedidosService.getOrderAnalytics(vc);
      res.json({ success: true, analytics });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /analytics: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // =============================================================================
  // ADDITIONAL MISSING ENDPOINTS (ported from legacy pedidos.js)
  // =============================================================================

  // GET /api/pedidos/families/detailed
  router.get('/families/detailed', async (req, res) => {
    try {
      const pedidosService = require('../../../services/pedidos.service');
      const families = await pedidosService.getFamiliesDetailed();
      res.json({ success: true, families });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /families/detailed: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/draft-status/:vendedorCode
  router.get('/draft-status/:vendedorCode', async (req, res) => {
    try {
      const code = String(req.params.vendedorCode || '').trim();
      const pedidosService = require('../../../services/pedidos.service');
      const result = await pedidosService.checkDraftAccumulation(code);
      res.json({ success: true, ...result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /draft-status: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/pedidos/draft-status/:vendedorCode/auto-confirm
  router.post('/draft-status/:vendedorCode/auto-confirm', async (req, res) => {
    try {
      const code = String(req.params.vendedorCode || '').trim();
      const pedidosService = require('../../../services/pedidos.service');
      const result = await pedidosService.checkDraftAccumulation(code, {
        autoConfirm: true,
        options: { userId: req.user?.code || req.user?.id || 'API' },
      });
      res.json({ success: true, ...result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in POST /draft-status/auto-confirm: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/purchase-history-global
  router.get('/purchase-history-global', async (req, res) => {
    try {
      const userIsJefe = req.user?.role === 'JEFE_VENTAS' || req.user?.role === 'ADMIN';
      const userVendor = String(req.user?.code || req.user?.id || '').trim();

      const now = new Date();
      const defaultFrom = new Date(now.getFullYear(), 0, 1);
      const from = req.query.from ? new Date(String(req.query.from)) : defaultFrom;
      const to = req.query.to ? new Date(String(req.query.to)) : now;
      const fromYmd = from.getFullYear() * 10000 + (from.getMonth() + 1) * 100 + from.getDate();
      const toYmd = to.getFullYear() * 10000 + (to.getMonth() + 1) * 100 + to.getDate();

      let vendor = String(req.query.vendedorCode || '').trim();
      if (!userIsJefe && userVendor) vendor = userVendor;
      const isAllVendor = !vendor || vendor.toUpperCase() === 'ALL';
      const clientCode = String(req.query.clientCode || '').trim();
      const productCode = String(req.query.productCode || '').trim();
      const familia = String(req.query.familia || '').trim();
      const marca = String(req.query.marca || '').trim();
      const limit = Math.min(parseInt(req.query.limit) || 100, 500);
      const offset = parseInt(req.query.offset) || 0;

      const where = [
        `(L.LCAADC * 10000 + L.LCMMDC * 100 + L.LCDDDC) BETWEEN ? AND ?`,
        `L.LCTPVT IN ('CC','VC') AND L.LCCLLN IN ('VT','AB')`,
        `L.LCSRAB NOT IN ('N','Z','G','D')`,
      ];
      const params = [fromYmd, toYmd];

      if (!isAllVendor) {
        const vendors = vendor.split(',').map(v => v.trim()).filter(Boolean);
        if (vendors.length > 0 && vendors.length <= 50) {
          where.push(`TRIM(L.LCCDVD) IN (${vendors.map(() => '?').join(',')})`);
          params.push(...vendors);
        } else if (vendors.length > 50) {
          const safe = vendors
            .filter(v => /^[A-Za-z0-9]{1,10}$/.test(v))
            .map(v => `'${v.replace(/'/g, "''")}'`)
            .join(',');
          if (safe) where.push(`TRIM(L.LCCDVD) IN (${safe})`);
        }
      }
      if (clientCode) { where.push(`TRIM(L.LCCDCL) = ?`); params.push(clientCode); }
      if (productCode) { where.push(`TRIM(L.LCCDRF) = ?`); params.push(productCode); }
      if (familia) { where.push(`L.LCCDRF IN (SELECT CODIGOARTICULO FROM DSEDAC.ART WHERE TRIM(CODIGOFAMILIA) = ?)`); params.push(familia); }
      if (marca) { where.push(`L.LCCDRF IN (SELECT CODIGOARTICULO FROM DSEDAC.ART WHERE TRIM(CODIGOMARCA) = ?)`); params.push(marca); }

      const whereSql = where.join(' AND ');

      const detailSql = `
        SELECT L.LCAADC AS ANO, L.LCMMDC AS MES, L.LCDDDC AS DIA,
          TRIM(L.LCCDCL) AS CODIGOCLIENTE,
          COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE)) AS NOMBRECLIENTE,
          TRIM(L.LCCDVD) AS CODIGOVENDEDOR, TRIM(L.LCCDRF) AS CODIGOARTICULO,
          TRIM(A.DESCRIPCIONARTICULO) AS DESCRIPCIONARTICULO,
          L.LCCTUD AS CANTIDADUNIDADES, L.LCCTEV AS CANTIDADENVASES,
          L.LCPRVT AS PRECIOVENTA, L.LCPJDT AS PORCENTAJEDESCUENTO,
          L.LCIMVT AS IMPORTEVENTA, (L.LCCTUD * L.LCPRVT) AS IMPORTESINDESCUENTO,
          (L.LCCTUD * L.LCPRVT - L.LCIMVT) AS IMPORTEDESCUENTO,
          TRIM(L.LCCDFP) AS CODIGOFORMAPAGO,
          TRIM(L.LCSRAB) AS SERIEALBARAN, L.LCNRAB AS NUMEROALBARAN
        FROM DSED.LACLAE L
        LEFT JOIN DSEDAC.ART A ON L.LCCDRF = A.CODIGOARTICULO
        LEFT JOIN DSEDAC.CLI C ON TRIM(C.CODIGOCLIENTE) = TRIM(L.LCCDCL)
        WHERE ${whereSql}
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC, L.LCDDDC DESC
        OFFSET ${offset} ROWS FETCH FIRST ${limit} ROWS ONLY`;

      const summarySql = `
        SELECT COUNT(*) AS NUM_LINEAS, COUNT(DISTINCT TRIM(L.LCCDCL)) AS NUM_CLIENTES,
          COUNT(DISTINCT TRIM(L.LCCDRF)) AS NUM_PRODUCTOS,
          COALESCE(SUM(L.LCIMVT), 0) AS TOTAL_VENDIDO,
          COALESCE(SUM(L.LCCTUD * L.LCPRVT), 0) AS TOTAL_SIN_DESCUENTO,
          COALESCE(SUM(L.LCCTUD * L.LCPRVT - L.LCIMVT), 0) AS TOTAL_DESCUENTO,
          COALESCE(SUM(L.LCCTUD), 0) AS TOTAL_UNIDADES
        FROM DSED.LACLAE L WHERE ${whereSql}`;

      const topProductosSql = `
        SELECT TRIM(L.LCCDRF) AS CODE, TRIM(A.DESCRIPCIONARTICULO) AS NAME,
          COALESCE(SUM(L.LCIMVT), 0) AS IMPORTE, COALESCE(SUM(L.LCCTUD), 0) AS UNIDADES,
          COUNT(*) AS NUM_LINEAS
        FROM DSED.LACLAE L LEFT JOIN DSEDAC.ART A ON L.LCCDRF = A.CODIGOARTICULO
        WHERE ${whereSql}
        GROUP BY TRIM(L.LCCDRF), TRIM(A.DESCRIPCIONARTICULO)
        ORDER BY IMPORTE DESC FETCH FIRST 10 ROWS ONLY`;

      const lastYearFrom = (from.getFullYear() - 1) * 10000 + (from.getMonth() + 1) * 100 + from.getDate();
      const lastYearTo = (to.getFullYear() - 1) * 10000 + (to.getMonth() + 1) * 100 + to.getDate();

      const monthlyByYearSql = `
        SELECT L.LCAADC AS ANO, L.LCMMDC AS MES,
          COALESCE(SUM(L.LCIMVT), 0) AS TOTAL_VENDIDO,
          COALESCE(SUM(L.LCCTUD * L.LCPRVT), 0) AS TOTAL_SIN_DESCUENTO,
          COALESCE(SUM(L.LCCTUD * L.LCPRVT - L.LCIMVT), 0) AS TOTAL_DESCUENTO,
          COALESCE(SUM(L.LCCTUD), 0) AS TOTAL_UNIDADES,
          COUNT(*) AS NUM_LINEAS
        FROM DSED.LACLAE L WHERE ${whereSql}
        GROUP BY L.LCAADC, L.LCMMDC ORDER BY L.LCAADC DESC, L.LCMMDC`;

      const [detail, summary, topProducts, lastYear, monthlyByYear] = await Promise.all([
        queryWithParams(detailSql, params, false),
        queryWithParams(summarySql, params, false),
        queryWithParams(topProductosSql, params, false),
        queryWithParams(`SELECT COALESCE(SUM(L.LCIMVT), 0) AS TOTAL_LAST_YEAR FROM DSED.LACLAE L WHERE (L.LCAADC * 10000 + L.LCMMDC * 100 + L.LCDDDC) BETWEEN ? AND ? AND L.LCTPVT IN ('CC','VC') AND L.LCCLLN IN ('VT','AB') AND L.LCSRAB NOT IN ('N','Z','G','D')`, [lastYearFrom, lastYearTo], false),
        queryWithParams(monthlyByYearSql, params, false),
      ]);

      const s = summary?.[0] || {};
      const totalThisPeriod = parseFloat(s.TOTAL_VENDIDO) || 0;
      const totalLastYear = parseFloat(lastYear?.[0]?.TOTAL_LAST_YEAR) || 0;
      const variation = totalLastYear > 0 ? ((totalThisPeriod - totalLastYear) / totalLastYear) * 100 : null;

      res.json({
        success: true,
        filters: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), vendedorCode: isAllVendor ? 'ALL' : vendor, clientCode: clientCode || null, productCode: productCode || null, familia: familia || null, marca: marca || null },
        summary: {
          numLineas: parseInt(s.NUM_LINEAS) || 0, numClientes: parseInt(s.NUM_CLIENTES) || 0, numProductos: parseInt(s.NUM_PRODUCTOS) || 0,
          totalVendido: totalThisPeriod, totalSinDescuento: parseFloat(s.TOTAL_SIN_DESCUENTO) || 0, totalDescuento: parseFloat(s.TOTAL_DESCUENTO) || 0, totalUnidades: parseFloat(s.TOTAL_UNIDADES) || 0,
          comparativaAnoAnterior: { totalAnoAnterior: totalLastYear, variacionPct: variation },
        },
        topProducts: (topProducts || []).map(t => ({ code: (t.CODE || '').trim(), name: (t.NAME || '').trim(), importe: parseFloat(t.IMPORTE) || 0, unidades: parseFloat(t.UNIDADES) || 0, numLineas: parseInt(t.NUM_LINEAS) || 0 })),
        lines: (detail || []).map(r => ({ fecha: `${r.ANO}-${String(r.MES).padStart(2, '0')}-${String(r.DIA).padStart(2, '0')}`, clienteCode: (r.CODIGOCLIENTE || '').trim(), clienteName: (r.NOMBRECLIENTE || '').trim(), vendedorCode: (r.CODIGOVENDEDOR || '').trim(), productCode: (r.CODIGOARTICULO || '').trim(), productName: (r.DESCRIPCIONARTICULO || '').trim(), cantidad: parseFloat(r.CANTIDADUNIDADES) || 0, envases: parseFloat(r.CANTIDADENVASES) || 0, precio: parseFloat(r.PRECIOVENTA) || 0, descuentoPct: parseFloat(r.PORCENTAJEDESCUENTO) || 0, importe: parseFloat(r.IMPORTEVENTA) || 0, importeSinDescuento: parseFloat(r.IMPORTESINDESCUENTO) || 0, importeDescuento: parseFloat(r.IMPORTEDESCUENTO) || 0, formaPago: (r.CODIGOFORMAPAGO || '').trim(), albaran: `${(r.SERIEALBARAN || '').trim()}-${r.NUMEROALBARAN || ''}` })),
        monthlyByYear: (monthlyByYear || []).map(r => ({ year: parseInt(r.ANO), month: parseInt(r.MES), totalVendido: parseFloat(r.TOTAL_VENDIDO) || 0, totalSinDescuento: parseFloat(r.TOTAL_SIN_DESCUENTO) || 0, totalDescuento: parseFloat(r.TOTAL_DESCUENTO) || 0, totalUnidades: parseFloat(r.TOTAL_UNIDADES) || 0, numLineas: parseInt(r.NUM_LINEAS) || 0 })),
        pagination: { limit, offset, hasMore: (detail || []).length === limit },
      });
    } catch (error) {
      const odbc0 = error.odbcErrors && error.odbcErrors[0];
      const odbcMsg = odbc0 ? `${odbc0.state} (${odbc0.code}): ${odbc0.message}` : '';
      logger.error(`[DDD-PEDIDOS] purchase-history-global ERROR: ${error.message}\n  ODBC: ${odbcMsg}\n  STACK: ${error.stack || ''}`);
      res.status(500).json({ success: false, error: 'Error obteniendo historico global', detail: process.env.NODE_ENV !== 'production' ? error.message : undefined, odbc: process.env.NODE_ENV !== 'production' ? odbcMsg : undefined });
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

      const { limit, offset, estado, status, vendedorCodes, dateFrom, dateTo, search, minAmount, maxAmount, sortBy, sortOrder } = req.query;
      const requestedVendedorCodes = vendedorCodes || userId;
      if (!canAccessVendedorCodes(req, requestedVendedorCodes)) {
        return res.status(403).json({ success: false, error: 'No autorizado para consultar esos vendedores', code: 'FORBIDDEN_VENDOR' });
      }
      const requestedStatus = status || estado;
      const cacheKey = `ddd:orders-list:${userId}:${limit || 20}:${offset || 0}:${requestedStatus || 'all'}:${search || ''}:${dateFrom || ''}:${dateTo || ''}`;
      await withCache(cache, cacheKey, TTL_MS.ORDER_HISTORY, async () => {
        const pedidosService = require('../../../services/pedidos.service');
        const result = await pedidosService.getOrders({
          vendedorCodes: requestedVendedorCodes,
          limit: parseInt(limit) || 50,
          offset: parseInt(offset) || 0,
          status: requestedStatus ? String(requestedStatus).trim() : undefined,
          dateFrom: dateFrom ? String(dateFrom).trim() : undefined,
          dateTo: dateTo ? String(dateTo).trim() : undefined,
          search: search ? String(search).trim() : undefined,
          minAmount: minAmount != null ? parseFloat(minAmount) : undefined,
          maxAmount: maxAmount != null ? parseFloat(maxAmount) : undefined,
          sortBy: sortBy ? String(sortBy).trim() : undefined,
          sortOrder: sortOrder ? String(sortOrder).trim() : undefined,
        });
        const orders = Array.isArray(result) ? result : (result.orders || []);
        const count = Array.isArray(result) ? result.length : (result.count || orders.length);
        return { success: true, orders, count };
      }, res, req);
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/delivery-options
  router.get('/delivery-options', async (req, res) => {
    try {
      const clientCode = req.query.clientCode ? String(req.query.clientCode).trim() : '';
      const vendedorCode = req.query.vendedorCode ? String(req.query.vendedorCode).trim() : '';
      const deliveryDate = req.query.deliveryDate ? String(req.query.deliveryDate).trim() : undefined;

      if (!clientCode || !vendedorCode) {
        return res.status(400).json({ success: false, error: 'clientCode and vendedorCode are required' });
      }

      const pedidosService = require('../../../services/pedidos.service');
      const options = await pedidosService.getDeliveryOptions({ clientCode, vendedorCode, deliveryDate });
      res.json({ success: true, options });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /delivery-options: ${error.message}`);
      const status = error.message.includes('Fecha reparto') ? 409 : 500;
      res.status(status).json({ success: false, error: error.message });
    }
  });

  // GET /api/pedidos/:id  - SOLO numerico para no capturar rutas como
  // /purchase-history-global, /draft-status/:vendedorCode, etc.
  router.get('/:id([0-9]+)', async (req, res) => {
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

      const { clientCode, clientName, vendedorCode, lines, observations, observaciones, tipoventa, almacen, tarifa } = req.body;
      // Use explicit vendedorCode from body, fallback to userId (the logged-in user)
      const actualVendedor = vendedorCode || userId;

      if (!canAccessVendedorCodes(req, actualVendedor)) {
        return res.status(403).json({ success: false, error: 'No autorizado para crear pedidos de otro vendedor', code: 'FORBIDDEN_VENDOR' });
      }

      if (!clientCode || !lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ success: false, error: 'clientCode and lines are required' });
      }

      const pedidosService = require('../../../services/pedidos.service');
      const result = await pedidosService.createOrder({
        clientCode: String(clientCode).trim(),
        clientName: clientName ? String(clientName).trim() : '',
        vendedorCode: String(actualVendedor).trim(),
        tipoventa: tipoventa || 'CC',
        almacen: parseInt(almacen) || 1,
        tarifa: parseInt(tarifa) || 1,
        observaciones: observations || observaciones || '',
        lines: lines,
        origen: 'A'
      });

      // Invalidate related caches
      cache.invalidatePattern(`ddd:products:`);
      cache.invalidatePattern(`ddd:orders-list:${userId}`);
      cache.invalidatePattern(`ddd:history:${userId}`);
      cache.invalidatePattern(`ddd:stats:${userId}`);

      const normalized = normalizeOrderResponse(result);
      res.status(201).json({ success: true, ...normalized });
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

      const { saleType, forceConfirm, deliveryDate, vehicleCode, driverCode, routeCode } = req.body || {};
      const pedidosService = require('../../../services/pedidos.service');
      const result = await pedidosService.confirmOrder(parseInt(id), saleType, {
        forceConfirm: !!forceConfirm,
        userId,
        deliveryDate: deliveryDate ? String(deliveryDate).trim() : undefined,
        vehicleCode: vehicleCode ? String(vehicleCode).trim() : undefined,
        driverCode: driverCode ? String(driverCode).trim() : undefined,
        routeCode: routeCode ? String(routeCode).trim() : undefined,
      });

      if (result && result.blocked) {
        return res.status(409).json({ success: false, ...result });
      }

      // Invalidate related caches
      cache.invalidatePattern(`ddd:orders-list:${userId}`);
      cache.invalidatePattern(`ddd:history:${userId}`);
      cache.invalidatePattern(`ddd:stats:${userId}`);

      const normalized = normalizeOrderResponse(result);
      res.json({ success: true, ...normalized });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in PUT /:id/confirm: ${error.message}`);
      const status = error.message.includes('Fecha reparto') ? 409
        : error.message.includes('BORRADOR') ? 409
        : error.message.includes('no encontrado') ? 404
        : 500;
      res.status(status).json({ success: false, error: error.message });
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
      res.status(error.code === 'ORDER_NOT_EDITABLE' ? 409 : 500).json({ success: false, error: error.message, code: error.code });
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
      res.status(error.code === 'ORDER_NOT_EDITABLE' ? 409 : 500).json({ success: false, error: error.message, code: error.code });
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
      res.status(error.code === 'ORDER_NOT_EDITABLE' ? 409 : 500).json({ success: false, error: error.message, code: error.code });
    }
  });

  // PUT /api/pedidos/:id/status
  router.put('/:id/status', async (req, res) => {
    try {
      const { id } = req.params;
      const { estado, status, userId } = req.body;
      const nextEstado = estado || status;
      if (!nextEstado) return res.status(400).json({ success: false, error: 'estado required' });

      const result = await repo.updateOrderStatus({ orderId: id, estado: nextEstado, userId: userId || req.user?.code });
      const normalized = normalizeOrderResponse(result);
      res.json({ success: true, ...normalized });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in PUT /:id/status: ${error.message}`);
      const statusCode = error.code === 'ORDER_NOT_FOUND' ? 404
        : error.code === 'INVALID_ORDER_STATUS' ? 400
          : error.code === 'INVALID_ORDER_TRANSITION' ? 409
            : 500;
      res.status(statusCode).json({ success: false, error: error.message, code: error.code });
    }
  });

  // PUT /api/pedidos/:id/cancel
  router.put('/:id/cancel', async (req, res) => {
    try {
      const { id } = req.params;
      const numericId = parseInt(id);
      if (isNaN(numericId)) {
        return res.status(400).json({ success: false, error: 'Invalid order ID' });
      }
      const pedidosService = require('../../../services/pedidos.service');
      const result = await pedidosService.cancelOrder(numericId, { userId: req.user?.code });
      res.json({ success: true, order: result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in PUT /:id/cancel: ${error.message}`);
      const status = error.message.includes('no se puede') || error.message.includes('anulado') || error.message.includes('enviado')
        ? 409
        : error.message.includes('no encontrado') ? 404 : 500;
      res.status(status).json({ success: false, error: error.message });
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

  const cobrosContext = (req) => ({
    userId: req.user?.code || req.user?.id,
    userRole: req.user?.role || 'COMERCIAL',
    isJefeVentas: req.user?.isJefeVentas === true || req.user?.role === 'JEFE_VENTAS' || req.user?.role === 'ADMIN',
    vendedorCodes: req.user?.vendedorCodes || req.user?.vendorCodes,
    vendorCodes: req.user?.vendorCodes || req.user?.vendedorCodes,
  });

  const cobrosCacheScope = (req) => {
    const role = req.user?.role || 'COMERCIAL';
    const userId = req.user?.code || req.user?.id || 'anonymous';
    const visible = req.user?.vendorCodes || req.user?.vendedorCodes || [];
    const visibleScope = Array.isArray(visible) ? visible.join(',') : String(visible || '');
    return `${role}:${userId}:${visibleScope}`;
  };

  const sendCobrosError = (res, error) => {
    const status = Number(error.status) ||
      (error.code === 'INVALID_IDEMPOTENCY_TOKEN' ? 400 :
        error.code === 'INVALID_PAYMENT_PAYLOAD' ? 400 :
          error.code === 'OVERRIDE_REASON_REQUIRED' ? 400 :
            error.code === 'FORBIDDEN_VENDOR' ? 403 :
              error.code === 'FORBIDDEN_CLIENT_VENDOR' ? 403 :
                error.code === 'ORDER_NOT_FOUND_FOR_PAYMENT' ? 404 :
                  error.code === 'IDEMPOTENCY_CONFLICT' ? 409 :
                    error.code === 'OVERPAY_NOT_ALLOWED' ? 409 :
                      error.code === 'PAYMENT_ALREADY_REGISTERED' ? 409 : 500);
    return res.status(status).json({
      success: false,
      error: error.message,
      code: error.code || 'COBROS_ERROR',
    });
  };

  router.get('/:codigoCliente/pendientes', async (req, res) => {
    try {
      const { codigoCliente } = req.params;
      if (!codigoCliente) return res.status(400).json({ success: false, error: 'codigoCliente required' });

      const cacheKey = `ddd:cobros:pendientes:${codigoCliente}:${cobrosCacheScope(req)}`;
      await withCache(cache, cacheKey, TTL_MS.PENDIENTES, async () => {
        const pendientes = await repo.getPendientes(String(codigoCliente).trim(), cobrosContext(req));
        return {
          success: true,
          cobros: pendientes.cobros || [],
          resumen: pendientes.resumen || { totalPendiente: 0 },
          pendientes
        };
      }, res);
    } catch (error) {
      logger.error(`[DDD-COBROS] Error in GET /pendientes: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/:codigoCliente/estado', async (req, res) => {
    try {
      const { codigoCliente } = req.params;
      if (!codigoCliente) return res.status(400).json({ success: false, error: 'codigoCliente required' });

      const pendientes = await repo.getPendientes(String(codigoCliente).trim(), cobrosContext(req));
      const totalPendiente = parseFloat(pendientes?.resumen?.totalPendiente) || 0;
      res.json({
        success: true,
        estadoCliente: {
          codigo: String(codigoCliente).trim(),
          nombre: '',
          limiteCredito: 0,
          totalPendiente,
          diasMora: 0,
          estado: totalPendiente > 0 ? 'EN_ROJO' : 'ACTIVO',
          motivo: totalPendiente > 0 ? 'Tiene cobros pendientes' : null
        }
      });
    } catch (error) {
      logger.error(`[DDD-COBROS] Error in GET /estado: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/:codigoCliente/registrar', async (req, res) => {
    try {
      const { codigoCliente } = req.params;
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const { referencia, importe, formaPago, observaciones, idempotencyToken, allowOverpay, overrideReason } = req.body;
      if (!codigoCliente || importe == null || !formaPago) {
        return res.status(400).json({ success: false, error: 'codigoCliente, importe, and formaPago required' });
      }

      const result = await repo.registerPayment({
        clientCode: String(codigoCliente).trim(),
        amount: parseFloat(importe) || 0,
        paymentMethod: formaPago,
        reference: referencia || '',
        observations: observaciones || '',
        userId,
        userRole: req.user?.role || 'COMERCIAL',
        isJefeVentas: req.user?.isJefeVentas === true,
        idempotencyToken,
        allowOverpay: allowOverpay === true,
        overrideReason: overrideReason || '',
      });

      cache.invalidatePattern(`ddd:cobros:pendientes:${codigoCliente}:`);
      cache.invalidatePattern(`ddd:cobros:historico:${codigoCliente}:`);

      res.json({ success: true, mensaje: 'Cobro registrado correctamente', payment: result });
    } catch (error) {
      logger.error(`[DDD-COBROS] Error in POST /:codigoCliente/registrar: ${error.message}`);
      sendCobrosError(res, error);
    }
  });

  router.post('/register', async (req, res) => {
    try {
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const { clientCode, amount, paymentMethod, reference, observations, idempotencyToken, allowOverpay, overrideReason } = req.body;
      if (!clientCode || !amount || !paymentMethod) {
        return res.status(400).json({ success: false, error: 'clientCode, amount, and paymentMethod required' });
      }

      const result = await repo.registerPayment({
        clientCode,
        amount,
        paymentMethod,
        reference,
        observations,
        userId,
        userRole: req.user?.role || 'COMERCIAL',
        isJefeVentas: req.user?.isJefeVentas === true,
        idempotencyToken,
        allowOverpay: allowOverpay === true,
        overrideReason: overrideReason || '',
      });

      // Invalidate cobros caches
      cache.invalidatePattern(`ddd:cobros:pendientes:${clientCode}:`);
      cache.invalidatePattern(`ddd:cobros:historico:${clientCode}:`);

      res.json({ success: true, payment: result });
    } catch (error) {
      logger.error(`[DDD-COBROS] Error in POST /register: ${error.message}`);
      sendCobrosError(res, error);
    }
  });

  // GET /api/cobros/pending-summary/:vendedorCode
  // Returns total pending amounts grouped by client for given vendor(s)
  router.get('/pending-summary/:vendedorCode', async (req, res) => {
    try {
      const vendedorCodeParam = req.params.vendedorCode;
      logger.info(`[COBROS] Pending summary for vendor: ${vendedorCodeParam}`);
      const result = await repo.getPendingSummary(vendedorCodeParam, cobrosContext(req));
      res.json({ success: true, ...result });
    } catch (error) {
      logger.error(`[COBROS] Error pending-summary: ${error.message}`);
      sendCobrosError(res, error);
    }
  });

  router.get('/:codigoCliente/historico', async (req, res) => {
    try {
      const { codigoCliente } = req.params;
      const { limit, offset } = req.query;

      const cacheKey = `ddd:cobros:historico:${codigoCliente}:${cobrosCacheScope(req)}:${limit || 20}:${offset || 0}`;
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

  const isPrivileged = (req) =>
    req.user?.isJefeVentas ||
    req.user?.role === 'JEFE_VENTAS' ||
    req.user?.role === 'ADMIN';

  async function canAccessAlbaran(req, albaranId) {
    if (isPrivileged(req)) return true;
    const repartidorId = req.user?.code || req.user?.id;
    if (!repartidorId) return false;
    const albaranes = await repo.getAlbaranes({ repartidorId });
    return albaranes.some((albaran) =>
      String(albaran.id || albaran.number || '').trim() ===
      String(albaranId || '').trim()
    );
  }

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
      if (!await canAccessAlbaran(req, id)) {
        return res.status(403).json({
          success: false,
          error: 'No tienes permisos para consultar esta entrega',
        });
      }
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
      if (!await canAccessAlbaran(req, id)) {
        return res.status(403).json({
          success: false,
          error: 'No tienes permisos para entregar este albaran',
        });
      }

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

  // Keep legacy document delivery endpoints available while DDD owns /api/entregas.
  // This prevents 404s for /receipt/:id, /receipt/:id/email and /receipt/:id/whatsapp.
  router.use(require('../../../routes/entregas'));

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

        const normalized = clients.map(c => ({
          code: (c.code ?? c.CODE ?? '').toString().trim(),
          name: (c.name ?? c.NAME ?? '').toString().trim(),
          nif: (c.nif ?? c.NIF ?? '').toString().trim(),
          address: (c.address ?? c.ADDRESS ?? '').toString().trim(),
          city: (c.city ?? c.CITY ?? '').toString().trim(),
          province: (c.province ?? c.PROVINCE ?? '').toString().trim(),
          postalCode: (c.postalCode ?? c.POSTALCODE ?? '').toString().trim(),
          phone: (c.phone ?? c.PHONE ?? '').toString().trim(),
          phone2: (c.phone2 ?? c.PHONE2 ?? '').toString().trim(),
          route: (c.route ?? c.ROUTE ?? '').toString().trim(),
          contactPerson: (c.contactPerson ?? c.CONTACTPERSON ?? '').toString().trim(),
          totalPurchases: Number(c.totalPurchases ?? c.TOTALPURCHASES ?? 0) || 0,
          numOrders: Number(c.numOrders ?? c.NUMORDERS ?? 0) || 0,
          lastDateInt: Number(c.lastDateInt ?? c.LASTDATEINT ?? 0) || 0,
          totalMargin: Number(c.totalMargin ?? c.TOTALMARGIN ?? 0) || 0,
          yearInactive: Number(c.yearInactive ?? c.YEARINACTIVE ?? 0) || 0,
          vendorName: (c.vendorName ?? c.VENDORNAME ?? '').toString().trim(),
          vendorCode: (c.vendorCode ?? c.VENDORCODE ?? '').toString().trim(),
        }));
        return { success: true, clients: normalized, count: normalized.length, isAllQuery };
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

      const safeVendedorCode = String(vendedorCode).replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
      if (!safeVendedorCode) return res.status(400).json({ success: false, error: 'vendedorCode inválido' });

      const selectedYear = parseInt(year) || new Date().getFullYear();
      const prevYear = selectedYear - 1;
      const cacheKey = `ddd:commissions:v2:${safeVendedorCode}:${selectedYear}`;

      const result = await performanceCache.getOrFetch(cacheKey, async () => {
        const { queryWithParams: qp } = require('../../../config/db');
        const salesRows = await qp(`
          SELECT L.LCAADC as YEAR, LCMMDC as MONTH, SUM(L.LCIMVT) as SALES
          FROM DSED.LACLAE L
          WHERE L.LCAADC IN (?, ?)
            AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT')
            AND LCSRAB NOT IN ('N', 'Z') AND TPDC = 'LAC'
            AND R1_T8CDVD = ?
          GROUP BY L.LCAADC, LCMMDC
          ORDER BY YEAR, MONTH
        `, [selectedYear, prevYear, safeVendedorCode], false);

        return { success: true, salesRows, year: selectedYear, vendorCode: safeVendedorCode };
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
