/**
 * GMP App Backend - Jest Configuration
 * =====================================
 * Comprehensive testing setup with coverage reporting
 * Orchestrated by Node.js optimization pipeline
 */

module.exports = {
    // Test environment
    testEnvironment: 'node',

    // Root directory
    rootDir: '.',

    // Test file patterns
    testMatch: [
        '**/tests/**/*.test.js',
        '**/tests/**/*.spec.js',
        '**/__tests__/**/*.js',
    ],

    // Files to ignore
    testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
        '/deprecated/',
    ],

    // Coverage configuration
    collectCoverage: true,
    collectCoverageFrom: [
        'routes/**/*.js',
        'services/**/*.js',
        'middleware/**/*.js',
        'config/**/*.js',
        'scripts/**/*.js',
        '!**/node_modules/**',
        '!**/deprecated/**',
    ],

    // Coverage thresholds - Zero breakage guarantee
    coverageThreshold: {
        global: {
            branches: 80,
            functions: 80,
            lines: 80,
            statements: 80,
        },
    },

    // Coverage reporters
    coverageReporters: ['text', 'lcov', 'json', 'html'],

    // Coverage directory
    coverageDirectory: './coverage',

    // Setup files
    setupFilesAfterEnv: ['./tests/setup.js'],

    // Timeout for tests
    testTimeout: 30000,

    // Verbose output
    verbose: true,

    // Force exit after tests
    forceExit: true,

    // Detect open handles
    detectOpenHandles: true,

    // Max workers for parallel testing
    maxWorkers: '50%',

    // Module name mapper for path aliases
    moduleNameMapper: {
        '^@config/(.*)$': '<rootDir>/config/$1',
        '^@routes/(.*)$': '<rootDir>/routes/$1',
        '^@services/(.*)$': '<rootDir>/services/$1',
        '^@middleware/(.*)$': '<rootDir>/middleware/$1',
        '^@utils/(.*)$': '<rootDir>/utils/$1',
    },

    // Global variables
    globals: {
        __DEV__: true,
    },

    // Transform ignore patterns
    transformIgnorePatterns: [
        '/node_modules/',
    ],

    // Reporter for CI/CD integration
    reporters: [
        'default',
        [
            'jest-junit',
            {
                outputDirectory: './test-results',
                outputName: 'junit.xml',
                suiteName: 'GMP Backend Tests',
                classNameTemplate: '{classname}',
                titleTemplate: '{title}',
            },
        ],
    ],
};
