/**
 * GMP App Backend - Test Setup
 * ============================
 * Common test configuration and mocks
 * Ensures clean test environment for each test
 */

const logger = require('../middleware/logger');

// Silence logger during tests
jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

// Global test timeout
jest.setTimeout(30000);

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-jwt-secret-for-testing-only';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-testing-only';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.PORT = '3335'; // Different port for tests

// Global test utilities
global.testUtils = {
    /**
     * Create a mock request object
     */
    mockRequest: (overrides = {}) => ({
        body: {},
        params: {},
        query: {},
        headers: {},
        user: null,
        ...overrides,
    }),

    /**
     * Create a mock response object
     */
    mockResponse: () => {
        const res = {};
        res.status = jest.fn().mockReturnValue(res);
        res.json = jest.fn().mockReturnValue(res);
        res.send = jest.fn().mockReturnValue(res);
        res.set = jest.fn().mockReturnValue(res);
        res.header = jest.fn().mockReturnValue(res);
        return res;
    },

    /**
     * Create a mock next function
     */
    mockNext: () => jest.fn(),

    /**
     * Wait for specified milliseconds
     */
    wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

    /**
     * Generate random string
     */
    randomString: (length = 10) => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    },

    /**
     * Compare two objects for deep equality (ignoring undefined)
     */
    deepEqual: (obj1, obj2) => {
        return JSON.stringify(obj1) === JSON.stringify(obj2);
    },
};

// Cleanup after all tests
afterAll(async () => {
    // Close any open connections
    jest.clearAllMocks();
    jest.clearAllTimers();
});

// Reset mocks before each test
beforeEach(() => {
    jest.clearAllMocks();
});

// Console spy for debugging
const originalConsole = { ...console };
global.enableConsole = () => {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
};

global.disableConsole = () => {
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
};

// Disable console by default in tests
global.disableConsole();
