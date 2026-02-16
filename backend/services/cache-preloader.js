const http = require('http');
const { loadLaclaeCache } = require('./laclae');
const logger = require('../middleware/logger');
const { getCurrentDate } = require('../utils/common');
const { cachedQuery } = require('./query-optimizer');
const { query } = require('../config/db');

// Define common queries to pre-warm Redis (dashboard + heavy endpoints)
const PRELOAD_ENDPOINTS = [
    '/api/dashboard/metrics',
    '/api/dashboard/sales-evolution',
    '/api/dashboard/recent-sales',
    '/api/commissions/summary?vendedorCode=ALL',
    '/api/objectives/evolution?vendedorCodes=ALL',
];

async function warmUpDashboard(port) {
    logger.info("🔥 Warming up Dashboard Cache (Global view)...");

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    // We can manually trigger the SQL queries or hit the HTTP endpoints
    // Hitting HTTP endpoints is safer to ensure exact cache key match

    for (const endpoint of PRELOAD_ENDPOINTS) {
        try {
            const url = `http://localhost:${port}${endpoint}?year=${year}&month=${month}`;
            logger.info(`   Examples: GET ${url}`);

            // Fire and forget (or await if we want strict ordering)
            // We use simple http.get
            http.get(url, (res) => {
                // Consume data to clear buffer
                res.resume();
                if (res.statusCode === 200) {
                    // logger.info(`   ✅ Warmed: ${endpoint}`);
                } else {
                    // logger.warn(`   ⚠️ Warmup failed ${endpoint}: ${res.statusCode}`);
                }
            }).on('error', (e) => {
                logger.warn(`   ⚠️ Warmup error ${endpoint}: ${e.message}`);
            });

        } catch (e) {
            logger.error(`Warmup execution failed: ${e.message}`);
        }
    }
}

async function preloadCache(port = 3000) {
    logger.info("🚀 Starting System Preload...");

    try {
        // 1. Critical: Load LACLAE Memory Cache (Optimized 2025-2026)
        // This is blocking for Rutero, so we await it
        await loadLaclaeCache();

        // 2. Background: Warm up Dashboard + heavy endpoints (Non-blocking)
        // Give the server a few seconds to be ready
        setTimeout(() => {
            warmUpDashboard(port);
        }, 5000);

    } catch (e) {
        logger.error(`Fatal Preload Error: ${e.message}`);
    }
}

module.exports = { preloadCache };
