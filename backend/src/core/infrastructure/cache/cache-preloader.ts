/**
 * Cache Preloader - Production Grade v4.0.0
 * 
 * Pre-warms critical caches on server startup.
 * 
 * ALL table names and column names verified against actual DB2 schema.
 * 
 * Schema reference:
 * - DSED.LACLAE = sales transactions (alias L)
 * - DSEDAC.ART = products (alias ART)  
 * - DSEDAC.CLI = clients (alias CLI)
 * - DSEDAC.VDD = vendors (alias D)
 * 
 * @agent Performance - Pre-warm eliminates cold-start latency
 */

import { Db2ConnectionPool } from '../database/db2-connection-pool';
import { RedisCacheService, CacheTTL } from './redis-cache';
import { logger } from '../../utils/logger';

export class CachePreloader {
  constructor(
    private redisCache: RedisCacheService,
    private dbPool: Db2ConnectionPool
  ) {}

  /**
   * Warm all critical caches in parallel where possible
   */
  async warmCriticalCaches(): Promise<void> {
    const warmers = [
      () => this.warmLaclaeMetadata(),
      () => this.warmVendorMappings(),
    ];

    await Promise.allSettled(warmers.map(w => w()));
    
    logger.info('✅ Critical cache pre-warming complete');
  }

  /**
   * Pre-warm LACLAE metadata (most critical table)
   * 
   * Table: DSED.LACLAE
   * Columns verified: VENDEDOR, TIPO, CLIENTE, etc.
   */
  private async warmLaclaeMetadata(): Promise<void> {
    const cacheKey = 'prewarm:laclae:metadata';
    
    try {
      const sql = `
        SELECT DISTINCT 
          L.LCCDVD AS VENDEDOR, 
          L.LCTPVT AS TIPO, 
          L.LCCDCL AS CLIENTE
        FROM DSED.LACLAE L
        WHERE L.LCCDVD IS NOT NULL
          AND L.LCTPVT IN ('FAC', 'FR')
          AND L.LCIMVT > 0
        ORDER BY L.LCCDVD, L.LCTPVT
      `;

      const result = await this.dbPool.query(sql);
      await this.redisCache.prewarm(cacheKey, result.data, CacheTTL.PREWARM);
      
      logger.info(`  ✅ LACLAE metadata cached (${result.rowCount} rows)`);
    } catch (error) {
      logger.warn(`  ⚠️ LACLAE prewarm failed (non-critical): ${error}`);
    }
  }

  /**
   * Pre-warm vendor-to-client mappings
   * 
   * Table: DSED.LACLAE
   */
  private async warmVendorMappings(): Promise<void> {
    const cacheKey = 'prewarm:vendors:mappings';
    
    try {
      const sql = `
        SELECT 
          L.LCCDVD AS VENDEDOR,
          COUNT(DISTINCT L.LCCDCL) AS CLIENTES,
          COUNT(DISTINCT L.LCTPVT) AS TIPOS
        FROM DSED.LACLAE L
        WHERE L.LCCDVD IS NOT NULL
          AND L.LCTPVT IN ('FAC', 'FR')
          AND L.LCIMVT > 0
        GROUP BY L.LCCDVD
      `;

      const result = await this.dbPool.query(sql);
      await this.redisCache.prewarm(cacheKey, result.data, CacheTTL.LONG);
      
      logger.info(`  ✅ Vendor mappings cached (${result.rowCount} vendors)`);
    } catch (error) {
      logger.warn(`  ⚠️ Vendor mappings prewarm failed (non-critical): ${error}`);
    }
  }
}
