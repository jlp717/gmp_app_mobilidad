'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

jest.mock('../../middleware/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

const canary = Object.freeze({
    user: ['PII', 'USER', '050'].join('-'),
    sub: ['PII', 'SUB', '050'].join('-'),
    role: ['PII', 'ROLE', 'ROOT'].join('-'),
    bearer: ['canary', 'bearer', 'value'].join('-'),
    ip: ['203', '0', '113', '77'].join('.'),
    ttl: ['PII', 'TTL', 'RAW'].join('-'),
    error: ['PII', 'ERROR', 'STACK', 'CANARY'].join('-'),
    sql: ['SELECT', 'CANARY', 'FROM', 'AUTH'].join(' '),
    path: ['', 'private', 'auth', 'canary'].join('/'),
});
const accessSecret = ['access', 'log', 'safety'].join('-').padEnd(64, 'a');
const refreshSecret = ['refresh', 'log', 'safety'].join('-').padEnd(64, 'r');
const managedEnvKeys = [
    'NODE_ENV',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'JWT_ACCESS_EXPIRES',
    'JWT_REFRESH_EXPIRES',
    'AUTH_SESSION_STORE_MODE',
    'AUTH_ALLOW_PLAINTEXT_PIN',
    'AUTH_PLAINTEXT_PIN_AUTH_UNTIL',
];
const originalEnv = Object.fromEntries(
    managedEnvKeys.map((key) => [key, process.env[key]])
);

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = accessSecret;
process.env.JWT_REFRESH_SECRET = refreshSecret;
process.env.JWT_ACCESS_EXPIRES = canary.ttl;
process.env.JWT_REFRESH_EXPIRES = canary.ttl;
process.env.AUTH_SESSION_STORE_MODE = 'memory';

const logger = require('../../middleware/logger');
const auth = require('../../middleware/auth');
const startupCalls = snapshotLogs(logger);
clearLogs(logger);

function clearLogs(targetLogger) {
    for (const level of ['debug', 'info', 'warn', 'error']) {
        targetLogger[level].mockClear();
    }
}

function snapshotLogs(targetLogger) {
    return ['debug', 'info', 'warn', 'error'].flatMap((level) =>
        targetLogger[level].mock.calls.map((args) => ({ level, args: [...args] }))
    );
}

function restoreManagedEnv() {
    for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
}

function encodedPayload(payload) {
    return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function signData(data, secret = accessSecret) {
    const signature = crypto.createHmac('sha256', secret).update(data).digest('hex');
    return `${data}.${signature}`;
}

function signedPayload(payload, secret = accessSecret) {
    return signData(encodedPayload(payload), secret);
}

function mockRequest(overrides = {}) {
    const headers = { ...(overrides.headers || {}) };
    return {
        method: canary.sql,
        path: canary.path,
        ip: canary.ip,
        headers,
        user: null,
        tokenPayload: null,
        get: (name) => headers[name.toLowerCase()] || canary.path,
        ...overrides,
    };
}

function mockResponse() {
    const response = {};
    response.status = jest.fn().mockReturnValue(response);
    response.json = jest.fn().mockReturnValue(response);
    return response;
}

function captureIsolatedLogs(configure, action) {
    const previous = Object.fromEntries(
        managedEnvKeys.map((key) => [key, process.env[key]])
    );
    let calls = [];
    try {
        configure();
        jest.isolateModules(() => {
            const isolatedLogger = require('../../middleware/logger');
            clearLogs(isolatedLogger);
            const isolatedAuth = require('../../middleware/auth');
            action(isolatedAuth);
            calls = snapshotLogs(isolatedLogger);
            isolatedAuth.shutdown();
        });
        return calls;
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

const scenarios = [
    {
        name: 'startup invalid expiry configuration',
        run: async () => startupCalls,
    },
    {
        name: 'ephemeral startup secrets',
        run: async () => captureIsolatedLogs(
            () => {
                process.env.NODE_ENV = 'test';
                delete process.env.JWT_ACCESS_SECRET;
                delete process.env.JWT_REFRESH_SECRET;
                delete process.env.JWT_ACCESS_EXPIRES;
                delete process.env.JWT_REFRESH_EXPIRES;
                process.env.AUTH_SESSION_STORE_MODE = 'memory';
            },
            () => undefined
        ),
    },
    {
        name: 'production PIN window and short secret warnings',
        run: async () => captureIsolatedLogs(
            () => {
                process.env.NODE_ENV = 'production';
                process.env.JWT_ACCESS_SECRET = 'a'.repeat(16);
                process.env.JWT_REFRESH_SECRET = 'r'.repeat(16);
                delete process.env.JWT_ACCESS_EXPIRES;
                delete process.env.JWT_REFRESH_EXPIRES;
                process.env.AUTH_SESSION_STORE_MODE = 'redis';
                process.env.AUTH_ALLOW_PLAINTEXT_PIN = 'true';
                process.env.AUTH_PLAINTEXT_PIN_AUTH_UNTIL = canary.error;
            },
            (isolatedAuth) => {
                expect(isolatedAuth.allowPlaintextPinAuth()).toBe(false);
                process.env.AUTH_PLAINTEXT_PIN_AUTH_UNTIL = new Date(
                    Date.now() + 60_000
                ).toISOString();
                expect(isolatedAuth.allowPlaintextPinAuth()).toBe(true);
            }
        ),
    },
    {
        name: 'signature length rejection',
        run: async () => {
            auth.verifyAccessToken(`${encodedPayload({ user: canary.user })}.f`);
            return snapshotLogs(logger);
        },
    },
    {
        name: 'signature mismatch rejection',
        run: async () => {
            auth.verifyAccessToken(
                `${encodedPayload({ sub: canary.sub })}.${'0'.repeat(64)}`
            );
            return snapshotLogs(logger);
        },
    },
    {
        name: 'signature comparison rejection',
        run: async () => {
            auth.verifyAccessToken(
                `${encodedPayload({ role: canary.role })}.${'z'.repeat(64)}`
            );
            return snapshotLogs(logger);
        },
    },
    {
        name: 'missing timestamp rejection',
        run: async () => {
            auth.verifyAccessToken(signedPayload({
                type: 'access',
                user: canary.user,
                sub: canary.sub,
            }));
            return snapshotLogs(logger);
        },
    },
    {
        name: 'expired token rejection',
        run: async () => {
            auth.verifyAccessToken(signedPayload({
                type: 'access',
                timestamp: Date.now() - auth.ACCESS_TTL_MS - 1,
                user: canary.user,
                sub: canary.sub,
            }));
            return snapshotLogs(logger);
        },
    },
    {
        name: 'invalid payload rejection',
        run: async () => {
            const data = Buffer.from(`${canary.sql} ${canary.path}`).toString('base64');
            auth.verifyAccessToken(signData(data));
            return snapshotLogs(logger);
        },
    },
    {
        name: 'missing bearer request',
        run: async () => {
            await auth.verifyToken(mockRequest(), mockResponse(), jest.fn());
            return snapshotLogs(logger);
        },
    },
    {
        name: 'invalid bearer request',
        run: async () => {
            await auth.verifyToken(
                mockRequest({ headers: { authorization: `Bearer ${canary.bearer}` } }),
                mockResponse(),
                jest.fn()
            );
            return snapshotLogs(logger);
        },
    },
    {
        name: 'role denial',
        run: async () => {
            auth.requireRoles('JEFE_VENTAS')(
                mockRequest({ user: { role: canary.role, code: canary.user } }),
                mockResponse(),
                jest.fn()
            );
            return snapshotLogs(logger);
        },
    },
    {
        name: 'jefe ventas denial',
        run: async () => {
            auth.requireJefeVentas(
                mockRequest({ user: { code: canary.user, role: canary.role } }),
                mockResponse(),
                jest.fn()
            );
            return snapshotLogs(logger);
        },
    },
    {
        name: 'session registration',
        run: async () => {
            const sid = ['sid', canary.sub].join('-');
            const refreshJti = ['refresh', canary.sub].join('-');
            const refreshToken = auth.signRefreshToken({
                sub: canary.sub,
                sid,
                jti: refreshJti,
                user: canary.user,
            });
            await auth.registerSession(
                canary.sub,
                refreshToken,
                canary.path,
                canary.ip,
                {
                    sid,
                    accessJti: ['access', canary.sub].join('-'),
                    refreshJti,
                }
            );
            return snapshotLogs(logger);
        },
    },
    {
        name: 'session invalidation',
        run: async () => {
            await auth.invalidateAllSessions(canary.sub);
            return snapshotLogs(logger);
        },
    },
    {
        name: 'session logout',
        run: async () => {
            await auth.handleLogout(
                mockRequest({
                    user: { id: canary.sub },
                    tokenPayload: { sid: ['sid', canary.sub].join('-'), sub: canary.sub },
                }),
                mockResponse()
            );
            return snapshotLogs(logger);
        },
    },
    {
        name: 'subsystem shutdown',
        run: async () => {
            auth.shutdown();
            return snapshotLogs(logger);
        },
    },
];

describe('Auth log redaction', () => {
    beforeEach(() => clearLogs(logger));
    afterAll(restoreManagedEnv);

    test.each(scenarios)('$name emits only allowlisted data', async ({ run }) => {
        const calls = await run();
        expect(calls.length).toBeGreaterThan(0);

        const serialized = JSON.stringify(calls);
        for (const value of Object.values(canary)) {
            expect(serialized).not.toContain(value);
        }
        for (const { args } of calls) {
            expect(args[0]).toMatch(/^AUTH_[A-Z0-9_]+$/);
            expect(args.length).toBeLessThanOrEqual(2);
            if (args.length === 2) {
                expect(Object.keys(args[1]).every((key) =>
                    ['count', 'suppressed'].includes(key)
                )).toBe(true);
                expect(Object.values(args[1]).every(Number.isSafeInteger)).toBe(true);
            }
        }
    });

    test('source keeps every logger call behind the safe emitter', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', 'middleware', 'auth.js'),
            'utf8'
        );
        const loggerCallLines = source
            .split(/\r?\n/)
            .filter((line) => /\blogger(?:\.|\[)/.test(line));

        expect(source).not.toMatch(/\bconsole\.(?:debug|info|log|warn|error)\s*\(/);
        expect(loggerCallLines).toHaveLength(2);
        expect(loggerCallLines.every((line) =>
            /logger\[safeLevel\]\(safeCode(?:, safeMetadata)?\);/.test(line)
        )).toBe(true);
        expect(source).not.toMatch(
            /logger(?:\.|\[)[^\n]*(?:\$\{[^}]*(?:req\.user|payload|error)|error\.(?:message|stack))/
        );
    });
});
