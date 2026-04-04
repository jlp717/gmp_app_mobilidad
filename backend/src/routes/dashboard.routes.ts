/**
 * Dashboard Routes - Production Grade v4.0.0
 * 
 * Architecture: Redis-first caching with role-specific TTLs
 * - JEFE DE VENTAS: Cache hit returns in < 50ms (pre-warmed on startup)
 * - Cache miss: Query executes, result cached, next request hits cache
 * - Role-specific TTLs: JEFE=10min, Comercial=30min, Repartidor=15min
 * 
 * Performance Target: < 2 seconds for JEFE DE VENTAS (cache hit: < 50ms)
 * 
 * @agent Performance - Redis-first, role-aware caching, pre-warmed
 * @agent DB2 Optimizer - Parameterized queries, no SQL injection
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { dbPool } from '../core/infrastructure/database/db2-connection-pool';
import { redisCache, CacheTTL } from '../core/infrastructure/cache/redis-cache';
import { AuthUser } from '../middleware/auth.middleware';

const router = Router();

// ============================================================
// VALIDATION SCHEMAS
// ============================================================

const dashboardQuerySchema = z.object({
  year: z.string().regex(/^\d{4}$/).optional(),
  month: z.string().regex(/^\d{1,2}$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  vendedorCode: z.string().optional(),
});

// ============================================================
// HELPER: Build cache key from request context
// ============================================================

function dashboardCacheKey(user: AuthUser, query: Record<string, string | undefined>): string {
  const role = user.role.toUpperCase();
  const vendedorCode = user.vendedorCode;
  const year = query.year || new Date().getFullYear().toString();
  const month = query.month || '';
  
  // Hash the filter combination for unique cache keys
  const filtersStr = JSON.stringify({ year, month, vendedorCode });
  const filtersHash = Buffer.from(filtersStr).toString('base64url').substring(0, 16);
  
  return `dashboard:metrics:${role}:${vendedorCode}:${filtersHash}`;
}

// ============================================================
// HELPER: Determine vendor filter for SQL queries
// ============================================================

function getVendorFilter(user: AuthUser): { condition: string; params: string[] } {
  const vendedorCodes = user.vendedorCodes || [user.vendedorCode];
  
  // JEFE DE VENTAS with ALL access — no vendor filter
  if (vendedorCodes.includes('ALL')) {
    return { condition: '1=1', params: [] };
  }
  
  // Specific vendor codes
  const placeholders = vendedorCodes.map(() => '?').join(',');
  return {
    condition: `L.VENDEDOR IN (${placeholders})`,
    params: vendedorCodes,
  };
}

// ============================================================
// HELPER: Get current date components
// ============================================================

function getDateComponents(query: Record<string, string | undefined>) {
  const now = new Date();
  const year = query.year ? parseInt(query.year, 10) : now.getFullYear();
  const month = query.month ? parseInt(query.month, 10) : now.getMonth() + 1;
  return { year, month };
}

// ============================================================
// ROUTE: GET /api/dashboard/metrics
// 
# The primary dashboard endpoint — Redis-first caching
// Returns KPIs: ventas, margen, pedidos, cajas, margenPercent
// 
// Performance:
// - Cache hit: < 50ms
// - Cache miss (first request): < 2s (optimized query)
// - Pre-warmed on startup for JEFE DE VENTAS
// ============================================================

router.get('/metrics', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const validation = dashboardQuerySchema.safeParse(req.query);
    
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: validation.error.errors });
      return;
    }

    const cacheKey = dashboardCacheKey(user, req.query as Record<string, string | undefined>);

    // TRY CACHE FIRST (Redis L2 → L1)
    const cached = await redisCache.get(cacheKey);
    if (cached) {
      logger.debug(`Cache HIT: ${cacheKey}`);
      res.json({ success: true, data: cached, source: 'cache', timestamp: new Date().toISOString() });
      return;
    }

    // CACHE MISS — execute query
    logger.info(`Cache MISS: ${cacheKey} — executing query`);
    const start = Date.now();
    
    const { year, month } = getDateComponents(req.query as Record<string, string | undefined>);
    const { condition: vendorFilter, params: vendorParams } = getVendorFilter(user);

    // Determine the correct vendor column based on date (feature flag from common.js)
    const vendorColumn = getVendorColumn();
    const salesFilter = getSalesFilter();

    const monthParam = month ? `AND L.LCMMDC = ?` : '';
    const queryParams = [...vendorParams];
    if (month) queryParams.push(month);

    const sql = `
      SELECT
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) AS MARGEN,
        COUNT(DISTINCT L.LCSRAB || L.LCNRAB) AS PEDIDOS,
        COALESCE(SUM(L.LCCTEV), 0) AS CAJAS
      FROM DSED.LACLAE L
      WHERE ${vendorFilter}
        AND ${salesFilter}
        AND L.${vendorColumn} IS NOT NULL
        ${monthParam}
    `;

    const result = await dbPool.query<Record<string, unknown>[]>(sql, queryParams);
    const row = result.data?.[0] as Record<string, number> || {};

    const ventas = row.VENTAS || 0;
    const margen = row.MARGEN || 0;
    const pedidos = row.PEDIDOS || 0;
    const cajas = row.CAJAS || 0;
    const margenPercent = ventas > 0 ? (margen / ventas) * 100 : 0;

    const metrics = {
      ventas: Math.round(ventas * 100) / 100,
      margen: Math.round(margen * 100) / 100,
      pedidos,
      cajas: Math.round(cajas * 100) / 100,
      margenPercent: Math.round(margenPercent * 100) / 100,
    };

    const executionTime = Date.now() - start;
    logger.info(`Dashboard metrics: ${executionTime}ms (${ventas ? 'data' : 'empty'})`);

    // CACHE THE RESULT (role-specific TTL)
    const ttl = getRoleTTL(user.role);
    await redisCache.set(cacheKey, metrics, ttl);

    res.json({ success: true, data: metrics, source: 'database', executionTime, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error('Dashboard metrics error:', error);
    res.status(500).json({ error: 'Internal server error', code: 'DASHBOARD_METRICS_ERROR' });
  }
});

// ============================================================
// ROUTE: GET /api/dashboard/sales-evolution
// ============================================================

router.get('/sales-evolution', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { year, month } = getDateComponents(req.query as Record<string, string | undefined>);
    const cacheKey = dashboardCacheKey(user, { ...req.query, endpoint: 'sales-evolution' } as Record<string, string | undefined>);

    const cached = await redisCache.get(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached, source: 'cache' });
      return;
    }

    const { condition: vendorFilter, params: vendorParams } = getVendorFilter(user);
    const vendorColumn = getVendorColumn();
    const salesFilter = getSalesFilter();
    
    const yearFilter = year ? `AND L.LCAADC = ?` : '';
    const queryParams = [...vendorParams];
    if (year) queryParams.push(year);

    const sql = `
      SELECT
        L.LCAADC AS ANIO,
        L.LCMMDC AS MES,
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) AS MARGEN,
        COUNT(DISTINCT L.LCSRAB || L.LCNRAB) AS PEDIDOS
      FROM DSED.LACLAE L
      WHERE ${vendorFilter}
        AND ${salesFilter}
        AND L.${vendorColumn} IS NOT NULL
        ${yearFilter}
      GROUP BY L.LCAADC, L.LCMMDC
      ORDER BY L.LCAADC DESC, L.LCMMDC DESC
      FETCH FIRST 12 ROWS ONLY
    `;

    const result = await dbPool.query<Record<string, unknown>[]>(sql, queryParams);
    const data = (result.data || []).map((row: Record<string, unknown>) => ({
      date: `${String(row.ANIO)}-${String(row.MES).padStart(2, '0')}`,
      ventas: Math.round((Number(row.VENTAS) || 0) * 100) / 100,
      margen: Math.round((Number(row.MARGEN) || 0) * 100) / 100,
      pedidos: Number(row.PEDIDOS) || 0,
    }));

    await redisCache.set(cacheKey, data, CacheTTL.MEDIUM);
    res.json({ success: true, data, source: 'database' });
  } catch (error) {
    logger.error('Sales evolution error:', error);
    res.status(500).json({ error: 'Internal server error', code: 'SALES_EVOLUTION_ERROR' });
  }
});

// ============================================================
// ROUTE: GET /api/dashboard/top-clients
// ============================================================

router.get('/top-clients', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { year, month } = getDateComponents(req.query as Record<string, string | undefined>);
    const limit = parseInt(req.query.limit as string) || 10;
    const cacheKey = dashboardCacheKey(user, { ...req.query, endpoint: 'top-clients', limit: String(limit) } as Record<string, string | undefined>);

    const cached = await redisCache.get(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached, source: 'cache' });
      return;
    }

    const { condition: vendorFilter, params: vendorParams } = getVendorFilter(user);
    const vendorColumn = getVendorColumn();
    const salesFilter = getSalesFilter();
    
    const yearFilter = year ? `AND L.LCAADC = ?` : '';
    const monthFilter = month ? `AND L.LCMMDC = ?` : '';
    const queryParams = [...vendorParams];
    if (year) queryParams.push(year);
    if (month) queryParams.push(month);
    queryParams.push(limit);

    const sql = `
      SELECT
        L.LCCDCL AS CODIGO,
        COALESCE(CLI.NOMBRECLIENTE, L.LCCDCL) AS NOMBRE,
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) AS MARGEN,
        COUNT(DISTINCT L.LCSRAB || L.LCNRAB) AS PEDIDOS
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(L.LCCDCL)
      WHERE ${vendorFilter}
        AND ${salesFilter}
        AND L.${vendorColumn} IS NOT NULL
        ${yearFilter}
        ${monthFilter}
      GROUP BY L.LCCDCL, CLI.NOMBRECLIENTE
      ORDER BY VENTAS DESC
      FETCH FIRST ? ROWS ONLY
    `;

    const result = await dbPool.query<Record<string, unknown>[]>(sql, queryParams);
    const data = (result.data || []).map((row: Record<string, unknown>) => ({
      code: String(row.CODIGO || ''),
      name: String(row.NOMBRE || ''),
      ventas: Math.round((Number(row.VENTAS) || 0) * 100) / 100,
      margen: Math.round((Number(row.MARGEN) || 0) * 100) / 100,
      pedidos: Number(row.PEDIDOS) || 0,
    }));

    await redisCache.set(cacheKey, data, CacheTTL.MEDIUM);
    res.json({ success: true, data, source: 'database' });
  } catch (error) {
    logger.error('Top clients error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// ROUTE: GET /api/dashboard/top-products
// ============================================================

router.get('/top-products', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { year, month } = getDateComponents(req.query as Record<string, string | undefined>);
    const limit = parseInt(req.query.limit as string) || 10;
    const cacheKey = dashboardCacheKey(user, { ...req.query, endpoint: 'top-products', limit: String(limit) } as Record<string, string | undefined>);

    const cached = await redisCache.get(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached, source: 'cache' });
      return;
    }

    const { condition: vendorFilter, params: vendorParams } = getVendorFilter(user);
    const vendorColumn = getVendorColumn();
    const salesFilter = getSalesFilter();

    const yearFilter = year ? `AND L.LCAADC = ?` : '';
    const monthFilter = month ? `AND L.LCMMDC = ?` : '';
    const queryParams = [...vendorParams];
    if (year) queryParams.push(year);
    if (month) queryParams.push(month);
    queryParams.push(limit);

    const sql = `
      SELECT
        L.LCCDRF AS CODIGO,
        COALESCE(ART.DESCRIPCIONARTICULO, L.LCCDRF) AS NOMBRE,
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCCTUD), 0) AS UNIDADES,
        COALESCE(ART.CODIGOFAMILIA, '') AS FAMILIA
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.ART ART ON TRIM(ART.CODIGOARTICULO) = TRIM(L.LCCDRF)
      WHERE ${vendorFilter}
        AND ${salesFilter}
        AND L.${vendorColumn} IS NOT NULL
        ${yearFilter}
        ${monthFilter}
      GROUP BY L.LCCDRF, ART.DESCRIPCIONARTICULO, ART.CODIGOFAMILIA
      ORDER BY VENTAS DESC
      FETCH FIRST ? ROWS ONLY
    `;

    const result = await dbPool.query<Record<string, unknown>[]>(sql, queryParams);
    const data = (result.data || []).map((row: Record<string, unknown>) => ({
      code: String(row.CODIGO || ''),
      name: String(row.NOMBRE || ''),
      ventas: Math.round((Number(row.VENTAS) || 0) * 100) / 100,
      unidades: Number(row.UNIDADES) || 0,
      familia: String(row.FAMILIA || ''),
    }));

    await redisCache.set(cacheKey, data, CacheTTL.MEDIUM);
    res.json({ success: true, data, source: 'database' });
  } catch (error) {
    logger.error('Top products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// ROUTE: GET /api/dashboard/recent-sales
// ============================================================

router.get('/recent-sales', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const limit = parseInt(req.query.limit as string) || 10;
    const cacheKey = dashboardCacheKey(user, { endpoint: 'recent-sales', limit: String(limit) } as Record<string, string | undefined>);

    const cached = await redisCache.get(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached, source: 'cache' });
      return;
    }

    const { condition: vendorFilter, params: vendorParams } = getVendorFilter(user);
    const vendorColumn = getVendorColumn();
    const salesFilter = getSalesFilter();
    const queryParams = [...vendorParams, limit];

    const sql = `
      SELECT
        L.LCAADC AS ANIO,
        L.LCMMDC AS MES,
        L.LCDDDC AS DIA,
        L.LCCDCL AS CLIENTE,
        COALESCE(CLI.NOMBRECLIENTE, L.LCCDCL) AS NOMBRE_CLIENTE,
        L.LCCDRF AS PRODUCTO,
        COALESCE(ART.DESCRIPCIONARTICULO, L.LCCDRF) AS NOMBRE_PRODUCTO,
        L.LCIMVT AS VENTAS,
        L.LCCTUD AS CANTIDAD
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(L.LCCDCL)
      LEFT JOIN DSEDAC.ART ART ON TRIM(ART.CODIGOARTICULO) = TRIM(L.LCCDRF)
      WHERE ${vendorFilter}
        AND ${salesFilter}
        AND L.${vendorColumn} IS NOT NULL
      ORDER BY L.LCAADC DESC, L.LCMMDC DESC, L.LCDDDC DESC
      FETCH FIRST ? ROWS ONLY
    `;

    const result = await dbPool.query<Record<string, unknown>[]>(sql, queryParams);
    await redisCache.set(cacheKey, result.data, CacheTTL.SHORT);
    res.json({ success: true, data: result.data, source: 'database' });
  } catch (error) {
    logger.error('Recent sales error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// ROUTE: GET /api/dashboard/yoy-comparison
// ============================================================

router.get('/yoy-comparison', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const cacheKey = dashboardCacheKey(user, { endpoint: 'yoy-comparison' } as Record<string, string | undefined>);

    const cached = await redisCache.get(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached, source: 'cache' });
      return;
    }

    const { condition: vendorFilter, params: vendorParams } = getVendorFilter(user);
    const vendorColumn = getVendorColumn();
    const salesFilter = getSalesFilter();

    const sql = `
      SELECT
        LCAADC AS ANIO,
        LCMMDC AS MES,
        COALESCE(SUM(LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(LCIMVT - LCIMCT), 0) AS MARGEN
      FROM DSED.LACLAE L
      WHERE ${vendorFilter}
        AND ${salesFilter}
        AND L.${vendorColumn} IS NOT NULL
        AND LCAADC >= YEAR(CURRENT DATE) - 1
      GROUP BY LCAADC, LCMMDC
      ORDER BY ANIO, MES
    `;

    const result = await dbPool.query<Record<string, unknown>[]>(sql, vendorParams);
    await redisCache.set(cacheKey, result.data, CacheTTL.MEDIUM);
    res.json({ success: true, data: result.data, source: 'database' });
  } catch (error) {
    logger.error('YoY comparison error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// ROUTE: GET /api/dashboard/hierarchy-data
// ============================================================

router.get('/hierarchy-data', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { year } = getDateComponents(req.query as Record<string, string | undefined>);
    const cacheKey = dashboardCacheKey(user, { ...req.query, endpoint: 'hierarchy-data' } as Record<string, string | undefined>);

    const cached = await redisCache.get(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached, source: 'cache' });
      return;
    }

    const { condition: vendorFilter, params: vendorParams } = getVendorFilter(user);
    const vendorColumn = getVendorColumn();
    const salesFilter = getSalesFilter();

    const yearFilter = year ? `AND L.LCAADC = ?` : '';
    const queryParams = [...vendorParams];
    if (year) queryParams.push(year);

    const sql = `
      SELECT
        L.${vendorColumn} AS VENDEDOR,
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) AS MARGEN,
        COUNT(DISTINCT L.LCSRAB || L.LCNRAB) AS PEDIDOS,
        COUNT(DISTINCT L.LCCDCL) AS CLIENTES
      FROM DSED.LACLAE L
      WHERE ${vendorFilter}
        AND ${salesFilter}
        AND L.${vendorColumn} IS NOT NULL
        ${yearFilter}
      GROUP BY L.${vendorColumn}
      ORDER BY VENTAS DESC
    `;

    const result = await dbPool.query<Record<string, unknown>[]>(sql, queryParams);
    await redisCache.set(cacheKey, result.data, CacheTTL.MEDIUM);
    res.json({ success: true, data: result.data, source: 'database' });
  } catch (error) {
    logger.error('Hierarchy data error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// HELPER FUNCTIONS (from utils/common.js, inlined for TS purity)
// ============================================================

/**
 * Determine vendor column based on date.
 * Before Oct 2024: LCCDVD
 * After Oct 2024: R1_T8CDVD
 */
function getVendorColumn(): string {
  const transitionDate = new Date('2024-10-01');
  return new Date() >= transitionDate ? 'R1_T8CDVD' : 'LCCDVD';
}

/**
 * Sales filter for LACLAE table
 * Verified against utils/common.js LACLAE_SALES_FILTER
 */
function getSalesFilter(): string {
  return "L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC') AND L.LCCLLN IN ('AB', 'VT') AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')";
}

/**
 * Get role-specific cache TTL
 */
function getRoleTTL(role: string): number {
  switch (role.toUpperCase()) {
    case 'JEFE_VENTAS':
    case 'JEFE':
      return CacheTTL.JEFE_VENTAS;
    case 'COMERCIAL':
      return CacheTTL.COMERCIAL;
    case 'REPARTIDOR':
      return CacheTTL.REPARTIDOR;
    default:
      return CacheTTL.SHORT;
  }
}

export { router as dashboardRoutes };
