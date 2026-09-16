'use strict';

const { beginRouteFill, endRouteFill } = require('../services/route-cache-stampede');
const { buildJefeHotPaths, isJefeUser, scheduleJefeHotRouteWarmup } = require('../services/jefe-hot-route-warmer');

const mockGet = jest.fn();
const mockAcquire = jest.fn();
const mockRelease = jest.fn();

jest.mock('../services/redis-cache', () => ({
  redisCache: {
    get: (...args) => mockGet(...args),
    acquireLock: (...args) => mockAcquire(...args),
    releaseLock: (...args) => mockRelease(...args),
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
    expect(result).toEqual({ hit: { ok: true }, fill: false, lock: null });
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
    expect(paths[0]).toContain('/api/objectives/by-client?vendedorCodes=ALL&years=2026');
    expect(paths[1]).toContain('/api/objectives/evolution?vendedorCodes=ALL&years=2026');
    expect(paths[2]).toContain('/api/commissions/summary?vendedorCode=ALL&year=2026');
    expect(paths.join()).not.toMatch(/VENDEDOR='ALL'/);
  });

  test('schedules only for JEFE/ADMIN', () => {
    expect(isJefeUser({ isJefeVentas: true, role: 'COMERCIAL' })).toBe(true);
    expect(isJefeUser({ role: 'JEFE_VENTAS' })).toBe(true);
    expect(isJefeUser({ role: 'COMERCIAL', isJefeVentas: false })).toBe(false);
    expect(scheduleJefeHotRouteWarmup({ token: 't', role: 'COMERCIAL' })).toBe(false);
    expect(scheduleJefeHotRouteWarmup({ token: 't', role: 'JEFE_VENTAS', delayMs: 60_000 })).toBe(true);
  });
});
