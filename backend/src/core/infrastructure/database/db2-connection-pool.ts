/**
 * DB2 Connection Pool - Production Grade v4.0.0
 * 
 * Wraps the legacy config/db.js pool with a clean TypeScript interface.
 * All queries are parameterized — no string concatenation.
 * 
 * @agent DB2 Optimizer - Parameterized queries only, no SQL injection
 */

import { QueryResult } from '../../types/db.types';

// Import legacy pool (will be fully migrated in next phase)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { initDb, query: legacyQuery, queryWithParams: legacyQueryWithParams, getPool } = require('../../../config/db');

export class Db2ConnectionPool {
  private _initialized = false;

  async initialize(): Promise<void> {
    if (!this._initialized) {
      await initDb();
      this._initialized = true;
    }
  }

  /**
   * Execute a parameterized query
   */
  async query<T = Record<string, unknown>[]>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const startTime = Date.now();
    
    let data: T;
    
    if (params.length > 0) {
      data = await legacyQueryWithParams(sql, params, true, true) as unknown as T;
    } else {
      data = await legacyQuery(sql, true, true) as unknown as T;
    }

    const executionTime = Date.now() - startTime;
    const rowCount = Array.isArray(data) ? data.length : 0;

    // Log slow queries
    if (executionTime > 500) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { logger } = require('../../utils/logger');
      logger.warn(`⚠️ Slow query (${executionTime}ms): ${sql.substring(0, 150)}...`);
    }

    return { data, rowCount, executionTime };
  }

  /**
   * Execute without logging errors (silent mode)
   */
  async querySilent<T = Record<string, unknown>[]>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const startTime = Date.now();
    
    let data: T;
    
    if (params.length > 0) {
      data = await legacyQueryWithParams(sql, params, false, false) as unknown as T;
    } else {
      data = await legacyQuery(sql, false, false) as unknown as T;
    }

    return { data, rowCount: Array.isArray(data) ? data.length : 0, executionTime: Date.now() - startTime };
  }

  /**
   * Execute in a transaction
   */
  async transaction<T = unknown>(callback: (conn: unknown) => Promise<T>): Promise<T> {
    const pool = getPool();
    if (!pool) {
      await initDb();
    }

    const conn = await getPool().connect();
    try {
      await conn.query('BEGIN WORK');
      const result = await callback(conn);
      await conn.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await conn.query('ROLLBACK');
      } catch {
        // Rollback failed — log but throw original error
      }
      throw err;
    } finally {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }

  /**
   * Get raw connection for advanced operations
   */
  async getConnection(): Promise<unknown> {
    if (!getPool()) {
      await initDb();
    }
    return getPool().connect();
  }

  async ping(): Promise<boolean> {
    try {
      await this.query('SELECT 1 AS OK FROM SYSIBM.SYSDUMMY1');
      return true;
    } catch {
      return false;
    }
  }

  get isConnected(): boolean {
    return this._initialized && getPool() !== null;
  }

  async close(): Promise<void> {
    // Legacy pool manages its own lifecycle
    this._initialized = false;
  }
}

// Singleton
export const dbPool = new Db2ConnectionPool();
