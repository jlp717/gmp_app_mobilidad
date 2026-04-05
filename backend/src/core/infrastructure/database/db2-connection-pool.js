/**
 * DB2 Connection Pool Manager
 * Wraps the legacy db.js with a cleaner interface for DDD modules
 */
const { query, queryWithParams, getPool, initDb } = require('../../../../config/db');
const odbc = require('odbc');
const logger = require('../../../../middleware/logger');

class Db2ConnectionPool {
  constructor() {
    this._initialized = false;
  }

  async initialize() {
    if (!this._initialized) {
      await initDb();
      this._initialized = true;
    }
    return this;
  }

  async execute(sql) {
    return query(sql, true, true);
  }

  async executeParams(sql, params) {
    return queryWithParams(sql, params, true, true);
  }

  async executeSilent(sql) {
    return query(sql, false, false);
  }

  async executeParamsSilent(sql, params) {
    return queryWithParams(sql, params, false, false);
  }

  /**
   * Execute multiple SQL statements within a single transaction.
   * If any statement fails, all changes are rolled back.
   * @param {Function} callback - Async function receiving a transaction connection
   * @returns {Promise<any>} Result from the callback
   */
  async transaction(callback) {
    const pool = getPool();
    if (!pool) {
      await initDb();
      const newPool = getPool();
      if (!newPool) throw new Error('Database pool not initialized');
    }

    const conn = await (getPool() || await initDb() && getPool()).connect();
    try {
      await conn.query('BEGIN WORK');
      const result = await callback(conn);
      await conn.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await conn.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error(`[TX] Rollback failed: ${rollbackErr.message}`);
      }
      throw err;
    } finally {
      try { await conn.close(); } catch (_) { }
    }
  }

  /**
   * Direct connection access for transactional operations.
   * Caller is responsible for closing the connection.
   */
  async getConnection() {
    const pool = getPool();
    if (!pool) {
      await initDb();
    }
    return getPool().connect();
  }

  getPool() {
    return getPool();
  }

  isInitialized() {
    return this._initialized;
  }
}

module.exports = { Db2ConnectionPool };
