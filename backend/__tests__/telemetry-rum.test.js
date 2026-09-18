'use strict';

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

jest.mock('../middleware/security', () => ({
    createRateLimiter: () => (req, res, next) => next(),
}));

jest.mock('../config/db', () => ({
    query: jest.fn(async () => []),
    queryWithParams: jest.fn(async () => []),
    getPool: jest.fn(),
    initDb: jest.fn(),
    closePool: jest.fn(),
    runWithDbRequestContext: (ctx, fn) => fn(),
    getPoolMetrics: jest.fn(() => ({})),
    acquireConfiguredConnection: jest.fn(),
}));

const express = require('express');
const logger = require('../middleware/logger');
const { auditMiddleware } = require('../middleware/audit');
const { emitRequestJsonLine, normalizeRequestPath } = require('../middleware/network-optimizer');
const dbTiming = require('../middleware/db-timing');
const telemetry = require('../routes/telemetry');
const db = require('../config/db');

describe('telemetry rum + request JSON line + audit requestId', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('audit middleware keeps the existing UUID requestId', () => {
        const req = {
            requestId: 'uuid-from-security',
            headers: {},
            path: '/api/dashboard/metrics',
            method: 'GET',
            socket: { remoteAddress: '127.0.0.1' },
        };
        const res = { on: jest.fn(), end: jest.fn() };
        auditMiddleware(req, res, () => {});
        expect(req.requestId).toBe('uuid-from-security');
    });

    test('normalizeRequestPath replaces weekday and long numbers', () => {
        expect(normalizeRequestPath('/api/rutero/day/lunes')).toBe('/api/rutero/day/:dia');
        expect(normalizeRequestPath('/api/cobros/80/pendientes')).toBe('/api/cobros/:n/pendientes');
    });

    test('emitRequestJsonLine writes t=req with db_ms', () => {
        const req = {
            requestId: 'abc-123',
            method: 'GET',
            path: '/api/rutero/day/martes',
            dbStats: { ms: 42, n: 3 },
            user: { id: 'V80' },
            get: () => 'wifi',
        };
        const res = { statusCode: 200, getHeader: () => 'HIT' };
        emitRequestJsonLine(req, res, 88);
        expect(logger.info).toHaveBeenCalled();
        const line = logger.info.mock.calls[0][0];
        const parsed = JSON.parse(line);
        expect(parsed).toMatchObject({ t: 'req', id: 'abc-123', db_ms: 42, db_n: 3, s: 200, cache: 'HIT' });
        expect(parsed.p).toBe('/api/rutero/day/:dia');
    });

    test('db-timing wrapper accumulates ms on the ALS stats object', async () => {
        const now = jest.spyOn(Date, 'now')
            .mockReturnValueOnce(1000)
            .mockReturnValueOnce(1037);
        try {
            const rows = [{ OK: 1 }];
            db.query.mockResolvedValue(rows);
            const stats = { ms: 11, n: 2, requestId: 'rid-1' };
            await expect(
                dbTiming.runWithStats(stats, () => dbTiming.query('SELECT 1', false)),
            ).resolves.toEqual(rows);
            expect(now).toHaveBeenCalledTimes(2);
            expect(stats).toMatchObject({ ms: 48, n: 3, requestId: 'rid-1' });
        } finally {
            now.mockRestore();
        }
    });

    test('POST /rum accepts up to 50 events and logs t=rum', async () => {
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            req.user = { id: 'V80' };
            req.requestId = 'corr-1';
            next();
        });
        app.use('/api/telemetry', telemetry);

        const http = require('http');
        const server = await new Promise((resolve) => {
            const s = app.listen(0, () => resolve(s));
        });
        const { port } = server.address();
        const payload = JSON.stringify({
            events: [{ endpoint: '/api/dashboard/metrics', method: 'GET', t_req: 1, t_resp: 2, rid: 'corr-1' }],
        });
        const body = await new Promise((resolve, reject) => {
            const req = http.request({
                hostname: '127.0.0.1',
                port,
                path: '/api/telemetry/rum',
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
            }, (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
            });
            req.on('error', reject);
            req.write(payload);
            req.end();
        });
        server.close();
        expect(body.status).toBe(200);
        const rumLines = logger.info.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"t":"rum"'));
        expect(rumLines.length).toBe(1);
        const logged = JSON.parse(rumLines[0]);
        expect(logged).toMatchObject({
            t: 'rum',
            u: null,
            screen: 'unknown',
            endpoint: '/dashboard',
            method: 'GET',
            status: null,
            t_req: 1,
            t_resp: 2,
            bytes: null,
            net: 'unknown',
        });
        expect(logged.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
        expect(logged.id).not.toBe('corr-1');
        expect(logged).not.toHaveProperty('rid');
        expect(logged).not.toHaveProperty('actor');
        expect(logged).not.toHaveProperty('requestId');
    });

    test('POST /rum rejects more than 50 events', async () => {
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => { req.user = { id: 'V80' }; next(); });
        app.use('/api/telemetry', telemetry);
        const http = require('http');
        const server = await new Promise((resolve) => {
            const s = app.listen(0, () => resolve(s));
        });
        const { port } = server.address();
        const events = Array.from({ length: 51 }, (_, i) => ({ endpoint: '/x', method: 'GET', t_req: i }));
        const payload = JSON.stringify({ events });
        const body = await new Promise((resolve, reject) => {
            const req = http.request({
                hostname: '127.0.0.1',
                port,
                path: '/api/telemetry/rum',
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
            }, (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => resolve({ status: res.statusCode }));
            });
            req.on('error', reject);
            req.write(payload);
            req.end();
        });
        server.close();
        expect(body.status).toBe(400);
    });
});
