/**
 * WS9-TEST-100 · PERF-2026-09-25-sales-metrics-objectives
 *
 * Tests permanentes de la paralelizacion:
 *  - objectives.service.ts L478-480: lookups independientes (activeDays,
 *    fixedTarget, targetCfg, filas LACLAE) en un solo Promise.all.
 *  - objectives.service.ts L492: VENTAS_B por anio en Promise.all + merge
 *    via Map YEAR:MONTH. L521-525: inherited (currentClients ->
 *    clientsMonthlySales) se mantiene SERIAL por dependencia de datos.
 *  - dashboard.service.js L96-99: agregados curr+prev en Promise.all.
 *  - dashboard.service.js L142-145: B-sales ambos anios en Promise.all.
 *  - dashboard.service.js L225-228: agregados + todaySales en Promise.all.
 *  - dashboard.service.js L339-344: B-sales por anio en Promise.all + Map.
 *  - vendor ALL => clause vacia (jamas WHERE VENDEDOR='ALL').
 *  - SQL siempre parametrizado (binding ?, sin literales concatenados).
 *
 * Solo lectura de producto: mocks de odbcPool / repository. Sin DB2, sin red.
 */

jest.mock('../config/database', () => ({
  odbcPool: { query: jest.fn(), initialize: jest.fn(), isHealthy: jest.fn().mockReturnValue(true) },
  initDatabase: jest.fn(),
  closeDatabase: jest.fn(),
}));

jest.mock('../utils/query-cache', () => ({
  queryCache: {
    getOrSet: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
    get: jest.fn(),
    set: jest.fn(),
    init: jest.fn(),
    close: jest.fn(),
    invalidatePattern: jest.fn(),
    getStats: jest.fn().mockReturnValue({}),
    hasRedis: false,
  },
  TTL: { REALTIME: 0, SHORT: 60, MEDIUM: 300, LONG: 3600, STATIC: 86400 },
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../middleware/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

jest.mock('../../services/redis-cache', () => ({
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
  redisCache: { isConnected: false },
}));

jest.mock('../../services/route-cache-stampede', () => ({
  beginRouteFill: jest.fn(async () => ({ fill: true, lock: null, busy: false, hit: null })),
  endRouteFill: jest.fn(async () => undefined),
}));

import { objectivesService } from '../services/objectives.service';
import { odbcPool } from '../config/database';
import { buildVendedorFilterLACLAE, buildVendedorFilterLAC } from '../utils/vendor-helpers';

// Explicit .js: el mapper de jest redirige services/dashboard.service -> .ts;
// con extension explicita se prueba la clase CommonJS con repository inyectado.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DashboardService } = require('../services/dashboard.service.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildVendedorFilterParameterized } = require('../utils/dashboardFilters');

const mockQuery = odbcPool.query as jest.Mock;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = (n = 5) => (async () => { for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(r)); })();

function sqlOf(call: unknown[]): string {
  return String(call[0] ?? '');
}

describe('objectives.getEvolution — paralelizacion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReset();
  });

  test('L478-480: lookups independientes se solapan en un solo Promise.all', async () => {
    const gActive = deferred<Record<string, unknown>[]>();
    const gFixed = deferred<Record<string, unknown>[]>();
    const gTarget = deferred<Record<string, unknown>[]>();
    const gRows = deferred<Record<string, unknown>[]>();

    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('VENTAS_B')) return Promise.resolve([]);
      if (sql.includes('DIA_SEMANA')) return gActive.promise;
      if (sql.includes('COMMERCIAL_TARGETS')) return gFixed.promise;
      if (sql.includes('OBJ_CONFIG')) return gTarget.promise;
      if (sql.includes('GROUP BY L.LCAADC')) return gRows.promise;
      if (sql.includes('CLIENT_CODE')) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const pending = objectivesService.getEvolution({ vendedorCodes: '5', years: '2026' });
    await flush();

    // RED seria: con codigo serial antiguo, alguna de estas queries aun no se
    // habria emitido. Las 4 deben estar en vuelo a la vez.
    const sqls = mockQuery.mock.calls.map(sqlOf);
    expect(sqls.some((s) => s.includes('DIA_SEMANA'))).toBe(true);
    expect(sqls.some((s) => s.includes('COMMERCIAL_TARGETS'))).toBe(true);
    expect(sqls.some((s) => s.includes('OBJ_CONFIG'))).toBe(true);
    expect(sqls.some((s) => s.includes('GROUP BY L.LCAADC'))).toBe(true);

    gActive.resolve([]);
    gFixed.resolve([]);
    gTarget.resolve([{ TARGET_PERCENTAGE: 10 }]);
    gRows.resolve([]);
    const result = await pending;
    expect(result).toBeDefined();
    expect(result.years).toEqual([2026]);
  });

  test('L492: VENTAS_B por anio en paralelo + merge Map YEAR:MONTH', async () => {
    const gB2026 = deferred<Record<string, unknown>[]>();
    const gB2025 = deferred<Record<string, unknown>[]>();

    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('VENTAS_B')) {
        const year = (params as unknown[])?.[1];
        if (year === 2026) return gB2026.promise;
        if (year === 2025) return gB2025.promise;
        return Promise.resolve([]);
      }
      if (sql.includes('DIA_SEMANA')) return Promise.resolve([]);
      if (sql.includes('COMMERCIAL_TARGETS')) return Promise.resolve([]);
      if (sql.includes('OBJ_CONFIG')) return Promise.resolve([{ TARGET_PERCENTAGE: 10 }]);
      if (sql.includes('GROUP BY L.LCAADC')) {
        return Promise.resolve([
          { YEAR: 2026, MONTH: 1, SALES: 1000, COST: 600, CLIENTS: 5 },
          { YEAR: 2025, MONTH: 1, SALES: 900, COST: 500, CLIENTS: 4 },
        ]);
      }
      if (sql.includes('CLIENT_CODE')) return Promise.resolve([]);
      if (sql.includes('GROUP BY L.LCMMDC')) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const pending = objectivesService.getEvolution({ vendedorCodes: '5', years: '2026,2025' });
    await flush(10);

    // Años independientes: un lookup VENTAS_B por anio (2026, 2025 y 2024
    // por el prev-year incluido). 2026+2025 pendientes a la vez => Promise.all.
    const bCalls = mockQuery.mock.calls.filter((c) => sqlOf(c).includes('VENTAS_B'));
    expect(bCalls).toHaveLength(3);
    expect(bCalls.map((c) => (c[1] as unknown[])?.[1]).sort()).toEqual([2024, 2025, 2026]);

    gB2026.resolve([{ MES: 1, IMPORTE: 100 }, { MES: 2, IMPORTE: 50 }]);
    gB2025.resolve([{ MES: 1, IMPORTE: 10 }]);

    const result = await pending;
    const yd = result.yearlyData as Record<string, Array<{ month: number; sales: number }>>;
    const m1 = yd['2026'].find((m) => m.month === 1)!;
    const m2 = yd['2026'].find((m) => m.month === 2)!;
    // Equivalencia Map: existente suma, mes nuevo crea fila.
    expect(m1.sales).toBeCloseTo(1100);
    expect(m2.sales).toBeCloseTo(50);
    const totals = result.yearTotals as Record<string, { totalSales: number }>;
    expect(totals['2026'].totalSales).toBeCloseTo(1150);
    const yd25 = yd['2025'].find((m) => m.month === 1)!;
    expect(yd25.sales).toBeCloseTo(910);
  });

  test('L521-525: inherited se mantiene SERIAL (clients primero, monthly despues)', async () => {
    const gClients = deferred<Record<string, unknown>[]>();

    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('VENTAS_B')) return Promise.resolve([]);
      if (sql.includes('DIA_SEMANA')) return Promise.resolve([]);
      if (sql.includes('COMMERCIAL_TARGETS')) return Promise.resolve([]);
      if (sql.includes('OBJ_CONFIG')) return Promise.resolve([{ TARGET_PERCENTAGE: 10 }]);
      if (sql.includes('GROUP BY L.LCAADC')) {
        return Promise.resolve([{ YEAR: 2026, MONTH: 1, SALES: 5000, COST: 3000, CLIENTS: 5 }]);
      }
      if (sql.includes('CLIENT_CODE')) {
        // Primera llamada (anio corriente): pendiente. Fallback: con clientes.
        if (mockQuery.mock.calls.filter((c) => sqlOf(c).includes('CLIENT_CODE')).length <= 1) {
          return gClients.promise;
        }
        return Promise.resolve([{ CLIENT_CODE: 'C1' }]);
      }
      if (sql.includes('GROUP BY L.LCMMDC')) return Promise.resolve([{ MONTH: 3, SALES: 700, COST: 400, CLIENTS: 2 }]);
      return Promise.resolve([]);
    });

    const pending = objectivesService.getEvolution({ vendedorCodes: '5', years: '2026,2025' });
    await flush(10);

    // Mientras clients esta pendiente, el monthly heredado NO debe emitirse.
    // (GROUP BY L.LCMMDC sin GROUP BY L.LCAADC = query de getClientsMonthlySales;
    // la principal agrupa por LCAADC.)
    const isInheritedMonthly = (c: unknown[]) =>
      sqlOf(c).includes('GROUP BY L.LCMMDC') && !sqlOf(c).includes('GROUP BY L.LCAADC');
    const monthlyBefore = mockQuery.mock.calls.filter(isInheritedMonthly);
    expect(monthlyBefore).toHaveLength(0);

    gClients.resolve([]);
    const result = await pending;

    const monthlyAfter = mockQuery.mock.calls.filter(isInheritedMonthly);
    expect(monthlyAfter).toHaveLength(1);
    // La query heredada usa los clientes resueltos (dependencia de datos).
    expect(JSON.stringify(monthlyAfter[0][1])).toContain('C1');
    expect(result).toBeDefined();
  });

  test('vendor ALL => clause vacia, sin lookups por vendedor', async () => {
    mockQuery.mockImplementation(() => Promise.resolve([]));
    const result = await objectivesService.getEvolution({ vendedorCodes: 'ALL', years: '2026' });

    const sqls = mockQuery.mock.calls.map(sqlOf);
    const main = sqls.find((s) => s.includes('GROUP BY L.LCAADC')) ?? '';
    expect(main).not.toContain('LCCDVD');
    expect(main).not.toContain('ALL');
    expect(sqls.some((s) => s.includes('VENTAS_B'))).toBe(false);
    expect(sqls.some((s) => s.includes('DIA_SEMANA'))).toBe(false);
    expect(sqls.some((s) => s.includes('COMMERCIAL_TARGETS'))).toBe(false);
    expect(result).toBeDefined();

    expect(buildVendedorFilterLACLAE('ALL')).toEqual({ clause: '', params: [] });
    expect(buildVendedorFilterLAC('ALL')).toEqual({ clause: '', params: [] });
  });

  test('SQL parametrizado: multi-vendor con placeholders, sin literales', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('OBJ_CONFIG')) return Promise.resolve([{ TARGET_PERCENTAGE: 10 }]);
      return Promise.resolve([]);
    });
    await objectivesService.getEvolution({ vendedorCodes: '5,7', years: '2026' });

    const main = mockQuery.mock.calls.find((c) => sqlOf(c).includes('GROUP BY L.LCAADC'));
    expect(main).toBeDefined();
    const [sql, params] = main as [string, unknown[]];
    expect(sql).toContain('?');
    expect(sql).toContain('IN (?, ?)');
    expect(params).toEqual(expect.arrayContaining(['5', '7']));
    expect(sql).not.toContain("'5'");
    expect(sql).not.toContain("'7'");
    expect(sql).not.toMatch(/VENDEDOR\s*=\s*'ALL'/i);
  });
});

describe('dashboard.service.js — paralelizacion + vendor ALL + binding', () => {
  function makeRepo(overrides: Record<string, jest.Mock> = {}) {
    return {
      fetchPeriodAggregate: jest.fn(async () => [{}]),
      fetchBSalesByVendor: jest.fn(async () => ({})),
      ...overrides,
    };
  }
  function makeCache() {
    const store = new Map<string, unknown>();
    return {
      TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
      get: jest.fn(async (_ns: string, key: string) => store.get(key)),
      set: jest.fn(async (_ns: string, key: string, val: unknown) => { store.set(key, val); }),
    };
  }
  const NOW = new Date();
  const Y = NOW.getFullYear();
  const M = NOW.getMonth() + 1;

  test('L96-99: agregados curr+prev en Promise.all y parametrizados', async () => {
    const gCurr = deferred<Record<string, unknown>[]>();
    const gPrev = deferred<Record<string, unknown>[]>();
    const repo = makeRepo({
      fetchPeriodAggregate: jest.fn((sql: string) => {
        if (sql.includes('COUNT(DISTINCT L.LCCDCL)')) return gCurr.promise;
        return gPrev.promise;
      }),
    });
    const svc = new DashboardService({ repository: repo, cache: makeCache() });

    const pending = svc.getMetrics('V1', { year: '2020', month: '1' }, {});
    await flush();

    // Ambas queries en vuelo antes de resolver ninguna.
    expect(repo.fetchPeriodAggregate).toHaveBeenCalledTimes(2);
    const [sqlCurr, paramsCurr] = repo.fetchPeriodAggregate.mock.calls[0];
    const [sqlPrev, paramsPrev] = repo.fetchPeriodAggregate.mock.calls[1];
    expect(sqlCurr).toContain('?');
    expect(sqlPrev).toContain('?');
    expect(paramsCurr.slice(0, 2)).toEqual([2020, 1]);
    expect(paramsPrev.slice(0, 2)).toEqual([2019, 1]);
    expect(JSON.stringify([sqlCurr, sqlPrev])).not.toContain("'V1'");
    expect(paramsCurr).toEqual(expect.arrayContaining(['V1']));

    gCurr.resolve([{ SALES: '1000', MARGIN: '300', BOXES: '50', ACTIVECLIENTS: '12' }]);
    gPrev.resolve([{ SALES: '800', MARGIN: '200', BOXES: '40' }]);
    const { payload } = await pending;
    expect(payload.period).toEqual({ year: 2020, month: 1 });
    expect(payload.totalSales).toBeCloseTo(1000);
  });

  test('L142-145: B-sales ambos anios en paralelo; ALL usa scope []', async () => {
    const gBcurr = deferred<Record<string, unknown>>();
    const gBlast = deferred<Record<string, unknown>>();
    const repo = makeRepo({
      fetchPeriodAggregate: jest.fn(async () => [{ SALES: '1000', MARGIN: '1', BOXES: '1', ACTIVECLIENTS: '1' }]),
      fetchBSalesByVendor: jest.fn((year: number) => (year === 2020 ? gBcurr.promise : gBlast.promise)),
    });
    const svc = new DashboardService({ repository: repo, cache: makeCache() });

    const pending = svc.getMetrics('V1', { year: '2020', month: '1' }, {});
    await flush(10);

    expect(repo.fetchBSalesByVendor).toHaveBeenCalledTimes(2);
    const years = repo.fetchBSalesByVendor.mock.calls.map((c) => c[0]).sort();
    expect(years).toEqual([2019, 2020]);
    // Scope propagates: vendedor concreto viaja como param, no como literal.
    expect(repo.fetchBSalesByVendor.mock.calls[0][1]).toBe('V1');

    gBcurr.resolve({ V1: { 1: 100 } });
    gBlast.resolve({ V1: { 1: 50 } });
    const { payload } = await pending;
    expect(payload.totalSales).toBeCloseTo(1100);
    expect(payload.lastMonthSales).toBeCloseTo(1050);

    // Vendor ALL => bSalesScope [] (clause vacia, sin IN de ~80 codigos).
    const repoAll = makeRepo({ fetchPeriodAggregate: jest.fn(async () => [{}]) });
    const svcAll = new DashboardService({ repository: repoAll, cache: makeCache() });
    await svcAll.getMetrics('ALL', { year: '2020', month: '1' }, {});
    for (const call of repoAll.fetchBSalesByVendor.mock.calls) {
      expect(call[1]).toEqual([]);
    }
    for (const call of repoAll.fetchPeriodAggregate.mock.calls) {
      expect(String(call[0])).not.toContain('ALL');
      expect(call[1]).toHaveLength(2); // solo [year, month], sin params de vendor
    }
  });

  test('L225-228: agregados y todaySales se solapan (mes corriente)', async () => {
    const gates: Array<Promise<Record<string, unknown>[]>> = [];
    const resolvers: Array<(v: Record<string, unknown>[]) => void> = [];
    const repo = makeRepo({
      fetchPeriodAggregate: jest.fn(() => {
        const g = deferred<Record<string, unknown>[]>();
        gates.push(g.promise);
        resolvers.push(g.resolve);
        return g.promise;
      }),
    });
    const svc = new DashboardService({ repository: repo, cache: makeCache() });

    const pending = svc.getMetrics('V1', { year: String(Y), month: String(M) }, {});
    await flush();

    // curr + prev + today en vuelo a la vez => paralelizado, no serial.
    expect(repo.fetchPeriodAggregate).toHaveBeenCalledTimes(3);
    expect(gates).toHaveLength(3);

    resolvers[0]([{ SALES: '1000', MARGIN: '300', BOXES: '50', ACTIVECLIENTS: '12' }]);
    resolvers[1]([{ SALES: '800', MARGIN: '200', BOXES: '40' }]);
    resolvers[2]([{ SALES: '120', ORDERS: '4' }]);
    const { payload } = await pending;
    expect(payload.todaySales).toBe(120);
    expect(payload.totalOrders).toBe(4);
  });

  test('L339-344: evolution B-sales por anio en paralelo + Map YEAR:MONTH', async () => {
    const gB26 = deferred<Record<string, unknown>>();
    const gB25 = deferred<Record<string, unknown>>();
    const repo = makeRepo({
      fetchPeriodAggregate: jest.fn(async () => [
        { YEAR: 2026, MONTH: 1, TOTALSALES: '100', TOTALORDERS: '2', UNIQUECLIENTS: '2' },
        { YEAR: 2025, MONTH: 1, TOTALSALES: '200', TOTALORDERS: '3', UNIQUECLIENTS: '3' },
      ]),
      fetchBSalesByVendor: jest.fn((year: number) => (year === 2026 ? gB26.promise : gB25.promise)),
    });
    const svc = new DashboardService({ repository: repo, cache: makeCache() });

    const pending = svc.getSalesEvolution('V1', { years: '2026,2025' });
    await flush(10);

    expect(repo.fetchBSalesByVendor).toHaveBeenCalledTimes(2);

    gB26.resolve({ V1: { 1: 25 } });
    gB25.resolve({ V1: { 1: 75 } });
    const rows = await pending;
    const r26 = rows.find((r: { year: number; month: number }) => r.year === 2026 && r.month === 1)!;
    const r25 = rows.find((r: { year: number; month: number }) => r.year === 2025 && r.month === 1)!;
    expect(r26.totalSales).toBeCloseTo(125);
    expect(r25.totalSales).toBeCloseTo(275);
  });

  test('vendor ALL => filter vacio, jamas WHERE ... = ALL', () => {
    expect(buildVendedorFilterParameterized('ALL')).toEqual({ filter: '', params: [] });
    expect(buildVendedorFilterParameterized('')).toEqual({ filter: '', params: [] });
    const single = buildVendedorFilterParameterized('15');
    expect(single.params).toEqual(['15']);
    expect(single.filter).toContain('?');
    expect(single.filter).not.toContain('ALL');
  });
});
