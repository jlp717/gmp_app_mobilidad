'use strict';

const { RuteroSemanalService, DAY_NAMES } = require('../../src/services/ruteroSemana.service');

jest.mock('../../middleware/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const NOW = new Date(2026, 7, 25); // martes
const TODAY_NAME = 'martes';

function makeSvc({ cacheCounts = null, totalClients = 0, erp = 0, app = 0, erpThrows = false, appThrows = false, weeklyRows = [], weeklyThrows = false } = {}) {
    const repo = {
        fetchErpDeliveredCount: jest.fn(async () => { if (erpThrows) throw new Error('ERP down'); return erp; }),
        fetchAppDeliveredCount: jest.fn(async () => { if (appThrows) throw new Error('DS missing'); return app; }),
        fetchWeeklyVisitCounts: jest.fn(async () => { if (weeklyThrows) throw new Error('CDVI fail'); return weeklyRows; }),
    };
    const svc = new RuteroSemanalService({
        repository: repo,
        getWeekCountsFromCache: jest.fn(() => cacheCounts),
        getTotalClientsFromCache: jest.fn(() => totalClients),
    });
    return { svc, repo };
}

describe('RuteroSemanalService.obtenerRuteroSemanal', () => {
    test('cache hit: progreso usa max(ERP, app) y payload de cache', async () => {
        const { svc, repo } = makeSvc({
            cacheCounts: { lunes: 5, martes: 4 },
            totalClients: 9,
            erp: 7,
            app: 3,
        });
        const res = await svc.obtenerRuteroSemanal({ vendedorCodes: '101,102', now: NOW });
        expect(res.variant).toBe('cache');
        expect(res.payload.week).toEqual({ lunes: 5, martes: 4 });
        expect(res.payload.totalUniqueClients).toBe(9);
        expect(res.payload.todayName).toBe(TODAY_NAME);
        expect(res.payload.weekProgress[TODAY_NAME]).toEqual({ total: 4, delivered: 7, percentage: Math.round((7 / 4) * 100) });
        // Codigo limpio: sentinelas fuera para el conteo de entregas
        expect(repo.fetchErpDeliveredCount.mock.calls[0][0]).toEqual(['101', '102']);
    });

    test('app supera a ERP cuando hay confirmaciones mayores', async () => {
        const { svc } = makeSvc({ cacheCounts: { martes: 10 }, erp: 2, app: 6 });
        const res = await svc.obtenerRuteroSemanal({ vendedorCodes: 'X1', now: NOW });
        expect(res.payload.weekProgress[TODAY_NAME].delivered).toBe(6);
    });

    test('fallo ERP no rompe: cae al conteo app', async () => {
        const { svc } = makeSvc({ cacheCounts: { martes: 3 }, erpThrows: true, app: 2 });
        const res = await svc.obtenerRuteroSemanal({ vendedorCodes: 'X1', now: NOW });
        expect(res.payload.weekProgress[TODAY_NAME].delivered).toBe(2);
    });

    test('sin clientes hoy no consulta DB de progreso', async () => {
        const { svc, repo } = makeSvc({ cacheCounts: { lunes: 3 }, erp: 5 });
        const res = await svc.obtenerRuteroSemanal({ vendedorCodes: 'X1', now: NOW });
        expect(res.payload.weekProgress).toEqual({});
        expect(repo.fetchErpDeliveredCount).not.toHaveBeenCalled();
    });

    test('cache miss: fallback CDVI mapea columnas y marca loading', async () => {
        const { svc, repo } = makeSvc({
            weeklyRows: [{ LUNES: '2', MARTES: '3', MIERCOLES: null, JUEVES: '0', VIERNES: '1', SABADO: '0', DOMINGO: '0' }],
        });
        const res = await svc.obtenerRuteroSemanal({ vendedorCodes: 'A,B', role: 'jefe', now: NOW });
        expect(res.variant).toBe('fallback');
        expect(res.payload.cacheStatus).toBe('loading');
        expect(res.payload.role).toBe('jefe');
        expect(res.payload.week).toEqual({ lunes: 2, martes: 3, miercoles: 0, jueves: 0, viernes: 1, sabado: 0, domingo: 0 });
        expect(res.payload.totalUniqueClients).toBe(6);
        expect(repo.fetchWeeklyVisitCounts.mock.calls[0][0]).toEqual(['A', 'B']);
    });

    test('fallo del fallback devuelve ceros con cacheStatus error (sin lanzar)', async () => {
        const { svc } = makeSvc({ weeklyThrows: true });
        const res = await svc.obtenerRuteroSemanal({ vendedorCodes: '', now: NOW });
        expect(res.variant).toBe('error');
        expect(res.payload.cacheStatus).toBe('error');
        expect(res.payload.totalUniqueClients).toBe(0);
        expect(Object.values(res.payload.week).every(v => v === 0)).toBe(true);
    });

    test('DAY_NAMES cubre los 7 dias y coincide con Date.getDay', () => {
        expect(DAY_NAMES[new Date(2026, 7, 25).getDay()]).toBe('martes');
        expect(DAY_NAMES.length).toBe(7);
    });
});
