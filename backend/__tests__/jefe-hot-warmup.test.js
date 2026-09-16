'use strict';

const { beginRouteFill, endRouteFill } = require('../services/route-cache-stampede');
const { buildJefeHotPaths, isJefeUser, scheduleJefeHotRouteWarmup, PURCHASE_HISTORY_UI_LIMIT } = require('../services/jefe-hot-route-warmer');

const mockGet = jest.fn();
const mockAcquire = jest.fn();
const mockRelease = jest.fn();
const mockHasLock = jest.fn();

jest.mock('../services/redis-cache', () => ({
  redisCache: {
    get: (...args) => mockGet(...args),
    acquireLock: (...args) => mockAcquire(...args),
    releaseLock: (...args) => mockRelease(...args),
    hasLock: (...args) => mockHasLock(...args),
  },
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('route-cache-stampede', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns HIT without taking a lock', async () => {
    mockGet.mockResolvedValue({ ok: true });
    const result = await beginRouteFill('obj:evolution:ALL');
    expect(result).toEqual({ hit: { ok: true }, fill: false, lock: null, busy: false });
    expect(mockAcquire).not.toHaveBeenCalled();
  });

  test('waiter sees HIT after the filler publishes', async () => {
    mockGet
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ready: true });
    mockAcquire.mockResolvedValue(null);

    const result = await beginRouteFill('k', { waitMs: 800, pollMs: 50 });
    expect(result.hit).toEqual({ ready: true });
    expect(result.fill).toBe(false);
    expect(result.busy).toBe(false);
  });

  test('waiter does not compute a second SQL while filler lock is held', async () => {
    mockGet.mockResolvedValue(null);
    mockAcquire.mockResolvedValue(null);
    mockHasLock.mockResolvedValue(true);

    const result = await beginRouteFill('k', { waitMs: 80, pollMs: 20 });
    expect(result).toEqual({ hit: null, fill: false, lock: null, busy: true });
    expect(mockAcquire).toHaveBeenCalledTimes(1);
  });

  test('endRouteFill releases only when a lock exists', async () => {
    await endRouteFill('k', null);
    expect(mockRelease).not.toHaveBeenCalled();
    await endRouteFill('k', 'tok');
    expect(mockRelease).toHaveBeenCalledWith('route', 'fill:k', 'tok');
  });
});

describe('jefe-hot-route-warmer', () => {
  test('builds Flutter-default JEFE ALL paths', () => {
    const paths = buildJefeHotPaths(new Date('2026-09-16T10:00:00Z'));
    expect(paths[0]).toContain('/api/dashboard/metrics?vendedorCodes=ALL&year=2026');
    expect(paths[1]).toContain('/api/objectives/evolution?vendedorCodes=ALL&years=2026');
    expect(paths[2]).toContain('/api/objectives/by-client?vendedorCodes=ALL&years=2026');
    expect(paths[3]).toContain('/api/commissions/summary?vendedorCode=ALL&year=2026');
    expect(paths[4]).toContain('/api/dashboard/matrix-data?vendedorCodes=ALL');
    expect(paths[4]).toContain('groupBy=vendor');
    expect(paths[5]).toContain('/api/clients/list?vendedorCodes=ALL&limit=50');
    expect(paths[6]).toContain('/api/pedidos/purchase-history-global?vendedorCode=ALL');
    expect(paths[6]).toContain('from=2024-01-01');
    expect(paths[6]).toContain('to=2026-12-31');
    expect(paths[6]).toContain('limit=300');
    expect(PURCHASE_HISTORY_UI_LIMIT).toBe(300);
    expect(paths.join()).not.toMatch(/VENDEDOR='ALL'/);
  });

  test('JEFE 80 warms personal evolution/commissions before ALL LACLAE', () => {
    const paths = buildJefeHotPaths(new Date('2026-09-16T10:00:00Z'), { vendorCode: '80' });
    expect(paths[0]).toContain('/api/dashboard/metrics?vendedorCodes=ALL');
    expect(paths[1]).toContain('/api/objectives/evolution?vendedorCodes=80&years=2026');
    expect(paths[2]).toContain('/api/commissions/summary?vendedorCode=80&year=2026');
    expect(paths.some((path) => path.includes('vendedorCodes=ALL&years=2026'))).toBe(true);
  });

  test('schedules JEFE/ADMIN and commercial 80, not other COMERCIAL', () => {
    const { shouldWarmHotRoutes } = require('../services/jefe-hot-route-warmer');
    expect(isJefeUser({ isJefeVentas: true, role: 'COMERCIAL' })).toBe(true);
    expect(isJefeUser({ role: 'JEFE_VENTAS' })).toBe(true);
    expect(isJefeUser({ role: 'COMERCIAL', isJefeVentas: false })).toBe(false);
    expect(shouldWarmHotRoutes({ role: 'COMERCIAL', code: '80' })).toBe(true);
    expect(shouldWarmHotRoutes({ role: 'COMERCIAL', code: '35' })).toBe(false);
    expect(scheduleJefeHotRouteWarmup({ token: 't', role: 'COMERCIAL' })).toBe(false);
    expect(scheduleJefeHotRouteWarmup({ token: 't', role: 'JEFE_VENTAS', delayMs: 60_000 })).toBe(true);
    expect(scheduleJefeHotRouteWarmup({ token: 't', role: 'COMERCIAL', code: '80', delayMs: 60_000 })).toBe(true);
  });
});
