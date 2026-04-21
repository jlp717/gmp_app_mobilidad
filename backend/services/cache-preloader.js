/**
 * CACHE PRE-WARMER (v2 - Direct Query)
 * =====================================
 * Warms up caches by executing queries DIRECTLY against DB2.
 * v1 failed because HTTP calls to own API hit auth middleware → 401 on every warmup.
 * 
 * Strategy:
 *  1. LACLAE cache (memory) — loaded synchronously on startup
 *  2. Dashboard metrics/evolution — query DB2 directly, populate cachedQuery L1/L2
 *  3. Clients list ALL — query DB2 directly, populate cachedQuery for JEFE_VENTAS
 *  4. Commissions/Objectives ALL — too complex for pre-warm, rely on route-level Redis
 */
const { loadLaclaeCache } = require('./laclae');
const logger = require('../middleware/logger');
const { getCurrentDate, LACLAE_SALES_FILTER, MIN_YEAR } = require('../utils/common');
const { cachedQuery } = require('./query-optimizer');
const { query } = require('../config/db');
const { TTL } = require('./redis-cache');

/**
 * Pre-warm dashboard queries that ALL users will need on first load.
 * Executes SQL directly (no HTTP, no auth) and populates the query cache.
 * OPTIMIZED v2: Aggressive warming for JEFE_VENTAS (ALL vendors)
 */
async function warmUpDashboardQueries() {
    const now = getCurrentDate();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const today = now.getDate();

    logger.info('🔥 Pre-warming dashboard cache (direct DB queries)...');
    const start = Date.now();

    try {
        // OPTIMIZATION: Use LONGER TTLs for ALL vendor queries (JEFE_VENTAS)
        const allVendorTTL = 1800; // 30 minutes for ALL
        const prevTTL = 86400; // 24 hours for prev year (static)
        const todayTTL = 300; // 5 minutes for today

        // 1. Current month metrics - ALL vendors (JEFE_VENTAS default)
        const currentMetricsSQL = `
            SELECT COALESCE(SUM(L.LCIMVT), 0) as sales,
                   COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) as margin,
                   COALESCE(SUM(L.LCCTEV), 0) as boxes,
                   COUNT(DISTINCT L.LCCDCL) as activeClients
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ${year} AND L.LCMMDC = ${month} AND ${LACLAE_SALES_FILTER}
        `;

        // 2. Previous year same month (static data, long cache)
        const prevMetricsSQL = `
            SELECT COALESCE(SUM(L.LCIMVT), 0) as sales,
                   COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) as margin,
                   COALESCE(SUM(L.LCCTEV), 0) as boxes
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ${year - 1} AND L.LCMMDC = ${month} AND ${LACLAE_SALES_FILTER}
        `;

        // 3. Today's live data (real-time, short cache)
        const todaySQL = `
            SELECT COALESCE(SUM(L.LCIMVT), 0) as sales, COUNT(DISTINCT L.LCNRAB) as orders
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ${year} AND L.LCMMDC = ${month} AND L.LCDDDC = ${today} AND ${LACLAE_SALES_FILTER}
        `;

        // 4. Sales evolution (last 2 years, monthly granularity) - P5: LIMIT to 36 rows
        const evolutionSQL = `
            SELECT L.LCAADC as year, L.LCMMDC as month,
                   SUM(L.LCIMVT) as totalSales,
                   COUNT(DISTINCT L.LCNRAB) as totalOrders,
                   COUNT(DISTINCT L.LCCDCL) as uniqueClients
            FROM DSED.LACLAE L
            WHERE ${LACLAE_SALES_FILTER} AND L.LCAADC IN (${year}, ${year - 1})
            GROUP BY L.LCAADC, L.LCMMDC ORDER BY L.LCAADC, L.LCMMDC
            FETCH FIRST 36 ROWS ONLY
        `;

        // 5. RECENT SALES for ALL vendors (JEFE_VENTAS quick view)
        const recentSalesSQL = `
            SELECT L.ANODOCUMENTO as year, L.MESDOCUMENTO as month, L.DIADOCUMENTO as day,
                   L.CODIGOCLIENTEALBARAN as clientCode,
                   C.NOMBRECLIENTE as clientName, L.CODIGOVENDEDOR as vendedorCode,
                   L.SERIEDOCUMENTO as docType,
                   SUM(L.IMPORTEVENTA) as totalEuros,
                   SUM(L.CANTIDADENVASES) as totalBoxes,
                   SUM(L.IMPORTEMARGENREAL) as totalMargin,
                   COUNT(*) as numLines
            FROM DSEDAC.LINDTO L
            LEFT JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
            WHERE L.ANODOCUMENTO >= ${MIN_YEAR}
            GROUP BY L.ANODOCUMENTO, L.MESDOCUMENTO, L.DIADOCUMENTO,
              L.CODIGOCLIENTEALBARAN, C.NOMBRECLIENTE, L.CODIGOVENDEDOR, L.SERIEDOCUMENTO
            ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC
            FETCH FIRST 20 ROWS ONLY
        `;

        // NOTE: cache keys must match what the dashboard routes generate
        // Dashboard metrics uses: `dashboard:metrics:${year}:${month}:${vendedorCodes}`
        // When vendedorCodes is ALL → vendedorFilter is empty, so no codes in key
        const baseKey = `dashboard:metrics:${year}:${month}:`;

        // Execute ALL in parallel — biggest speedup for first user
        const results = await Promise.allSettled([
            cachedQuery(query, currentMetricsSQL, `${baseKey}ALL:curr`, allVendorTTL),
            cachedQuery(query, prevMetricsSQL, `${baseKey}ALL:prev`, prevTTL),
            cachedQuery(query, todaySQL, `${baseKey}ALL:today`, todayTTL),
            cachedQuery(query, evolutionSQL, `dashboard:evolution:default:month:false:ALL:monthly`, allVendorTTL),
            cachedQuery(query, recentSalesSQL, `dashboard:recent_sales:ALL:20`, allVendorTTL),
        ]);

        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        const elapsed = Date.now() - start;
        logger.info(`🔥 Dashboard cache warmed in ${elapsed}ms (${succeeded}/5 queries OK)`);

    } catch (e) {
        logger.error(`❌ Dashboard warmup failed: ${e.message}`);
    }
}

async function warmUpClientsAll() {
    try {
        // Pre-warm clients list for ALL vendors (JEFE_VENTAS default view)
        const { query } = require('../config/db');
        const logger = require('../middleware/logger');

        const clientsSQL = `
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
                SELECT
                    LCCDCL as CLIENT_CODE,
                    SUM(LCIMVT) as TOTAL_PURCHASES,
                    SUM(LCIMVT - LCIMCT) as TOTAL_MARGIN,
                    COUNT(DISTINCT LCAADC || LCMMDC || LCDDDC) as NUM_ORDERS,
                    MAX(LCAADC * 10000 + LCMMDC * 100 + LCDDDC) as LAST_PURCHASE_DATE
                FROM DSED.LACLAE
                WHERE LCAADC >= ${MIN_YEAR}
                    AND TPDC = 'LAC'
                    AND LCTPVT IN ('CC', 'VC')
                    AND LCCLLN IN ('AB', 'VT')
                    AND LCSRAB NOT IN ('N', 'Z')
                GROUP BY LCCDCL
            ) S ON C.CODIGOCLIENTE = S.CLIENT_CODE
            LEFT JOIN LATERAL (
                SELECT LCCDVD as LAST_VENDOR
                FROM DSED.LACLAE
                WHERE LCCDCL = C.CODIGOCLIENTE
                    AND LCAADC >= ${MIN_YEAR}
                    AND TPDC = 'LAC'
                    AND LCTPVT IN ('CC', 'VC')
                    AND LCCLLN IN ('AB', 'VT')
                    AND LCSRAB NOT IN ('N', 'Z')
                ORDER BY LCAADC DESC, LCMMDC DESC, LCDDDC DESC
                FETCH FIRST 1 ROWS ONLY
            ) LV ON 1=1
            LEFT JOIN DSEDAC.VDD V ON LV.LAST_VENDOR = V.CODIGOVENDEDOR
            WHERE C.ANOBAJA = 0 AND LV.LAST_VENDOR IS NOT NULL
            ORDER BY COALESCE(S.TOTAL_PURCHASES, 0) DESC
            FETCH FIRST 1000 ROWS ONLY
        `;

        // Use LONG TTL since this is expensive and rarely changes
        const clientsTTL = 3600; // 1 hour for clients list

        await cachedQuery(query, clientsSQL, `clients:list:v5:ALL:none:1000:0`, clientsTTL);
        logger.info(`[CachePreWarmer] Clients ALL list warmed (1hr TTL)`);

    } catch (e) {
        logger.warn(`[CachePreWarmer] Clients pre-warm error (non-fatal): ${e.message}`);
    }
}

async function warmUpCommissionsAll() {
    try {
        const { redisCache, TTL } = require('./redis-cache');
        const logger = require('../middleware/logger');

        const currentYear = new Date().getFullYear();
        const allCacheKey = `comm:summary:ALL:${currentYear}`;
        const existing = await redisCache.get('route', allCacheKey);
        if (existing) {
            logger.info(`[CachePreWarmer] Commissions ALL already cached, skipping`);
            return;
        }

        // Do not discover vendors here. That DB2 DISTINCT scan was taking 7s+
        // at startup and it did not actually populate the commissions cache.
        logger.info(`[CachePreWarmer] Commissions ALL warmup skipped; first real request will cache for ${TTL.MEDIUM}s`);
    } catch (e) {
        logger.warn(`[CachePreWarmer] Commissions pre-warm error (non-fatal): ${e.message}`);
    }
}

async function preloadCache(port = 3000) {
    logger.info('🚀 Starting System Preload...');

    try {
        // 0. Invalidate stale Redis query caches from previous session
        try {
            const { deleteCachePattern } = require('./redis-cache');
            await deleteCachePattern('clients:*');
            await deleteCachePattern('rutero:*');
            logger.info('🧹 Stale Redis query caches invalidated on startup');
        } catch (redisErr) {
            logger.warn(`Redis invalidation on startup failed (non-blocking): ${redisErr.message}`);
        }

        // 1. Critical: Load LACLAE Memory Cache (blocking — Rutero depends on it)
        await loadLaclaeCache();

        // 2. Background: Warm up dashboard DB queries (non-blocking, 2s delay)
        setTimeout(() => {
            warmUpDashboardQueries().catch(e => logger.warn(`Warmup error: ${e.message}`));
        }, 2000);

        // 3. Background: Warm up clients list ALL (JEFE_VENTAS, 3s delay)
        setTimeout(() => {
            warmUpClientsAll().catch(e => logger.warn(`Clients warmup error: ${e.message}`));
        }, 3000);

        // 4. Background: Pre-warm commissions ALL (non-blocking, 5s delay, runs only if needed)
        setTimeout(() => {
            warmUpCommissionsAll().catch(e => logger.warn(`Commissions warmup error: ${e.message}`));
        }, 5000);

    } catch (e) {
        logger.error(`Fatal Preload Error: ${e.message}`);
    }
}

module.exports = { preloadCache };
