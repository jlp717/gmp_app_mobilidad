'use strict';

describe('Commissions PDF historical months', () => {
    const originalEnv = process.env;

    function loadService(queryWithParams) {
        jest.resetModules();
        process.env = {
            ...originalEnv,
            SNAPSHOT_UNTIL_MONTH: '2',
            VENDOR_COLUMN: 'R1_T8CDVD',
        };

        jest.doMock('../config/db', () => ({
            queryWithParams,
            query: jest.fn(),
            getPool: jest.fn(),
        }));

        jest.doMock('../middleware/logger', () => ({
            info: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            error: jest.fn(),
        }));

        return require('../services/commissions-pdf.service');
    }

    afterEach(() => {
        process.env = originalEnv;
        jest.dontMock('../config/db');
        jest.dontMock('../middleware/logger');
        jest.clearAllMocks();
    });

    test('Jan/Feb snapshots override live PDF metrics for closed commission months', async () => {
        const queryWithParams = jest.fn(async (sql) => {
            if (sql.includes('JAVIER.COMM_CONFIG')) return [];
            if (sql.includes('JAVIER.COMMERCIAL_TARGETS')) return [];
            if (sql.includes('DSED.LACLAE')) {
                return [
                    { VENDEDOR_CODIGO: '05', MES: 1, VENTAS_LAC: 1000 },
                    { VENDEDOR_CODIGO: '06', MES: 1, VENTAS_LAC: 1200 },
                ];
            }
            if (sql.includes('JAVIER.VENTAS_B')) return [];
            if (sql.includes('JAVIER.COMMISSION_SNAPSHOT_2026_0102')) {
                return [
                    {
                        VENDEDOR_CODIGO: '06',
                        MES: 1,
                        VENTAS_REAL: 2000,
                        OBJETIVO_MES: 1500,
                        COMISION_GENERADA: 50,
                        IMPORTE_PAGADO: 25,
                    },
                ];
            }
            return [];
        });

        const service = loadService(queryWithParams);
        const vendorData = [
            { code: '05', name: 'Vendor 05', months: { 1: { lac: 1200 } } },
            { code: '06', name: 'Vendor 06', months: { 1: { lac: 999 } } },
        ];
        const condorData = new Map([
            ['5', { code: '05', normalizedCode: '5', name: 'Vendor 05', months: { 1: { condor: 100 } } }],
            ['6', { code: '06', normalizedCode: '6', name: 'Vendor 06', months: { 1: { condor: 100 } } }],
        ]);

        const targetMap = await service._private.buildMonthlyTargetsAndCommissions(
            vendorData,
            condorData,
            2026,
            1,
            1
        );

        expect(targetMap.get('5')[1]).toEqual(expect.objectContaining({
            objetivo: 1030,
            totalVentas: 1300,
            comisionGenerada: 0,
            importePagadoOverride: 0,
            snapshotStatus: 'not_commissioned',
        }));

        expect(targetMap.get('6')[1]).toEqual(expect.objectContaining({
            objetivo: 1500,
            totalVentas: 2000,
            comisionGenerada: 50,
            importePagadoOverride: 25,
            snapshotStatus: 'recorded',
        }));
    });

    test('fixed monthly target does not roll forward in PDF metrics', async () => {
        const queryWithParams = jest.fn(async (sql) => {
            if (sql.includes('JAVIER.COMM_CONFIG')) return [];
            if (sql.includes('JAVIER.COMMERCIAL_TARGETS')) {
                return [{ VENDEDOR_CODIGO: '16', MES: 5, IMPORTE_BASE_COMISION: 78157.46 }];
            }
            if (sql.includes('DSED.LACLAE')) {
                return [{ VENDEDOR_CODIGO: '16', MES: 6, VENTAS_LAC: 131017.70 }];
            }
            if (sql.includes('JAVIER.VENTAS_B')) return [];
            if (sql.includes('JAVIER.COMMISSION_SNAPSHOT_2026_0102')) return [];
            if (sql.includes('JAVIER.COMMISSION_PAYMENTS')) return [];
            return [];
        });

        const service = loadService(queryWithParams);
        const targetMap = await service._private.buildMonthlyTargetsAndCommissions(
            [{ code: '16', name: 'Vendor 16', months: { 6: { lac: 14153.93 } } }],
            new Map(),
            2026,
            6,
            6
        );

        expect(targetMap.get('16')[6]).toEqual(expect.objectContaining({
            totalVentas: 14153.93,
            snapshotStatus: 'live',
        }));
        expect(targetMap.get('16')[6].objetivo).toBeCloseTo(134948.231, 3);
    });

    test('summary month metrics are the PDF source for live commission months', async () => {
        const queryWithParams = jest.fn(async (sql) => {
            if (sql.includes('JAVIER.COMM_CONFIG')) return [];
            if (sql.includes('JAVIER.COMMERCIAL_TARGETS')) return [];
            if (sql.includes('DSED.LACLAE')) {
                return [{ VENDEDOR_CODIGO: '35', MES: 6, VENTAS_LAC: 131017.70 }];
            }
            if (sql.includes('JAVIER.VENTAS_B')) return [];
            if (sql.includes('JAVIER.COMMISSION_SNAPSHOT_2026_0102')) return [];
            if (sql.includes('JAVIER.COMMISSION_PAYMENTS')) return [];
            return [];
        });

        const service = loadService(queryWithParams);
        const targetMap = await service._private.buildMonthlyTargetsAndCommissions(
            [{
                code: '35',
                name: 'Vendor 35',
                months: [{
                    month: 6,
                    target: 110693.10,
                    actual: 126950.76,
                    complianceCtx: { commission: 325.15 },
                }],
            }],
            new Map(),
            2026,
            6,
            6
        );

        expect(targetMap.get('35')[6]).toEqual(expect.objectContaining({
            objetivo: 110693.10,
            totalVentas: 126950.76,
            comisionGenerada: 325.15,
            snapshotStatus: 'summary',
        }));
    });

    test('payment snapshot locks paid PDF metrics instead of recalculating live values', async () => {
        const queryWithParams = jest.fn(async (sql) => {
            if (sql.includes('JAVIER.COMM_CONFIG')) return [];
            if (sql.includes('JAVIER.COMMERCIAL_TARGETS')) return [];
            if (sql.includes('DSED.LACLAE')) {
                return [{ VENDEDOR_CODIGO: '16', MES: 1, VENTAS_LAC: 1000 }];
            }
            if (sql.includes('JAVIER.VENTAS_B')) return [];
            if (sql.includes('JAVIER.COMMISSION_SNAPSHOT_2026_0102')) {
                return [{
                    VENDEDOR_CODIGO: '16',
                    MES: 1,
                    VENTAS_REAL: 39053.02,
                    OBJETIVO_MES: 35686.57,
                    COMISION_GENERADA: 53.80,
                    IMPORTE_PAGADO: 0,
                }];
            }
            if (sql.includes('JAVIER.COMMISSION_PAYMENTS')) {
                return [{
                    VENDEDOR_CODIGO: '16',
                    MES: 1,
                    VENTAS_REAL: 39053.02,
                    OBJETIVO_MES: 35686.57,
                    COMISION_GENERADA: 53.86,
                    IMPORTE_PAGADO: 53.86,
                    FECHA_PAGO: '2026-02-28 10:00:00',
                    OBSERVACIONES: '',
                }];
            }
            return [];
        });

        const service = loadService(queryWithParams);
        const targetMap = await service._private.buildMonthlyTargetsAndCommissions(
            [{ code: '16', name: 'Vendor 16', months: { 1: { lac: 1 } } }],
            new Map(),
            2026,
            1,
            1
        );

        expect(targetMap.get('16')[1]).toEqual(expect.objectContaining({
            objetivo: 35686.57,
            totalVentas: 39053.02,
            comisionGenerada: 53.86,
            importePagadoOverride: 53.86,
            snapshotStatus: 'payment_recorded',
        }));
    });

    test('80 accumulated summary is rebuilt from visible seller contributions', () => {
        const service = loadService(jest.fn(async () => []));
        const rows = service._private.buildTeamLeadAccumulatedRows(
            {
                leaderCode: '80',
                months: [{
                    month: 5,
                    leaderPrevSales: 130127.45,
                    leaderCurrentSales: 143541.70,
                    leaderPersonalCommission: 12.34,
                    // Stale/opaque aggregate fields must not drive the PDF summary.
                    teamAggregatePrevSales: 487182.67,
                    teamAggregateThreshold: 535900.94,
                    teamAggregateCurrentSales: 999999.99,
                    teamAggregateCommission: 999.99,
                    members: [
                        { vendorCode: '72', prevYearSales: 97986.79, currentSales: 93701.88 },
                        { vendorCode: '73', prevYearSales: 88386.81, currentSales: 92606.86 },
                        { vendorCode: '81', prevYearSales: 85268.57, currentSales: 83570.22 },
                        { vendorCode: '83', prevYearSales: 58721.07, currentSales: 56263.84 },
                    ],
                }],
            },
            5,
            5,
            {
                ipc: 3,
                TIER1_MAX: 103,
                TIER1_PCT: 1,
                TIER2_MAX: 106,
                TIER2_PCT: 1.3,
                TIER3_MAX: 110,
                TIER3_PCT: 1.6,
                TIER4_PCT: 2,
            },
        );

        const aggregate = rows.find(row => row.isTeamAggregate);
        const leader = rows.find(row => row.isLeader);

        expect(aggregate.prev).toBeCloseTo(460490.69, 2);
        expect(aggregate.curr).toBeCloseTo(469684.50, 2);
        expect(aggregate.threshold).toBeCloseTo(506539.76, 2);
        expect(aggregate.commission).toBeCloseTo(0, 2);
        expect(leader.ownCommission).toBeCloseTo(12.34, 2);
    });

    test('summary PDF can be generated with no vendors', async () => {
        const service = loadService(jest.fn(async () => []));

        const buffer = await service.generateCommissionsPdfFromSummary(
            [],
            new Map(),
            2026,
            1,
            6,
        );

        expect(Buffer.isBuffer(buffer)).toBe(true);
        expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
        expect(buffer.length).toBeGreaterThan(1000);
    });
});

describe('Commissions PDF route helpers', () => {
    function loadRoute({
        resolveAllModeVendorCodes = jest.fn(async () => []),
        redisGet = jest.fn(async () => null),
        redisSet = jest.fn(async () => undefined),
        redisAcquireLock = jest.fn(async () => null),
        redisReleaseLock = jest.fn(async () => undefined),
        redisIsConnected = false,
    } = {}) {
        jest.resetModules();

        const query = jest.fn(async () => []);
        const queryWithParams = jest.fn(async () => []);

        jest.doMock('../config/db', () => ({
            query,
            queryWithParams,
            getPool: jest.fn(),
        }));
        jest.doMock('../services/query-optimizer', () => ({
            cachedQuery: jest.fn(),
        }));
        jest.doMock('../middleware/logger', () => ({
            info: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            error: jest.fn(),
        }));
        jest.doMock('../middleware/audit', () => ({
            auditDataAccess: jest.fn(),
        }));
        jest.doMock('../services/laclae', () => ({
            getVendorActiveDaysFromCache: jest.fn(() => []),
            getClientCodesFromCache: jest.fn(() => []),
        }));
        jest.doMock('../utils/common', () => ({
            getCurrentDate: jest.fn(() => new Date('2026-07-02T00:00:00Z')),
            LACLAE_SALES_FILTER: '1=1',
            SNAPSHOT_UNTIL_MONTH: 2,
            getCommissionVendorColumnExpr: jest.fn(() => 'L.VENDEDOR'),
            getCommissionActualVendorColumnExprForYear: jest.fn(() => 'L.VENDEDOR'),
            getCommissionActualVendorColumnExprForMonth: jest.fn(() => 'L.VENDEDOR'),
            getVendorName: jest.fn(async code => `Vendor ${code}`),
            calculateDaysPassed: jest.fn(() => 0),
            getBSales: jest.fn(async () => ({})),
            sanitizeForSQL: jest.fn(value => String(value || '')),
            handleRouteError: jest.fn(),
        }));
        jest.doMock('../utils/commission-snapshot', () => ({
            resolveCommissionTarget: jest.fn(() => 0),
            resolveHistoricalCommissionMonth: jest.fn(() => null),
            resolvePaymentSnapshotMonth: jest.fn(() => null),
        }));
        jest.doMock('../middleware/auth', () => ({
            verifyToken: jest.fn((req, res, next) => next()),
        }));
        jest.doMock('../services/redis-cache', () => ({
            redisCache: {
                get: redisGet,
                set: redisSet,
                acquireLock: redisAcquireLock,
                releaseLock: redisReleaseLock,
                isConnected: redisIsConnected,
            },
            TTL: {
                SHORT: 60,
                MEDIUM: 300,
                LONG: 3600,
            },
            invalidateCachePattern: jest.fn(async () => undefined),
        }));
        jest.doMock('../services/team-commission.service', () => ({
            isTeamLeader: jest.fn(() => false),
            getTeamCommission: jest.fn(),
            buildTeamLeadSummaryPayload: jest.fn(),
            isScopedTeamAllRequest: jest.fn(() => false),
            resolveAllModeVendorCodes,
            allModeCacheScope: jest.fn(() => 'ALL'),
            isCommercial80User: jest.fn(() => false),
        }));

        return {
            routeModule: require('../routes/commissions'),
            query,
            queryWithParams,
            resolveAllModeVendorCodes,
            redisGet,
            redisSet,
            redisAcquireLock,
            redisReleaseLock,
        };
    }

    afterEach(() => {
        jest.dontMock('../config/db');
        jest.dontMock('../services/query-optimizer');
        jest.dontMock('../middleware/logger');
        jest.dontMock('../middleware/audit');
        jest.dontMock('../services/laclae');
        jest.dontMock('../utils/common');
        jest.dontMock('../utils/commission-snapshot');
        jest.dontMock('../middleware/auth');
        jest.dontMock('../services/redis-cache');
        jest.dontMock('../services/team-commission.service');
        jest.clearAllMocks();
    });

    test('ALL PDF summary returns empty data without querying DB when no vendors resolve', async () => {
        const { routeModule, query, queryWithParams, resolveAllModeVendorCodes } = loadRoute();

        const result = await routeModule._private.buildPdfSummaryVendors(
            'ALL',
            2026,
            { ipc: 3 },
            '98',
        );

        expect(result).toEqual([]);
        expect(resolveAllModeVendorCodes).toHaveBeenCalledTimes(1);
        expect(query).not.toHaveBeenCalled();
        expect(queryWithParams).not.toHaveBeenCalled();
    });

    test('ALL PDF summary reuses grouped summary cache before DB work', async () => {
        const cachedVendor = {
            vendedorCode: '80',
            name: 'Vendor 80',
            months: [],
            quarters: [],
            grandTotalCommission: 0,
        };
        const redisGet = jest.fn(async () => ({ breakdown: [cachedVendor] }));
        const { routeModule, query, queryWithParams, resolveAllModeVendorCodes } = loadRoute({
            redisGet,
        });

        const result = await routeModule._private.buildPdfSummaryVendors(
            'ALL',
            2026,
            { ipc: 3 },
            '98',
        );

        expect(result).toEqual([cachedVendor]);
        expect(redisGet).toHaveBeenCalledWith(
            'route',
            'comm:summary:v20260706-paid-month-lock:ALL:2026',
        );
        expect(resolveAllModeVendorCodes).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();
        expect(queryWithParams).not.toHaveBeenCalled();
    });

    test('PDF payload cache stores base64 buffers with short TTL', async () => {
        const redisSet = jest.fn(async () => true);
        const { routeModule } = loadRoute({ redisSet });
        const pdfBuffer = Buffer.from('%PDF-1.4 cached');

        await routeModule._private.setCachedPdfPayload('pdf:key', {
            pdfBuffer,
            vendorCount: 3,
            fileName: 'cached.pdf',
            generatedAt: '2026-07-02T07:00:00.000Z',
        });

        expect(redisSet).toHaveBeenCalledWith(
            'route',
            'pdf:key',
            expect.objectContaining({
                pdfBase64: pdfBuffer.toString('base64'),
                vendorCount: 3,
                fileName: 'cached.pdf',
            }),
            600,
        );
    });

    test('PDF generation uses Redis lock and releases it after caching', async () => {
        const redisSet = jest.fn(async () => true);
        const redisAcquireLock = jest.fn(async () => 'lock-token');
        const redisReleaseLock = jest.fn(async () => true);
        const { routeModule } = loadRoute({
            redisSet,
            redisAcquireLock,
            redisReleaseLock,
            redisIsConnected: true,
        });
        const pdfBuffer = Buffer.from('%PDF-1.4 fresh');
        const generator = jest.fn(async () => ({
            pdfBuffer,
            vendorCount: 2,
            fileName: 'fresh.pdf',
        }));

        const result = await routeModule._private.getOrGeneratePdfPayload('pdf:key', generator);

        expect(generator).toHaveBeenCalledTimes(1);
        expect(redisAcquireLock).toHaveBeenCalledWith('route', 'pdf:key:generate', expect.any(Number));
        expect(redisSet).toHaveBeenCalledWith(
            'route',
            'pdf:key',
            expect.objectContaining({ pdfBase64: pdfBuffer.toString('base64') }),
            600,
        );
        expect(redisReleaseLock).toHaveBeenCalledWith('route', 'pdf:key:generate', 'lock-token');
        expect(result.pdfBuffer).toEqual(pdfBuffer);
    });

    test('PDF generation returns cached payload without acquiring a lock', async () => {
        const pdfBuffer = Buffer.from('%PDF-1.4 cached');
        const redisGet = jest.fn(async () => ({
            pdfBase64: pdfBuffer.toString('base64'),
            vendorCount: 1,
            fileName: 'cached.pdf',
        }));
        const redisAcquireLock = jest.fn();
        const { routeModule } = loadRoute({
            redisGet,
            redisAcquireLock,
            redisIsConnected: true,
        });
        const generator = jest.fn();

        const result = await routeModule._private.getOrGeneratePdfPayload('pdf:key', generator);

        expect(generator).not.toHaveBeenCalled();
        expect(redisAcquireLock).not.toHaveBeenCalled();
        expect(result.fromCache).toBe(true);
        expect(result.pdfBuffer).toEqual(pdfBuffer);
    });
});
