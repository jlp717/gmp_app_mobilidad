const odbc = require('odbc');
const { AsyncLocalStorage } = require('async_hooks');
const logger = require('../middleware/logger');

require('./load-env').loadEnv(require('path').resolve(__dirname, '..'));

const NODE_ENV = process.env.NODE_ENV || 'development';
const dbRequestContext = new AsyncLocalStorage();

function parseIntEnv(name, defaultValue) {
    const parsed = parseInt(process.env[name], 10);
    return Number.isFinite(parsed) ? parsed : defaultValue;
}

const DB_UID = process.env.ODBC_UID;
const DB_PWD = process.env.ODBC_PWD;
const DB_DSN = process.env.ODBC_DSN || 'GMP';

if (NODE_ENV === 'production' && (!DB_UID || !DB_PWD)) {
    logger.error('[DB] DB2 credentials are not configured; database initialization is blocked');
}

const DB_CREDENTIALS_CONFIGURED = Boolean(DB_UID && DB_PWD);

const DB_CONFIG = DB_CREDENTIALS_CONFIGURED ? `DSN=${DB_DSN};UID=${DB_UID};PWD=${DB_PWD};NAM=1;CCSID=1208;CMPTDM=1;
    CPOOLMAX=${parseIntEnv('ODBC_POOL_MAX', 20)};
    CPOOLMIN=${parseIntEnv('ODBC_POOL_MIN', 3)};
    CPTOUT=${parseIntEnv('ODBC_TIMEOUT', 60)};
    COMMTIMEOUT=${parseIntEnv('ODBC_COMM_TIMEOUT', 90)};
    LONGDATACOMPAT=1;
    ExtendedColInfo=0;
    DBQ=${DB_DSN};` : null;

function assertDbCredentialsConfigured() {
    if (DB_CREDENTIALS_CONFIGURED) return;
    const error = new Error('DB2 credentials are not configured');
    error.code = 'DB_CREDENTIALS_REQUIRED';
    error.statusCode = 503;
    throw error;
}

// Pool sizing — configurable via env for production tuning.
// Defaults raised: /commissions/summary?vendor=ALL fans out to N parallel vendor
// queries; with max=10 the pool exhausted and requests timed out at 10s.
// Increased to 50 for high-concurrency scenarios (up to ~40 vendors in parallel).
// For multi-user environments, increased max connections to handle concurrent users
const POOL_CONFIG = {
    min: parseIntEnv('DB_POOL_MIN', NODE_ENV === 'production' ? 1 : 5),
    max: parseIntEnv('DB_POOL_MAX', NODE_ENV === 'production' ? 5 : 25),
    idleTimeoutMs: parseIntEnv('DB_POOL_IDLE_MS', 60000),
    acquireTimeoutMs: parseIntEnv('DB_POOL_ACQUIRE_MS', 15000)
};

const POOL_ACQUIRE_FAST_FAIL_MS = parseIntEnv('DB_POOL_FAST_FAIL_MS', 0) ||
    Math.min(10000, POOL_CONFIG.acquireTimeoutMs);
const DEFAULT_DB_QUERY_CONCURRENCY = Math.max(2, Math.min(8, POOL_CONFIG.max));
const DB_QUERY_CONCURRENCY = parseIntEnv('DB_QUERY_CONCURRENCY', DEFAULT_DB_QUERY_CONCURRENCY);
const DB_QUERY_QUEUE_TIMEOUT_MS = parseIntEnv('DB_QUERY_QUEUE_TIMEOUT_MS', 15000);
const DB_QUERY_SLOW_MS = parseIntEnv('DB_QUERY_SLOW_MS', 500);
const DB_CIRCUIT_FAILURE_THRESHOLD = parseIntEnv('DB_CIRCUIT_FAILURE_THRESHOLD', 6);
const DB_CIRCUIT_RESET_MS = parseIntEnv('DB_CIRCUIT_RESET_MS', 15000);
const DB_POOL_METRICS_INTERVAL_MS = parseIntEnv('DB_POOL_METRICS_INTERVAL_MS', 60000);

const queryGate = {
    active: 0,
    waiters: [],
    timeouts: 0,

    async acquire() {
        if (DB_QUERY_CONCURRENCY <= 0) {
            return () => {};
        }

        if (this.active < DB_QUERY_CONCURRENCY) {
            this.active++;
            return () => this.release();
        }

        const start = Date.now();
        return new Promise((resolve, reject) => {
            const waiter = {
                done: false,
                resolve: () => {
                    if (waiter.done) return;
                    waiter.done = true;
                    clearTimeout(waiter.timer);
                    this.active++;
                    resolve(() => this.release());
                },
                reject: (error) => {
                    if (waiter.done) return;
                    waiter.done = true;
                    clearTimeout(waiter.timer);
                    reject(error);
                }
            };

            waiter.timer = setTimeout(() => {
                const idx = this.waiters.indexOf(waiter);
                if (idx >= 0) this.waiters.splice(idx, 1);
                this.timeouts++;
                const waitedMs = Date.now() - start;
                const error = new Error(`DB query queue timeout after ${waitedMs}ms`);
                error.code = 'DB_QUERY_QUEUE_TIMEOUT';
                waiter.reject(error);
            }, DB_QUERY_QUEUE_TIMEOUT_MS);

            this.waiters.push(waiter);
        });
    },

    release() {
        if (this.active > 0) this.active--;
        while (this.waiters.length > 0 && this.active < DB_QUERY_CONCURRENCY) {
            const waiter = this.waiters.shift();
            waiter.resolve();
            break;
        }
    },

    getMetrics() {
        return {
            active: this.active,
            waiting: this.waiters.length,
            max: DB_QUERY_CONCURRENCY,
            queueTimeoutMs: DB_QUERY_QUEUE_TIMEOUT_MS,
            timeouts: this.timeouts,
        };
    }
};

const dbCircuit = {
    state: 'closed',
    failures: 0,
    openedAt: 0,
    lastError: null,

    beforeRequest() {
        if (this.state !== 'open') return;
        if (Date.now() - this.openedAt >= DB_CIRCUIT_RESET_MS) {
            this.state = 'half_open';
            return;
        }
        const error = new Error('DB2 circuit open');
        error.code = 'DB_CIRCUIT_OPEN';
        error.statusCode = 503;
        throw error;
    },

    recordSuccess() {
        this.failures = 0;
        this.lastError = null;
        if (this.state !== 'closed') {
            logger.info('[DB_CIRCUIT] closed');
        }
        this.state = 'closed';
    },

    recordFailure(error) {
        if (!isConnectionError(error) && !isPoolAcquireError(error)) return;
        this.failures++;
        this.lastError = error?.code || error?.message || 'unknown';
        if (this.failures >= DB_CIRCUIT_FAILURE_THRESHOLD || this.state === 'half_open') {
            this.state = 'open';
            this.openedAt = Date.now();
            logger.warn(`[DB_CIRCUIT] open failures=${this.failures} last=${this.lastError}`);
        }
    },

    getMetrics() {
        return {
            state: this.state,
            failures: this.failures,
            openedAt: this.openedAt || null,
            resetMs: DB_CIRCUIT_RESET_MS,
            lastError: this.lastError,
        };
    }
};

const pool = {
    connections: [],
    active: 0,
    waiting: 0,
    acquireTimeouts: 0,
    min: POOL_CONFIG.min,
    max: POOL_CONFIG.max,
    idleTimeoutMs: POOL_CONFIG.idleTimeoutMs,
    acquireTimeoutMs: POOL_CONFIG.acquireTimeoutMs,
    _odbcPool: null,
    _initPromise: null,
    _closed: false,

    async _ensureMinConnections() {
        // Add safety check to prevent excessive connections
        if (this.connections.length >= this.max) {
            return;
        }
        
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
        const acquireDeadlineMs = Math.min(this.acquireTimeoutMs, POOL_ACQUIRE_FAST_FAIL_MS);

        // Implement circuit breaker pattern to prevent cascade failures
        if (this.active >= this.max) {
            const waitTime = 20;
            let attempts = 0;
            const maxAttempts = Math.max(1, Math.floor(acquireDeadlineMs / waitTime));

            this.waiting++;
            try {
                while (this.active >= this.max && attempts < maxAttempts) {
                    if (Date.now() - start > acquireDeadlineMs) {
                        this.acquireTimeouts++;
                        logger.warn(`[POOL] Connection acquisition timeout after ${acquireDeadlineMs}ms`);
                        throw new Error('Pool: acquire timeout - max connections reached');
                    }

                    await new Promise(res => setTimeout(res, waitTime));
                    attempts++;
                }

                if (this.active >= this.max) {
                    this.acquireTimeouts++;
                    throw new Error('Pool: unable to acquire connection after waiting');
                }
            } finally {
                if (this.waiting > 0) this.waiting--;
            }
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
                // Wait for connection with exponential backoff
                let waitTime = 20;
                let totalWait = 0;

                this.waiting++;
                try {
                    while (!c && totalWait < acquireDeadlineMs) {
                        await new Promise(res => setTimeout(res, waitTime));
                        totalWait += waitTime;
                        c = this.connections.find(c => !c.inUse);

                        // Exponential backoff up to 200ms
                        if (waitTime < 200) {
                            waitTime += 20;
                        }
                    }
                    
                    if (!c) {
                        this.acquireTimeouts++;
                        throw new Error(`Pool: acquire timeout - no available connections after ${acquireDeadlineMs}ms`);
                    }
                } finally {
                    if (this.waiting > 0) this.waiting--;
                }
            }
        } else {
            c.inUse = true;
            c.lastUsed = Date.now();
        }

        this.active++;
        return c.conn;
    },

    async release(conn, { destroy = false } = {}) {
        const idx = this.connections.findIndex(c => c.conn === conn);
        const entry = idx >= 0 ? this.connections[idx] : null;

        if (destroy) {
            if (entry) this.connections.splice(idx, 1);
            try {
                if (conn) await conn.close();
            } catch (_) {
                // Stale/broken connections can fail while closing; they are no longer pooled.
            }
        } else if (entry) {
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
            waiting: this.waiting,
            acquireTimeouts: this.acquireTimeouts,
            acquireTimeoutMs: this.acquireTimeoutMs,
            fastFailMs: POOL_ACQUIRE_FAST_FAIL_MS,
            queryGate: queryGate.getMetrics(),
            closed: this._closed
        };
    }
};

function createQueryTimeoutError(timeoutMs) {
    const error = new Error(`Query timeout after ${timeoutMs}ms`);
    error.code = 'DB_QUERY_TIMEOUT';
    error.fatalConnection = true;
    return error;
}

function isQueryTimeoutError(error) {
    return error?.code === 'DB_QUERY_TIMEOUT' ||
        error?.fatalConnection === true ||
        /query timeout/i.test(error?.message || '');
}

function isPoolAcquireError(error) {
    return error?.code === 'DB_QUERY_QUEUE_TIMEOUT' ||
        /pool: .*acquire timeout/i.test(error?.message || '') ||
        /db query queue timeout/i.test(error?.message || '');
}

function queryWithTimeout(conn, sql, params, timeoutMs = QUERY_TIMEOUT_MS) {
    let timer = null;
    const queryPromise = (params !== undefined
        ? conn.query(sql, params)
        : conn.query(sql)).finally(() => {
            if (timer) clearTimeout(timer);
        });

    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(async () => {
            try {
                if (typeof conn.cancel === 'function') {
                    await conn.cancel();
                }
            } catch (_) {
                // The connection is destroyed by caller; cancel is best-effort.
            }
            reject(createQueryTimeoutError(timeoutMs));
        }, timeoutMs);
    });

    return Promise.race([queryPromise, timeoutPromise]);
}

let dbPool = null;
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE_MS = 500;
// FIX 2026-05-15: timeout subido de 60s a 120s. La query de /clients?vendor=ALL
// para 92 vendedores hace agregaciones masivas sobre LACLAE (~2M filas) y
// tarda ~50s la primera vez (siguientes son instantaneos por cache). 60s
// era marginal y reventaba la primera carga tras restart. 120s da margen.
const QUERY_TIMEOUT_MS = parseInt(process.env.DB_QUERY_TIMEOUT_MS, 10) || 120000;
let poolRecreateInProgress = false;
let keepaliveInterval = null;
let poolMetricsInterval = null;

const _utf8Connections = new WeakSet();

async function ensureUtf8(conn) {
    if (_utf8Connections.has(conn)) return;
    try {
        await conn.query("CALL QSYS.QCMDEXC('CHGJOB CCSID(1208)', 0000000018.00000)");
        logger.debug('[DB] Connection CCSID set to 1208 (UTF-8)');
    } catch (e) {
        logger.debug(`[DB] CHGJOB CCSID(1208) skipped: ${e.message}`);
    }
    // Ensure APP_SCHEMA is in library list to prevent SQL5051
    // when creating tables in the app schema (needed for CREATE TABLE DDL).
    // En prod APP_SCHEMA=DSEDAC; ademas siempre anadimos JAVIER porque BOLSA_*
    // vive alli incluso en produccion.
    const APP_SCHEMA = String(process.env.PEDIDOS_CONFIRMATION_SCHEMA || 'JAVIER').trim().toUpperCase();
    const librariesToAdd = new Set([APP_SCHEMA, 'JAVIER']);
    for (const lib of librariesToAdd) {
        try {
            // 18.00000 = length of command string + 8 padding (ADDLIBLE JAVIER = 14 chars; 18 also valida para DSEDAC=14)
            const cmd = `ADDLIBLE ${lib}`;
            const lenStr = String(cmd.length).padStart(10, '0') + '.00000';
            await conn.query(`CALL QSYS.QCMDEXC('${cmd}', ${lenStr})`);
            logger.debug(`[DB] Added ${lib} to library list`);
        } catch (e) {
            logger.debug(`[DB] ADDLIBLE ${lib} skipped (may already exist): ${e.message}`);
        }
    }
    _utf8Connections.add(conn);
}

async function initDb() {
    assertDbCredentialsConfigured();
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
            startPoolMetrics();
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

let poolRecreateDelay = 1000;

async function recreatePool() {
    assertDbCredentialsConfigured();
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

        await new Promise(res => setTimeout(res, poolRecreateDelay));

        pool._odbcPool = await odbc.pool(DB_CONFIG);
        dbPool = pool._odbcPool;
        await pool._ensureMinConnections();
        logger.info('✅ Database pool recreated successfully');
        startKeepalive();
        startPoolMetrics();
        poolRecreateDelay = 1000; // Reset backoff
    } catch (error) {
        logger.error(`❌ Pool recreation failed: ${error.message}`);
        poolRecreateDelay = Math.min(poolRecreateDelay * 2, 30000); // Exponential backoff max 30s
        setTimeout(() => recreatePool().catch(() => {}), poolRecreateDelay);
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

// Non-transient errors that should NOT be retried:
//   - 22001 = string data right truncation (param too large for column)
//   - 22003 = numeric value out of range
//   - 22012 = division by zero
//   - 23505 = unique constraint violation
//   - 23502 = not null constraint violation
function isNonTransientDataError(error) {
    const odbcStates = (error.odbcErrors || []).map(e => e.state);
    const msg = (error.message || '').toLowerCase();

    return odbcStates.includes('22001') ||
        odbcStates.includes('22003') ||
        odbcStates.includes('22012') ||
        odbcStates.includes('23505') ||
        odbcStates.includes('23502') ||
        msg.includes('cwb0111');  // ODBC driver's version of 22001
}

// Check if an error is worth retrying (only connection/timeout errors)
function isRetryableError(error) {
    if (isPoolAcquireError(error)) return false;
    if (isConnectionError(error)) return true;
    if (isQueryTimeoutError(error)) return false;
    if (isSqlSyntaxError(error)) return false;
    if (isNonTransientDataError(error)) return false;
    return false;  // default: don't retry unknown errors
}

function safeOdbcDetails(error) {
    return (error.odbcErrors || []).map(e => ({
        state: e.state,
        code: e.code,
    }));
}

function safeParamPreview(params) {
    if (!Array.isArray(params)) return { count: 0, types: [] };
    return {
        count: params.length,
        types: params.slice(0, 25).map(value => {
            if (value === null) return 'null';
            if (Array.isArray(value)) return 'array';
            return typeof value;
        }),
        truncated: params.length > 25,
    };
}

function normalizeSqlForLog(sql, maxLength = 500) {
    return String(sql || '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, maxLength);
}

function getRequestContext() {
    return dbRequestContext.getStore() || {};
}

function getContextQueryTimeoutMs() {
    const ctx = getRequestContext();
    const deadlineAt = Number(ctx.dbDeadlineAt);
    if (!Number.isFinite(deadlineAt) || deadlineAt <= 0) {
        return QUERY_TIMEOUT_MS;
    }

    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) return 1;
    return Math.max(1, Math.min(QUERY_TIMEOUT_MS, remainingMs));
}

function runWithDbRequestContext(context, fn) {
    return dbRequestContext.run(context || {}, fn);
}

function getContextUser(ctx) {
    const requestUser = ctx.req?.user || {};
    return ctx.user
        || requestUser.id
        || requestUser.codigo
        || requestUser.user
        || requestUser.username
        || '-';
}

function logQueryPerformance({ sql, params, duration, rowCount, paramQuery }) {
    const preview = normalizeSqlForLog(sql);
    if (duration >= DB_QUERY_SLOW_MS) {
        const ctx = getRequestContext();
        logger.warn(`[SLOW_QUERY] durationMs=${duration} rows=${rowCount} method=${ctx.method || '-'} path=${ctx.path || '-'} user=${getContextUser(ctx)} sql="${preview}" params=${JSON.stringify(safeParamPreview(params))}`);
        return;
    }

    if (process.env.DB_QUERY_LOG_ALL === 'true') {
        const label = paramQuery ? 'Param Query' : 'Query';
        logger.info(`📊 ${label} (${duration}ms): ${preview.substring(0, 100)}... → ${rowCount} rows`);
    }
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

function startPoolMetrics() {
    stopPoolMetrics();
    if (DB_POOL_METRICS_INTERVAL_MS <= 0) return;
    poolMetricsInterval = setInterval(() => {
        const metrics = pool.getMetrics();
        logger.info(`[DB_POOL] active=${metrics.active} idle=${metrics.idle} total=${metrics.total}/${metrics.max} waiting=${metrics.waiting} queryActive=${metrics.queryGate.active}/${metrics.queryGate.max} queryWaiting=${metrics.queryGate.waiting} circuit=${dbCircuit.state}`);
    }, DB_POOL_METRICS_INTERVAL_MS);
    if (typeof poolMetricsInterval.unref === 'function') poolMetricsInterval.unref();
}

function stopPoolMetrics() {
    if (poolMetricsInterval) {
        clearInterval(poolMetricsInterval);
        poolMetricsInterval = null;
    }
}

// Normalize ODBC result rows so every column is accessible by both UPPERCASE
// and lowercase keys. DB2/ODBC driver casing varies between environments and
// many legacy endpoints assume UPPERCASE while newer SQL uses `as lowercase`
// aliases â€” this prevents undefined/0/empty responses from casing mismatches.
function normalizeRowCasing(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || typeof row !== 'object') continue;
        const keys = Object.keys(row);
        for (let k = 0; k < keys.length; k++) {
            const key = keys[k];
            const upper = key.toUpperCase();
            const lower = key.toLowerCase();
            if (upper !== key && !(upper in row)) row[upper] = row[key];
            if (lower !== key && !(lower in row)) row[lower] = row[key];
        }
    }
    return rows;
}

async function query(sql, logQuery = true, logError = true) {
    if (!dbPool) {
        await initDb();
        if (!dbPool) throw new Error('Database pool not initialized and failed to re-init');
    }
    dbCircuit.beforeRequest();

    let lastError = null;
    let connectionErrorCount = 0;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        let conn = null;
        let destroyConn = false;
        let releaseGate = null;
        try {
            releaseGate = await queryGate.acquire();
            conn = await pool.acquire();

            await ensureUtf8(conn);

            const start = Date.now();
            const result = await queryWithTimeout(conn, sql, undefined, getContextQueryTimeoutMs());
            const duration = Date.now() - start;
            dbCircuit.recordSuccess();
            logQueryPerformance({ sql, params: [], duration, rowCount: result.length, paramQuery: false });

            if (logQuery) {
                const preview = sql.replace(/\s+/g, ' ').substring(0, 100);
                logger.info(`📊 Query (${duration}ms): ${preview}... → ${result.length} rows`);
            }

            return normalizeRowCasing(result);

        } catch (error) {
            lastError = error;
            const connError = isConnectionError(error);
            const timeoutError = isQueryTimeoutError(error);
            destroyConn = connError || timeoutError;

            if (connError) {
                connectionErrorCount++;
            }
            dbCircuit.recordFailure(error);

            const retryable = isRetryableError(error);

            if (logError && attempt === MAX_RETRIES) {
                const odbcDetails = error.odbcErrors ? JSON.stringify(safeOdbcDetails(error)) : '';
                logger.error(`❌ Query Error (Final Attempt): ${error.message} ${odbcDetails}\n  SQL: ${sql ? sql.replace(/\s+/g, ' ').substring(0, 200) : 'N/A'}`);
            } else if (logError && retryable) {
                logger.warn(`⚠️ Query Failed (Attempt ${attempt}/${MAX_RETRIES}): ${error.message}. Retrying...`);
            } else if (logError) {
                const states = (error.odbcErrors || []).map(e => e.state).join(',');
                logger.error(`🚫 Non-retryable error (attempt ${attempt}): ${error.message} [state=${states}]`);
            }

            if (!retryable) {
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
                    await pool.release(conn, { destroy: destroyConn });
                } catch (closeError) {
                    // Ignore close errors on stale connections
                }
            }
            if (releaseGate) releaseGate();
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
    dbCircuit.beforeRequest();

    let lastError = null;
    let connectionErrorCount = 0;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        let conn = null;
        let destroyConn = false;
        let releaseGate = null;
        try {
            releaseGate = await queryGate.acquire();
            conn = await pool.acquire();

            await ensureUtf8(conn);

            const start = Date.now();
            const result = await queryWithTimeout(conn, sql, params, getContextQueryTimeoutMs());
            const duration = Date.now() - start;
            dbCircuit.recordSuccess();
            logQueryPerformance({ sql, params, duration, rowCount: result.length, paramQuery: true });

            if (logQuery) {
                const preview = sql.replace(/\s+/g, ' ').substring(0, 80);
                logger.info(`📊 Param Query (${duration}ms): ${preview}... → ${result.length} rows`);
            }

            return normalizeRowCasing(result);

        } catch (error) {
            lastError = error;
            const connError = isConnectionError(error);
            const timeoutError = isQueryTimeoutError(error);
            destroyConn = connError || timeoutError;

            if (connError) {
                connectionErrorCount++;
            }
            dbCircuit.recordFailure(error);

            const retryable = isRetryableError(error);

            if (logError && attempt === MAX_RETRIES) {
                const odbcDetails = error.odbcErrors ? JSON.stringify(safeOdbcDetails(error)) : '';
                const sqlPreview = sql ? sql.replace(/\s+/g, ' ').substring(0, 300) : 'N/A';
                const paramPreview = JSON.stringify(safeParamPreview(params));
                logger.error(`❌ Param Query Error (Final): ${error.message} ${odbcDetails}\n  SQL: ${sqlPreview}\n  Params: ${paramPreview}`);
            } else if (logError && retryable) {
                logger.warn(`⚠️ Param Query Retry (${attempt}): ${error.message}`);
            } else if (logError) {
                const states = (error.odbcErrors || []).map(e => e.state).join(',');
                logger.error(`🚫 Non-retryable param error (attempt ${attempt}): ${error.message} [state=${states}]`);
            }

            if (!retryable) break;

            if (connectionErrorCount >= 2 && attempt < MAX_RETRIES) {
                await recreatePool();
            }

            const delay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt - 1);
            await new Promise(res => setTimeout(res, delay));

        } finally {
            if (conn) {
                try {
                    await pool.release(conn, { destroy: destroyConn });
                } catch (e) { /* ignore */ }
            }
            if (releaseGate) releaseGate();
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
    return {
        ...pool.getMetrics(),
        circuit: dbCircuit.getMetrics(),
    };
}

async function closePool() {
    stopKeepalive();
    stopPoolMetrics();
    await pool.close();
    dbPool = null;
}

module.exports = {
    getPoolMetrics,
    runWithDbRequestContext,
    initDb,
    query,
    queryWithParams,
    getPool,
    closePool
};
