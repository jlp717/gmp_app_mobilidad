'use strict';

// Explicit .js: a .ts twin exists (used by the TS integration suites via
// moduleNameMapper); this suite tests the CommonJS DashboardService class.
const { DashboardService } = require('../../src/services/dashboard.service.js');

jest.mock('../../middleware/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

jest.mock('../../services/redis-cache', () => ({
    TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
    redisCache: { isConnected: false },
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
                .mockResolvedValue([{
                    SALES: '120', FILTEREDSALES: '120', DOCUMENTS: '4',
                    FILTEREDDOCUMENTS: '4', LEGACYFILTEREDORDERS: '4',
                    CLIENTS: '3', FILTEREDCLIENTS: '3',
                }]),
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
            'margin', 'period', 'sales', 'todayClients', 'todayClientsFiltered',
            'todayDocumentsFiltered', 'todayDocumentsGross', 'todayOrders',
            'todayOrdersFiltered', 'todaySales', 'todaySalesFiltered',
            'todaySalesGap', 'todaySalesGross', 'todayContractDate', 'totalBoxes',
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
        const ttls = repo.fetchPeriodAggregate.mock.calls.map((call) => call[3]);
        expect(ttls).toEqual([7 * 24 * 3600, 7 * 24 * 3600]);
    });

    test('current month metrics use 10 min TTL and previous year 7 days', async () => {
        const repo = makeRepo({
            fetchPeriodAggregate: jest.fn().mockResolvedValue([{}]),
        });
        const cache = makeCache();
        const svc = new DashboardService({ repository: repo, cache });
        await svc.getMetrics('ALL', { year: String(Y), month: String(M) }, {});
        const ttls = repo.fetchPeriodAggregate.mock.calls.map((call) => call[3]);
        expect(ttls[0]).toBe(10 * 60);
        expect(ttls[1]).toBe(7 * 24 * 3600);
        expect(cache.set.mock.calls[0][3]).toBe(10 * 60);
    });
});

describe('DashboardService canonico Ventas Hoy 29/09/2026', () => {
    test('Ventas Hoy separa bruto, filtro histórico, gap y documento completo para la fecha verificada', async () => {
        const NOW = new Date(2026, 8, 29, 12, 0, 0);
        const Y = 2026;
        const M = 9;
        const repo = makeRepo({
            fetchPeriodAggregate: jest.fn()
                .mockResolvedValueOnce([{ SALES: '2500000', MARGIN: '120000', BOXES: '9000', ACTIVECLIENTS: '241' }])
                .mockResolvedValueOnce([{ SALES: '2200000', MARGIN: '100000', BOXES: '8000' }])
                .mockResolvedValueOnce([{
                    SALES: '57442.76', FILTEREDSALES: '48928.95',
                    DOCUMENTS: '346', FILTEREDDOCUMENTS: '326',
                    LEGACYFILTEREDORDERS: '312',
                    CLIENTS: '255', FILTEREDCLIENTS: '241',
                }]),
            fetchBSalesByVendor: jest.fn(async () => ({})),
        });
        const svc = new DashboardService({ repository: repo, cache: makeCache(), clock: () => new Date(NOW) });
        const { payload } = await svc.getMetrics('ALL', { year: String(Y), month: String(M) }, {});
        expect(payload.todaySales).toBeCloseTo(57442.76, 2); // campo que pintan las apps ya instaladas
        expect(payload.todaySalesGross).toBeCloseTo(57442.76, 2);
        expect(payload.todaySalesFiltered).toBeCloseTo(48928.95, 2);
        expect(payload.todaySalesGap).toBe(8513.81);
        expect(payload.totalSales).toBe(2500000); // agregado mensual; independiente del canon diario
        expect(payload.totalOrders).toBe(312); // legacy app count remains unchanged
        expect(payload.todayOrders).toBe(312);
        expect(payload.todayOrdersFiltered).toBe(312); // legacy order count stays compatible
        expect(payload.todayDocumentsGross).toBe(346); // full composite document key
        expect(payload.todayDocumentsFiltered).toBe(326);
        expect(payload.todayClients).toBe(255);
        expect(payload.todayClientsFiltered).toBe(241);
        expect(payload.todayContractDate).toBe('2026-09-29');
        expect(payload.uniqueClients).toBe(241);
        expect(payload.avgOrderValue).toBeCloseTo(57442.76 / 312, 2);
        // El WHERE exterior aplica fecha y ámbito vendedor; las métricas
        // filtradas preservan por separado el universo histórico de ventas.
        const todaySql = repo.fetchPeriodAggregate.mock.calls[2][0];
        expect(todaySql).toMatch(/SUM\(L\.LCIMVT\), 0\) as sales/);
        expect(todaySql).toMatch(/SUM\(CASE WHEN L\.TPDC = 'LAC'/);
        expect(todaySql).toMatch(/COUNT\(DISTINCT CASE WHEN L\.TPDC = 'LAC'/);
        expect(todaySql).toMatch(/COUNT\(DISTINCT L\.LCSBAB \|\| DIGITS\(L\.LCYEAB\) \|\| L\.LCSRAB \|\| DIGITS\(L\.LCTRAB\) \|\| DIGITS\(L\.LCNRAB\)\) as documents/);
        expect(todaySql).toMatch(/COUNT\(DISTINCT CASE WHEN L\.TPDC = 'LAC'[\s\S]*?THEN L\.LCNRAB END\) as legacyFilteredOrders/);
        expect(todaySql).not.toMatch(/WHERE[\s\S]*AND L\.TPDC = 'LAC'/);
        expect(todaySql).not.toContain('L.LCCDVD IN'); // explicit manager ALL
        expect(repo.fetchPeriodAggregate.mock.calls[2][1]).toEqual([Y, M, 29]);
        const currSql = repo.fetchPeriodAggregate.mock.calls[0][0];
        const prevSql = repo.fetchPeriodAggregate.mock.calls[1][0];
        expect(currSql).toContain("AND L.TPDC = 'LAC'");
        expect(prevSql).toContain("AND L.TPDC = 'LAC'");
        expect(currSql).toMatch(/COUNT\(DISTINCT L\.LCCDCL\)/);
    });

    test('el ámbito comercial se enlaza por vendedor que vendió en el agregado bruto', async () => {
        const NOW = new Date(2026, 8, 29, 12, 0, 0);
        const repo = makeRepo({
            fetchPeriodAggregate: jest.fn()
                .mockResolvedValueOnce([{ SALES: '1000' }])
                .mockResolvedValueOnce([{ SALES: '900' }])
                .mockResolvedValueOnce([{ SALES: '500', DOCUMENTS: '2' }]),
            fetchBSalesByVendor: jest.fn(async () => ({})),
        });
        const svc = new DashboardService({ repository: repo, cache: makeCache(), clock: () => new Date(NOW) });
        await svc.getMetrics('V1', { year: '2026', month: '9' }, {});
        const todayCall = repo.fetchPeriodAggregate.mock.calls[2];
        expect(todayCall[0]).toContain('AND L.LCCDVD IN (?)');
        expect(todayCall[1]).toEqual([2026, 9, 29, 'V1']);
    });

    test.each([undefined, null, '', '   '])('rechaza ámbito ausente o vacío sin consultar DB2 (%s)', async (scope) => {
        const repo = makeRepo();
        const svc = new DashboardService({ repository: repo, cache: makeCache() });
        await expect(svc.getMetrics(scope, { year: '2026', month: '9' }, {})).rejects.toMatchObject({
            statusCode: 403,
            code: 'DASHBOARD_VENDOR_SCOPE_REQUIRED',
        });
        expect(repo.fetchPeriodAggregate).not.toHaveBeenCalled();
    });

    test('separa la caché de respuesta y ventas de hoy por fecha documental', () => {
        const day29 = new DashboardService({
            repository: makeRepo(), cache: makeCache(), clock: () => new Date(2026, 8, 29, 12),
        })._resolvePeriod('V1', '2026', '9');
        const day30 = new DashboardService({
            repository: makeRepo(), cache: makeCache(), clock: () => new Date(2026, 8, 30, 12),
        })._resolvePeriod('V1', '2026', '9');
        expect(day29.responseCacheKey).not.toBe(day30.responseCacheKey);
        expect(day29.todayCacheKey).not.toBe(day30.todayCacheKey);
        expect(day29.responseCacheKey).toContain(':day:2026-09-29');
        expect(day30.todayCacheKey).toContain(':today:2026-09-30');
    });

    test('consulta el canon bruto diario directamente, parametrizado y sin filtro legacy', async () => {
        const repo = makeRepo({
            fetchDailyGrossAudit: jest.fn(async () => [{ SALES: '57442.76', DOCUMENTS: '346' }]),
        });
        const svc = new DashboardService({
            repository: repo,
            cache: makeCache(),
            clock: () => new Date('2026-09-29T12:00:00.000Z'),
        });
        await expect(svc.getTodayGrossAudit('ALL')).resolves.toEqual({
            date: '2026-09-29', sales: 57442.76, documents: 346,
        });
        const [sql, params] = repo.fetchDailyGrossAudit.mock.calls[0];
        expect(sql).toContain('COALESCE(SUM(L.LCIMVT), 0)');
        expect(sql).toContain('COUNT(DISTINCT L.LCSBAB');
        expect(sql).not.toContain("TPDC = 'LAC'");
        expect(params).toEqual([2026, 9, 29]);
    });

    test('rechaza auditoría para un ámbito distinto de ALL', async () => {
        const repo = makeRepo({ fetchDailyGrossAudit: jest.fn() });
        const svc = new DashboardService({ repository: repo, cache: makeCache() });
        await expect(svc.getTodayGrossAudit('18', new Date())).rejects.toMatchObject({
            code: 'DASHBOARD_AUDIT_SCOPE_FORBIDDEN', statusCode: 403,
        });
        expect(repo.fetchDailyGrossAudit).not.toHaveBeenCalled();
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
