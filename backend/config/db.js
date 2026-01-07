const odbc = require('odbc');
const dotenv = require('dotenv');
const logger = require('../middleware/logger');

dotenv.config();

// Build connection string from environment variables (fallback to defaults for development)
const DB_UID = process.env.ODBC_UID || 'JAVIER';
const DB_PWD = process.env.ODBC_PWD || 'JAVIER';
const DB_DSN = process.env.ODBC_DSN || 'GMP';
const DB_CONFIG = `DSN=${DB_DSN};UID=${DB_UID};PWD=${DB_PWD};NAM=1;`;

let dbPool = null;

async function initDb() {
    try {
        dbPool = await odbc.pool(DB_CONFIG);
        logger.info('✅ Database connection pool initialized');
        return dbPool;
    } catch (error) {
        logger.error(`❌ Database connection failed: ${error.message}`);
        process.exit(1);
    }
}

async function query(sql, logQuery = true, logError = true) {
    if (!dbPool) throw new Error('Database pool not initialized');

    const start = Date.now();
    const conn = await dbPool.connect();
    try {
        const result = await conn.query(sql);
        const duration = Date.now() - start;
        if (logQuery) {
            const preview = sql.replace(/\s+/g, ' ').substring(0, 100);
            logger.info(`📊 Query (${duration}ms): ${preview}... → ${result.length} rows`);
        }
        return result;
    } catch (error) {
        if (logError) {
            logger.error(`❌ Query Error: ${error.message} \nSQL: ${sql ? sql.substring(0, 50) : 'N/A'}`);
        }
        throw error;
    } finally {
        await conn.close();
    }
}

/**
 * Execute a parameterized query to prevent SQL injection
 * Uses ODBC parameterized queries with ? placeholders
 * The node-odbc library supports parameterized queries via conn.query(sql, params)
 * @param {string} sql - SQL query with ? placeholders
 * @param {Array} params - Array of parameter values in order
 * @param {boolean} logQuery - Whether to log the query (false for sensitive queries)
 * @param {boolean} logError - Whether to log errors (default true)
 * @returns {Promise<Array>} Query results
 */
async function queryWithParams(sql, params = [], logQuery = true, logError = true) {
    if (!dbPool) throw new Error('Database pool not initialized');

    const start = Date.now();
    const conn = await dbPool.connect();
    try {
        // node-odbc supports parameterized queries directly via query(sql, params)
        const result = await conn.query(sql, params);

        const duration = Date.now() - start;
        if (logQuery) {
            const preview = sql.replace(/\s+/g, ' ').substring(0, 80);
            logger.info(`📊 Parameterized Query (${duration}ms): ${preview}... → ${result.length} rows`);
        }
        return result;
    } catch (error) {
        if (logError) {
            logger.error(`❌ Parameterized Query Error: ${error.message}`);
        }
        throw error;
    } finally {
        await conn.close();
    }
}

function getPool() {
    return dbPool;
}

module.exports = {
    initDb,
    query,
    queryWithParams,
    getPool
};
