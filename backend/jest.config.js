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
        // FASE 2 (P0-4): bring the orphaned TS suites into the default run.
        // ts-jest was installed but never configured, so src/__tests__
        // (incl. security/sql-injection) never executed anywhere.
        '**/src/__tests__/**/*.test.ts',
    ],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
    ],
    setupFilesAfterEnv: [
        './tests/setup.js',
    ],
    // 'js' first keeps every existing CommonJS require resolving as before.
    // src has same-named .js/.ts twins (dashboard.routes, dashboard.controller,
    // dashboard.service). The mapper pins ONLY the route mount performed by
    // src/index.ts to its .ts router; deeper .js factories keep resolving .js.
    moduleFileExtensions: ['js', 'ts', 'json'],
    moduleNameMapper: {
        '^([./]*routes/dashboard\\.routes)$': '$1.ts',
        '^([./]*controllers/dashboard\\.controller)$': '$1.ts',
        '^([./]*services/dashboard\\.service)$': '$1.ts',
    },
    transform: {
        // ts-jest for the TS suites; babel-jest MUST stay registered for
        // .js files — providing `transform` replaces jest's defaults, and
        // without babel-jest the jest.mock hoisting plugin is lost, which
        // silently breaks every JS suite that declares mocks after requires.
        '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }],
        '^.+\\.[jt]sx?$': 'babel-jest',
    },
    // L1: collectCoverage stays false on the default run — 277 suites make
    // global coverage too slow/flaky for CI red/green. The ratchet below
    // (coverageThreshold) only enforces when coverage IS collected
    // (npm run test:coverage); ratchet inicial L1, subir en L8.
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
    // L1: forceExit requerido — la suite completa se cuelga sin el
    // (verificado 2026-09-25: sin forceExit supera 300 s tras pasar los
    // tests; pool ODBC sin teardown global). Deuda: cerrar pool/teardown
    // global y re-evaluar. Diagnosticar con npm run test:diagnose.
    forceExit: true,
    detectOpenHandles: false,
};