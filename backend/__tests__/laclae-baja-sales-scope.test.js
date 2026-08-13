/**
 * Baja fichas (vendor transfers) must stay in sales client-scope
 * but must not appear on the commercial day route.
 */
const {
    getClientCodesFromCache,
    getClientsForDay,
    getWeekCountsFromCache,
    getTotalClientsFromCache,
    clearLaclaeCache,
    __setLaclaeCacheForTests,
    isAnoBaja,
} = require('../services/laclae');

describe('laclae baja dual-use (sales vs visits)', () => {
    afterEach(() => {
        clearLaclaeCache();
    });

    test('isAnoBaja treats 0/null/undefined as active', () => {
        expect(isAnoBaja(0)).toBe(false);
        expect(isAnoBaja(null)).toBe(false);
        expect(isAnoBaja(undefined)).toBe(false);
        expect(isAnoBaja('')).toBe(false);
        expect(isAnoBaja(2026)).toBe(true);
        expect(isAnoBaja('2026')).toBe(true);
    });

    test('getClientCodesFromCache includes baja clients for sales scope', () => {
        __setLaclaeCacheForTests({
            '02': {
                '4300009627': {
                    visitDays: ['lunes', 'miercoles'],
                    deliveryDays: [],
                    isBaja: true,
                },
                '4300001111': {
                    visitDays: ['martes'],
                    deliveryDays: [],
                    isBaja: false,
                },
            },
        });

        const codes = getClientCodesFromCache('02');
        expect(codes).toEqual(expect.arrayContaining(['4300009627', '4300001111']));
        expect(codes).toHaveLength(2);
    });

    test('getClientsForDay excludes baja clients from the day route', () => {
        __setLaclaeCacheForTests({
            '02': {
                '4300009627': {
                    visitDays: ['lunes'],
                    deliveryDays: [],
                    isBaja: true,
                },
                '4300001111': {
                    visitDays: ['lunes'],
                    deliveryDays: [],
                    isBaja: false,
                },
            },
        });

        const clients = getClientsForDay('02', 'lunes', 'comercial', true);
        expect(clients).toEqual(['4300001111']);
    });

    test('getWeekCountsFromCache and getTotalClientsFromCache ignore baja', () => {
        __setLaclaeCacheForTests({
            '02': {
                '4300009627': {
                    visitDays: ['lunes', 'martes'],
                    deliveryDays: [],
                    isBaja: true,
                },
                '4300001111': {
                    visitDays: ['lunes'],
                    deliveryDays: [],
                    isBaja: false,
                },
            },
        });

        const counts = getWeekCountsFromCache('02', 'comercial', true);
        expect(counts.lunes).toBe(1);
        expect(counts.martes).toBe(0);
        expect(getTotalClientsFromCache('02', 'comercial')).toBe(1);
    });

    test('week and day lookups resolve padded vendor codes', () => {
        __setLaclaeCacheForTests({
            '05': {
                '4300001111': {
                    visitDays: ['lunes'],
                    deliveryDays: [],
                    isBaja: false,
                },
            },
        });

        expect(getWeekCountsFromCache('5', 'comercial', true).lunes).toBe(1);
        expect(getClientsForDay('5', 'lunes', 'comercial', true)).toEqual(['4300001111']);
        expect(getTotalClientsFromCache('05', 'comercial')).toBe(1);
    });
});
