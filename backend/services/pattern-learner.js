/**
 * GMP App - Pattern Learning Service
 * ================================
 * Learns from user behavior and improves recommendations over time
 * Uses in-memory pattern matching for fast responses
 * 
 * Memory Management:
 * - MAX_PATTERNS (10000): Max user patterns before LRU eviction
 * - MAX_ERROR_PATTERNS (1000): Max error patterns before LRU eviction
 * - PATTERN_TTL_MS (24h): TTL for stale pattern entries
 * - Cleanup runs every 1 hour to remove expired entries
 */

const logger = require('../middleware/logger');

const MAX_PATTERNS = 10000;
const MAX_ERROR_PATTERNS = 1000;
const MAX_HISTORY_PER_USER = 50;
const MAX_SEARCH_HISTORY_PER_USER = 20;
const PATTERN_TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

const patternStore = new Map();

const userPatterns = {
    purchaseHistory: new Map(),
    searchHistory: new Map(),
    timePreferences: new Map()
};

const popularByTime = {
    morning: new Map(),
    afternoon: new Map(),
    evening: new Map()
};

let lastCleanupTime = Date.now();
let cleanupTimer = null;

function getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
        heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
        external: Math.round(usage.external / 1024 / 1024),
        rss: Math.round(usage.rss / 1024 / 1024)
    };
}

function evictOldestEntries(map, maxSize) {
    if (map.size >= maxSize) {
        const entriesToRemove = map.size - Math.floor(maxSize * 0.8);
        const keys = Array.from(map.keys()).slice(0, entriesToRemove);
        for (const key of keys) {
            map.delete(key);
        }
        logger.warn(`[PatternLearner] Evicted ${entriesToRemove} entries, map size now: ${map.size}`);
    }
}

function evictOldestFromSet(map, maxSize) {
    if (map.size >= maxSize) {
        const entriesToRemove = map.size - Math.floor(maxSize * 0.8);
        const keys = Array.from(map.keys()).slice(0, entriesToRemove);
        for (const key of keys) {
            map.delete(key);
        }
    }
}

function cleanupExpiredEntries() {
    const now = Date.now();
    let totalEvicted = 0;

    for (const [userCode, history] of userPatterns.purchaseHistory.entries()) {
        const validEntries = history.filter(h => now - h.timestamp < PATTERN_TTL_MS);
        if (validEntries.length < history.length) {
            userPatterns.purchaseHistory.set(userCode, validEntries);
            totalEvicted += history.length - validEntries.length;
        }
    }

    for (const [userCode, history] of userPatterns.searchHistory.entries()) {
        const validEntries = history.filter(h => now - h.timestamp < PATTERN_TTL_MS);
        if (validEntries.length < history.length) {
            userPatterns.searchHistory.set(userCode, validEntries);
            totalEvicted += history.length - validEntries.length;
        }
    }

    for (const timeKey of ['morning', 'afternoon', 'evening']) {
        for (const [productCode, timestamp] of popularByTime[timeKey].entries()) {
            if (now - timestamp > PATTERN_TTL_MS) {
                popularByTime[timeKey].delete(productCode);
                totalEvicted++;
            }
        }
    }

    for (const [userCode, prefs] of userPatterns.timePreferences.entries()) {
        const isExpired = Object.values(prefs).every(
            v => !v || (v.timestamp && now - v.timestamp > PATTERN_TTL_MS)
        );
        if (isExpired) {
            userPatterns.timePreferences.delete(userCode);
            totalEvicted++;
        }
    }

    lastCleanupTime = now;
    if (totalEvicted > 0) {
        logger.info(`[PatternLearner] Cleanup removed ${totalEvicted} expired entries`);
    }

    return totalEvicted;
}

function startPeriodicCleanup() {
    if (cleanupTimer) return;
    
    cleanupTimer = setInterval(() => {
        try {
            cleanupExpiredEntries();
            const mem = getMemoryUsage();
            logger.info(`[PatternLearner] Memory: heap=${mem.heapUsed}MB rss=${mem.rss}MB`);
        } catch (err) {
            logger.error(`[PatternLearner] Cleanup error: ${err.message}`);
        }
    }, CLEANUP_INTERVAL_MS);

    cleanupTimer.unref();
}

function stopPeriodicCleanup() {
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }
}

class PatternLearner {
    
    static recordView(userCode, productCode) {
        try {
            if (!userCode || !productCode) return;
            
            evictOldestEntries(userPatterns.purchaseHistory, MAX_PATTERNS);

            const history = userPatterns.purchaseHistory.get(userCode) || [];
            history.push({ productCode, timestamp: Date.now() });

            if (history.length > MAX_HISTORY_PER_USER) {
                history.shift();
            }

            userPatterns.purchaseHistory.set(userCode, history);

            const hour = new Date().getHours();
            let timeKey = 'evening';
            if (hour >= 6 && hour < 12) timeKey = 'morning';
            else if (hour >= 12 && hour < 18) timeKey = 'afternoon';

            evictOldestFromSet(popularByTime[timeKey], MAX_PATTERNS);
            popularByTime[timeKey].set(productCode, Date.now());
        } catch (err) {
            logger.error(`[PatternLearner] recordView error: ${err.message}`);
        }
    }
    
    static recordSearch(userCode, searchTerm) {
        try {
            if (!userCode || !searchTerm) return;
            
            evictOldestEntries(userPatterns.searchHistory, MAX_PATTERNS);

            const history = userPatterns.searchHistory.get(userCode) || [];
            history.push({ term: searchTerm.toLowerCase(), timestamp: Date.now() });

            if (history.length > MAX_SEARCH_HISTORY_PER_USER) {
                history.shift();
            }

            userPatterns.searchHistory.set(userCode, history);
        } catch (err) {
            logger.error(`[PatternLearner] recordSearch error: ${err.message}`);
        }
    }
    
    static getRecommendations(userCode, limit = 5) {
        try {
            startPeriodicCleanup();

            const recommendations = [];
            
            const history = userPatterns.purchaseHistory.get(userCode) || [];
            const purchased = new Set(history.map(h => h.productCode));
            
            const similarUsers = this.findSimilarUsers(userCode);
            
            for (const similarUser of similarUsers) {
                const theirHistory = userPatterns.purchaseHistory.get(similarUser) || [];
                for (const item of theirHistory) {
                    if (!purchased.has(item.productCode)) {
                        recommendations.push({
                            productCode: item.productCode,
                            score: (recommendations.length + 1),
                            source: 'similar_user'
                        });
                    }
                }
            }
            
            const hour = new Date().getHours();
            let timeKey = 'evening';
            if (hour >= 6 && hour < 12) timeKey = 'morning';
            else if (hour >= 12 && hour < 18) timeKey = 'afternoon';
            
            for (const [code] of popularByTime[timeKey].entries()) {
                if (!purchased.has(code) && recommendations.length < limit * 2) {
                    recommendations.push({
                        productCode: code,
                        score: recommendations.length + 1,
                        source: 'popular'
                    });
                }
            }

            return recommendations.slice(0, limit);
        } catch (err) {
            logger.error(`[PatternLearner] getRecommendations error: ${err.message}`);
            return [];
        }
    }
    
    static findSimilarUsers(userCode, limit = 3) {
        try {
            const userHistory = userPatterns.purchaseHistory.get(userCode) || [];
            const userProducts = new Set(userHistory.map(h => h.productCode));
            
            const similarities = [];
            
            for (const [otherUser, theirHistory] of userPatterns.purchaseHistory.entries()) {
                if (otherUser === userCode) continue;
                
                const otherProducts = new Set(theirHistory.map(h => h.productCode));
                
                let intersection = 0;
                for (const p of userProducts) {
                    if (otherProducts.has(p)) intersection++;
                }
                
                const union = new Set([...userProducts, ...otherProducts]).size;
                const similarity = union > 0 ? intersection / union : 0;
                
                if (similarity > 0.1) {
                    similarities.push({ user: otherUser, similarity });
                }
            }
            
            similarities.sort((a, b) => b.similarity - a.similarity);
            
            return similarities.slice(0, limit).map(s => s.user);
        } catch (err) {
            logger.error(`[PatternLearner] findSimilarUsers error: ${err.message}`);
            return [];
        }
    }
    
    static getSearchSuggestions(userCode, partial, limit = 3) {
        try {
            if (!userCode || !partial) return [];
            
            const history = userPatterns.searchHistory.get(userCode) || [];
            const suggestions = new Set();
            
            const lowerPartial = partial.toLowerCase();
            for (const item of history) {
                if (item.term.includes(lowerPartial)) {
                    suggestions.add(item.term);
                }
            }
            
            for (const [user, searchHistory] of userPatterns.searchHistory.entries()) {
                if (user === userCode) continue;
                for (const item of searchHistory) {
                    if (item.term.includes(lowerPartial)) {
                        suggestions.add(item.term);
                    }
                }
            }

            return Array.from(suggestions).slice(0, limit);
        } catch (err) {
            logger.error(`[PatternLearner] getSearchSuggestions error: ${err.message}`);
            return [];
        }
    }
    
    static getStats() {
        try {
            const mem = getMemoryUsage();
            return {
                totalUsers: userPatterns.purchaseHistory.size,
                totalSearches: userPatterns.searchHistory.size,
                popularProducts: {
                    morning: popularByTime.morning.size,
                    afternoon: popularByTime.afternoon.size,
                    evening: popularByTime.evening.size
                },
                memory: mem,
                lastCleanup: new Date(lastCleanupTime).toISOString(),
                uptime: process.uptime()
            };
        } catch (err) {
            logger.error(`[PatternLearner] getStats error: ${err.message}`);
            return {
                error: err.message,
                totalUsers: 0,
                totalSearches: 0,
                popularProducts: { morning: 0, afternoon: 0, evening: 0 }
            };
        }
    }

    static cleanup() {
        try {
            return cleanupExpiredEntries();
        } catch (err) {
            logger.error(`[PatternLearner] cleanup error: ${err.message}`);
            return 0;
        }
    }

    static shutdown() {
        stopPeriodicCleanup();
        userPatterns.purchaseHistory.clear();
        userPatterns.searchHistory.clear();
        userPatterns.timePreferences.clear();
        for (const timeKey of ['morning', 'afternoon', 'evening']) {
            popularByTime[timeKey].clear();
        }
        patternStore.clear();
        logger.info('[PatternLearner] Shutdown complete, all stores cleared');
    }
}

module.exports = PatternLearner;
