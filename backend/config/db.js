const odbc = require('odbc');
const dotenv = require('dotenv');
const logger = require('../middleware/logger');

dotenv.config();

const NODE_ENV = process.env.NODE_ENV || 'development';

const DB_UID = process.env.ODBC_UID;
const DB_PWD = process.env.ODBC_PWD;
const DB_DSN = process.env.ODBC_DSN || 'GMP';

if (NODE_ENV === 'production' && (!DB_UID || !DB_PWD)) {
    logger.warn('[DB] ⚠️ Using default DB credentials in production');
}

const DB_UID_FINAL = DB_UID || 'JAVIER';
const DB_PWD_FINAL = DB_PWD || (NODE_ENV === 'development' ? 'JAVIER' : '');

const DB_CONFIG = `DSN=${DB_DSN};UID=${DB_UID_FINAL};PWD=${DB_PWD_FINAL};NAM=1;CCSID=1208;CMPTDM=1;
    CPOOLMAX=${parseInt(process.env.ODBC_POOL_MAX) || 20};
    CPOOLMIN=${parseInt(process.env.ODBC_POOL_MIN) || 3};
    CPTOUT=${parseInt(process.env.ODBC_TIMEOUT) || 60};
    COMMTIMEOUT=${parseInt(process.env.ODBC_COMM_TIMEOUT) || 90};
    DBQ=${DB_DSN};`;

const POOL_CONFIG = {
    min: 2,
    max: 10,
    idleTimeoutMs: 30000,
    acquireTimeoutMs: 10000
};

const pool = {
    connections: [],
    active: 0,
    min: POOL_CONFIG.min,
    max: POOL_CONFIG.max,
    idleTimeoutMs: POOL_CONFIG.idleTimeoutMs,
    acquireTimeoutMs: POOL_CONFIG.acquireTimeoutMs,
    _odbcPool: null,
    _initPromise: null,
    _closed: false,

    async _ensureMinConnections() {
        while (this.connections.length < this.min) {
            try {
                const conn = await this._odbcPool.connect();
                this.connections.push({
                    conn,
                    createdAt: Date.now(),
                    lastUsed: Date.now()
                });
                logger.debug(`[POOL] Min connection created (${this.connections.length}/${this.min})`);
            } catch (error) {
                logger.error(`[POOL] Failed to create min connection: ${error.message}`);
                break;
            }
        }
    },

    async _closeIdleConnections() {
        const now = Date.now();
        const toClose = [];
        for (let i = this.connections.length - 1; i >= 0; i--) {
            const c = this.connections[i];
            if (c.conn && now - c.lastUsed > this.idleTimeoutMs && this.connections.length > this.min) {
                toClose.push(i);
            }
        }
        for (const i of toClose) {
            try {
                await this.connections[i].conn.close();
                this.connections.splice(i, 1);
                logger.debug(`[POOL] Idle connection closed (${this.connections.length} total)`);
            } catch (e) {
                this.connections.splice(i, 1);
            }
        }
    },

    async acquire() {
        if (this._closed) throw new Error('Pool is closed');
        const start = Date.now();

        while (this.active >= this.max) {
            if (Date.now() - start > this.acquireTimeoutMs) {
                throw new Error('Pool: acquire timeout - max connections reached');
            }
            await new Promise(res => setTimeout(res, 50));
        }

        let c = this.connections.find(c => !c.inUse);
        if (!c) {
            if (this.connections.length < this.max) {
                try {
                    const conn = await this._odbcPool.connect();
                    c = { conn, createdAt: Date.now(), lastUsed: Date.now(), inUse: true };
                    this.connections.push(c);
                } catch (error) {
                    throw new Error(`Pool: failed to create connection - ${error.message}`);
                }
            } else {
                while (!c) {
                    if (Date.now() - start > this.acquireTimeoutMs) {
                        throw new Error('Pool: acquire timeout - no available connections');
                    }
                    await new Promise(res => setTimeout(res, 50));
                    c = this.connections.find(c => !c.inUse);
                }
            }
        } else {
            c.inUse = true;
            c.lastUsed = Date.now();
        }

        this.active++;
        return c.conn;
    },

    async release(conn) {
        const entry = this.connections.find(c => c.conn === conn);
        if (entry) {
            entry.inUse = false;
            entry.lastUsed = Date.now();
        }
        if (this.active > 0) this.active--;
        this._ensureMinConnections().catch(() => {});
        this._closeIdleConnections().catch(() => {});
    },

    async close() {
        this._closed = true;
        this._odbcPool = null;
        for (const entry of this.connections) {
            try { await entry.conn.close(); } catch (_) {}
        }
        this.connections = [];
        this.active = 0;
        logger.info('[POOL] All connections closed');
    },

    getMetrics() {
        return {
            active: this.active,
            idle: this.connections.filter(c => !c.inUse).length,
            total: this.connections.length,
            min: this.min,
            max: this.max,
            closed: this._closed
        };
    }
};

let dbPool = null;
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE_MS = 500;
let poolRecreateInProgress = false;
let keepaliveInterval = null;

const _utf8Connections = new WeakSet();

async function ensureUtf8(conn) {
    if (_utf8Connections.has(conn)) return;
    try {
        await conn.query("CALL QSYS.QCMDEXC('CHGJOB CCSID(1208)', 0000000018.00000)");
        logger.debug('[DB] Connection CCSID set to 1208 (UTF-8)');
    } catch (e) {
        logger.debug(`[DB] CHGJOB CCSID(1208) skipped: ${e.message}`);
    }
    _utf8Connections.add(conn);
}

async function initDb() {
    if (pool._initPromise) {
        await pool._initPromise;
        return pool._odbcPool;
    }
    pool._initPromise = (async () => {
        try {
            pool._odbcPool = await odbc.pool(DB_CONFIG);
            dbPool = pool._odbcPool;
            await pool._ensureMinConnections();
            logger.info(`✅ Connection pool initialized: min=${pool.min}, max=${pool.max}, idleTimeoutMs=${pool.idleTimeoutMs}, acquireTimeoutMs=${pool.acquireTimeoutMs}`);
            startKeepalive();
        } catch (error) {
            logger.error(`❌ Database connection failed during init: ${error.message}`);
            throw error;
        } finally {
            pool._initPromise = null;
        }
    })();
    await pool._initPromise;
    return pool._odbcPool;
}

async function recreatePool() {
    if (poolRecreateInProgress) {
        await new Promise(res => setTimeout(res, 2000));
        return;
    }
    poolRecreateInProgress = true;
    try {
        logger.warn('🔄 Recreating database pool (stale connections detected)...');
        const oldPool = dbPool;
        dbPool = null;
        stopKeepalive();

        if (oldPool) {
            try { await oldPool.close(); } catch (e) { /* ignore */ }
        }
        pool.connections = [];
        pool.active = 0;

        await new Promise(res => setTimeout(res, 500));

        pool._odbcPool = await odbc.pool(DB_CONFIG);
        dbPool = pool._odbcPool;
        await pool._ensureMinConnections();
        logger.info('✅ Database pool recreated successfully');
        startKeepalive();
    } catch (error) {
        logger.error(`❌ Pool recreation failed: ${error.message}`);
        dbPool = null;
    } finally {
        poolRecreateInProgress = false;
    }
}

function isConnectionError(error) {
    const msg = (error.message || '').toLowerCase();
    const odbcCodes = (error.odbcErrors || []).map(e => e.code);
    const odbcStates = (error.odbcErrors || []).map(e => e.state);

    return msg.includes('communication link failure') ||
        msg.includes('so close') ||
        msg.includes('connection') ||
        odbcCodes.includes(10054) ||
        odbcCodes.includes(10053) ||
        odbcStates.includes('08S01') ||
        odbcStates.includes('08003') ||
        odbcStates.includes('HY000');
}

function isSqlSyntaxError(error) {
    const odbcStates = (error.odbcErrors || []).map(e => e.state);
    const odbcCodes = (error.odbcErrors || []).map(e => e.code);

    return odbcStates.includes('42S22') ||
        odbcStates.includes('42S02') ||
        odbcStates.includes('42000') ||
        odbcCodes.includes(-205) ||
        odbcCodes.includes(-204) ||
        odbcCodes.includes(-104);
}

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
    }, 2 * 60 * 1000);
}

function stopKeepalive() {
    if (keepaliveInterval) {
        clearInterval(keepaliveInterval);
        keepaliveInterval = null;
    }
}

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
            conn = await pool.acquire();

            await ensureUtf8(conn);

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

            if (isSqlSyntaxError(error)) {
                if (logError) {
                    logger.error(`🚫 SQL syntax/schema error (no retry): state=${(error.odbcErrors || []).map(e => e.state).join(',')} code=${(error.odbcErrors || []).map(e => e.code).join(',')}\n  SQL: ${sql ? sql.replace(/\s+/g, ' ') : 'N/A'}`);
                }
                break;
            }

            if (!connError && !error.message.includes('odbc')) {
                break;
            }

            if (connectionErrorCount >= 2 && attempt < MAX_RETRIES) {
                await recreatePool();
            }

            const delay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt - 1);
            await new Promise(res => setTimeout(res, delay));

        } finally {
            if (conn) {
                try {
                    await pool.release(conn);
                    await conn.close();
                } catch (closeError) {
                    // Ignore close errors on stale connections
                }
            }
        }
    }

    if (connectionErrorCount >= MAX_RETRIES) {
        recreatePool().catch(() => { });
    }

    throw lastError;
}

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
            conn = await pool.acquire();

            await ensureUtf8(conn);

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
                const odbcDetails = error.odbcErrors ? JSON.stringify(error.odbcErrors) : '';
                const sqlPreview = sql ? sql.replace(/\s+/g, ' ').substring(0, 300) : 'N/A';
                const paramPreview = params ? JSON.stringify(params).substring(0, 200) : '[]';
                logger.error(`❌ Param Query Error (Final): ${error.message} ${odbcDetails}\n  SQL: ${sqlPreview}\n  Params: ${paramPreview}`);
            } else if (logError) {
                logger.warn(`⚠️ Param Query Retry (${attempt}): ${error.message}`);
            }

            if (isSqlSyntaxError(error)) {
                if (logError) {
                    logger.error(`🚫 SQL syntax/schema error (no retry): ${(error.odbcErrors || []).map(e => e.state).join(',')}`);
                }
                break;
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
                    await pool.release(conn);
                    await conn.close();
                } catch (e) { /* ignore */ }
            }
        }
    }

    if (connectionErrorCount >= MAX_RETRIES) {
        recreatePool().catch(() => { });
    }

    throw lastError;
}

function getPool() {
    return dbPool;
}

function getPoolMetrics() {
    return pool.getMetrics();
}

async function closePool() {
    stopKeepalive();
    await pool.close();
    dbPool = null;
}

module.exports = {
    initDb,
    query,
    queryWithParams,
    getPool,
    getPoolMetrics,
    closePool
};
