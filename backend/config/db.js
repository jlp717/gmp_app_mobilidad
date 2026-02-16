const odbc = require('odbc');
const dotenv = require('dotenv');
const logger = require('../middleware/logger');

dotenv.config();

// Build connection string from environment variables
const DB_UID = process.env.ODBC_UID || 'JAVIER';
const DB_PWD = process.env.ODBC_PWD || 'JAVIER';
const DB_DSN = process.env.ODBC_DSN || 'GMP';
const DB_CONFIG = `DSN=${DB_DSN};UID=${DB_UID};PWD=${DB_PWD};NAM=1;`;

let dbPool = null;
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE_MS = 500;   // Exponential: 500ms, 1000ms, 2000ms
let poolRecreateInProgress = false; // Prevent concurrent pool recreation
let keepaliveInterval = null;       // Keepalive timer

async function initDb() {
    try {
        dbPool = await odbc.pool(DB_CONFIG);
        logger.info('✅ Database connection pool initialized');
        startKeepalive();
        return dbPool;
    } catch (error) {
        logger.error(`❌ Database connection failed during init: ${error.message}`);
    }
}

/**
 * Recreate the connection pool when stale connections are detected.
 * Error 10054 (TCP reset) / 08S01 (communication link failure) indicate
 * the AS400 dropped idle connections - the entire pool is poisoned.
 */
async function recreatePool() {
    if (poolRecreateInProgress) {
        // Wait for ongoing recreation to finish
        await new Promise(res => setTimeout(res, 2000));
        return;
    }
    poolRecreateInProgress = true;
    try {
        logger.warn('🔄 Recreating database pool (stale connections detected)...');
        const oldPool = dbPool;
        dbPool = null;
        stopKeepalive();

        // Try to close old pool gracefully (don't block on failure)
        if (oldPool) {
            try { await oldPool.close(); } catch (e) { /* ignore */ }
        }

        // Small delay to let AS400 clean up
        await new Promise(res => setTimeout(res, 500));

        dbPool = await odbc.pool(DB_CONFIG);
        logger.info('✅ Database pool recreated successfully');
        startKeepalive();
    } catch (error) {
        logger.error(`❌ Pool recreation failed: ${error.message}`);
        dbPool = null;
    } finally {
        poolRecreateInProgress = false;
    }
}

/**
 * Detect if an error is a connection/network error (stale connection).
 * These errors mean the TCP connection to the AS400 was dropped.
 */
function isConnectionError(error) {
    const msg = (error.message || '').toLowerCase();
    const odbcCodes = (error.odbcErrors || []).map(e => e.code);
    const odbcStates = (error.odbcErrors || []).map(e => e.state);

    return msg.includes('communication link failure') ||
           msg.includes('so close') ||
           msg.includes('connection') ||
           odbcCodes.includes(10054) ||   // TCP reset by remote
           odbcCodes.includes(10053) ||   // Software caused connection abort
           odbcStates.includes('08S01') || // Communication link failure
           odbcStates.includes('08003') || // Connection not open
           odbcStates.includes('HY000');   // General ODBC error (often stale conn)
}

/**
 * Keepalive: ping the DB every 2 minutes to prevent AS400 from
 * dropping idle connections. Lightweight query on SYSIBM.SYSDUMMY1.
 */
function startKeepalive() {
    stopKeepalive();
    keepaliveInterval = setInterval(async () => {
        if (!dbPool) return;
        let conn = null;
        try {
            conn = await dbPool.connect();
            await conn.query('SELECT 1 FROM SYSIBM.SYSDUMMY1');
        } catch (e) {
            logger.debug(`[KEEPALIVE] Ping failed: ${e.message}`);
        } finally {
            if (conn) try { await conn.close(); } catch (_) { }
        }
    }, 2 * 60 * 1000); // 2 minutes
}

function stopKeepalive() {
    if (keepaliveInterval) {
        clearInterval(keepaliveInterval);
        keepaliveInterval = null;
    }
}

/**
 * Execute a query with retry logic, exponential backoff, and pool recreation.
 */
async function query(sql, logQuery = true, logError = true) {
    if (!dbPool) {
        await initDb();
        if (!dbPool) throw new Error('Database pool not initialized and failed to re-init');
    }

    let lastError = null;
    let connectionErrorCount = 0;

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
            const connError = isConnectionError(error);

            if (connError) {
                connectionErrorCount++;
            }

            if (logError && attempt === MAX_RETRIES) {
                const odbcDetails = error.odbcErrors ? JSON.stringify(error.odbcErrors) : '';
                logger.error(`❌ Query Error (Final Attempt): ${error.message} ${odbcDetails}\n  SQL: ${sql ? sql.replace(/\s+/g, ' ').substring(0, 200) : 'N/A'}`);
            } else if (logError) {
                logger.warn(`⚠️ Query Failed (Attempt ${attempt}/${MAX_RETRIES}): ${error.message}. Retrying...`);
            }

            if (!connError && !error.message.includes('odbc')) {
                // Syntax or logic error — don't retry
                break;
            }

            // If 2+ connection errors in a row, recreate the pool before next retry
            if (connectionErrorCount >= 2 && attempt < MAX_RETRIES) {
                await recreatePool();
            }

            // Exponential backoff: 500ms, 1000ms, 2000ms
            const delay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt - 1);
            await new Promise(res => setTimeout(res, delay));

        } finally {
            if (conn) {
                try {
                    await conn.close();
                } catch (closeError) {
                    // Ignore close errors on stale connections
                }
            }
        }
    }

    // If ALL retries failed with connection errors, schedule pool recreation
    // for the next request (don't block this one further)
    if (connectionErrorCount >= MAX_RETRIES) {
        recreatePool().catch(() => {}); // fire-and-forget
    }

    throw lastError;
}

/**
 * Execute a parameterized query with retry logic and pool recovery.
 */
async function queryWithParams(sql, params = [], logQuery = true, logError = true) {
    if (!dbPool) {
        await initDb();
        if (!dbPool) throw new Error('Database pool not initialized');
    }

    let lastError = null;
    let connectionErrorCount = 0;

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
            const connError = isConnectionError(error);

            if (connError) {
                connectionErrorCount++;
            }

            if (logError && attempt === MAX_RETRIES) {
                logger.error(`❌ Param Query Error (Final): ${error.message}`);
            } else if (logError) {
                logger.warn(`⚠️ Param Query Retry (${attempt}): ${error.message}`);
            }

            if (!connError && !error.message.includes('odbc')) break;

            if (connectionErrorCount >= 2 && attempt < MAX_RETRIES) {
                await recreatePool();
            }

            const delay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt - 1);
            await new Promise(res => setTimeout(res, delay));

        } finally {
            if (conn) {
                try {
                    await conn.close();
                } catch (e) { /* ignore */ }
            }
        }
    }

    if (connectionErrorCount >= MAX_RETRIES) {
        recreatePool().catch(() => {});
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
