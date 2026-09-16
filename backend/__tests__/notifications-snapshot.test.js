'use strict';

const express = require('express');
const request = require('supertest');
const { createNotificationsRouter, assembleSnapshot, SNAPSHOT_TTL_SECONDS } = require('../routes/notifications');

function memoryCache() {
    const store = new Map();
    return {
        store,
        async getOrSet(ns, key, fn) {
            const k = `${ns}:${key}`;
            if (store.has(k)) return store.get(k);
            const value = await fn();
            store.set(k, value);
            return value;
        },
    };
}

function makeApp({ loaders, cache, now } = {}) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        if (req.headers['x-test-user'] === 'none') {
            req.user = null;
            return next();
        }
        req.user = {
            id: req.headers['x-test-user'] || 'V80',
            code: req.headers['x-test-user'] || 'V80',
            role: 'COMERCIAL',
            vendedorCodes: ['80'],
            showCommissions: true,
        };
        next();
    });
    app.use('/api/notifications', createNotificationsRouter({ loaders, cache, now }));
    return app;
}

function okLoaders(overrides = {}) {
    return {
        orders: jest.fn(async () => ({ borrador: 1, pendiente: 2 })),
        kpi: jest.fn(async () => ({ totals: { alerts: 3 } })),
        ruteroHoy: jest.fn(async () => ({ count: 4, day: 'lunes' })),
        ruteroManana: jest.fn(async () => ({ count: 5, day: 'martes' })),
        facturas: jest.fn(async () => ({ hoy: { totalImporte: 10 }, mes: { totalImporte: 20 } })),
        commissions: jest.fn(async () => ({ months: [] })),
        bolsa: jest.fn(async () => ({ saldoDisponible: 100 })),
        metrics: jest.fn(async () => ({ todaySales: 50 })),
        topClients: jest.fn(async () => ([{ name: 'A' }, { name: 'B' }, { name: 'C' }])),
        stats: jest.fn(async () => ({ totalOrders: 7 })),
        ...overrides,
    };
}

describe('GET /api/notifications/snapshot', () => {
    test('rejects unauthenticated requests', async () => {
        const app = makeApp({ loaders: okLoaders(), cache: memoryCache() });
        const res = await request(app)
            .get('/api/notifications/snapshot')
            .set('x-test-user', 'none');
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('HTTP_401');
    });

    test('returns aggregated payload from existing loaders', async () => {
        const loaders = okLoaders();
        const app = makeApp({ loaders, cache: memoryCache() });
        const res = await request(app).get('/api/notifications/snapshot');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.orders).toEqual({ borrador: 1, pendiente: 2 });
        expect(res.body.kpi).toEqual({ totals: { alerts: 3 } });
        expect(res.body.ruteroHoy).toEqual({ count: 4, day: 'lunes' });
        expect(res.body.ruteroManana).toEqual({ count: 5, day: 'martes' });
        expect(res.body.facturas.hoy.totalImporte).toBe(10);
        expect(res.body.commissions).toEqual({ months: [] });
        expect(res.body.bolsa.saldoDisponible).toBe(100);
        expect(res.body.metrics.todaySales).toBe(50);
        expect(res.body.topClients).toHaveLength(3);
        expect(res.body.stats.totalOrders).toBe(7);
        expect(res.headers['x-cache-status']).toBe('MISS');
        expect(loaders.orders).toHaveBeenCalledTimes(1);
    });

    test('runs badge loaders before heavy dashboard loaders', async () => {
        const order = [];
        const loaders = okLoaders({
            orders: jest.fn(async () => {
                order.push('orders');
                return { borrador: 1, pendiente: 2 };
            }),
            kpi: jest.fn(async () => {
                order.push('kpi');
                return { totals: { alerts: 3 } };
            }),
            metrics: jest.fn(async () => {
                order.push('metrics');
                return { todaySales: 50 };
            }),
            commissions: jest.fn(async () => {
                order.push('commissions');
                return { months: [] };
            }),
        });
        await assembleSnapshot(loaders, { user: { code: '80' }, scope: { csv: '80' }, now: new Date() });
        expect(order.indexOf('orders')).toBeGreaterThanOrEqual(0);
        expect(order.indexOf('kpi')).toBeGreaterThanOrEqual(0);
        expect(Math.max(order.indexOf('orders'), order.indexOf('kpi')))
            .toBeLessThan(order.indexOf('metrics'));
        expect(Math.max(order.indexOf('orders'), order.indexOf('kpi')))
            .toBeLessThan(order.indexOf('commissions'));
    });

    test('Promise.allSettled: failed loader becomes null, others remain', async () => {
        const loaders = okLoaders({
            kpi: jest.fn(async () => { throw new Error('kpi down'); }),
            commissions: jest.fn(async () => { throw new Error('commissions down'); }),
        });
        const snapshot = await assembleSnapshot(loaders, { user: { code: '80' }, scope: { csv: '80' }, now: new Date() });
        expect(snapshot.kpi).toBeNull();
        expect(snapshot.commissions).toBeNull();
        expect(snapshot.orders).toEqual({ borrador: 1, pendiente: 2 });
        expect(snapshot.bolsa.saldoDisponible).toBe(100);
        expect(snapshot.topClients).toHaveLength(3);
    });

    test('TTL cache is per user and skips loaders on HIT', async () => {
        const loaders = okLoaders();
        const cache = memoryCache();
        const app = makeApp({ loaders, cache });
        const first = await request(app).get('/api/notifications/snapshot');
        const second = await request(app).get('/api/notifications/snapshot');
        expect(first.headers['x-cache-status']).toBe('MISS');
        expect(second.headers['x-cache-status']).toBe('HIT');
        expect(second.body.orders).toEqual(first.body.orders);
        expect(loaders.orders).toHaveBeenCalledTimes(1);
        expect(loaders.metrics).toHaveBeenCalledTimes(1);

        const other = await request(app)
            .get('/api/notifications/snapshot')
            .set('x-test-user', 'V01');
        expect(other.headers['x-cache-status']).toBe('MISS');
        expect(loaders.orders).toHaveBeenCalledTimes(2);
        expect(SNAPSHOT_TTL_SECONDS).toBe(60);
        expect(cache.store.has('notifications:snapshot:V80')).toBe(true);
        expect(cache.store.has('notifications:snapshot:V01')).toBe(true);
    });
});
