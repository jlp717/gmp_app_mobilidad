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
const { verifyVendorPin, _private } = require('../services/vendor-pin-auth');

describe('vendor pin auth', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        auth.allowPlaintextPinAuth.mockReturnValue(false);
        _private.clearPinFailures('98');
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

    test('locks the account after repeated PIN failures', async () => {
        // Vendor aislado para no contaminar el estado del resto de la suite.
        const code = '97LOCK';
        _private.clearPinFailures(code);
        queryWithParams.mockResolvedValue([]);

        for (let i = 0; i < 5; i += 1) {
            const result = await verifyVendorPin({
                vendedorCode: code,
                candidatePin: `wrong${i}`,
                dbPin: '9999',
                requestId: 'test',
            });
            expect(result.valid).toBe(false);
        }

        // 6º intento con el PIN CORRECTO: cuenta bloqueada.
        const blocked = await verifyVendorPin({
            vendedorCode: code,
            candidatePin: '9999',
            dbPin: '9999',
            requestId: 'test',
        });
        expect(blocked).toEqual({ valid: false, reason: 'account_locked' });

        _private.clearPinFailures(code);
    });

    test('resets the failure counter on a successful login', async () => {
        const code = '96LOCK';
        _private.clearPinFailures(code);

        // 4 fallos previos (sin hash -> pin_mismatch), luego hash disponible.
        queryWithParams
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValue([{ PIN_HASH: 'hash:1234' }]);

        for (let i = 0; i < 4; i += 1) {
            await verifyVendorPin({ vendedorCode: code, candidatePin: 'xxxx', dbPin: '', requestId: 'test' });
        }

        const ok = await verifyVendorPin({
            vendedorCode: code,
            candidatePin: '1234',
            dbPin: '1234',
            requestId: 'test',
        });
        expect(ok).toEqual({ valid: true, method: 'migrated_hash', reason: null });

        // Contador reiniciado: 1 fallo mas no bloquea.
        const miss = await verifyVendorPin({ vendedorCode: code, candidatePin: 'zzzz', dbPin: '1234', requestId: 'test' });
        expect(miss.reason).toBe('migrated_hash_mismatch');
        expect(_private.pinAccountLocked(code)).toBe(false);

        _private.clearPinFailures(code);
    });
});
