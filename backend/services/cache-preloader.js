/**
 * CACHE PRE-WARMER (v2 - Direct Query)
 * =====================================
 * Warms up caches by executing queries DIRECTLY against DB2.
 * v1 failed because HTTP calls to own API hit auth middleware → 401 on every warmup.
 * 
 * Strategy:
 *  1. LACLAE cache (memory) — loaded synchronously on startup
 *  2. Dashboard metrics/evolution — query DB2 directly, populate cachedQuery L1/L2
 *  3. Commissions/Objectives ALL — too complex for pre-warm, rely on route-level Redis
 */
const { loadLaclaeCache } = require('./laclae');
const logger = require('../middleware/logger');
const { getCurrentDate, LACLAE_SALES_FILTER } = require('../utils/common');
const { cachedQuery } = require('./query-optimizer');
const { query } = require('../config/db');
const { TTL } = require('./redis-cache');

/**
 * Pre-warm dashboard queries that ALL users will need on first load.
 * Executes SQL directly (no HTTP, no auth) and populates the query cache.
 */
async function warmUpDashboardQueries() {
    const now = getCurrentDate();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const today = now.getDate();

    logger.info('🔥 Pre-warming dashboard cache (direct DB queries)...');
    const start = Date.now();

    try {
        // 1. Current month metrics (most requested by every user)
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

        // 3. Today's live data
        const todaySQL = `
            SELECT COALESCE(SUM(L.LCIMVT), 0) as sales, COUNT(DISTINCT L.LCNRAB) as orders
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ${year} AND L.LCMMDC = ${month} AND L.LCDDDC = ${today} AND ${LACLAE_SALES_FILTER}
        `;

        // 4. Sales evolution (last 2 years, monthly granularity)
        const evolutionSQL = `
            SELECT L.LCAADC as year, L.LCMMDC as month,
                   SUM(L.LCIMVT) as totalSales,
                   COUNT(DISTINCT L.LCNRAB) as totalOrders,
                   COUNT(DISTINCT L.LCCDCL) as uniqueClients
            FROM DSED.LACLAE L
            WHERE ${LACLAE_SALES_FILTER} AND L.LCAADC IN (${year}, ${year - 1})
            GROUP BY L.LCAADC, L.LCMMDC ORDER BY L.LCAADC, L.LCMMDC
        `;

        // NOTE: cache keys must match what the dashboard routes generate
        // Dashboard metrics uses: `dashboard:metrics:${year}:${month}:${vendedorCodes}`
        // When vendedorCodes is ALL → vendedorFilter is empty, so no codes in key
        const baseKey = `dashboard:metrics:${year}:${month}:`;

        // Execute ALL in parallel — biggest speedup for first user
        const results = await Promise.allSettled([
            cachedQuery(query, currentMetricsSQL, `${baseKey}:curr`, TTL.SHORT),
            cachedQuery(query, prevMetricsSQL, `${baseKey}:prev`, TTL.LONG),
            cachedQuery(query, todaySQL, `${baseKey}:today`, TTL.SHORT),
            cachedQuery(query, evolutionSQL, `dashboard:evolution:undefined:month:false::monthly`, TTL.MEDIUM),
        ]);

        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        const elapsed = Date.now() - start;
        logger.info(`🔥 Dashboard cache warmed in ${elapsed}ms (${succeeded}/4 queries OK)`);

    } catch (e) {
        logger.error(`❌ Dashboard warmup failed: ${e.message}`);
    }
}

async function preloadCache(port = 3000) {
    logger.info('🚀 Starting System Preload...');

    try {
        // 1. Critical: Load LACLAE Memory Cache (blocking — Rutero depends on it)
        await loadLaclaeCache();

        // 2. Background: Warm up dashboard DB queries (non-blocking, 2s delay)
        setTimeout(() => {
            warmUpDashboardQueries().catch(e => logger.warn(`Warmup error: ${e.message}`));
        }, 2000);

    } catch (e) {
        logger.error(`Fatal Preload Error: ${e.message}`);
    }
}

module.exports = { preloadCache };
