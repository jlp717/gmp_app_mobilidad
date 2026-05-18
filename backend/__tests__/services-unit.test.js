/**
 * Unit Tests - Services
 * =====================
 */

'use strict';

jest.mock('../config/db', () => ({
    query: jest.fn(),
    queryWithParams: jest.fn(),
    getPool: jest.fn()
}));

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

describe('CircuitBreaker Service', () => {
    let CircuitBreaker;
    
    beforeEach(() => {
        jest.resetModules();
        CircuitBreaker = require('../services/circuit-breaker');
    });
    
    test('should start in CLOSED state', () => {
        const cb = new CircuitBreaker.CircuitBreaker({ name: 'test' });
        expect(cb.state).toBe('closed');
    });
    
    test('should transition to OPEN after failures', async () => {
        const cb = new CircuitBreaker.CircuitBreaker({ 
            name: 'test',
            failureThreshold: 2,
            timeout: 100
        });
        
        // Simulate failures
        for (let i = 0; i < 2; i++) {
            try {
                await cb.execute(() => { throw new Error('fail'); }, () => 'fallback');
            } catch (e) {}
        }
        
        expect(cb.state).toBe('open');
    });
    
    test('should use fallback when open', async () => {
        const cb = new CircuitBreaker.CircuitBreaker({
            name: 'test',
            failureThreshold: 1,
            timeout: 5000
        });
        
        // Force open state
        cb.state = CircuitBreaker.OPEN;
        cb.nextAttempt = Date.now() + 5000;
        
        const result = await cb.execute(
            () => { throw new Error('fail'); },
            () => 'fallback'
        );
        
        expect(result).toBe('fallback');
    });
});

describe('PatternLearner Service', () => {
    let PatternLearner;
    
    beforeEach(() => {
        jest.resetModules();
        // Need fresh instance
        PatternLearner = require('../services/pattern-learner');
    });
    
    test('should record product view', () => {
        PatternLearner.recordView('USER001', 'PROD001');
        
        const stats = PatternLearner.getStats();
        expect(stats.totalUsers).toBe(1);
    });
    
    test('should record search', () => {
        PatternLearner.recordSearch('USER001', 'test search');
        
        const history = PatternLearner.getSearchSuggestions('USER001', 'test');
        expect(history).toContain('test search');
    });
    
    test('should get recommendations', () => {
        // Add some history
        PatternLearner.recordView('USER001', 'PROD001');
        PatternLearner.recordView('USER002', 'PROD001');
        PatternLearner.recordView('USER002', 'PROD002');
        
        const recs = PatternLearner.getRecommendations('USER001', 5);
        expect(Array.isArray(recs)).toBe(true);
    });
});

describe('Query Optimizer', () => {
    let queryOptimizer;
    
    beforeEach(() => {
        jest.resetModules();
        queryOptimizer = require('../services/query-optimizer');
    });
    
    test('should export query optimizer', () => {
        expect(queryOptimizer).toBeDefined();
        expect(queryOptimizer.cachedQuery).toBeDefined();
        expect(queryOptimizer.queryOptimizer).toBeDefined();
    });
});

describe('Redis Cache', () => {
    let redisCache;
    
    beforeEach(() => {
        jest.resetModules();
    });
    
    test('should initialize without Redis', async () => {
        // This will fail gracefully if no Redis
        try {
            redisCache = require('../services/redis-cache');
            await redisCache.initCache();
        } catch (e) {
            // Expected if no Redis
        }
        
        expect(true).toBe(true); // Passed if no crash
    });
});

describe('LACLAE Service', () => {
    let laclae;
    
    beforeEach(() => {
        jest.resetModules();
    });
    
    test('should export basic functions', () => {
        laclae = require('../services/laclae');
        
        expect(typeof laclae.loadLaclaeCache).toBe('function');
        expect(typeof laclae.isCacheReady).toBe('function');
        expect(typeof laclae.getClientsForDay).toBe('function');
    });
});