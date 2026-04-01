/**
 * DB2 Connection Pool Manager
 * Wraps the legacy db.js with a cleaner interface for DDD modules
 */
const { query, queryWithParams, getPool, initDb } = require('../../../config/db');

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

  getPool() {
    return getPool();
  }

  isInitialized() {
    return this._initialized;
  }
}

module.exports = { Db2ConnectionPool };
