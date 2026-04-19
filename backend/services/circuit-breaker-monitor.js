/**
 * Circuit Breaker Monitoring Service
 * ===================================
 * Provides metrics and health status for all circuit breakers in the system
 */

const logger = require('../middleware/logger');

// Registry of all circuit breakers in the system
const circuitBreakerRegistry = new Map();

// Register a circuit breaker
function registerBreaker(name, breaker) {
    circuitBreakerRegistry.set(name, {
        breaker,
        registeredAt: Date.now(),
        stateChanges: 0
    });
    logger.info(`[CircuitBreakerMonitor] Registered: ${name}`);
}

// Get all circuit breaker statuses
function getAllStatuses() {
    const statuses = {};
    
    for (const [name, entry] of circuitBreakerRegistry.entries()) {
        const b = entry.breaker;
        statuses[name] = {
            state: b.state,
            failures: b.failures,
            successes: b.successes,
            lastFailureTime: b.lastFailureTime,
            nextAttempt: b.nextAttempt,
            uptimeMs: Date.now() - entry.registeredAt,
            healthScore: calculateHealthScore(b)
        };
    }
    
    return statuses;
}

// Calculate health score (0-100)
function calculateHealthScore(breaker) {
    if (!breaker.failures && !breaker.successes) return 100;
    
    const total = breaker.failures + breaker.successes;
    const successRate = (breaker.successes / total) * 100;
    
    // Penalize for being in OPEN state
    if (breaker.state === 'open') return Math.max(0, successRate - 30);
    if (breaker.state === 'half_open') return Math.max(0, successRate - 10);
    
    return Math.round(successRate);
}

// Get system health summary
function getHealthSummary() {
    const statuses = getAllStatuses();
    const names = Object.keys(statuses);
    
    if (names.length === 0) {
        return { healthy: true, message: 'No circuit breakers registered' };
    }
    
    const openCount = names.filter(n => statuses[n].state === 'open').length;
    const healthyCount = names.filter(n => statuses[n].healthScore >= 80).length;
    
    return {
        total: names.length,
        healthy: healthyCount,
        open: openCount,
        healthScore: Math.round(
            names.reduce((sum, n) => sum + statuses[n].healthScore, 0) / names.length
        ),
        needsAttention: names.filter(n => statuses[n].healthScore < 50)
    };
}

// Auto-register built-in breakers
function initializeMonitoring() {
    try {
        // Try to register warehouse breaker
        const warehouse = require('../routes/warehouse');
        if (warehouse.warehouseBreaker) {
            registerBreaker('warehouse', warehouse.warehouseBreaker);
        }
    } catch (e) { /* Not yet initialized */ }
    
    try {
        const repartidor = require('../routes/repartidor');
        if (repartidor.repartidorBreaker) {
            registerBreaker('repartidor', repartidor.repartidorBreaker);
        }
    } catch (e) { /* Not yet initialized */ }
    
    try {
        const pedidos = require('../services/pedidos.service');
        if (pedidos.pedidosBreaker) {
            registerBreaker('pedidos-db', pedidos.pedidosBreaker);
        }
    } catch (e) { /* Not yet initialized */ }
    
    logger.info(`[CircuitBreakerMonitor] Initialized with ${circuitBreakerRegistry.size} breakers`);
}

module.exports = {
    registerBreaker,
    getAllStatuses,
    getHealthSummary,
    initializeMonitoring
};