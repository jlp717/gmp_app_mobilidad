/**
 * GMP App Backend - Jest Configuration
 * =====================================
 * Comprehensive testing setup with coverage reporting
 */

module.exports = {
    testEnvironment: 'node',
    rootDir: '.',
    testMatch: [
        '**/tests/**/*.test.js',
        '**/__tests__/**/*.js',
    ],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
    ],
    setupFilesAfterEnv: [
        './tests/setup.js',
    ],
    moduleFileExtensions: ['js', 'json'],
    collectCoverage: false,
    coverageThreshold: {
        global: {
            statements: 32,
            branches: 25,
            functions: 31,
            lines: 33,
        },
    },
    testTimeout: 30000,
    verbose: true,
    forceExit: true,
    detectOpenHandles: false,
};