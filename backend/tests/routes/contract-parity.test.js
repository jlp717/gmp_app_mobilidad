'use strict';

/**
 * Contratos HTTP de los endpoints migrados a la arquitectura src/ en capas.
 * Los payloads esperados replican el comportamiento legacy capturado ANTES del
 * refactor (Prompt 3). Cualquier desviacion aqui = regresion observable.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth', () => ({
    verifyToken: (req, _res, next) => {
        if (!req.user) req.user = { code: 'V1', role: 'JEFE_VENTAS', isJefeVentas: true };
        next();
    },
}));
jest.mock('../../middleware/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../config/db', () => ({
    queryWithParams: jest.fn(async () => []),
    query: jest.fn(async () => []),
    getPool: jest.fn(() => ({})),
}));
jest.mock('../../services/query-optimizer', () => ({
    cachedQuery: jest.fn(async (_q, _sql, _key, _ttl, _params) => [{}]),
}));
jest.mock('../../services/redis-cache', () => ({
    TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
    redisCache: { get: jest.fn(async () => null), set: jest.fn(async () => {}) },
    deleteCachePattern: jest.fn(async () => {}),
    invalidateCache: jest.fn(async () => {}),
}));
jest.mock('../../services/laclae', () => ({
    getWeekCountsFromCache: jest.fn(),
    getTotalClientsFromCache: jest.fn(),
    getClientsForDay: jest.fn(),
    reloadRuteroConfig: jest.fn(),
    loadLaclaeCache: jest.fn(),
    getClientCurrentDay: jest.fn(),
    getNaturalOrder: jest.fn(),
    laclaeCacheLastLoadTime: 0,
}));
jest.mock('../../services/repartidor-finance-service', () => ({
    getDailySummary: jest.fn(async () => ({ repartidorId: '12', date: '2026-08-25', cobros: [], totales: { efectivo: 0 } })),
    getVencimientos: jest.fn(async () => ({ items: [{ docId: 'F-2026-1' }], total: 1, hasMore: false, nextCursor: null })),
    getCommissionSummary: jest.fn(async () => ({ rango: {}, totalComision: 0 })),
    getCommissionTiers: jest.fn(async () => []),
}));

const { errorHandler } = require('../../src/middlewares/errorHandler');
const { createDashboardRoutes } = require('../../src/routes/dashboard.routes');
const { createPlannerRoutes } = require('../../src/routes/planner.routes');
const { createRepartidorFinanzasRoutes } = require('../../src/routes/repartidorFinanzas.routes');
const laclae = require('../../services/laclae');
const financeSvc = require('../../services/repartidor-finance-service');

function appWith(router) {
    const app = express();
    app.use(router);
    app.use(errorHandler);
    return app;
}

describe('contrato /rutero/week (post-refactor)', () => {
    const app = appWith(createPlannerRoutes());

    test('cache hit => payload con week/todayName/role/totalUniqueClients/weekProgress', async () => {
        laclae.getWeekCountsFromCache.mockReturnValueOnce({ lunes: 2, martes: 4 });
        laclae.getTotalClientsFromCache.mockReturnValueOnce(6);
        const res = await request(app).get('/rutero/week?vendedorCodes=101&role=jefe').expect(200);
        const expectedToday = new Intl.DateTimeFormat('es-ES', {
            weekday: 'long',
            timeZone: 'Europe/Madrid',
        }).format(new Date()).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const expectedProgress = Object.hasOwn({ lunes: 2, martes: 4 }, expectedToday)
            ? { [expectedToday]: { total: { lunes: 2, martes: 4 }[expectedToday], delivered: 0, percentage: 0 } }
            : {};
        expect(res.body).toEqual({
            week: { lunes: 2, martes: 4 },
            todayName: expectedToday,
            role: 'jefe',
            totalUniqueClients: 6,
            weekProgress: expectedProgress,
        });
        expect(laclae.getWeekCountsFromCache).toHaveBeenCalledWith('101', 'jefe', false);
    });

    test('cache miss => fallback CDVI con cacheStatus loading', async () => {
        laclae.getWeekCountsFromCache.mockReturnValueOnce(null);
        const { queryWithParams } = require('../../config/db');
        queryWithParams.mockResolvedValueOnce([{ LUNES: '1', MARTES: '0', MIERCOLES: '0', JUEVES: '0', VIERNES: '2', SABADO: '0', DOMINGO: '0' }]);
        const res = await request(app).get('/rutero/week?vendedorCodes=101').expect(200);
        expect(res.body.cacheStatus).toBe('loading');
        expect(res.body.week.viernes).toBe(2);
        expect(res.body.totalUniqueClients).toBe(3);
    });

    test('fallo de fallback => 200 con ceros y cacheStatus error (paridad legacy)', async () => {
        laclae.getWeekCountsFromCache.mockReturnValueOnce(null);
        const { queryWithParams } = require('../../config/db');
        queryWithParams.mockRejectedValueOnce(new Error('DB2 down'));
        const res = await request(app).get('/rutero/week?vendedorCodes=101').expect(200);
        expect(res.body).toMatchObject({ cacheStatus: 'error', totalUniqueClients: 0 });
    });
});

describe('contrato /dashboard/metrics (post-refactor)', () => {
    const app = appWith(createDashboardRoutes());

    test('payload completo con claves legacy y cabeceras X-Cache-*', async () => {
        const { cachedQuery } = require('../../services/query-optimizer');
        cachedQuery
            .mockResolvedValueOnce([{ SALES: '1000', MARGIN: '300', BOXES: '50', ACTIVECLIENTS: '10' }])
            .mockResolvedValueOnce([{ SALES: '800', MARGIN: '200', BOXES: '40' }])
            .mockResolvedValue([{ SALES: '90', ORDERS: '3' }]);
        const res = await request(app).get('/metrics?year=2026&month=8&vendedorCodes=V1').expect(200);
        expect(res.headers['x-cache-hit']).toBe('false');
        expect(Object.keys(res.body)).toEqual(expect.arrayContaining([
            'period', 'totalSales', 'todaySales', 'growthPercent', 'sales', 'margin', 'clients', 'boxes',
        ]));
        expect(res.body.period).toEqual({ year: 2026, month: 8 });
    });

    test('scope denegado para vendedor sin asignacion', async () => {
        const a = express();
        a.use((req, _res, next) => { req.user = { role: 'COMERCIAL' }; next(); });
        a.use(createDashboardRoutes());
        a.use(errorHandler);
        const res = await request(a).get('/metrics?vendedorCodes=ZZZ').expect(403);
        expect(res.body.code).toBe('FORBIDDEN_VENDOR');
    });
});

describe('contrato finanzas repartidor (post-refactor)', () => {
    const app = appWith(createRepartidorFinanzasRoutes());

    test('daily-summary mantiene success+canReverseCobros:false', async () => {
        const res = await request(app).get('/daily-summary/12?date=2026-08-25').expect(200);
        expect(res.body.success).toBe(true);
        expect(res.body.canReverseCobros).toBe(false);
        expect(financeSvc.getDailySummary).toHaveBeenCalledWith({ repartidorId: '12', date: '2026-08-25' });
    });

    test('vencimientos shape range/pagination identico', async () => {
        const res = await request(app).get('/vencimientos/12?limit=200').expect(200);
        expect(res.body.range).toEqual({ from: expect.any(String), to: expect.any(String), limit: 100, search: null });
        expect(res.body.pagination).toEqual({ total: 1, limit: 100, hasMore: false, nextCursor: null });
        expect(res.body.vencimientos).toEqual([{ docId: 'F-2026-1' }]);
    });

    test('ALL selector => 422 UNSUPPORTED_REPARTIDOR_SELECTOR via errorHandler', async () => {
        const res = await request(app).get('/commissions/summary/ALL').expect(422);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe('UNSUPPORTED_REPARTIDOR_SELECTOR');
    });

    test('param invalido => 400 Invalid request con details', async () => {
        const res = await request(app).get('/daily-summary/BAD*ID').expect(400);
        expect(res.body.error).toBe('Invalid request');
        expect(Array.isArray(res.body.details)).toBe(true);
    });

    test('fallo de servicio 500 => INTERNAL_SERVER_ERROR sin filtrar mensaje', async () => {
        financeSvc.getDailySummary.mockImplementationOnce(async () => { throw new Error('[ODBC] SQL0204 secreto'); });
        const res = await request(app).get('/daily-summary/12').expect(500);
        expect(res.body).toEqual({ success: false, code: 'INTERNAL_SERVER_ERROR', error: 'Error interno del servidor' });
        expect(JSON.stringify(res.body)).not.toMatch(/ODBC|SQL0204/);
    });
});
