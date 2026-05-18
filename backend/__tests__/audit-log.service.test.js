/**
 * Unit Tests - Audit Log Service
 * ===============================
 */
'use strict';

jest.mock('../config/db', () => ({
    queryWithParams: jest.fn(),
    getPool: jest.fn()
}));

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

describe('AuditLog Service', () => {
    let auditLog;
    let mockQuery;

    beforeEach(() => {
        jest.resetModules();
        mockQuery = require('../config/db').queryWithParams;
        auditLog = require('../services/audit-log.service');
    });

    describe('hashTokenPreview', () => {
        test('should return empty string for null token', () => {
            expect(auditLog.hashTokenPreview(null)).toBe('');
        });

        test('should return full token if <= 16 chars', () => {
            expect(auditLog.hashTokenPreview('abc123')).toBe('abc123');
        });

        test('should truncate long token with ellipsis', () => {
            const long = 'abcdef1234567890extra';
            const result = auditLog.hashTokenPreview(long);
            expect(result).toMatch(/^.{8}\.\.\.(.{8})?$/);
        });
    });

    describe('logPaymentEvent', () => {
        test('should skip when audit table does not exist', async () => {
            mockQuery.mockRejectedValueOnce({ message: 'not found', odbcErrors: [{ state: '42S02' }] });

            await auditLog.logPaymentEvent({
                eventType: 'TEST',
                operador: 'user1',
                codigoRepartidor: 'rep1',
                payload: '{}'
            });

            expect(mockQuery).not.toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO'),
                expect.anything(),
                expect.anything(),
                expect.anything()
            );
        });

        test('should insert audit entry when table exists', async () => {
            mockQuery.mockResolvedValueOnce([{ 1: 1 }]); // table exists check
            mockQuery.mockResolvedValueOnce([]); // INSERT

            await auditLog.logPaymentEvent({
                eventType: 'LIQUIDACION',
                operador: 'user1',
                codigoRepartidor: 'rep1',
                idempotencyToken: 'tok_abc12345xyz',
                payload: JSON.stringify({ amount: 100 })
            });

            expect(mockQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO'),
                expect.arrayContaining(['LIQUIDACION', 'user1', 'rep1']),
                expect.anything(),
                expect.anything()
            );
        });

        test('should not throw when INSERT fails', async () => {
            mockQuery.mockResolvedValueOnce([{ 1: 1 }]);
            mockQuery.mockRejectedValueOnce(new Error('DB error'));

            await expect(auditLog.logPaymentEvent({
                eventType: 'TEST',
                operador: 'u1',
                codigoRepartidor: 'r1'
            })).resolves.not.toThrow();
        });
    });
});
