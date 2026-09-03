'use strict';

const mockQueryWithParams = jest.fn();

jest.mock('../config/db', () => ({
    query: jest.fn(),
    queryWithParams: (...args) => mockQueryWithParams(...args),
    getPool: jest.fn(),
}));

jest.mock('../services/query-optimizer', () => ({
    cachedQuery: jest.fn((fn) => fn()),
}));

jest.mock('../services/redis-cache', () => ({
    redisCache: {
        get: jest.fn(),
        set: jest.fn(),
        acquireLock: jest.fn(),
        releaseLock: jest.fn(),
        isConnected: false,
    },
    TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
    invalidateCachePattern: jest.fn(async () => undefined),
}));

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

jest.mock('../middleware/audit', () => ({
    auditDataAccess: jest.fn(),
}));

jest.mock('../services/laclae', () => ({
    getVendorActiveDaysFromCache: jest.fn(() => []),
    getClientCodesFromCache: jest.fn(() => []),
}));

jest.mock('../utils/common', () => ({
    getCurrentDate: jest.fn(() => new Date('2026-07-14T10:00:00Z')),
    LACLAE_SALES_FILTER: '1=1',
    SNAPSHOT_UNTIL_MONTH: 2,
    getCommissionVendorColumnExpr: jest.fn(() => 'L.VENDEDOR'),
    getCommissionActualVendorColumnExprForYear: jest.fn(() => 'L.VENDEDOR'),
    getCommissionActualVendorColumnExprForMonth: jest.fn(() => 'L.VENDEDOR'),
    getVendorName: jest.fn(async (code) => `Vendor ${code}`),
    calculateDaysPassed: jest.fn(() => 0),
    getBSales: jest.fn(async () => ({})),
    sanitizeForSQL: jest.fn((value) => String(value || '')),
    handleRouteError: jest.fn(),
}));

jest.mock('../utils/commission-snapshot', () => ({
    resolveCommissionTarget: jest.fn(() => 800),
    resolveHistoricalCommissionMonth: jest.fn(() => ({
        isHistoricalSnapshot: false,
        status: 'live',
        actual: 1000,
        target: 800,
        commission: 295.53,
        snapshotSource: null,
    })),
    resolvePaymentSnapshotMonth: jest.fn(() => ({
        isPaymentSnapshot: false,
    })),
    requiresPartialPaymentObservaciones: jest.fn(() => false),
}));

jest.mock('../middleware/auth', () => ({
    verifyToken: (req, _res, next) => next(),
}));

jest.mock('../services/team-commission.service', () => ({
    isTeamLeader: jest.fn(() => false),
    getTeamCommission: jest.fn(),
    buildTeamLeadSummaryPayload: jest.fn(),
    isScopedTeamAllRequest: jest.fn(() => false),
    resolveAllModeVendorCodes: jest.fn(async () => []),
    allModeCacheScope: jest.fn(() => 'ALL'),
    isCommercial80User: jest.fn(() => false),
}));

const { _private } = require('../routes/commissions');

describe('commission payment summary refresh', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { redisCache } = require('../services/redis-cache');
        redisCache.get.mockReset();
        redisCache.get.mockResolvedValue(null);
    });

    test('getVendorPayments returns corrected monthly total after setTotal insert', async () => {
        mockQueryWithParams.mockImplementation(async (sql) => {
            if (sql.includes('FROM JAVIER.COMMISSION_PAYMENTS') && sql.includes('SELECT')) {
                return [
                    {
                        MES: 5,
                        IMPORTE_PAGADO: 295.53,
                        COMISION_GENERADA: 295.53,
                        VENTAS_REAL: 1000,
                        OBJETIVO_MES: 800,
                        OBSERVACIONES: 'Correccion total mes',
                        FECHA_PAGO: '2026-07-14T10:00:00Z',
                    },
                ];
            }
            return [];
        });

        const payments = await _private.getVendorPayments('02', 2026);

        expect(payments.monthly[5]).toBe(295.53);
        expect(payments.details[5].totalPaid).toBe(295.53);
        expect(payments.total).toBe(295.53);
    });

    test('invalidateCommissionPaymentCaches targets summary/pdf without dropping sales caches', async () => {
        const { invalidateCachePattern } = require('../services/redis-cache');
        await _private.invalidateCommissionPaymentCaches('02', 2026);

        const patterns = invalidateCachePattern.mock.calls.map(call => call[0]);
        expect(patterns).toEqual(expect.arrayContaining([
            'route:comm:summary:*',
            'route:comm:pdf:*',
            expect.stringMatching(/route:comm:summary:.*:SINGLE:02:\*/),
        ]));
        expect(patterns.some((pattern) => pattern.includes('sales-by-client-scope'))).toBe(false);
        expect(patterns).not.toContain('route:comm:*');
        expect(patterns.some((pattern) => /route:commissions:.*:\*$/.test(pattern) && !pattern.includes('SINGLE'))).toBe(false);
    });

    test('getCurrentPaymentSnapshot prefers Redis summary and skips LACLAE', async () => {
        const { redisCache } = require('../services/redis-cache');
        redisCache.get.mockImplementation(async (_ns, key) => {
            if (String(key).includes('SINGLE:02:') || String(key).includes('SINGLE:2:')) {
                return {
                    vendor: '02',
                    months: [
                        { month: 5, actual: 1200, target: 800, complianceCtx: { commission: 295.53 } },
                    ],
                };
            }
            return null;
        });

        const snapshot = await _private.getCurrentPaymentSnapshot('02', 2026, 5);

        expect(snapshot).toMatchObject({
            ventaComision: 1200,
            objetivoMes: 800,
            generatedAmount: 295.53,
            source: 'cache',
        });
        expect(mockQueryWithParams).not.toHaveBeenCalled();
    });

    test('getCurrentPaymentSnapshot ignores client body and ALL aggregate months', async () => {
        const { redisCache } = require('../services/redis-cache');
        redisCache.get.mockImplementation(async (_ns, key) => {
            if (String(key).includes(':ALL:') || String(key).includes(':TEAM80:')) {
                return {
                    months: [
                        { month: 5, actual: 99999, target: 1, complianceCtx: { commission: 5000 } },
                    ],
                    breakdown: [],
                };
            }
            return null;
        });

        const snapshot = await _private.getCurrentPaymentSnapshot('02', 2026, 5, {
            clientSnapshot: {
                ventaComision: 1,
                objetivoMes: 1,
                generatedAmount: 1,
            },
        });

        expect(snapshot?.source).not.toBe('client');
        expect(snapshot?.generatedAmount).not.toBe(5000);
        expect(snapshot?.generatedAmount).not.toBe(1);
    });
});
