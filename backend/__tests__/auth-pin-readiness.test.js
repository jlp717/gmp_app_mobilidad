'use strict';

jest.mock('../config/db', () => ({
    queryWithParams: jest.fn(),
}));

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const { queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');
const {
    checkAuthPinHashReadiness,
    resetAuthPinReadinessCache,
} = require('../services/auth-pin-readiness');

describe('auth PIN readiness', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetAuthPinReadinessCache();
    });

    test('reports ready when every active vendor has a PIN hash', async () => {
        queryWithParams.mockResolvedValueOnce([{
            TOTAL_ACTIVE_VENDORS: 64,
            MISSING_HASHES: 0,
        }]);

        const result = await checkAuthPinHashReadiness({
            force: true,
            cacheMs: 0,
            now: Date.parse('2026-07-03T09:00:00Z'),
        });

        expect(result).toEqual(expect.objectContaining({
            status: 'ready',
            totalActiveVendors: 64,
            hashedVendors: 64,
            missingHashes: 0,
            missingExamples: [],
            cached: false,
        }));
        expect(queryWithParams).toHaveBeenCalledTimes(1);
    });

    test('reports not ready and bounded vendor examples when hashes are missing', async () => {
        queryWithParams
            .mockResolvedValueOnce([{ TOTAL_ACTIVE_VENDORS: 64, MISSING_HASHES: 2 }])
            .mockResolvedValueOnce([{ CODIGOVENDEDOR: '02' }, { CODIGOVENDEDOR: '99' }]);

        const result = await checkAuthPinHashReadiness({
            force: true,
            cacheMs: 0,
            exampleLimit: 2,
        });

        expect(result).toEqual(expect.objectContaining({
            status: 'not_ready',
            totalActiveVendors: 64,
            hashedVendors: 62,
            missingHashes: 2,
            missingExamples: ['02', '99'],
        }));
    });

    test('returns error status when the readiness query fails', async () => {
        queryWithParams.mockRejectedValueOnce(new Error('VENDOR_PIN_HASHES missing'));

        const result = await checkAuthPinHashReadiness({
            force: true,
            cacheMs: 0,
        });

        expect(result).toEqual(expect.objectContaining({
            status: 'error',
            error: 'VENDOR_PIN_HASHES missing',
            missingHashes: null,
        }));
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('PIN hash readiness check failed'));
    });
});
