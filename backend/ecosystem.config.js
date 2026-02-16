/**
 * GMP App - PM2 Ecosystem Configuration
 * ======================================
 * Production-ready PM2 configuration with clustering,
 * monitoring, and auto-restart
 */

module.exports = {
    apps: [
        {
            name: 'gmp-api',
            script: 'server.js',
            cwd: __dirname,

            // ==================== CLUSTERING ====================
            instances: 'max', // Use all available CPU cores
            exec_mode: 'cluster', // Enable cluster mode

            // ==================== ENVIRONMENT ====================
            env: {
                NODE_ENV: 'development',
                PORT: 3334,
                USE_TS_ROUTES: 'false',
            },
            env_production: {
                NODE_ENV: 'production',
                PORT: 3334,
                USE_TS_ROUTES: 'false',
            },
            env_ts: {
                NODE_ENV: 'production',
                PORT: 3334,
                USE_TS_ROUTES: 'true',
            },

            // ==================== MEMORY & RESTART ====================
            max_memory_restart: '1G', // Restart if memory exceeds 1GB
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
            listen_timeout: 10000, // Time to wait for app to be ready
            kill_timeout: 5000, // Time to wait for graceful shutdown

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
