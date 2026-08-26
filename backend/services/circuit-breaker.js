'use strict';

const logger = require('../middleware/logger');

const CLOSED = 'closed';
const OPEN = 'open';
const HALF_OPEN = 'half_open';

class CircuitOpenError extends Error {
    constructor(name, code = 'CIRCUIT_OPEN') {
        super('Circuit breaker open: ' + name);
        this.name = 'CircuitOpenError';
        this.code = code;
        this.statusCode = 503;
        this.isOperational = true;
    }
}

// ponytail: breaker state is per PM2 worker. upgrade: share state only if cross-worker coordination is required.
class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 3;
        this.successThreshold = options.successThreshold || 2;
        this.timeout = options.timeout || 5000;
        this.resetTimeout = options.resetTimeout || options.timeout || 30000;
        this.errorThresholdPercentage = options.errorThresholdPercentage || 50;
        this.rollingWindowSize = options.rollingWindowSize || 20;
        this.throwOnFailure = options.throwOnFailure === true;
        this.openErrorCode = options.openErrorCode || 'CIRCUIT_OPEN';
        this.name = options.name || 'circuit';
        this.shouldCountFailure = typeof options.shouldCountFailure === 'function'
            ? options.shouldCountFailure
            : () => true;

        this.state = CLOSED;
        this.failures = 0;
        this.successes = 0;
        this.lastFailureTime = 0;
        this.nextAttempt = 0;
        this.outcomes = [];
        this.halfOpenProbeInFlight = false;
    }

    async execute(fn, fallbackFn, executionOptions = {}) {
        const now = Date.now();
        if (this.state === OPEN) {
            if (now < this.nextAttempt) {
                const error = new CircuitOpenError(this.name, this.openErrorCode);
                logger.warn('[CircuitBreaker:' + this.name + '] OPEN - using fallback');
                if (fallbackFn) return fallbackFn(error);
                if (this.throwOnFailure) throw error;
                return null;
            }
            this.state = HALF_OPEN;
            this.successes = 0;
            logger.info('[CircuitBreaker:' + this.name + '] HALF_OPEN - testing connection');
        }

        if (this.state === HALF_OPEN && this.halfOpenProbeInFlight) {
            const error = new CircuitOpenError(this.name, this.openErrorCode);
            logger.warn('[CircuitBreaker:' + this.name + '] HALF_OPEN probe already running');
            if (fallbackFn) return fallbackFn(error);
            if (this.throwOnFailure) throw error;
            return null;
        }

        const isHalfOpenProbe = this.state === HALF_OPEN;
        if (isHalfOpenProbe) this.halfOpenProbeInFlight = true;

        const executionTimeout = executionOptions.timeout || this.timeout;
        let timer;
        try {
            const timeoutPromise = new Promise((_, reject) => {
                timer = setTimeout(() => {
                    const error = executionOptions.timeoutErrorFactory
                        ? executionOptions.timeoutErrorFactory(executionTimeout)
                        : Object.assign(new Error('Circuit breaker timeout'), { code: 'CIRCUIT_TIMEOUT' });
                    reject(error);
                    if (executionOptions.onTimeout) {
                        Promise.resolve()
                            .then(() => executionOptions.onTimeout())
                            .catch(() => {});
                    }
                }, executionTimeout);
            });
            const result = await Promise.race([Promise.resolve().then(fn), timeoutPromise]);
            this.onSuccess();
            return result;
        } catch (error) {
            const predicate = executionOptions.shouldCountFailure || this.shouldCountFailure;
            if (predicate(error)) {
                this.onFailure();
            } else if (isHalfOpenProbe) {
                this.onSuccess();
            }
            logger.warn('[CircuitBreaker:' + this.name + '] Failed: ' + error.message + ' - using fallback');
            if (fallbackFn) return fallbackFn(error);
            if (this.throwOnFailure) throw error;
            return null;
        } finally {
            clearTimeout(timer);
            if (isHalfOpenProbe) this.halfOpenProbeInFlight = false;
        }
    }

    recordOutcome(success) {
        this.outcomes.push(success);
        if (this.outcomes.length > this.rollingWindowSize) this.outcomes.shift();
        this.failures = this.outcomes.filter((outcome) => !outcome).length;
    }

    onSuccess() {
        if (this.state === HALF_OPEN) {
            this.successes++;
            if (this.successes >= this.successThreshold) {
                this.close();
                logger.info('[CircuitBreaker:' + this.name + '] CLOSED - recovered');
            }
            return;
        }
        this.recordOutcome(true);
    }

    onFailure() {
        this.lastFailureTime = Date.now();
        if (this.state === HALF_OPEN) {
            this.open();
            return;
        }

        this.recordOutcome(false);
        const errorRate = (this.failures / this.outcomes.length) * 100;
        if (this.outcomes.length >= this.failureThreshold && errorRate >= this.errorThresholdPercentage) {
            this.open();
        }
    }

    open() {
        this.state = OPEN;
        this.nextAttempt = Date.now() + this.resetTimeout;
        this.successes = 0;
        logger.warn('[CircuitBreaker:' + this.name + '] OPEN - error threshold reached');
    }

    close() {
        this.state = CLOSED;
        this.failures = 0;
        this.successes = 0;
        this.nextAttempt = 0;
        this.outcomes = [];
    }

    getState() {
        return this.state;
    }

    getMetrics() {
        return {
            state: this.state,
            failures: this.failures,
            sampleSize: this.outcomes.length,
            errorThresholdPercentage: this.errorThresholdPercentage,
            resetTimeout: this.resetTimeout,
            nextAttempt: this.nextAttempt || null,
        };
    }
}

const ruteroWeekCircuit = new CircuitBreaker({
    name: 'rutero_week',
    failureThreshold: 2,
    timeout: 200,
});

const erpDeliveryCircuit = new CircuitBreaker({
    name: 'erp_delivery',
    failureThreshold: 3,
    timeout: 3000,
});

module.exports = {
    CircuitBreaker,
    CircuitOpenError,
    CLOSED,
    OPEN,
    HALF_OPEN,
    ruteroWeekCircuit,
    erpDeliveryCircuit,
};
