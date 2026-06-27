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
const defaultThreadPoolSize = isMultiInstance ? '32' : '128';
const defaultOldSpaceMb = isMultiInstance ? '384' : '512';
const defaultExecMode = process.env.PM2_EXEC_MODE || (isMultiInstance ? 'cluster' : 'fork');

const runtimePerformanceEnv = {
    UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || defaultThreadPoolSize,
    NODE_OPTIONS: process.env.NODE_OPTIONS || `--max-old-space-size=${defaultOldSpaceMb}`,
    HTTP_COMPRESSION_THRESHOLD: process.env.HTTP_COMPRESSION_THRESHOLD || '1024',
    HTTP_COMPRESSION_LEVEL: process.env.HTTP_COMPRESSION_LEVEL || '6',
    HTTP_REQUEST_TIMEOUT_MS: process.env.HTTP_REQUEST_TIMEOUT_MS || '45000',
    PM2_INSTANCES: requestedInstances,
    PM2_EXEC_MODE: defaultExecMode,
    DB_TOTAL_CONNECTION_BUDGET: String(totalDbConnectionBudget),
    DB_TOTAL_QUERY_CONCURRENCY: String(totalDbConcurrencyBudget),
    DB_POOL_MIN: process.env.DB_POOL_MIN || (isMultiInstance ? '0' : '5'),
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
                ...runtimePerformanceEnv,
            },
            env_production: {
                NODE_ENV: 'production',
                PORT: 3335,  // gmp-api production port (gmp-api-pre uses 3334)
                USE_TS_ROUTES: 'false',
                USE_DDD_ROUTES: 'true',
                VENDOR_COLUMN: 'R1_T8CDVD',
                SNAPSHOT_UNTIL_MONTH: '2',
                // JWT secrets loaded from .env — do NOT hardcode here
                // (wrong secrets here cause "Invalid or expired token" errors)
                // JWT_ACCESS_EXPIRES and JWT_REFRESH_EXPIRES intentionally omitted:
                // auth.js uses parseInt() which breaks string values like '15m' or '7d'
                // Default: ACCESS=3600000ms (1h), REFRESH=604800000ms (7d)
                ...runtimePerformanceEnv,
            },
            env_ts: {
                NODE_ENV: 'production',
                PORT: 3335,  // gmp-api production port
                USE_TS_ROUTES: 'false', // TS auth NOT compatible with Flutter yet — DO NOT enable
                VENDOR_COLUMN: 'R1_T8CDVD',
                SNAPSHOT_UNTIL_MONTH: '2',
                ...runtimePerformanceEnv,
            },

            // ==================== MEMORY & RESTART ====================
            max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART || '512M',
            min_uptime: '10s', // Minimum uptime before considering "started"
            max_restarts: 10, // Max restarts within min_uptime
            restart_delay: 4000, // Delay between restarts

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
            listen_timeout: 30000, // Time to wait for app to be ready (LACLAE cache preload)
            kill_timeout: parseInt(process.env.PM2_KILL_TIMEOUT_MS, 10) || 5000,

            // ==================== AUTO RESTART ON FILE CHANGE ====================
            watch_delay: 1000,

            // ==================== PROCESS MANAGEMENT ====================
            autorestart: true,
            exp_backoff_restart_delay: 100, // Exponential backoff

            // ==================== GRACEFUL SHUTDOWN ====================
            shutdown_with_message: true,
            wait_ready: true,

            // ==================== SOURCE MAPS ====================
            source_map_support: true,

            // ==================== INSTANCE VARIABLES ====================
            instance_var: 'INSTANCE_ID',

            // ==================== CRON RESTART ====================
            // Restart every day at 4 AM to clear memory
            cron_restart: '0 4 * * *',
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
    deploy: {
        production: {
            user: 'deploy',
            host: '192.168.1.230',
            ref: 'origin/main',
            repo: 'git@github.com:user/gmp_app_mobilidad.git',
            path: '/var/www/gmp-api',
            'pre-deploy-local': '',
            'post-deploy': 'npm ci && npm run build:ts && pm2 reload ecosystem.config.js --env production',
            'pre-setup': '',
            env: {
                NODE_ENV: 'production',
            },
        },
    },
};
