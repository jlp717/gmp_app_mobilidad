/**
 * GMP App - Cache Cleanup Script
 * ===============================
 * Scheduled cleanup of expired cache entries
 * Run manually or via PM2 cron: node scripts/cache-cleanup.js
 */

const logger = require('../middleware/logger');
const { redisCache, getCacheStats } = require('../services/redis-cache');

async function cleanupCache() {
    console.log('═'.repeat(50));
    console.log('  CACHE CLEANUP');
    console.log('═'.repeat(50));
    console.log(`  Started: ${new Date().toISOString()}`);
    console.log('');

    try {
        // Get stats before cleanup
        const statsBefore = getCacheStats();
        console.log(`  Before cleanup:`);
        console.log(`    L1 Size: ${statsBefore.l1Size}`);
        console.log(`    Hits: ${statsBefore.hits.l1 + statsBefore.hits.l2}`);
        console.log(`    Misses: ${statsBefore.misses}`);
        console.log(`    Hit Rate: ${statsBefore.hitRate}%`);
        console.log('');

        // Flush expired entries
        await redisCache.flush();

        // Get stats after cleanup
        const statsAfter = getCacheStats();
        console.log(`  After cleanup:`);
        console.log(`    L1 Size: ${statsAfter.l1Size}`);
        console.log('');

        console.log('  ✅ Cleanup completed successfully');
    } catch (error) {
        console.log(`  ❌ Cleanup error: ${error.message}`);
        process.exit(1);
    }

    console.log('═'.repeat(50));
    console.log(`  Finished: ${new Date().toISOString()}`);
    console.log('═'.repeat(50));
}

// Run if called directly
if (require.main === module) {
    cleanupCache()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('Fatal error:', err);
            process.exit(1);
        });
}

module.exports = { cleanupCache };
