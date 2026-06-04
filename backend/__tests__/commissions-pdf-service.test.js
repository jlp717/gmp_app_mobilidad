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

    test('missing Jan/Feb snapshot row keeps sales and target but forces zero commission', async () => {
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

    test('payment snapshot overrides historical snapshot in PDF metrics', async () => {
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
});
