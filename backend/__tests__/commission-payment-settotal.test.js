'use strict';

const request = require('supertest');
const express = require('express');

const mockQueryWithParams = jest.fn();
const mockInvalidateCachePattern = jest.fn(async () => undefined);

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
    invalidateCachePattern: (...args) => mockInvalidateCachePattern(...args),
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
    getCurrentDate: jest.fn(() => new Date('2026-07-13T18:00:00Z')),
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
    requiresPartialPaymentObservaciones: jest.fn(({ paymentAmount, alreadyPaid, generatedAmount, observaciones }) => {
        const remaining = Math.max(0, generatedAmount - alreadyPaid);
        return paymentAmount + 0.01 < remaining && !(observaciones || '').trim();
    }),
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

const { router: commissionsRouter } = require('../routes/commissions');

function makeApp(user = { code: '98', role: 'ADMIN', isJefeVentas: true }) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = user;
        next();
    });
    app.use('/', commissionsRouter);
    return app;
}

function existingMayPayments() {
    return [
        {
            MES: 5,
            IMPORTE_PAGADO: 304.72,
            COMISION_GENERADA: 295.53,
            VENTAS_REAL: 1000,
            OBJETIVO_MES: 800,
            OBSERVACIONES: 'Pago 1',
            FECHA_PAGO: '2026-05-10T10:00:00Z',
        },
        {
            MES: 5,
            IMPORTE_PAGADO: -295.53,
            COMISION_GENERADA: 295.53,
            VENTAS_REAL: 1000,
            OBJETIVO_MES: 800,
            OBSERVACIONES: 'Ajuste',
            FECHA_PAGO: '2026-05-11T10:00:00Z',
        },
        {
            MES: 5,
            IMPORTE_PAGADO: 304.72,
            COMISION_GENERADA: 295.53,
            VENTAS_REAL: 1000,
            OBJETIVO_MES: 800,
            OBSERVACIONES: 'Pago 3',
            FECHA_PAGO: '2026-05-12T10:00:00Z',
        },
    ];
}

function defaultQueryMock(sql, params, paymentRows = existingMayPayments()) {
    if (sql.includes('FROM JAVIER.COMMISSION_PAYMENTS') && sql.includes('SELECT')) {
        return paymentRows;
    }
    if (sql.includes('DELETE FROM JAVIER.COMMISSION_PAYMENTS')) {
        return [];
    }
    if (sql.includes('INSERT INTO JAVIER.COMMISSION_PAYMENTS')) {
        return [];
    }
    if (sql.includes('JAVIER.COMM_CONFIG') || sql.includes('COMMERCIAL_TARGETS') || sql.includes('EXCLUDED')) {
        return [];
    }
    if (sql.includes('DSED.LACLAE') || sql.includes('VENTAS_B') || sql.includes('SNAPSHOT')) {
        return [];
    }
    return [];
}

describe('commission payment setTotal mode', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('setTotal replaces accumulated month payments with a single total', async () => {
        const sqlCalls = [];
        mockQueryWithParams.mockImplementation(async (sql, params) => {
            sqlCalls.push({ sql, params });
            return defaultQueryMock(sql, params);
        });

        const app = makeApp();
        const response = await request(app)
            .post('/pay')
            .send({
                vendedorCode: '02',
                year: 2026,
                month: 5,
                amount: 295.53,
                generatedAmount: 295.53,
                observaciones: 'Correccion mayo',
                setTotal: true,
            });

        if (response.status !== 200) {
            throw new Error(`Unexpected status ${response.status}: ${JSON.stringify(response.body)}`);
        }
        expect(response.body.success).toBe(true);
        expect(sqlCalls.some((call) => call.sql.includes('DELETE FROM JAVIER.COMMISSION_PAYMENTS'))).toBe(true);
        const insertCall = sqlCalls.find((call) => call.sql.includes('INSERT INTO JAVIER.COMMISSION_PAYMENTS'));
        expect(insertCall).toBeTruthy();
        expect(insertCall.params).toEqual(expect.arrayContaining([295.53]));
    });

    test('setTotal requires observaciones when correcting an existing total', async () => {
        mockQueryWithParams.mockImplementation(async (sql) => defaultQueryMock(sql));

        const app = makeApp();
        const response = await request(app)
            .post('/pay')
            .send({
                vendedorCode: '02',
                year: 2026,
                month: 5,
                amount: 295.53,
                generatedAmount: 295.53,
                setTotal: true,
            });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/observaci/i);
    });

    test('setTotal allows zero to clear month payments', async () => {
        const sqlCalls = [];
        mockQueryWithParams.mockImplementation(async (sql, params) => {
            sqlCalls.push({ sql, params });
            return defaultQueryMock(sql, params);
        });

        const app = makeApp();
        const response = await request(app)
            .post('/pay')
            .send({
                vendedorCode: '02',
                year: 2026,
                month: 5,
                amount: 0,
                generatedAmount: 295.53,
                observaciones: 'Limpiar mayo',
                setTotal: true,
            });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(sqlCalls.some((call) => call.sql.includes('DELETE FROM JAVIER.COMMISSION_PAYMENTS'))).toBe(true);
        expect(sqlCalls.some((call) => call.sql.includes('INSERT INTO JAVIER.COMMISSION_PAYMENTS'))).toBe(false);
    });

    test('setTotal invalidates route-scoped redis cache keys', async () => {
        mockQueryWithParams.mockImplementation(async (sql) => defaultQueryMock(sql));

        const app = makeApp();
        const response = await request(app)
            .post('/pay')
            .send({
                vendedorCode: '02',
                year: 2026,
                month: 5,
                amount: 295.53,
                generatedAmount: 295.53,
                observaciones: 'Correccion mayo',
                setTotal: true,
            });

        expect(response.status).toBe(200);
        expect(mockInvalidateCachePattern).toHaveBeenCalled();
        const patterns = mockInvalidateCachePattern.mock.calls.map(call => call[0]);
        expect(patterns.some(pattern => pattern.startsWith('route:comm:summary:'))).toBe(true);
        expect(patterns.some(pattern => pattern.startsWith('route:comm:pdf:'))).toBe(true);
        expect(patterns.some(pattern => pattern.includes('SINGLE:02:'))).toBe(true);
        expect(patterns.some(pattern => pattern === 'route:comm:summary:*')).toBe(true);
    });
});
