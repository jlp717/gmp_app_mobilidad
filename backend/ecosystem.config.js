/**
 * GMP App - PM2 Ecosystem Configuration
 * ======================================
 * Production-ready PM2 configuration with clustering,
 * monitoring, and auto-restart
 */

const requestedInstances = process.env.PM2_INSTANCES || '8';
const parsedInstanceCount = Number.parseInt(requestedInstances, 10);
const requestedInstanceCount = Number.isFinite(parsedInstanceCount)
    ? parsedInstanceCount
    : (requestedInstances === 'max' ? 9 : 1);
const isMultiInstance = requestedInstanceCount > 1;
const totalDbConnectionBudget = Number.parseInt(process.env.DB_TOTAL_CONNECTION_BUDGET || '40', 10);
const totalDbConcurrencyBudget = Number.parseInt(process.env.DB_TOTAL_QUERY_CONCURRENCY || '32', 10);
const safeInstanceCount = Math.max(1, requestedInstanceCount);
const defaultDbPoolMax = isMultiInstance
    ? String(Math.max(1, Math.floor(totalDbConnectionBudget / safeInstanceCount)))
    : String(totalDbConnectionBudget);
const defaultDbConcurrency = isMultiInstance
    ? String(Math.max(1, Math.floor(totalDbConcurrencyBudget / safeInstanceCount)))
    : String(Math.min(16, totalDbConcurrencyBudget));
const defaultThreadPoolSize = '128';
const defaultOldSpaceMb = '512';
const defaultExecMode = process.env.PM2_EXEC_MODE || (isMultiInstance ? 'cluster' : 'fork');

const runtimePerformanceEnv = {
    UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || defaultThreadPoolSize,
    NODE_OPTIONS: process.env.NODE_OPTIONS || `--max-old-space-size=${defaultOldSpaceMb}`,
    HTTP_COMPRESSION_THRESHOLD: process.env.HTTP_COMPRESSION_THRESHOLD || '1024',
    HTTP_COMPRESSION_LEVEL: process.env.HTTP_COMPRESSION_LEVEL || '6',
    HTTP_REQUEST_TIMEOUT_MS: process.env.HTTP_REQUEST_TIMEOUT_MS || '30000',
    PM2_INSTANCES: requestedInstances,
    PM2_EXEC_MODE: defaultExecMode,
    DB_TOTAL_CONNECTION_BUDGET: String(totalDbConnectionBudget),
    DB_TOTAL_QUERY_CONCURRENCY: String(totalDbConcurrencyBudget),
    DB_POOL_MIN: process.env.DB_POOL_MIN || (isMultiInstance ? '1' : '5'),
    DB_POOL_MAX: process.env.DB_POOL_MAX || defaultDbPoolMax,
    DB_POOL_ACQUIRE_MS: process.env.DB_POOL_ACQUIRE_MS || '15000',
    DB_POOL_FAST_FAIL_MS: process.env.DB_POOL_FAST_FAIL_MS || '10000',
    DB_QUERY_CONCURRENCY: process.env.DB_QUERY_CONCURRENCY || defaultDbConcurrency,
    DB_QUERY_QUEUE_TIMEOUT_MS: process.env.DB_QUERY_QUEUE_TIMEOUT_MS || '12000',
    REDIS_DISABLE_OFFLINE_QUEUE: process.env.REDIS_DISABLE_OFFLINE_QUEUE || 'true',
    REDIS_COMMAND_TIMEOUT_MS: process.env.REDIS_COMMAND_TIMEOUT_MS || '1000',
    QUERY_CACHE_REBUILD_WAIT_MS: process.env.QUERY_CACHE_REBUILD_WAIT_MS || '5000',
    QUERY_CACHE_STALE_MS: process.env.QUERY_CACHE_STALE_MS || '300000',
};

const REPARTO_BOOLEAN_FLAGS = Object.freeze([
    'REPARTO_WRITES_ENABLED',
    'REPARTO_PRODUCTION_WRITES_APPROVED',
    'REPARTO_PRODUCTION_ERP_WRITES_APPROVED',
    'REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED',
    'REPARTO_PRODUCTION_CONFIRMATION_APPROVED',
    'REPARTO_FINANCE_DB2_CAPABILITY_APPROVED',
]);
// Contrato fail-closed (tests ecosystem-reparto-fail-closed + reparto-runtime-production):
// el baseline PM2 es produccion con TODOS los approvals en false. Cualquier
// perfil staging/isolated_test se define explicitamente en el fichero de
// entorno del backend o en shell ANTES del recycle (REPARTO_ENVIRONMENT,
// REPARTO_TABLE_SET, approvals en true solo tras gates humanos: staging+QA+
// AppSec+SRE+Javier). Valores invalidos se preservan para que
// resolveRepartoRuntime rechace el arranque.
function explicitRepartoBoolean(name) {
    const value = process.env[name];
    if (value === undefined || value === '') return 'false';
    const normalized = String(value).trim().toLowerCase();
    // Preserve invalid explicit values so resolveRepartoRuntime rejects the
    // process at startup instead of silently changing an approval decision.
    return normalized === 'true' || normalized === 'false' ? normalized : String(value);
}

function explicitRepartoValue(name, fallback) {
    const value = process.env[name];
    if (value === undefined || value === '') return fallback;
    return String(value).trim();
}

const repartoConfiguredBooleans = Object.freeze(
    Object.fromEntries(REPARTO_BOOLEAN_FLAGS.map((name) => [name, explicitRepartoBoolean(name)])),
);

// Default PM2 profile is fail-closed production. Staging isolated_test is only
// applied when those values are already present in the PM2/shell environment
// (sourced from backend/.env) before an env-updating process recycle.
const repartoFailClosedEnv = Object.freeze({
    REPARTO_ENVIRONMENT: explicitRepartoValue('REPARTO_ENVIRONMENT', 'production'),
    REPARTO_TABLE_SET: explicitRepartoValue('REPARTO_TABLE_SET', 'production'),
    REPARTO_EVIDENCE_PENDING_TTL_HOURS: explicitRepartoValue('REPARTO_EVIDENCE_PENDING_TTL_HOURS', '24'),
    ...repartoConfiguredBooleans,
    REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
    REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
    REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
    USE_TS_ROUTES: 'false',
    USE_DDD_ROUTES: 'true',
});

// Deployment automation is intentionally absent. A production deployment is a
// human-gated operation and must use the separately approved runbook, never a
// PM2 ecosystem hook that could run extra installation, migration, or reload commands.
const deployConfig = Object.freeze({});

module.exports = {
    apps: [
        {
            name: 'gmp-api',
            script: 'server.js',
            cwd: __dirname,

            // ==================== CLUSTERING ====================
            instances: requestedInstances,
            exec_mode: defaultExecMode,

            // ==================== ENVIRONMENT ====================
            env: {
                NODE_ENV: 'production',
                PORT: 3335,  // gmp-api production port (gmp-api-pre uses 3334)
                USE_TS_ROUTES: 'false',
                USE_DDD_ROUTES: 'true',
                VENDOR_COLUMN: 'R1_T8CDVD',
                SNAPSHOT_UNTIL_MONTH: '2',
                ...repartoFailClosedEnv,
                ...runtimePerformanceEnv,
            },
            env_production: {
                NODE_ENV: 'production',
                PORT: 3335,  // gmp-api production port (gmp-api-pre uses 3334)
                USE_TS_ROUTES: 'false',
                USE_DDD_ROUTES: 'true',
                VENDOR_COLUMN: 'R1_T8CDVD',
                SNAPSHOT_UNTIL_MONTH: '2',
                ...repartoFailClosedEnv,
                // JWT secrets loaded from .env — do NOT hardcode here
                // (wrong secrets here cause "Invalid or expired token" errors)
                // JWT_ACCESS_EXPIRES and JWT_REFRESH_EXPIRES are loaded from .env.
                // auth.js accepts numeric milliseconds and values like 1h/7d.
                ...runtimePerformanceEnv,
            },
            env_ts: {
                NODE_ENV: 'production',
                PORT: 3335,  // gmp-api production port
                USE_TS_ROUTES: 'false', // TS auth NOT compatible with Flutter yet — DO NOT enable
                VENDOR_COLUMN: 'R1_T8CDVD',
                SNAPSHOT_UNTIL_MONTH: '2',
                ...repartoFailClosedEnv,
                ...runtimePerformanceEnv,
            },

            // ==================== MEMORY & RESTART ====================
            max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART || '512M',
            min_uptime: '10s', // Minimum uptime before considering "started"
            max_restarts: parseInt(process.env.PM2_MAX_RESTARTS, 10) || 50,
            restart_delay: parseInt(process.env.PM2_RESTART_DELAY_MS, 10) || 1000,

            // ==================== LOGGING ====================
            log_file: './logs/combined.log',
            out_file: './logs/out.log',
            error_file: './logs/error.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true, // Merge logs from all instances

            // ==================== MONITORING ====================
            watch: false, // Disable in production
            ignore_watch: ['node_modules', 'logs', '.validation-baselines', 'coverage'],

            // ==================== HEALTH CHECK ====================
            listen_timeout: parseInt(process.env.PM2_LISTEN_TIMEOUT_MS, 10) || 120000,
            kill_timeout: parseInt(process.env.PM2_KILL_TIMEOUT_MS, 10) || 5000,

            // ==================== AUTO RESTART ON FILE CHANGE ====================
            watch_delay: 1000,

            // ==================== PROCESS MANAGEMENT ====================
            autorestart: true,
            exp_backoff_restart_delay: parseInt(process.env.PM2_EXP_BACKOFF_RESTART_DELAY_MS, 10) || 500,

            // ==================== GRACEFUL SHUTDOWN ====================
            shutdown_with_message: true,
            wait_ready: true,

            // ==================== SOURCE MAPS ====================
            source_map_support: true,

            // ==================== INSTANCE VARIABLES ====================
            instance_var: 'INSTANCE_ID',

            // ==================== CRON RESTART ====================
            // Disabled by default; max_memory_restart handles leaks without
            // forcing a full-cluster session disruption every morning.
            ...(process.env.PM2_CRON_RESTART
                ? { cron_restart: process.env.PM2_CRON_RESTART }
                : {}),
        },

        // ==================== OPTIMIZATION SCRIPTS ====================
        {
            name: 'gmp-cache-cleanup',
            script: 'scripts/cache-cleanup.js',
            cwd: __dirname,
            instances: 1,
            exec_mode: 'fork',
            cron_restart: '0 */6 * * *', // Run every 6 hours
            autorestart: false,
            watch: false,
            env: {
                NODE_ENV: 'production',
            },
        },

        {
            name: 'gmp-query-analyzer',
            script: 'scripts/query-analyzer.js',
            cwd: __dirname,
            instances: 1,
            exec_mode: 'fork',
            cron_restart: '0 2 * * *', // Run daily at 2 AM
            autorestart: false,
            watch: false,
            env: {
                NODE_ENV: 'production',
            },
        },
    ],

    // ==================== DEPLOYMENT ====================
    // Deploy automation intentionally disabled; production changes go through
    // staging/QA/AppSec/SRE gates and the approved human runbook.
    deploy: deployConfig,
};
