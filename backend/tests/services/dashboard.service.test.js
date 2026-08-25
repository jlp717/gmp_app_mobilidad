'use strict';

const { DashboardService } = require('../../src/services/dashboard.service');

// Fecha real del sistema: los tests derivan expectativas dinamicamente para
// no acoplarse a un dia concreto (paridad con getCurrentDate legacy).
jest.mock('../../middleware/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

function makeRepo(overrides = {}) {
    return {
        fetchPeriodAggregate: jest.fn(async () => [{}]),
        fetchBSalesByVendor: jest.fn(async () => ({})),
        ...overrides,
    };
}

function makeCache() {
    const store = new Map();
    return {
        TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
        get: jest.fn(async (_ns, key) => store.get(key)),
        set: jest.fn(async (_ns, key, val) => { store.set(key, val); }),
    };
}

describe('DashboardService.getMetrics', () => {
    const NOW = new Date();
    const Y = NOW.getFullYear();
    const M = NOW.getMonth() + 1;

    test('payload cumple contrato y anade ventas B del periodo actual', async () => {
        const repo = makeRepo({
            fetchPeriodAggregate: jest.fn()
                .mockResolvedValueOnce([{ SALES: '1000', MARGIN: '300', BOXES: '50', ACTIVECLIENTS: '12' }])
                .mockResolvedValueOnce([{ SALES: '800', MARGIN: '200', BOXES: '40' }])
                .mockResolvedValue([{ SALES: '120', ORDERS: '4' }]),
            fetchBSalesByVendor: jest.fn()
                .mockResolvedValueOnce({ V1: { [M]: 100 } })
                .mockResolvedValueOnce({ V1: { [M]: 50 } }),
        });
        const svc = new DashboardService({ repository: repo, cache: makeCache() });
        const { payload, fromCache } = await svc.getMetrics('V1', { year: String(Y), month: String(M) }, {});
        expect(fromCache).toBe(false);
        // Periodo actual => se consulta ventas de hoy
        expect(payload.period).toEqual({ year: Y, month: M });
        expect(payload.totalSales).toBeCloseTo(1100); // 1000 + 100 (ventas B)
        expect(payload.lastMonthSales).toBeCloseTo(850);
        expect(payload.todaySales).toBe(120);
        expect(payload.totalOrders).toBe(4);
        expect(payload.growthPercent).toBe(Math.round(((1100 - 850) / 850) * 100 * 10) / 10);
        expect(Object.keys(payload).sort()).toEqual([
            'avgOrderValue', 'boxes', 'clients', 'growthPercent', 'lastMonthSales',
            'margin', 'period', 'sales', 'todayOrders', 'todaySales', 'totalBoxes',
            'totalMargin', 'totalOrders', 'totalSales', 'uniqueClients',
        ].sort());
        expect(payload.sales.trend).toBe('up');
    });

    test('cache hit devuelve payload sin tocar repositorio', async () => {
        const repo = makeRepo();
        const cache = makeCache();
        const svc = new DashboardService({ repository: repo, cache });
        // Pre-cargar respuesta en la clave que generaria el service
        const warm = new DashboardService({ repository: makeRepo(), cache });
        const first = await warm.getMetrics('V1', {}, {});
        const second = await svc.getMetrics('V1', {}, {});
        expect(second.fromCache).toBe(true);
        expect(second.payload).toEqual(first.payload);
        expect(repo.fetchPeriodAggregate).not.toHaveBeenCalled();
    });

    test('forceRefresh ignora cache', async () => {
        const cache = makeCache();
        const repo = makeRepo({ fetchPeriodAggregate: jest.fn().mockResolvedValue([{}]) });
        const warmRepo = makeRepo({ fetchPeriodAggregate: jest.fn().mockResolvedValue([{ SALES: '1' }]) });
        const warm = new DashboardService({ repository: warmRepo, cache });
        await warm.getMetrics('V1', {}, {});
        const svc = new DashboardService({ repository: repo, cache });
        const res = await svc.getMetrics('V1', {}, { forceRefresh: true });
        expect(res.fromCache).toBe(false);
        expect(repo.fetchPeriodAggregate).toHaveBeenCalled();
    });

    test('periodo historico no consulta ventas de hoy', async () => {
        const repo = makeRepo({
            fetchPeriodAggregate: jest.fn().mockResolvedValue([{}]),
        });
        const svc = new DashboardService({ repository: repo, cache: makeCache() });
        const { payload } = await svc.getMetrics('ALL', { year: '2020', month: '1' }, {});
        expect(payload.todaySales).toBe(0);
        expect(repo.fetchPeriodAggregate).toHaveBeenCalledTimes(2); // curr+prev, sin today
    });
});

describe('DashboardService.getSalesEvolution', () => {
    test('granularidad mensual mapea filas y limita a months', async () => {
        // Orden DESC como el ORDER BY real de DB2 (year DESC, month DESC).
        const rows = [];
        for (let m = 6; m >= 1; m--) rows.push({ YEAR: 2026, MONTH: m, TOTALSALES: String(m * 100), TOTALORDERS: String(m), UNIQUECLIENTS: String(m * 2) });
        const repo = makeRepo({ fetchPeriodAggregate: jest.fn().mockResolvedValue(rows) });
        const svc = new DashboardService({ repository: repo, cache: makeCache() });
        const evolution = await svc.getSalesEvolution('V1', { years: '2026', months: '3' }, {});
        expect(evolution).toHaveLength(3);
        expect(evolution[0]).toMatchObject({ year: 2026, month: 6, totalSales: 600, totalOrders: 6, uniqueClients: 12 });
    });

    test('granularidad semanal agrega por semana ISO aproximada del legacy', async () => {
        const daily = [
            { YEAR: 2026, MONTH: 1, DAY: 5, SALES: '100', ORDERS: '2', CLIENTS: '2' },
            { YEAR: 2026, MONTH: 1, DAY: 6, SALES: '50', ORDERS: '1', CLIENTS: '1' },
        ];
        const repo = makeRepo({ fetchPeriodAggregate: jest.fn().mockResolvedValue(daily) });
        const svc = new DashboardService({ repository: repo, cache: makeCache() });
        const evolution = await svc.getSalesEvolution('ALL', { granularity: 'week', years: '2026' }, {});
        expect(evolution.length).toBeGreaterThanOrEqual(1);
        const wk = evolution[0];
        expect(wk.totalSales).toBeCloseTo(150);
        expect(wk.totalOrders).toBe(3);
        expect(String(wk.year)).toBe('2026');
        expect(wk.week).toBeDefined();
    });
});
