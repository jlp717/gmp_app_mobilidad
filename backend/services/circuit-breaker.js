/**
 * Circuit Breaker for DB/ODBC calls
 * P3: Opens fast (<200ms) and falls back to cache
 */

'use strict';
const logger = require('../middleware/logger');
const CircuitBreakerClass = null;

// Circuit breaker states
const CLOSED = 'closed';
const OPEN = 'open';
const HALF_OPEN = 'half_open';

class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 3;
        this.successThreshold = options.successThreshold || 2;
        this.timeout = options.timeout || 5000; // 5s default
        this.name = options.name || 'circuit';
        
        this.state = CLOSED;
        this.failures = 0;
        this.successes = 0;
        this.lastFailureTime = 0;
        this.nextAttempt = 0;
    }

    async execute(fn, fallbackFn) {
        const now = Date.now();

        // Check if circuit is open
        if (this.state === OPEN) {
            if (now < this.nextAttempt) {
                logger.warn(`[CircuitBreaker:${this.name}] OPEN - using fallback`);
                return fallbackFn ? fallbackFn() : null;
            }
            // Try half-open
            this.state = HALF_OPEN;
            logger.info(`[CircuitBreaker:${this.name}] HALF_OPEN - testing connection`);
        }

        try {
            // Execute with timeout
            const result = await Promise.race([
                fn(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Circuit breaker timeout')), this.timeout)
                )
            ]);
            
            this.onSuccess();
            return result;
            
        } catch (error) {
            this.onFailure();
            logger.warn(`[CircuitBreaker:${this.name}] Failed: ${error.message} - using fallback`);
            return fallbackFn ? fallbackFn() : null;
        }
    }

    onSuccess() {
        this.failures = 0;
        if (this.state === HALF_OPEN) {
            this.successes++;
            if (this.successes >= this.successThreshold) {
                this.state = CLOSED;
                logger.info(`[CircuitBreaker:${this.name}] CLOSED - recovered`);
            }
        }
    }

    onFailure() {
        this.failures++;
        this.lastFailureTime = Date.now();
        
        if (this.failures >= this.failureThreshold) {
            this.state = OPEN;
            this.nextAttempt = Date.now() + this.timeout;
            this.successes = 0;
            logger.warn(`[CircuitBreaker:${this.name}] OPEN - too many failures`);
        }
    }

    getState() {
        return this.state;
    }
}

// P3: Create circuit breakers for each dependent service
const ruteroWeekCircuit = new CircuitBreaker({
    name: 'rutero_week',
    failureThreshold: 2,
    timeout: 200, // Fast open
});

const erpDeliveryCircuit = new CircuitBreaker({
    name: 'erp_delivery', 
    failureThreshold: 3,
    timeout: 3000,
});

module.exports = {
    CircuitBreaker,
    ruteroWeekCircuit,
    erpDeliveryCircuit
};