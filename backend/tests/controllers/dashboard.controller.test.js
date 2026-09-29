'use strict';

jest.mock('../../middleware/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../services/redis-cache', () => ({
    TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
    redisCache: { get: jest.fn(), set: jest.fn(), isConnected: false },
    getRedisClient: jest.fn(() => null),
}));
jest.mock('../../services/emailPdfService', () => ({
    sendHtmlEmail: jest.fn(),
    escapeHtml: (value) => value,
}));

const { createMetricsController } = require('../../src/controllers/dashboard.controller');

function response(events) {
    return {
        locals: {},
        set: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn((body) => { events.push('response'); return body; }),
    };
}

describe('dashboard metrics discrepancy scheduling', () => {
    const asOf = new Date('2026-09-29T12:00:00.000Z');
    const payload = {
        todaySalesGross: 57442.76,
        todayDocumentsGross: 346,
        todayContractDate: '2026-09-29',
    };

    test('responds first and then schedules current ALL manager audit with the same instant', async () => {
        const events = [];
        const metricsService = { getMetrics: jest.fn(async () => ({ payload, fromCache: false, cacheScope: 'ALL' })) };
        const alertService = { audit: jest.fn(async () => { events.push('audit'); }) };
        const scheduled = [];
        const controller = createMetricsController({
            metricsService,
            alertService,
            now: () => asOf,
            schedule: (callback) => scheduled.push(callback),
        });
        const req = { query: { vendedorCodes: 'ALL' }, user: { role: 'JEFE_VENTAS', isJefeVentas: true } };

        await controller(req, response(events));
        expect(events).toEqual(['response']);
        expect(alertService.audit).not.toHaveBeenCalled();
        expect(metricsService.getMetrics).toHaveBeenCalledWith(
            'ALL',
            { year: 2026, month: 9 },
            { forceRefresh: false, asOf },
        );
        scheduled[0]();
        await Promise.resolve();
        expect(events).toEqual(['response', 'audit']);
        expect(alertService.audit).toHaveBeenCalledWith({ scope: 'ALL', payload, asOf });
    });

    test('does not schedule historical manager requests', async () => {
        const scheduled = [];
        const controller = createMetricsController({
            metricsService: { getMetrics: jest.fn(async () => ({ payload: {}, fromCache: true, cacheScope: 'ALL' })) },
            alertService: { audit: jest.fn() },
            now: () => asOf,
            schedule: (callback) => scheduled.push(callback),
        });
        await controller(
            { query: { vendedorCodes: 'ALL', year: '2025', month: '9' }, user: { role: 'JEFE_VENTAS', isJefeVentas: true } },
            response([]),
        );
        expect(scheduled).toHaveLength(0);
    });

    test('does not schedule commercial scope', async () => {
        const scheduled = [];
        const metricsService = { getMetrics: jest.fn(async () => ({ payload: {}, fromCache: false, cacheScope: '18' })) };
        const controller = createMetricsController({
            metricsService,
            alertService: { audit: jest.fn() },
            now: () => asOf,
            schedule: (callback) => scheduled.push(callback),
        });
        await controller(
            { query: { vendedorCodes: 'ALL' }, user: { role: 'COMERCIAL', code: '18' } },
            response([]),
        );
        expect(metricsService.getMetrics.mock.calls[0][0]).toBe('18');
        expect(scheduled).toHaveLength(0);
    });
});
