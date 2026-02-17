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

    // Test file patterns (JS + TS)
    testMatch: [
        '**/tests/**/*.test.js',
        '**/tests/**/*.spec.js',
        '**/__tests__/**/*.js',
        '**/__tests__/**/*.ts',
        '**/src/**/*.test.ts',
    ],

    // TypeScript support via ts-jest
    transform: {
        '^.+\\.ts$': ['ts-jest', {
            tsconfig: {
                esModuleInterop: true,
                module: 'commonjs',
                target: 'es2020',
                strict: false,
                resolveJsonModule: true,
            },
        }],
    },

    // Module file extensions
    moduleFileExtensions: ['ts', 'js', 'json'],

    // Files to ignore
    testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
        '/deprecated/',
    ],

    // Coverage configuration
    collectCoverage: true,
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.test.ts',
        '!src/__tests__/**',
        '!src/types/**',
        '!**/node_modules/**',
        '!**/deprecated/**',
    ],

    // Coverage thresholds (scoped to TS layer only)
    coverageThreshold: {
        global: {
            branches: 35,
            functions: 35,
            lines: 38,
            statements: 38,
        },
    },

    // Coverage reporters
    coverageReporters: ['text', 'lcov', 'json', 'html'],

    // Coverage directory
    coverageDirectory: './coverage',

    // Setup files (skip if not found)
    // setupFilesAfterEnv: ['./tests/setup.js'],

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
