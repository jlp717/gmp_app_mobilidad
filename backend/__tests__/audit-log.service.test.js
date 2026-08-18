/**
 * Unit Tests - Audit Log Service
 * ===============================
 */
'use strict';

Object.assign(process.env, {
    NODE_ENV: 'test',
    REPARTO_ENVIRONMENT: 'test',
    REPARTO_TABLE_SET: 'isolated_test',
    REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
    REPARTO_WRITES_ENABLED: 'true',
    REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'true',
    REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
    REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
    ODBC_DSN: 'GMP',
    REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
    REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
    REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
});

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

    describe('resolveAuditBinding', () => {
        test('maps isolated_test to TEST audit and production to production audit', () => {
            expect(auditLog.resolveAuditBinding()).toMatchObject({
                table: 'JAVIER.TEST_REPARTIDOR_COBROS_AUDIT',
                tableSet: 'isolated_test',
            });
            expect(auditLog.resolveAuditBinding({
                ...process.env,
                NODE_ENV: 'production',
                REPARTO_ENVIRONMENT: 'production',
                REPARTO_TABLE_SET: 'production',
                REPARTO_WRITES_ENABLED: 'true',
                REPARTO_PRODUCTION_WRITES_APPROVED: 'true',
                REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'true',
                REPARTIDOR_FINANCE_ERP_SCHEMA: 'DSEDAC',
            })).toMatchObject({
                table: 'JAVIER.REPARTIDOR_COBROS_AUDIT',
                tableSet: 'production',
            });
        });

        test('fails closed when runtime is invalid', () => {
            expect(auditLog.resolveAuditBinding({
                ...process.env,
                REPARTO_TABLE_SET: 'unknown',
            })).toBeNull();
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
                expect.stringContaining('INSERT INTO JAVIER.TEST_REPARTIDOR_COBROS_AUDIT'),
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
