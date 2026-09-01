/**
 * FASE 1 — Characterization tests for services/laclae.js
 * Purpose: pin current observable behavior BEFORE any refactor of the
 * rutero config cache (P0-2 staleness fix candidate, FASE 2).
 *
 * These tests assert what the code DOES today, not what would be ideal.
 * No production code was modified for this file.
 *
 * Evidence baseline (must stay green against unmodified HEAD):
 *   cd backend && npx jest __tests__/laclae-characterization.test.js
 */
jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}));

const {
    __setLaclaeCacheForTests,
    clearLaclaeCache,
    isCacheReady,
    getClientDays,
    getClientCurrentDay,
    getNaturalOrder,
    isAnoBaja,
} = require('../services/laclae');

function seedVendorCache() {
    __setLaclaeCacheForTests({
        '10': {
            // Client with explicit visit + delivery days and natural order
            '0001': {
                visitDays: ['lunes', 'jueves'],
                deliveryDays: ['martes', 'viernes'],
                isBaja: false,
                naturalOrder: { lunes: 3, jueves: 7 },
            },
            // Delivery-only client (LACLAE fallback shape)
            '0002': {
                visitDays: [],
                deliveryDays: ['miercoles'],
                isBaja: false,
            },
        },
        '20': {
            // Same client code under a second vendor, no visit days
            '0001': {
                visitDays: [],
                deliveryDays: ['sabado'],
                isBaja: false,
            },
        },
    });
}

beforeEach(() => {
    seedVendorCache();
});

afterAll(() => {
    clearLaclaeCache();
});

describe('isCacheReady / seeding helper', () => {
    test('reports ready after test seeding', () => {
        expect(isCacheReady()).toBe(true);
    });

    test('isAnoBaja: 0/null/undefined are active, non-zero numeric is baja', () => {
        expect(isAnoBaja(0)).toBe(false);
        expect(isAnoBaja('0')).toBe(false);
        expect(isAnoBaja(null)).toBe(false);
        expect(isAnoBaja(undefined)).toBe(false);
        expect(isAnoBaja(2024)).toBe(true);
        expect(isAnoBaja('2025')).toBe(true);
    });
});

describe('getClientDays', () => {
    test('returns visit and delivery days with short labels for a known vendor-client pair', () => {
        const result = getClientDays('10', '0001');
        expect(result).toEqual({
            visitDays: ['lunes', 'jueves'],
            deliveryDays: ['martes', 'viernes'],
            visitDaysShort: 'LJ',
            deliveryDaysShort: 'MV',
        });
    });

    test('returns null when client is unknown', () => {
        expect(getClientDays('10', '9999')).toBeNull();
    });

    test('returns null when cache is not ready', () => {
        __setLaclaeCacheForTests({}, { ready: false });
        expect(getClientDays('10', '0001')).toBeNull();
    });

    test('cross-vendor fallback prefers the vendor with non-empty visit days', () => {
        const result = getClientDays(null, '0001');
        // Vendor '10' has visit days so it wins over '20' (delivery-only),
        // regardless of Object.entries iteration order.
        expect(result.foundVendor).toBe('10');
        expect(result.visitDays).toEqual(['lunes', 'jueves']);
    });

    test('cross-vendor fallback keeps delivery-only vendor when no visit days exist anywhere', () => {
        const result = getClientDays(null, '0002');
        expect(result.foundVendor).toBe('10');
        expect(result.deliveryDays).toEqual(['miercoles']);
        expect(result.visitDays).toEqual([]);
    });

    test('returns null without clientCode even if cache ready', () => {
        expect(getClientDays('10', '')).toBeNull();
        expect(getClientDays('10', null)).toBeNull();
    });
});

describe('getClientCurrentDay', () => {
    test('returns the first natural visit day when no RUTERO_CONFIG override exists', () => {
        // Seeded cache has no ruteroConfigCache, so the natural day path runs.
        expect(getClientCurrentDay('10', '0001')).toBe('lunes');
    });

    test('returns null for unknown client or vendor', () => {
        expect(getClientCurrentDay('99', '0001')).toBeNull();
        expect(getClientCurrentDay('10', '9999')).toBeNull();
    });

    test('returns null when cache is not ready', () => {
        __setLaclaeCacheForTests({}, { ready: false });
        expect(getClientCurrentDay('10', '0001')).toBeNull();
    });
});

describe('getNaturalOrder', () => {
    test('returns the stored order for a seeded day', () => {
        expect(getNaturalOrder('10', '0001', 'lunes')).toBe(3);
        expect(getNaturalOrder('10', '0001', 'jueves')).toBe(7);
    });

    test('returns 0 for a day with no stored order (raw value; planner owns the fallback)', () => {
        // laclae.js:719-720 — comment says planner handles fallback, this
        // returns `order || 0`, so an unseeded day yields 0, not a sentinel.
        expect(getNaturalOrder('10', '0001', 'martes')).toBe(0);
    });

    test('returns 9999 when vendor, client, or day is missing', () => {
        expect(getNaturalOrder('', '0001', 'lunes')).toBe(9999);
        expect(getNaturalOrder('10', '', 'lunes')).toBe(9999);
        expect(getNaturalOrder('10', '0001', '')).toBe(9999);
    });

    test('returns raw value including zero (fallback handled by planner)', () => {
        __setLaclaeCacheForTests({
            '10': { '0003': { visitDays: ['lunes'], deliveryDays: [], isBaja: false, naturalOrder: { lunes: 0 } } },
        });
        expect(getNaturalOrder('10', '0003', 'lunes')).toBe(0);
    });
});
