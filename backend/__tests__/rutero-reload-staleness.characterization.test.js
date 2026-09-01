/**
 * FASE 1 — Characterization test for the rutero config reload path.
 * Pins the CURRENT behavior of `reloadRuteroConfig()` in services/laclae.js,
 * including the known multi-instance staleness gap (FASE 0, P0-2):
 *
 *   reloadRuteroConfig() refreshes ruteroConfigCache ONLY in the process
 *   that calls it. It does NOT notify other cluster instances (no Redis
 *   pub/sub publish), so the other instances keep serving stale rutero
 *   overrides until their own TTL/next reload.
 *
 * This test documents that behavior as-is so FASE 2 can change it
 * deliberately (and visibly) instead of accidentally.
 *
 * Evidence baseline (green against unmodified HEAD):
 *   cd backend && npx jest __tests__/rutero-reload-staleness.characterization.test.js
 */
jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}));

// Spy surface: if a future change starts publishing invalidations, the
// "does not publish" assertions below will fail — that is the intended
// tripwire for the FASE 2 fix.
// Spy surface for the cross-instance convergence hook (FASE 2 fix).
// The redis-cache mock records the hook laclae registers at module load so
// tests can invoke it as if a pub/sub message had arrived.
let mockRegisteredHook = null;
const mockRedisCacheMocks = {
    invalidateCache: jest.fn(),
    invalidateCachePattern: jest.fn(),
    deleteCache: jest.fn(),
    deleteCachePattern: jest.fn(),
    setCache: jest.fn(),
    getCache: jest.fn(),
    initCache: jest.fn(),
    onInvalidationPattern: jest.fn((hook) => {
        mockRegisteredHook = hook;
        return () => { mockRegisteredHook = null; };
    }),
};
jest.mock('../services/redis-cache', () => ({
    __esModule: false,
    redisCache: {
        init: jest.fn(),
        get: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
        invalidatePattern: jest.fn(),
        getStats: jest.fn(() => ({})),
    },
    TTL: { SHORT: 300, MEDIUM: 1800, LONG: 86400, REALTIME: 60 },
    ...mockRedisCacheMocks,
}));

// Fake ODBC pool: one connect() returning a scripted connection.
const mockConn = {
    query: jest.fn(),
    close: jest.fn(),
};
const mockPool = {
    connect: jest.fn(() => Promise.resolve(mockConn)),
};
jest.mock('../config/db', () => ({
    __esModule: false,
    getPool: jest.fn(() => mockPool),
}));

const {
    __setLaclaeCacheForTests,
    clearLaclaeCache,
    getClientCurrentDay,
    reloadRuteroConfig,
} = require('../services/laclae');

beforeEach(() => {
    jest.clearAllMocks();
    __setLaclaeCacheForTests({
        '10': {
            '0001': {
                visitDays: ['lunes'],
                deliveryDays: [],
                isBaja: false,
            },
        },
    });
});

afterAll(() => {
    clearLaclaeCache();
});

describe('reloadRuteroConfig (current behavior, laclae.js:145-155)', () => {
    test('replaces in-process ruteroConfigCache from JAVIER.RUTERO_CONFIG rows', async () => {
        mockConn.query.mockResolvedValueOnce([
            { VENDEDOR: '10', CLIENTE: '0001', DIA: 'viernes', ORDEN: 0 },
        ]);

        await reloadRuteroConfig();

        expect(mockPool.connect).toHaveBeenCalledTimes(1);
        // Overrides are stored keyed by lowercase day (laclae.js:134).
        expect(getClientCurrentDay('10', '0001')).toBe('viernes');
        expect(mockConn.close).toHaveBeenCalledTimes(1);
    });

    test('positive override wins over natural visit day; blocking entries (ORDEN < 0) do not', async () => {
        mockConn.query.mockResolvedValueOnce([
            { VENDEDOR: '10', CLIENTE: '0001', DIA: 'miercoles', ORDEN: -1 }, // blocking
            { VENDEDOR: '10', CLIENTE: '0001', DIA: 'jueves', ORDEN: 2 },    // positive
        ]);

        await reloadRuteroConfig();

        // getClientCurrentDay skips order < 0 entries and returns the
        // first positive override day (laclae.js:626-629).
        expect(getClientCurrentDay('10', '0001')).toBe('jueves');
    });

    test('an empty config reload clears overrides and falls back to natural days', async () => {
        mockConn.query.mockResolvedValueOnce([
            { VENDEDOR: '10', CLIENTE: '0001', DIA: 'viernes', ORDEN: 0 },
        ]);
        await reloadRuteroConfig();
        expect(getClientCurrentDay('10', '0001')).toBe('viernes');

        // Second reload returns zero rows -> ruteroConfigCache reset to {}
        mockConn.query.mockResolvedValueOnce([]);
        await reloadRuteroConfig();

        expect(getClientCurrentDay('10', '0001')).toBe('lunes');
    });

    test('swallows DB errors: cache keeps previous overrides, connection still closed', async () => {
        mockConn.query.mockResolvedValueOnce([
            { VENDEDOR: '10', CLIENTE: '0001', DIA: 'viernes', ORDEN: 0 },
        ]);
        await reloadRuteroConfig();

        mockConn.query.mockRejectedValueOnce(new Error('SQL0817 connector error'));
        await reloadRuteroConfig();

        expect(getClientCurrentDay('10', '0001')).toBe('viernes');
        expect(mockConn.close).toHaveBeenCalledTimes(2);
    });

    test('does nothing when the DB pool is not initialized', async () => {
        const { getPool } = require('../config/db');
        getPool.mockReturnValueOnce(null);

        await reloadRuteroConfig();

        expect(mockPool.connect).not.toHaveBeenCalled();
    });

    test('STALENESS FIX (was P0-2): reload publishes the dedicated laclae:rutero-config pattern so other instances converge', async () => {
        mockConn.query.mockResolvedValueOnce([
            { VENDEDOR: '10', CLIENTE: '0001', DIA: 'viernes', ORDEN: 0 },
        ]);

        await reloadRuteroConfig();

        // New contract (FASE 2): reloadRuteroConfig publishes exactly the
        // dedicated pattern consumed by the cross-instance hook. It must NOT
        // republish planner's own cache families (rutero:config:v2 etc.) —
        // planner.js already scopes those per-vendedor.
        expect(mockRedisCacheMocks.deleteCachePattern).toHaveBeenCalledTimes(1);
        expect(mockRedisCacheMocks.deleteCachePattern).toHaveBeenCalledWith('laclae:rutero-config:*');
        expect(mockRedisCacheMocks.invalidateCachePattern).not.toHaveBeenCalled();
        expect(mockRedisCacheMocks.invalidateCache).not.toHaveBeenCalled();
        expect(mockRedisCacheMocks.deleteCache).not.toHaveBeenCalled();
        expect(mockRedisCacheMocks.setCache).not.toHaveBeenCalled();
    });

    test('a pub/sub failure does not fail the reload: local cache still refreshed, error swallowed', async () => {
        mockConn.query.mockResolvedValueOnce([
            { VENDEDOR: '10', CLIENTE: '0001', DIA: 'viernes', ORDEN: 0 },
        ]);
        mockRedisCacheMocks.deleteCachePattern.mockRejectedValueOnce(new Error('Redis ECONNREFUSED'));

        await expect(reloadRuteroConfig()).resolves.toBeUndefined();

        // Local reload still applied.
        expect(getClientCurrentDay('10', '0001')).toBe('viernes');
    });

    test('cross-instance hook: receiving gmp:laclae:rutero-config:* reloads the local cache and does NOT re-publish (no loop)', async () => {
        expect(typeof mockRegisteredHook).toBe('function');

        // Simulate another instance's write: the hook fires with the
        // published pattern. This instance reloads from its own DB2 pool.
        mockConn.query.mockResolvedValueOnce([
            { VENDEDOR: '10', CLIENTE: '0001', DIA: 'sabado', ORDEN: 1 },
        ]);

        mockRegisteredHook('gmp:laclae:rutero-config:*');
        // Hook is fire-and-forget; let the async local reload settle.
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(mockPool.connect).toHaveBeenCalledTimes(1);
        expect(getClientCurrentDay('10', '0001')).toBe('sabado');
        // No echo: the hook path must not publish again.
        expect(mockRedisCacheMocks.deleteCachePattern).not.toHaveBeenCalled();
    });

    test('cross-instance hook ignores unrelated patterns', async () => {
        mockRegisteredHook('gmp:clients:list:*');
        await new Promise((resolve) => setTimeout(resolve, 5));

        expect(mockPool.connect).not.toHaveBeenCalled();
    });
});
