/**
 * Request Coalescing - P4
 * Prevents duplicate requests: if same request is in-flight, wait for it instead of spawning new query
 */

const logger = require('../middleware/logger');

// In-flight requests map
const inFlightRequests = new Map();

/**
 * Execute or coalesce: if identical request is in-flight, wait for it
 * @param {string} key - Request unique key (e.g., hash of params)
 * @param {Function} fn - Function to execute if not in-flight
 * @param {number} ttl - Time to live for cache (ms), optional
 * @returns {Promise} Result from either current or in-flight request
 */
async function executeOrCoalesce(key, fn, ttl = 30000) {
    // Check if already in-flight
    if (inFlightRequests.has(key)) {
        logger.info(`[Coalescing] Request ${key.substring(0, 20)} already in-flight, waiting...`);
        return inFlightRequests.get(key);
    }

    // Create new request promise
    const promise = fn().finally(() => {
        // Remove from in-flight after completion
        inFlightRequests.delete(key);
    });

    inFlightRequests.set(key, promise);
    logger.info(`[Coalescing] New request ${key.substring(0, 20)} started, ${inFlightRequests.size} in-flight`);

    return promise;
}

/**
 * Generate unique key from request params
 */
function generateRequestKey(base, params) {
    const normalized = typeof params === 'object' 
        ? JSON.stringify(params) 
        : String(params);
    return `${base}:${normalized}`;
}

module.exports = {
    executeOrCoalesce,
    generateRequestKey,
    getInFlightCount: () => inFlightRequests.size
};