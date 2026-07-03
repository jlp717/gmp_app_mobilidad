'use strict';

jest.mock('../config/db', () => ({
    queryWithParams: jest.fn(),
}));

jest.mock('../middleware/auth', () => ({
    verifyPassword: jest.fn((password, hash) => Promise.resolve(hash === `hash:${password}`)),
    hashPassword: jest.fn((password) => Promise.resolve(`hash:${password}`)),
    allowPlaintextPinAuth: jest.fn(() => false),
}));

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const { queryWithParams } = require('../config/db');
const auth = require('../middleware/auth');
const { verifyVendorPin } = require('../services/vendor-pin-auth');

describe('vendor pin auth', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        auth.allowPlaintextPinAuth.mockReturnValue(false);
    });

    test('accepts migrated bcrypt hash when plaintext fallback is disabled', async () => {
        queryWithParams.mockResolvedValueOnce([{ PIN_HASH: 'hash:9322' }]);

        const result = await verifyVendorPin({
            vendedorCode: '98',
            candidatePin: '9322',
            dbPin: '9322',
            requestId: 'test',
        });

        expect(result).toEqual({ valid: true, method: 'migrated_hash', reason: null });
        expect(auth.verifyPassword).toHaveBeenCalledWith('9322', 'hash:9322');
        expect(auth.allowPlaintextPinAuth).not.toHaveBeenCalled();
    });

    test('denies plaintext PIN when production fallback is disabled and no hash exists', async () => {
        queryWithParams.mockResolvedValueOnce([]);

        const result = await verifyVendorPin({
            vendedorCode: '98',
            candidatePin: '9322',
            dbPin: '9322',
            requestId: 'test',
        });

        expect(result).toEqual({ valid: false, reason: 'plaintext_pin_denied' });
        expect(auth.allowPlaintextPinAuth).toHaveBeenCalled();
    });

    test('migrates plaintext PIN when temporary fallback is enabled', async () => {
        auth.allowPlaintextPinAuth.mockReturnValue(true);
        queryWithParams
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);

        const result = await verifyVendorPin({
            vendedorCode: '98',
            candidatePin: '9322',
            dbPin: '9322',
            requestId: 'test',
        });

        expect(result).toEqual({ valid: true, method: 'plaintext_migrated' });
        expect(auth.hashPassword).toHaveBeenCalledWith('9322', 12);
        expect(queryWithParams).toHaveBeenLastCalledWith(expect.stringContaining('MERGE INTO JAVIER.VENDOR_PIN_HASHES'), ['98', 'hash:9322'], false);
    });
});
