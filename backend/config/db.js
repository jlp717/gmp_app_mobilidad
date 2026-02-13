const odbc = require('odbc');
const dotenv = require('dotenv');
const logger = require('../middleware/logger');

dotenv.config();

// Build connection string from environment variables
const DB_UID = process.env.ODBC_UID || 'JAVIER';
const DB_PWD = process.env.ODBC_PWD || 'JAVIER';
const DB_DSN = process.env.ODBC_DSN || 'GMP';
// Add connection timeout and other stability parameters if supported by driver
const DB_CONFIG = `DSN=${DB_DSN};UID=${DB_UID};PWD=${DB_PWD};NAM=1;`;

let dbPool = null;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

async function initDb() {
    try {
        // Use simple string config which is more reliable with older odbc versions
        dbPool = await odbc.pool(DB_CONFIG);
        logger.info('✅ Database connection pool initialized (Simple Mode)');
        return dbPool;
    } catch (error) {
        logger.error(`❌ Database connection failed during init: ${error.message}`);
        // Do not exit process, allow retry later
        // process.exit(1);
    }
}

/**
 * Execute a query with retry logic and connection management
 */
async function query(sql, logQuery = true, logError = true) {
    if (!dbPool) {
        // Try to re-init if pool is missing
        await initDb();
        if (!dbPool) throw new Error('Database pool not initialized and failed to re-init');
    }

    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        let conn = null;
        try {
            conn = await dbPool.connect();

            const start = Date.now();
            const result = await conn.query(sql);
            const duration = Date.now() - start;

            if (logQuery) {
                const preview = sql.replace(/\s+/g, ' ').substring(0, 100);
                logger.info(`📊 Query (${duration}ms): ${preview}... → ${result.length} rows`);
            }

            return result;

        } catch (error) {
            lastError = error;
            const isConnectionError = error.message.includes('Communication link failure') ||
                error.message.includes('so close') ||
                error.message.includes('SYSDUMMY1');

            if (logError && attempt === MAX_RETRIES) {
                const odbcDetails = error.odbcErrors ? JSON.stringify(error.odbcErrors) : '';
                logger.error(`❌ Query Error (Final Attempt): ${error.message} ${odbcDetails}\nSQL: ${sql ? sql.replace(/\s+/g, ' ').substring(0, 200) : 'N/A'}`);
            } else if (logError) {
                logger.warn(`⚠️ Query Failed (Attempt ${attempt}/${MAX_RETRIES}): ${error.message}. Retrying...`);
            }

            if (!isConnectionError && !error.message.includes('odbc')) {
                // If it's a syntax error, don't retry
                break;
            }

            // Wait before retry
            await new Promise(res => setTimeout(res, RETRY_DELAY_MS));

        } finally {
            if (conn) {
                try {
                    await conn.close();
                } catch (closeError) {
                    logger.warn(`⚠️ Error closing connection: ${closeError.message}`);
                }
            }
        }
    }

    throw lastError;
}

/**
 * Execute a parameterized query with retry logic
 */
async function queryWithParams(sql, params = [], logQuery = true, logError = true) {
    if (!dbPool) {
        await initDb();
        if (!dbPool) throw new Error('Database pool not initialized');
    }

    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        let conn = null;
        try {
            conn = await dbPool.connect();

            const start = Date.now();
            const result = await conn.query(sql, params);
            const duration = Date.now() - start;

            if (logQuery) {
                const preview = sql.replace(/\s+/g, ' ').substring(0, 80);
                logger.info(`📊 Param Query (${duration}ms): ${preview}... → ${result.length} rows`);
            }

            return result;

        } catch (error) {
            lastError = error;

            if (logError && attempt === MAX_RETRIES) {
                logger.error(`❌ Param Query Error (Final): ${error.message}`);
            } else {
                logger.warn(`⚠️ Param Query Retry (${attempt}): ${error.message}`);
            }

            if (!error.message.includes('odbc')) break; // Don't retry logic errors

            await new Promise(res => setTimeout(res, RETRY_DELAY_MS));

        } finally {
            if (conn) {
                try {
                    await conn.close();
                } catch (e) { /* ignore close errors */ }
            }
        }
    }

    throw lastError;
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
