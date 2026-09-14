'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockGetClientsForDay = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

jest.mock('../config/db', () => ({
    getPool: jest.fn(),
    query: (...args) => mockQuery(...args),
    queryWithParams: (...args) => mockQueryWithParams(...args),
}));

jest.mock('../services/query-optimizer', () => ({
    cachedQuery: (queryFn, sql, _cacheKeyOrOptions, _ttl, params) =>
        queryFn(sql, params),
    patternFor: jest.requireActual('../services/query-optimizer').patternFor,
}));

jest.mock('../services/redis-cache', () => ({
    TTL: { SHORT: 60, MEDIUM: 300, LONG: 1800, REALTIME: 60 },
    deleteCachePattern: jest.fn(),
    redisCache: {
        get: (...args) => mockRedisGet(...args),
        set: (...args) => mockRedisSet(...args),
    },
}));

jest.mock('../services/laclae', () => ({
    getWeekCountsFromCache: jest.fn(() => ({ lunes: 0 })),
    getTotalClientsFromCache: jest.fn(() => 0),
    getClientsForDay: (...args) => mockGetClientsForDay(...args),
    reloadRuteroConfig: jest.fn(),
    loadLaclaeCache: jest.fn(),
    getClientCurrentDay: jest.fn(),
    getNaturalOrder: jest.fn(() => 0),
    laclaeCacheLastLoadTime: jest.fn(() => Date.now()),
}));

jest.mock('../services/emailService', () => ({
    sendAuditEmail: jest.fn(),
    sendAuditEmailNow: jest.fn(),
}));

const plannerRoutes = require('../routes/planner');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { code: '98', role: 'JEFE_VENTAS', isJefeVentas: true };
        next();
    });
    app.use('/', plannerRoutes);
    return app;
}

describe('Planner rutero/day shared concurrency', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisGet.mockResolvedValue(null);
        mockRedisSet.mockResolvedValue(true);
        mockQuery.mockResolvedValue([]);
        const clients = Array.from({ length: 600 }, (_, index) => String(4300000000 + index));
        mockGetClientsForDay.mockReturnValue(clients);
    });

    test('app.js uses /rutero/day for the report timeout, not /planner/rutero/day', () => {
        const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
        expect(source).toMatch(/originalUrl\.includes\('\/rutero\/day'\)/);
        expect(source).not.toMatch(/originalUrl\.includes\('\/planner\/rutero\/day'\)/);
    });

    test('5 families with 3 batches keep at most 3 DB queries in flight', async () => {
        let inflight = 0;
        let maxInflight = 0;
        mockQueryWithParams.mockImplementation(async () => {
            inflight += 1;
            maxInflight = Math.max(maxInflight, inflight);
            await new Promise((resolve) => setTimeout(resolve, 25));
            inflight -= 1;
            return [];
        });

        const res = await request(makeApp())
            .get('/rutero/day/lunes')
            .query({
                vendedorCodes: '01',
                role: 'comercial',
                year: '2026',
                month: '4',
                week: '4',
                forceRefresh: '1',
            });

        expect(res.status).toBe(200);
        expect(mockQueryWithParams.mock.calls.length).toBeGreaterThanOrEqual(5);
        expect(maxInflight).toBeLessThanOrEqual(3);
        expect(maxInflight).toBeGreaterThan(0);
    });
});
