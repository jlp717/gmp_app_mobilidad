/**
 * Unit Tests - Bolsa Comercial Service
 * =====================================
 */
'use strict';

const ORIGINAL_ENV = { ...process.env };
process.env.APP_ENV = 'test';
process.env.REPARTO_TABLE_SET = 'isolated_test';
process.env.DB2_WRITE_SCHEMA = 'JAVIER';

afterAll(() => {
    process.env = ORIGINAL_ENV;
});

const mockOpenDedicatedConnection = jest.fn();

function promisedImplementation(implementation) {
    return (...args) => Promise.resolve(implementation(...args));
}

jest.mock('../config/db', () => ({
    queryWithParams: jest.fn(),
    getPool: jest.fn(() => null),
    initDb: jest.fn()
}));

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../adapters/pedidos-transaction-connection', () => ({
    openDedicatedPedidosTransactionConnection: (...args) =>
        mockOpenDedicatedConnection(...args),
}));

const SCHEMA = 'JAVIER';

beforeEach(() => {
    mockOpenDedicatedConnection.mockReset();
    const db = require('../config/db');
    mockOpenDedicatedConnection.mockImplementation(() => ({
        query: (sql, params) => /^LOCK TABLE/i.test(String(sql).trim())
            ? Promise.resolve([])
            : require('../config/db').queryWithParams(sql, params),
        beginTransaction: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
    }));
    if (db.getPool && db.getPool.mockReturnValue) db.getPool.mockReturnValue(null);
    if (db.initDb && db.initDb.mockReset) db.initDb.mockReset();
});

function installTransactionalPool(db, { initialState = 'BORRADOR' } = {}) {
    let state = initialState;
    let transactionState = initialState;
    const conn = {
        query: jest.fn((sql, params) => {
            const statement = String(sql).trim();
            if (/^(SET TRANSACTION|LOCK TABLE)/i.test(statement)) return Promise.resolve([]);
            if (/SELECT\s+TRIM\(ESTADO\)\s+AS\s+ESTADO/i.test(statement)) {
                return Promise.resolve([{ ESTADO: state }]);
            }
            if (/UPDATE\s+JAVIER\.(?:TEST_)?PEDIDOS_CAB/i.test(statement)
                && /SET\s+ESTADO\s*=\s*'CONFIRMANDO'/i.test(statement)) {
                if (state !== 'BORRADOR') return Promise.resolve({ count: 0 });
                state = 'CONFIRMANDO';
                return Promise.resolve({ count: 1 });
            }
            if (/UPDATE\s+JAVIER\.(?:TEST_)?PEDIDOS_CAB/i.test(statement)
                && /SET\s+ESTADO\s*=\s*'CONFIRMADO'/i.test(statement)) {
                if (state !== 'CONFIRMANDO') return Promise.resolve({ count: 0 });
                state = 'CONFIRMADO';
                return Promise.resolve({ count: 1 });
            }
            return db.queryWithParams(sql, params);
        }),
        beginTransaction: jest.fn(() => {
            transactionState = state;
            return Promise.resolve();
        }),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn(() => {
            state = transactionState;
            return Promise.resolve();
        }),
        close: jest.fn().mockResolvedValue(undefined),
        getState: () => state,
    };
    db.getPool.mockReturnValue({ connect: jest.fn().mockResolvedValue(conn) });
    mockOpenDedicatedConnection.mockResolvedValue(conn);
    return conn;
}

function installSerializedTransactionalConnections(db) {
    let state = 'BORRADOR';
    let lockTail = Promise.resolve();
    const connections = [];

    mockOpenDedicatedConnection.mockImplementation(() => {
        let releaseLock;
        let transactionState = state;
        const conn = {
            query: jest.fn(async (sql, params) => {
                const statement = String(sql).trim();
                if (/^SET TRANSACTION/i.test(statement)) return [];
                if (/LOCK TABLE .*PEDIDOS_STOCK_RESERVE/i.test(statement)) {
                    const previous = lockTail;
                    lockTail = new Promise((resolve) => { releaseLock = resolve; });
                    await previous;
                    transactionState = state;
                    return [];
                }
                if (/^LOCK TABLE/i.test(statement)) return [];
                if (/SELECT\s+TRIM\(ESTADO\)\s+AS\s+ESTADO/i.test(statement)) {
                    return [{ ESTADO: state }];
                }
                if (/SET\s+ESTADO\s*=\s*'CONFIRMANDO'/i.test(statement)) {
                    if (state !== 'BORRADOR') return { count: 0 };
                    state = 'CONFIRMANDO';
                    return { count: 1 };
                }
                if (/SET\s+ESTADO\s*=\s*'CONFIRMADO'/i.test(statement)) {
                    if (state !== 'CONFIRMANDO') return { count: 0 };
                    state = 'CONFIRMADO';
                    return { count: 1 };
                }
                return db.queryWithParams(sql, params);
            }),
            beginTransaction: jest.fn().mockResolvedValue(undefined),
            commit: jest.fn(() => {
                releaseLock?.();
                return Promise.resolve();
            }),
            rollback: jest.fn(() => {
                state = transactionState;
                releaseLock?.();
                return Promise.resolve();
            }),
            close: jest.fn().mockResolvedValue(undefined),
        };
        connections.push(conn);
        return Promise.resolve(conn);
    });

    return { connections, getState: () => state };
}

describe('BolsaComercial Service', () => {
    let bolsaService;
    let mockQuery;

    beforeEach(() => {
        jest.resetModules();
        mockQuery = require('../config/db').queryWithParams;
        bolsaService = require('../services/bolsa-comercial.service');
    });

    describe('getOrCreateBolsa', () => {
        test('should return existing bolsa when found', async () => {
            mockQuery.mockResolvedValueOnce([{
                ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 100,
                CONSUMIDO: 0, ACUMULADO: 50
            }]);

            const result = await bolsaService.getOrCreateBolsa('10', 2026, 5);

            expect(result.id).toBe(1);
            expect(result.vendedor).toBe('10');
            expect(result.saldoDisponible).toBe(100);
            expect(mockQuery).toHaveBeenCalledTimes(1);
        });

        test('should create new bolsa when not found', async () => {
            mockQuery
                .mockResolvedValueOnce([]) // SELECT returns empty
                .mockResolvedValueOnce([]) // INSERT
                .mockResolvedValueOnce([{  // SELECT after insert
                    ID: 2, CODIGOVENDEDOR: '15  ', EJERCICIO: 2026, MES: 6,
                    LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 0,
                    CONSUMIDO: 0, ACUMULADO: 0
                }]);

            const result = await bolsaService.getOrCreateBolsa('15', 2026, 6);

            expect(result.vendedor).toBe('15');
            expect(result.limitePct).toBe(3);
        });

        test('fails closed when a duplicate-race reread still cannot return the monthly row', async () => {
            const duplicate = Object.assign(new Error('duplicate key'), { state: '23505' });
            mockQuery
                .mockResolvedValueOnce([])
                .mockRejectedValueOnce(duplicate)
                .mockResolvedValueOnce([]);

            await expect(bolsaService.getOrCreateBolsa('15', 2026, 6))
                .rejects.toMatchObject({ code: 'BOLSA_MONTHLY_ROW_UNAVAILABLE', status: 503 });
        });
    });

    describe('applyOrderMovements physical transaction', () => {
        test('fails before writes when the physical connection lacks transaction methods', async () => {
            const query = jest.fn();
            mockOpenDedicatedConnection.mockResolvedValue({ query, close: jest.fn() });

            await expect(bolsaService.applyOrderMovements({
                vendedorCode: '73', pedidoId: 81,
            })).rejects.toMatchObject({ code: 'BOLSA_TRANSACTION_UNAVAILABLE', status: 503 });
            expect(query).not.toHaveBeenCalled();
        });

        test('rolls back mixed movements when the second ledger write fails', async () => {
            const rollback = jest.fn().mockResolvedValue(undefined);
            const commit = jest.fn().mockResolvedValue(undefined);
            const close = jest.fn().mockResolvedValue(undefined);
            let movementWrites = 0;
            const query = jest.fn((sql) => {
                if (/^LOCK TABLE/i.test(sql)) return [];
                if (/FROM JAVIER\.(?:TEST_)?BOLSA_COMERCIAL.*CODIGOVENDEDOR/i.test(sql)) {
                    return [{
                        ID: 4, CODIGOVENDEDOR: '73', EJERCICIO: 2026, MES: 11,
                        SALDO_DISPONIBLE: 300, CONSUMIDO: 0, ACUMULADO: 0,
                    }];
                }
                if (/SELECT IDEMPOTENCY_KEY/i.test(sql)) return [];
                if (/INSERT INTO JAVIER\.(?:TEST_)?MOVIMIENTOS_BOLSA/i.test(sql)) {
                    movementWrites += 1;
                    if (movementWrites === 2) throw new Error('ledger stage failed');
                }
                return { count: 1 };
            });
            mockOpenDedicatedConnection.mockResolvedValue({
                query,
                beginTransaction: jest.fn().mockResolvedValue(undefined),
                commit,
                rollback,
                close,
            });

            await expect(bolsaService.applyOrderMovements({
                vendedorCode: '73', pedidoId: 81,
                consumoAmount: 2,
                acumulacionAmount: 3,
                consumoMovements: [{ importe: 2, idempotencyKey: 'pedido-81-consumo' }],
                acumulacionMovements: [{ importe: 3, idempotencyKey: 'pedido-81-acumulacion' }],
            })).rejects.toThrow('ledger stage failed');

            expect(rollback).toHaveBeenCalledTimes(1);
            expect(commit).not.toHaveBeenCalled();
            expect(close).toHaveBeenCalledTimes(1);
        });

        test('commits a zero-impact registration and exact retry writes no duplicate', async () => {
            const persisted = new Set();
            const commit = jest.fn().mockResolvedValue(undefined);
            const query = jest.fn((sql, params = []) => {
                if (/^LOCK TABLE/i.test(sql)) return [];
                if (/FROM JAVIER\.(?:TEST_)?BOLSA_COMERCIAL.*CODIGOVENDEDOR/i.test(sql)) {
                    return [{
                        ID: 4, CODIGOVENDEDOR: '73', EJERCICIO: 2026, MES: 11,
                        SALDO_DISPONIBLE: 300, CONSUMIDO: 0, ACUMULADO: 0,
                    }];
                }
                if (/SELECT IDEMPOTENCY_KEY/i.test(sql)) {
                    return [...persisted].map((IDEMPOTENCY_KEY) => ({ IDEMPOTENCY_KEY }));
                }
                if (/INSERT INTO JAVIER\.(?:TEST_)?MOVIMIENTOS_BOLSA/i.test(sql)) {
                    persisted.add(params.at(-1));
                }
                return { count: 1 };
            });
            mockOpenDedicatedConnection.mockImplementation(() => ({
                query,
                beginTransaction: jest.fn().mockResolvedValue(undefined),
                commit,
                rollback: jest.fn().mockResolvedValue(undefined),
                close: jest.fn().mockResolvedValue(undefined),
            }));

            const first = await bolsaService.applyOrderMovements({ vendedorCode: '73', pedidoId: 81 });
            const replay = await bolsaService.applyOrderMovements({ vendedorCode: '73', pedidoId: 81 });

            expect(first.registration).toMatchObject({ created: true });
            expect(replay.registration).toMatchObject({ created: false });
            expect(persisted).toEqual(new Set(['pedido-81-bag-registration']));
            expect(commit).toHaveBeenCalledTimes(2);
        });
    });

    describe('acumularBolsa', () => {
        test('should accumulate margin and create movement', async () => {
            mockQuery
                .mockResolvedValueOnce([{
                    ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                    LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 100,
                    CONSUMIDO: 0, ACUMULADO: 0
                }])
                .mockResolvedValueOnce([]) // UPDATE
                .mockResolvedValueOnce([]); // INSERT movement

            const result = await bolsaService.acumularBolsa('10', 42, 50, 'Test margin');

            expect(result).toBeCloseTo(150);
        });
    });

    describe('consumirBolsa', () => {
        test('should deny consumption when insufficient balance', async () => {
            mockQuery.mockResolvedValueOnce([{
                ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                LIMITE_PCT: 3, SALDO_DISPONIBLE: 10,
                CONSUMIDO: 0, ACUMULADO: 0
            }]);

            const result = await bolsaService.consumirBolsa('10', 42, 50, 'ART01');

            expect(result.allowed).toBe(false);
            expect(result.deficit).toBeCloseTo(40);
        });

        test('should allow consumption when sufficient balance', async () => {
            mockQuery
                .mockResolvedValueOnce([{
                    ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                    LIMITE_PCT: 3, SALDO_DISPONIBLE: 100,
                    CONSUMIDO: 0, ACUMULADO: 0
                }])
                .mockResolvedValueOnce([]) // UPDATE
                .mockResolvedValueOnce([]); // INSERT movement

            const result = await bolsaService.consumirBolsa('10', 42, 30, 'ART01');

            expect(result.allowed).toBe(true);
            expect(result.saldo).toBeCloseTo(70);
        });
    });

    describe('validateOrderWithBolsa', () => {
        test('uses the caller transaction executor for the monthly bolsa row', async () => {
            mockQuery.mockReset();
            const txQuery = jest.fn().mockResolvedValue([{
                ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 100,
                CONSUMIDO: 0, ACUMULADO: 0,
            }]);

            const result = await bolsaService.validateOrderWithBolsa('10', [], { queryFn: txQuery });

            expect(result.valid).toBe(true);
            expect(txQuery).toHaveBeenCalledTimes(1);
            expect(mockQuery).not.toHaveBeenCalled();
        });

        test('should validate when all lines are within budget', async () => {
            mockQuery.mockResolvedValueOnce([{
                ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 100,
                CONSUMIDO: 0, ACUMULADO: 0
            }]);

            const result = await bolsaService.validateOrderWithBolsa('10', [
                { precioTarifaCliente: 10, precioVenta: 12, cantidadEnvases: 1 }
            ]);

            expect(result.valid).toBe(true);
        });

        test('should reject when deficit exceeds balance', async () => {
            mockQuery.mockResolvedValueOnce([{
                ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                LIMITE_PCT: 3, SALDO_DISPONIBLE: 10,
                CONSUMIDO: 0, ACUMULADO: 0
            }]);

            const result = await bolsaService.validateOrderWithBolsa('10', [
                { precioTarifaCliente: 100, precioVenta: 50, cantidadEnvases: 1 }
            ]);

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('BOLSA_INSUFICIENTE');
        });

        test('movement importe equals (precioVenta - precioTarifa) x qty', async () => {
            mockQuery.mockResolvedValueOnce([{
                ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 100,
                CONSUMIDO: 0, ACUMULADO: 0
            }]);

            const result = await bolsaService.validateOrderWithBolsa('10', [
                { ID: 7, precioTarifaCliente: 10, precioVenta: 13, cantidadEnvases: 2 }
            ]);

            expect(result.valid).toBe(true);
            expect(result.lineMovements).toHaveLength(1);
            expect(result.lineMovements[0].importe).toBe(6);
            expect(result.lineMovements[0].precioMinimoCongelado).toBe(10);
        });

        test('allows below-tarifa bolsa consumo even when under configured min floor', async () => {
            mockQuery.mockResolvedValueOnce([{
                ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 100,
                CONSUMIDO: 0, ACUMULADO: 0
            }]);

            const result = await bolsaService.validateOrderWithBolsa('10', [
                { precioTarifaCliente: 10, precioMinimo: 12, precioVenta: 9, cantidadEnvases: 1 }
            ]);

            expect(result.valid).toBe(true);
            expect(result.consumo).toBe(1);
            expect(result.lineMovements[0].tipo).toBe('CONSUMO');
        });

        test('blocks sale below configured min floor even with bolsa balance', async () => {
            mockQuery.mockResolvedValueOnce([{
                ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 1000,
                CONSUMIDO: 0, ACUMULADO: 0
            }]);

            const result = await bolsaService.validateOrderWithBolsa('10', [
                { precioTarifaCliente: 10, precioMinimo: 12, precioVenta: 11, cantidadEnvases: 1 }
            ]);

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('PRECIO_DEBAJO_MINIMO');
        });

        test('allows configured client special price below global min floor', async () => {
            mockQuery.mockResolvedValueOnce([{
                ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 1000,
                CONSUMIDO: 0, ACUMULADO: 0
            }]);

            const result = await bolsaService.validateOrderWithBolsa('10', [
                {
                    precioTarifaCliente: 12,
                    precioMinimo: 15,
                    precioVenta: 13,
                    cantidadEnvases: 1,
                    precioEspecialCliente: true,
                    permiteBajoMinimo: true,
                    precioClienteSource: 'DSEDAC.PES',
                }
            ]);

            expect(result.valid).toBe(true);
            expect(result.acumulacion).toBe(1);
            expect(result.lineMovements[0].tipo).toBe('ACUMULACION');
        });

        test.each([
            ['CAJAS', { cantidadEnvases: 1 }],
            ['UNIDADES', { cantidadUnidades: 1 }],
        ])('real PES default price has zero bolsa impact in %s', async (unidadMedida, quantity) => {
            mockQuery.mockResolvedValueOnce([{
                ID: 1, CODIGOVENDEDOR: '73', EJERCICIO: 2026, MES: 11,
                LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 300,
                CONSUMIDO: 0, ACUMULADO: 0,
            }]);

            const result = await bolsaService.validateOrderWithBolsa('73', [{
                codigoArticulo: '2974',
                unidadMedida,
                ...quantity,
                precioTarifaCliente: 29.28,
                precioMinimo: 36.198,
                precioVenta: 29.28,
                precioEspecialCliente: true,
                permiteBajoMinimo: true,
                precioClienteSource: 'DSEDAC.PES',
            }]);

            expect(result).toMatchObject({ valid: true, consumo: 0, acumulacion: 0 });
            expect(result.lineMovements).toEqual([]);
        });

        test('commercial price below current PES reference consumes bolsa without being replaced', async () => {
            mockQuery.mockResolvedValueOnce([{
                ID: 1, CODIGOVENDEDOR: '73', EJERCICIO: 2026, MES: 11,
                LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 300,
                CONSUMIDO: 0, ACUMULADO: 0,
            }]);

            const result = await bolsaService.validateOrderWithBolsa('73', [{
                codigoArticulo: '2974',
                unidadMedida: 'CAJAS',
                cantidadEnvases: 2,
                precioTarifaCliente: 29.28,
                precioMinimo: 36.198,
                precioVenta: 28,
                precioEspecialCliente: true,
                permiteBajoMinimo: true,
                precioClienteSource: 'DSEDAC.PES',
            }]);

            expect(result).toMatchObject({ valid: true, consumo: 2.56, acumulacion: 0 });
            expect(result.lineMovements).toEqual([
                expect.objectContaining({ tipo: 'CONSUMO', importe: 2.56, precioMinimoCongelado: 29.28 }),
            ]);
        });
    });

    describe('resolveBolsaReferencePrice', () => {
        test('prefers client tariff over catalog tariff and legacy min', () => {
            expect(bolsaService.resolveBolsaReferencePrice({
                precioTarifaCliente: 8.5,
                precioTarifa: 9,
                precioMinimo: 7,
            })).toBe(8.5);
        });
    });

    describe('toDb2Timestamp', () => {
        test('formats timestamps for DB2 ODBC binding (no ISO T/Z)', () => {
            const ts = bolsaService.toDb2Timestamp(new Date('2026-06-19T10:15:30.123Z'));
            expect(ts).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
            expect(ts).not.toContain('T');
            expect(ts).not.toContain('Z');
        });
    });

    describe('getMovimientos', () => {
        test('should return mapped movements', async () => {
            mockQuery
                .mockResolvedValueOnce([
                    { ID: 1, TIPO: 'ACUMULACION  ', IMPORTE: 50, SALDO_ANTERIOR: 100, SALDO_POSTERIOR: 150,
                      CODIGO_ARTICULO: '', DESCRIPCION: 'test', PEDIDO_ID: 42, CREATED_AT: '2026-06-09T23:36:39.000Z',
                      LINEA_ID: 7, PRECIO_MINIMO_CONGELADO: 10, PRECIO_VENTA: 12, CANTIDAD: 3,
                      UNIDAD_MEDIDA: 'CAJAS  ', IDEMPOTENCY_KEY: 'pedido-42-line-7-over-min  ',
                      CODIGOVENDEDOR: '10', CODIGOCLIENTE: 'C001', NOMBRECLIENTE: 'Cliente Test',
                      SERIEPEDIDO: 'P', TERMINAL: 95, NUMEROPEDIDO: 2 }
                ]);

            const movs = await bolsaService.getMovimientos('10', 2026, 5);

            expect(movs).toHaveLength(1);
            expect(movs[0].tipo).toBe('ACUMULACION');
            expect(movs[0].importe).toBe(50);
            expect(movs[0]).toMatchObject({
                lineId: 7,
                precioMinimoCongelado: 10,
                precioVenta: 12,
                cantidad: 3,
                unidadMedida: 'CAJAS',
                idempotencyKey: 'pedido-42-line-7-over-min',
                pedidoId: 42,
                fecha: '2026-06-09T23:36:39.000Z',
                vendedor: '10',
                clienteCodigo: 'C001',
                clienteNombre: 'Cliente Test',
                pedidoReferencia: 'P-095-000002',
            });
        });

        test('should serialize movement fecha as ISO string and numeric pedidoId/lineId', async () => {
            mockQuery
                .mockResolvedValueOnce([
                    { ID: 2, TIPO: 'CONSUMO  ', IMPORTE: 3, SALDO_ANTERIOR: 100, SALDO_POSTERIOR: 97,
                      CODIGO_ARTICULO: 'ART-1', DESCRIPCION: 'under min', PEDIDO_ID: '42', CREATED_AT: '2026-06-09 23:36:39',
                      LINEA_ID: '7', PRECIO_MINIMO_CONGELADO: 10, PRECIO_VENTA: 7, CANTIDAD: 2,
                      UNIDAD_MEDIDA: 'CAJAS  ', IDEMPOTENCY_KEY: 'pedido-42-line-7-under-min  ' }
                ]);

            const movs = await bolsaService.getMovimientos('10', 2026, 5);

            expect(movs[0]).toMatchObject({
                pedidoId: 42,
                lineId: 7,
                cantidad: 2,
                importe: 3,
            });
            expect(movs[0].fecha).toMatch(/^2026-06-09T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });

        test('should pass advanced movement filters into SQL safely', async () => {
            mockQuery.mockResolvedValueOnce([]);

            await bolsaService.getMovimientos('10', undefined, undefined, 25, {
                dateFrom: '2026-06-01',
                dateTo: '2026-06-30',
                document: 'P-095-000002',
                client: 'Galera',
            });

            const [sql, params] = mockQuery.mock.calls[0];
            expect(sql).toMatch(/M\.CREATED_AT >= \?/);
            expect(sql).toMatch(/M\.CREATED_AT <= \?/);
            expect(sql).toMatch(/UPPER\(TRIM\(C\.NOMBRECLIENTE\)\) LIKE \?/);
            expect(sql).toMatch(/EXISTS \(SELECT 1 FROM DSEDAC\.CPC P/);
            expect(params).toEqual(expect.arrayContaining(['10', '2026-06-01 00:00:00.000', '2026-06-30 23:59:59.999', '%GALERA%', 25]));
        });
    });

    describe('getGroupedStatus', () => {
        test('should return grouped totals by commercial vendor', async () => {
            mockQuery.mockResolvedValueOnce([
                { ID: 1, CODIGOVENDEDOR: '01 ', EJERCICIO: 2026, MES: 6, LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 100, CONSUMIDO: 20, ACUMULADO: 120 },
                { ID: 2, CODIGOVENDEDOR: '02 ', EJERCICIO: 2026, MES: 6, LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 50, CONSUMIDO: 10, ACUMULADO: 60 },
            ]);

            const result = await bolsaService.getGroupedStatus(['01', '02'], 2026, 6);

            expect(result.vendedores).toHaveLength(2);
            expect(result.totals).toMatchObject({ saldoDisponible: 150, consumido: 30, acumulado: 180, vendedores: 2 });
            expect(mockQuery.mock.calls[0][0]).toMatch(/TRIM\(CODIGOVENDEDOR\) IN \(\?, \?\)/);
            expect(mockQuery.mock.calls[0][1]).toEqual([2026, 6, '01', '02']);
        });

        test('should include default 300 EUR status for requested vendors without row', async () => {
            mockQuery.mockResolvedValueOnce([
                { ID: 1, CODIGOVENDEDOR: '01 ', EJERCICIO: 2026, MES: 6, LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 100, CONSUMIDO: 20, ACUMULADO: 120 },
            ]);

            const result = await bolsaService.getGroupedStatus(['01', '02'], 2026, 6);

            expect(result.vendedores).toEqual([
                expect.objectContaining({ vendedor: '01', saldoDisponible: 100, consumido: 20, acumulado: 120 }),
                expect.objectContaining({ vendedor: '02', saldoDisponible: 300, consumido: 0, acumulado: 0 }),
            ]);
            expect(result.totals).toMatchObject({ saldoDisponible: 400, consumido: 20, acumulado: 120, vendedores: 2 });
        });
    });

    describe('updateBolsaConfig', () => {
        test('should update only provided fields', async () => {
            mockQuery
                .mockResolvedValueOnce([{
                    ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                    LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 100,
                    CONSUMIDO: 0, ACUMULADO: 0
                }])
                .mockResolvedValueOnce([]) // UPDATE
                .mockResolvedValueOnce([{
                    ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                    LIMITE_PCT: 5, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 100,
                    CONSUMIDO: 0, ACUMULADO: 0
                }]);

            const result = await bolsaService.updateBolsaConfig('10', 2026, 5, { limitePct: 5 });

            expect(result.limitePct).toBe(5);
        });
    });
});

describe("bolsa comercial business rules", () => {
  let svc, q;
  const row = (saldo = 300) => ({ ID: 1, CODIGOVENDEDOR: "10  ", EJERCICIO: 2026, MES: 6, LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: saldo, CONSUMIDO: 0, ACUMULADO: 0 });
  beforeEach(() => { jest.resetModules(); q = require("../config/db").queryWithParams; q.mockReset(); svc = require("../services/bolsa-comercial.service"); });
  test("allows exactly 300.00 under-min consumption and blocks 300.01", async () => {
    q.mockResolvedValueOnce([row(300)]).mockResolvedValueOnce([row(300)]);
    const allowed = await svc.validateOrderWithBolsa("10", [{ codigoArticulo: "ART300", precioTarifaCliente: 10, precioVenta: 0, cantidadEnvases: 30 }]);
    const blocked = await svc.validateOrderWithBolsa("10", [{ codigoArticulo: "ART301", precioTarifaCliente: 10, precioVenta: 0, cantidadEnvases: 30.001 }]);
    expect(allowed).toMatchObject({ valid: true, consumo: 300, saldo: 0 });
    expect(blocked).toMatchObject({ valid: false, reason: "BOLSA_INSUFICIENTE", saldo: 300 });
    expect(blocked.deficit).toBeCloseTo(0.01, 2);
  });
  test("calculates over-min accumulation as sale-minus-tariff times quantity", async () => {
    q.mockResolvedValueOnce([row(300)]);
    const result = await svc.validateOrderWithBolsa("10", [{ codigoArticulo: "ART-OVER", precioTarifaCliente: 10, precioVenta: 12, cantidadEnvases: 3, unidadMedida: "CAJAS" }]);
    expect(result).toMatchObject({ valid: true, acumulacion: 6 });
    expect(result.lineMovements).toEqual(expect.arrayContaining([expect.objectContaining({ tipo: "ACUMULACION", importe: 6, codigoArticulo: "ART-OVER", precioMinimoCongelado: 10, precioVenta: 12, cantidad: 3, unidadMedida: "CAJAS" })]));
  });
  test("calculates under-min consumption as tariff-minus-sale times quantity", async () => {
    q.mockResolvedValueOnce([row(300)]);
    const result = await svc.validateOrderWithBolsa("10", [{ codigoArticulo: "ART-UNDER", precioTarifaCliente: 10, precioMinimo: 5, precioVenta: 7, cantidadEnvases: 2, unidadMedida: "CAJAS" }]);
    expect(result).toMatchObject({ valid: true, consumo: 6, saldo: 294 });
  });
  test("does not double-count equivalent units for cajas lines", async () => {
    q.mockResolvedValueOnce([row(300)]);
    const result = await svc.validateOrderWithBolsa("10", [{
      codigoArticulo: "ART-EQUIV",
      precioTarifaCliente: 10,
      precioVenta: 12,
      cantidadEnvases: 2,
      cantidadUnidades: 24,
      unidadesCaja: 12,
      unidadMedida: "CAJAS",
    }]);
    expect(result).toMatchObject({ valid: true, acumulacion: 4 });
    expect(result.lineMovements[0]).toMatchObject({ cantidad: 2, importe: 4 });
  });
  test("counts loose units as box fraction for cajas lines", async () => {
    q.mockResolvedValueOnce([row(300)]);
    const result = await svc.validateOrderWithBolsa("10", [{
      codigoArticulo: "ART-PARTIAL",
      precioTarifaCliente: 10,
      precioVenta: 12,
      cantidadEnvases: 2,
      cantidadUnidades: 3,
      unidadesCaja: 12,
      unidadMedida: "CAJAS",
    }]);
    expect(result).toMatchObject({ valid: true, acumulacion: 4.5 });
    expect(result.lineMovements[0]).toMatchObject({ cantidad: 2.25, importe: 4.5 });
  });
});

describe("bolsa ledger movement contracts", () => {
  let svc, q;
  beforeEach(() => { jest.resetModules(); q = require("../config/db").queryWithParams; q.mockReset(); svc = require("../services/bolsa-comercial.service"); });
  test("movement writes preserve immutable ledger payload fields", async () => {
    q.mockResolvedValueOnce([{ ID: 1, CODIGOVENDEDOR: "10  ", EJERCICIO: 2026, MES: 6, LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 300, CONSUMIDO: 0, ACUMULADO: 0 }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await svc.acumularBolsa("10", 42, 6, { timestamp: "2026-06-09T23:36:39.000Z", lineId: 7, codigoArticulo: "ART-OVER", precioMinimoCongelado: 10, precioVenta: 12, cantidad: 3, unidadMedida: "CAJAS", idempotencyKey: "pedido-42-line-7-over-min" });
    const movementInsert = q.mock.calls.find(([sql]) => /INSERT\s+INTO\s+JAVIER\.(?:TEST_)?MOVIMIENTOS_BOLSA/i.test(sql));
    expect(movementInsert).toBeDefined();
    expect(movementInsert[0]).toEqual(expect.stringContaining("CREATED_AT"));
    expect(movementInsert[0]).toEqual(expect.stringContaining("LINEA_ID"));
    expect(movementInsert[0]).toEqual(expect.stringContaining("CODIGOVENDEDOR"));
    expect(movementInsert[0]).toEqual(expect.stringContaining("PRECIO_MINIMO_CONGELADO"));
    expect(movementInsert[0]).toEqual(expect.stringContaining("PRECIO_VENTA"));
    expect(movementInsert[0]).toEqual(expect.stringContaining("CANTIDAD"));
    expect(movementInsert[0]).toEqual(expect.stringContaining("UNIDAD_MEDIDA"));
    expect(movementInsert[0]).toEqual(expect.stringContaining("IDEMPOTENCY_KEY"));
    expect(movementInsert[1]).toEqual(expect.arrayContaining(["10", 42, 7, "ART-OVER", 10, 12, 3, "CAJAS", "pedido-42-line-7-over-min"]));
  });
});

describe("bolsa route contracts", () => {
  test("registers a single GET movements route", () => {
    const fs = require("fs");
    const path = require("path");
    const source = fs.readFileSync(path.join(__dirname, "../routes/bolsa.js"), "utf8");
    const needle = "router.get(" + String.fromCharCode(39) + "/:vendedorCode/movements" + String.fromCharCode(39);
    expect(source.split(needle).length - 1).toBe(1);
  });
});

describe("pedidos confirmation bolsa contract", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.dontMock("../services/bolsa-comercial.service");
    jest.dontMock('../services/pedidos/erp-tariff-floor');
  });
  test("confirmOrder rejects instead of silently succeeding when bolsa movement write fails", async () => {
    const db = require("../config/db");
    const conn = installTransactionalPool(db);
    db.queryWithParams.mockReset();
    db.queryWithParams.mockImplementation(async (sql) => {
      if (/UPDATE\s+JAVIER\.(?:TEST_)?PEDIDOS_CAB/i.test(sql) && sql.includes("CONFIRMANDO")) return { count: 1 };
      if (/SELECT\s+ID,\s+TRIM\(ESTADO\).*DESCUENTO_GLOBAL/is.test(sql)) {
        return [{
          ID: 42, ESTADO: conn.getState(), EJERCICIO: 2026, NUMEROPEDIDO: 1001,
          SERIEPEDIDO: 'M', TERMINAL: 1, CODIGOCLIENTE: 'C001', CODIGOVENDEDOR: '10',
          IMPORTETOTAL: 7, IMPORTEBASE: 7, IMPORTEIVA: 0, IMPORTECOSTO: 4,
          IMPORTEMARGEN: 3, DESCUENTO_GLOBAL: 0, PORCENTAJEDESCUENTO1: 0,
        }];
      }
      if (/SELECT\s+ESTADO,/i.test(sql)) return [{ ID: 42, ESTADO: "BORRADOR", EJERCICIO: 2026, NUMEROPEDIDO: 1001, SERIEPEDIDO: "M", TERMINAL: 1, DIADOCUMENTO: 9, MESDOCUMENTO: 6, ANODOCUMENTO: 2026, HORADOCUMENTO: 233639, CODIGOCLIENTE: "C001", NOMBRECLIENTE: "Cliente Test", CODIGOVENDEDOR: "10", CODIGOFORMAPAGO: "01", CODIGOTARIFA: 1, CODIGOALMACEN: 1, TIPOVENTA: "CC", IMPORTETOTAL: 7, IMPORTEBASE: 7, IMPORTEIVA: 0, IMPORTECOSTO: 4, IMPORTEMARGEN: 3, OBSERVACIONES: "" }];
      if (/FROM\s+DSEDAC\.OPP/i.test(sql)) return [{ CODIGOVEHICULO: "02", CODIGOREPARTIDOR: "10" }];
      if (/FROM\s+JAVIER\.(?:TEST_)?PEDIDOS_LIN\s+WHERE\s+PEDIDO_ID/i.test(sql)) return [{ ID: 7, PEDIDO_ID: 42, SECUENCIA: 1, CODIGOARTICULO: "ART-UNDER", DESCRIPCION: "Producto bajo minimo", CANTIDADENVASES: 1, CANTIDADUNIDADES: 0, UNIDADMEDIDA: "CAJAS", UNIDADESCAJA: 1, PRECIOVENTA: 7, PRECIOCOSTO: 4, PRECIOTARIFA: 10, PRECIOTARIFACLIENTE: 10, PRECIOMINIMO: 10, IMPORTEVENTA: 7, IMPORTECOSTO: 4, IMPORTEMARGEN: 3, PORCENTAJEMARGEN: 42.85, TIPOLINEA: "R", TIPOVENTA: "CC", CLASELINEA: "VT", ORDEN: 1 }];
      if (/FROM\s+DSEDAC\.ARO/i.test(sql)) return [{ CODE: "ART-UNDER", ENVASES: 100, UNIDADES: 0 }];
      if (/UPDATE\s+JAVIER\.(?:TEST_)?PEDIDOS_CAB/i.test(sql) && sql.includes("CONFIRMADO")) return [];
      if (/SELECT\s+ID,\s+EJERCICIO,\s+NUMEROPEDIDO/i.test(sql)) return [{ ID: 42, EJERCICIO: 2026, NUMEROPEDIDO: 1001, SERIEPEDIDO: "M", TERMINAL: 1, DIADOCUMENTO: 9, MESDOCUMENTO: 6, ANODOCUMENTO: 2026, HORADOCUMENTO: 233639, CODIGOCLIENTE: "C001", NOMBRECLIENTE: "Cliente Test", CODIGOVENDEDOR: "10", CODIGOFORMAPAGO: "01", CODIGOTARIFA: 1, CODIGOALMACEN: 1, TIPOVENTA: "CC", ESTADO: "CONFIRMADO", IMPORTETOTAL: 7, IMPORTEBASE: 7, IMPORTEIVA: 0, IMPORTECOSTO: 4, IMPORTEMARGEN: 3, OBSERVACIONES: "" }];
      return [];
    });
    jest.doMock("../services/query-optimizer", () => ({ cachedQuery: jest.fn((fn, sql, _key, _ttl, params) => fn(sql, params)) }));
    jest.doMock("../services/redis-cache", () => ({ redisCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), invalidatePattern: jest.fn() }, TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 } }));
    jest.doMock("../services/laclae", () => ({ getClientDays: jest.fn(() => ({ deliveryDays: ["martes"], deliveryDaysShort: "M" })) }));
    const applyOrderMovementsWith = jest.fn()
      .mockRejectedValueOnce(new Error("movement write failed"))
      .mockResolvedValueOnce({ allowed: true, saldo: 297 });
    jest.doMock("../services/bolsa-comercial.service", () => ({
      validateOrderWithBolsa: jest.fn().mockResolvedValue({ valid: true, consumo: 3, saldo: 297 }),
      applyOrderMovementsWith,
    }));
    const pedidosService = require("../services/pedidos.service");
    await expect(pedidosService.confirmOrder(42, "CC", { deliveryDate: "2026-06-09" })).rejects.toThrow(/movement write failed|bolsa/i);
    expect(db.queryWithParams.mock.calls.some(([sql]) =>
      /SET\s+ESTADO\s*=\s*'BORRADOR'/i.test(sql)
    )).toBe(false);
    expect(conn.getState()).toBe('BORRADOR');
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();

    await expect(pedidosService.confirmOrder(42, "CC", { deliveryDate: "2026-06-09" }))
      .resolves.toMatchObject({ header: { id: 42, estado: 'CONFIRMADO' } });
    expect(conn.getState()).toBe('CONFIRMADO');
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(applyOrderMovementsWith).toHaveBeenCalledTimes(2);
  });

  test("confirmOrder returns refreshed bolsa summary after movement write", async () => {
    const db = require("../config/db");
    const conn = installTransactionalPool(db);
    const header = { ID: 42, EJERCICIO: 2026, NUMEROPEDIDO: 1001, SERIEPEDIDO: "M", TERMINAL: 1, DIADOCUMENTO: 9, MESDOCUMENTO: 6, ANODOCUMENTO: 2026, HORADOCUMENTO: 233639, CODIGOCLIENTE: "C001", NOMBRECLIENTE: "Cliente Test", CODIGOVENDEDOR: "10", CODIGOFORMAPAGO: "01", CODIGOTARIFA: 1, CODIGOALMACEN: 1, TIPOVENTA: "CC", IMPORTETOTAL: 36, IMPORTEBASE: 36, IMPORTEIVA: 0, IMPORTECOSTO: 24, IMPORTEMARGEN: 12, OBSERVACIONES: "" };
    const line = { ID: 7, PEDIDO_ID: 42, SECUENCIA: 1, CODIGOARTICULO: "ART-OVER", DESCRIPCION: "Producto sobre minimo", CANTIDADENVASES: 3, CANTIDADUNIDADES: 0, UNIDADMEDIDA: "CAJAS", UNIDADESCAJA: 1, PRECIOVENTA: 12, PRECIOCOSTO: 8, PRECIOTARIFA: 10, PRECIOTARIFACLIENTE: 10, PRECIOMINIMO: 10, IMPORTEVENTA: 36, IMPORTECOSTO: 24, IMPORTEMARGEN: 12, PORCENTAJEMARGEN: 33.33, TIPOLINEA: "R", TIPOVENTA: "CC", CLASELINEA: "VT", CODIGOIVA: "2", ORDEN: 1 };
    let movementReads = 0;
    db.queryWithParams.mockReset();
    db.queryWithParams.mockImplementation(async (sql) => {
      if (/UPDATE\s+JAVIER\.(?:TEST_)?PEDIDOS_CAB/i.test(sql) && sql.includes("CONFIRMANDO")) return { count: 1 };
      if (/SELECT\s+ID,\s+TRIM\(ESTADO\).*DESCUENTO_GLOBAL/is.test(sql)) {
        return [{
          ...header,
          ESTADO: conn.getState(),
          DESCUENTO_GLOBAL: 0,
          PORCENTAJEDESCUENTO1: 0,
        }];
      }
      if (/SELECT\s+ESTADO,/i.test(sql)) return [{ ...header, ESTADO: "BORRADOR" }];
      if (/FROM\s+DSEDAC\.OPP/i.test(sql)) return [{ CODIGOVEHICULO: "02", CODIGOREPARTIDOR: "10" }];
      if (/FROM\s+JAVIER\.(?:TEST_)?PEDIDOS_LIN\s+WHERE\s+PEDIDO_ID/i.test(sql)) return [line];
      if (/FROM\s+DSEDAC\.ARO/i.test(sql)) return [{ CODE: "ART-OVER", ENVASES: 100, UNIDADES: 0 }];
      if (/INSERT\s+INTO\s+JAVIER\.(?:TEST_)?PEDIDOS_STOCK_RESERVE/i.test(sql)) return [];
      if (/UPDATE\s+JAVIER\.(?:TEST_)?PEDIDOS_CAB/i.test(sql) && sql.includes("CONFIRMADO")) return [];
      if (/SELECT\s+ID,\s+EJERCICIO,\s+NUMEROPEDIDO/i.test(sql)) return [{ ...header, ESTADO: "CONFIRMADO" }];
      if (/FROM\s+JAVIER\.(?:TEST_)?MOVIMIENTOS_BOLSA/i.test(sql)) {
        movementReads += 1;
        return [{
          ID: 99,
          TIPO: "ACUMULACION",
          IMPORTE: 6,
          SALDO_ANTERIOR: 300,
          SALDO_POSTERIOR: 306,
          CODIGO_ARTICULO: "ART-OVER",
          DESCRIPCION: "Producto sobre minimo",
          PEDIDO_ID: 42,
          LINEA_ID: 7,
          PRECIO_MINIMO_CONGELADO: 10,
          PRECIO_VENTA: 12,
          CANTIDAD: 3,
          UNIDAD_MEDIDA: "CAJAS",
          IDEMPOTENCY_KEY: "pedido-42-line-7-over-min",
          CREATED_AT: "2026-06-09T23:36:39.000Z",
        }];
      }
      return [];
    });
    jest.doMock("../services/query-optimizer", () => ({ cachedQuery: jest.fn((fn, sql, _key, _ttl, params) => fn(sql, params)) }));
    jest.doMock("../services/redis-cache", () => ({ redisCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), invalidatePattern: jest.fn() }, TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 } }));
    jest.doMock("../services/laclae", () => ({ getClientDays: jest.fn(() => ({ deliveryDays: ["martes"], deliveryDaysShort: "M" })) }));
    const mockValidateOrderWithBolsa = jest.fn().mockResolvedValue({
      valid: true,
      acumulacion: 6,
      consumo: 0,
      saldo: 306,
      lineMovements: [{ tipo: "ACUMULACION", lineId: 7, codigoArticulo: "ART-OVER", precioMinimoCongelado: 10, precioVenta: 12, cantidad: 3, unidadMedida: "CAJAS", importe: 6, idempotencyKey: "pedido-42-line-7-over-min" }],
    });
    const mockAcumularBolsa = jest.fn().mockResolvedValue(306);
    const mockApplyOrderMovementsWith = jest.fn().mockResolvedValue({ allowed: true, saldoAcumulado: 306 });
    jest.doMock("../services/bolsa-comercial.service", () => ({
      validateOrderWithBolsa: mockValidateOrderWithBolsa,
      acumularBolsa: mockAcumularBolsa,
      consumirBolsa: jest.fn(),
      applyOrderMovementsWith: mockApplyOrderMovementsWith,
    }));

    const pedidosService = require("../services/pedidos.service");
    const result = await pedidosService.confirmOrder(42, "CC", { deliveryDate: "2026-06-09" });

    expect(mockApplyOrderMovementsWith).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        vendedorCode: "10",
        pedidoId: 42,
        acumulacionAmount: 6,
        acumulacionMovements: [expect.objectContaining({ lineId: 7, importe: 6 })],
      }),
    );
    expect(movementReads).toBe(1);
    expect(result.bolsaSummary).toMatchObject({ acumulacion: 6, consumo: 0, neto: 6, movementCount: 1 });
    expect(result.lines[0].bolsaImpact).toMatchObject({ acumulacion: 6, hasImpact: true });
  });

  test('locked floor race rolls back with no order, audit, stock-reserve or bolsa DML', async () => {
    const db = require('../config/db');
    const conn = installTransactionalPool(db);
    const header = {
      ID: 48, EJERCICIO: 2026, NUMEROPEDIDO: 1008, SERIEPEDIDO: 'M', TERMINAL: 1,
      DIADOCUMENTO: 9, MESDOCUMENTO: 6, ANODOCUMENTO: 2026, HORADOCUMENTO: 120000,
      CODIGOCLIENTE: 'C001', NOMBRECLIENTE: 'Cliente Test', CODIGOVENDEDOR: '10',
      CODIGOFORMAPAGO: '01', CODIGOTARIFA: 1, CODIGOALMACEN: 1, TIPOVENTA: 'CC',
      ESTADO: 'BORRADOR', IMPORTETOTAL: 20.62, IMPORTEBASE: 20.62, IMPORTEIVA: 0,
      IMPORTECOSTO: 0, IMPORTEMARGEN: 0, DESCUENTO_GLOBAL: 0,
      PORCENTAJEDESCUENTO1: 0, OBSERVACIONES: '',
    };
    const line = {
      ID: 18, PEDIDO_ID: 48, SECUENCIA: 1, CODIGOARTICULO: '1009', DESCRIPCION: 'Producto',
      CANTIDADENVASES: 1, CANTIDADUNIDADES: 5, UNIDADMEDIDA: 'KILO', UNIDADESCAJA: 5,
      PRECIOVENTA: 4.124, PRECIOCOSTO: 0, PRECIOTARIFA: 4.124,
      PRECIOTARIFACLIENTE: 4.124, PRECIOMINIMO: 4.124, IMPORTEVENTA: 20.62,
      IMPORTECOSTO: 0, IMPORTEMARGEN: 0, PORCENTAJEMARGEN: 0,
      DESCUENTO_LINEA: 0, PORCENTAJEDESCUENTO: 0,
      TIPOLINEA: 'R', TIPOVENTA: 'CC', CLASELINEA: 'VT', CODIGOIVA: '2', ORDEN: 1,
    };
    db.queryWithParams.mockReset();
    db.queryWithParams.mockImplementation(promisedImplementation((sql) => {
      if (/SELECT\s+ESTADO,/i.test(sql)) return [{ ...header, ESTADO: 'BORRADOR' }];
      if (/FROM\s+DSEDAC\.OPP/i.test(sql)) return [{ CODIGOVEHICULO: '02', CODIGOREPARTIDOR: '10' }];
      if (/FROM\s+JAVIER\.(?:TEST_)?PEDIDOS_LIN\s+WHERE\s+PEDIDO_ID/i.test(sql)) return [line];
      if (/DESCUENTO_GLOBAL/i.test(sql) && /PEDIDOS_CAB/i.test(sql)) {
        if (/SELECT\s+ID,\s+TRIM\(ESTADO\)/is.test(sql)) return [header];
        return [{ DESCUENTO_GLOBAL: 0, PORCENTAJEDESCUENTO1: 0 }];
      }
      if (/FROM\s+DSEDAC\.ARO/i.test(sql)) return [{ CODE: '1009', ENVASES: 100, UNIDADES: 500 }];
      return [];
    }));
    jest.doMock('../services/query-optimizer', () => ({
      cachedQuery: jest.fn((fn, sql, _key, _ttl, params) => fn(sql, params)),
    }));
    jest.doMock('../services/redis-cache', () => ({
      redisCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), invalidatePattern: jest.fn() },
      TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
    }));
    jest.doMock('../services/laclae', () => ({
      getClientDays: jest.fn(() => ({ deliveryDays: ['martes'], deliveryDaysShort: 'M' })),
    }));
    const lockedConflict = Object.assign(new Error('La tarifa cambió durante la confirmación.'), {
      code: 'HARD_PRICE_FLOOR_BREACH', status: 409,
    });
    const assertErpTariffFloorForOrder = jest.fn()
      .mockResolvedValueOnce({ active: true, covered: 1, skipped: [] })
      .mockRejectedValueOnce(lockedConflict);
    jest.doMock('../services/pedidos/erp-tariff-floor', () => ({ assertErpTariffFloorForOrder }));
    const validateOrderWithBolsa = jest.fn();
    const applyOrderMovementsWith = jest.fn();
    jest.doMock('../services/bolsa-comercial.service', () => ({
      validateOrderWithBolsa,
      applyOrderMovementsWith,
    }));

    const pedidosService = require('../services/pedidos.service');
    await expect(pedidosService.confirmOrder(48, 'CC', {
      deliveryDate: '2026-06-09',
      requireTariffFloorPilotProfile: true,
    })).rejects.toMatchObject({ code: 'HARD_PRICE_FLOOR_BREACH', status: 409 });

    expect(assertErpTariffFloorForOrder).toHaveBeenCalledTimes(2);
    expect(validateOrderWithBolsa).not.toHaveBeenCalled();
    expect(applyOrderMovementsWith).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) => /^(?:INSERT|UPDATE|DELETE|MERGE)\b/i.test(String(sql).trim()))).toBe(false);
  });

  test('confirmOrder replay returns the existing confirmed order without repeating writes', async () => {
    const db = require('../config/db');
    const conn = installTransactionalPool(db, { initialState: 'CONFIRMADO' });
    const header = {
      ID: 42, EJERCICIO: 2026, NUMEROPEDIDO: 1001, SERIEPEDIDO: 'M', TERMINAL: 1,
      DIADOCUMENTO: 9, MESDOCUMENTO: 6, ANODOCUMENTO: 2026, HORADOCUMENTO: 120000,
      CODIGOCLIENTE: 'C001', NOMBRECLIENTE: 'Cliente Test', CODIGOVENDEDOR: '10',
      CODIGOFORMAPAGO: '01', CODIGOTARIFA: 1, CODIGOALMACEN: 1, TIPOVENTA: 'CC',
      ESTADO: 'CONFIRMADO', IMPORTETOTAL: 7, IMPORTEBASE: 7, IMPORTEIVA: 0,
      IMPORTECOSTO: 4, IMPORTEMARGEN: 3, OBSERVACIONES: '',
    };
    db.queryWithParams.mockReset();
    db.queryWithParams.mockImplementation(promisedImplementation((sql) => {
      if (/UPDATE\s+JAVIER\.(?:TEST_)?PEDIDOS_CAB/i.test(sql) && sql.includes('CONFIRMANDO')) {
        return { count: 0 };
      }
      if (/SELECT\s+ESTADO,/i.test(sql)) return [header];
      if (/SELECT\s+ID,\s+EJERCICIO,\s+NUMEROPEDIDO/i.test(sql)) return [header];
      return [];
    }));
    jest.doMock('../services/query-optimizer', () => ({
      cachedQuery: jest.fn((fn, sql, _key, _ttl, params) => fn(sql, params)),
    }));
    jest.doMock('../services/redis-cache', () => ({
      redisCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), invalidatePattern: jest.fn() },
      TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
    }));
    const floor = jest.fn();
    jest.doMock('../services/pedidos/erp-tariff-floor', () => ({ assertErpTariffFloorForOrder: floor }));
    const applyOrderMovementsWith = jest.fn();
    jest.doMock('../services/bolsa-comercial.service', () => ({
      validateOrderWithBolsa: jest.fn(),
      applyOrderMovementsWith,
    }));

    const pedidosService = require('../services/pedidos.service');
    const result = await pedidosService.confirmOrder(42, 'CC');

    expect(result).toMatchObject({
      idempotentReplay: true,
      header: { id: 42, estado: 'CONFIRMADO' },
    });
    expect(applyOrderMovementsWith).not.toHaveBeenCalled();
    expect(floor).not.toHaveBeenCalled();
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(db.queryWithParams.mock.calls.some(([sql]) =>
      /INSERT\s+INTO\s+JAVIER\.(?:TEST_)?PEDIDOS_STOCK_RESERVE/i.test(sql)
    )).toBe(false);
  });

  test('two concurrent local confirmations commit once and replay without duplicate ledger or history', async () => {
    const db = require('../config/db');
    const serialized = installSerializedTransactionalConnections(db);
    const header = {
      ID: 44, EJERCICIO: 2026, NUMEROPEDIDO: 1003, SERIEPEDIDO: 'M', TERMINAL: 1,
      DIADOCUMENTO: 9, MESDOCUMENTO: 6, ANODOCUMENTO: 2026, HORADOCUMENTO: 120000,
      CODIGOCLIENTE: 'C001', NOMBRECLIENTE: 'Cliente Test', CODIGOVENDEDOR: '10',
      CODIGOFORMAPAGO: '01', CODIGOTARIFA: 1, CODIGOALMACEN: 1, TIPOVENTA: 'CC',
      IMPORTETOTAL: 7, IMPORTEBASE: 7, IMPORTEIVA: 0, IMPORTECOSTO: 4,
      IMPORTEMARGEN: 3, OBSERVACIONES: '',
    };
    const line = {
      ID: 9, PEDIDO_ID: 44, SECUENCIA: 1, CODIGOARTICULO: 'ART-CONCURRENT',
      DESCRIPCION: 'Producto', CANTIDADENVASES: 1, CANTIDADUNIDADES: 0,
      UNIDADMEDIDA: 'CAJAS', UNIDADESCAJA: 1, PRECIOVENTA: 7, PRECIOCOSTO: 4,
      PRECIOTARIFA: 10, PRECIOTARIFACLIENTE: 10, PRECIOMINIMO: 10,
      IMPORTEVENTA: 7, IMPORTECOSTO: 4, IMPORTEMARGEN: 3,
      PORCENTAJEMARGEN: 42.85, TIPOLINEA: 'R', TIPOVENTA: 'CC', CLASELINEA: 'VT',
      CODIGOIVA: '2', ORDEN: 1,
    };
    db.queryWithParams.mockReset();
    db.queryWithParams.mockImplementation((sql) => {
      if (/SELECT\s+ESTADO,/i.test(sql)) return Promise.resolve([{ ...header, ESTADO: 'BORRADOR' }]);
      if (/FROM\s+DSEDAC\.OPP/i.test(sql)) return Promise.resolve([{ CODIGOVEHICULO: '02', CODIGOREPARTIDOR: '10' }]);
      if (/FROM\s+JAVIER\.(?:TEST_)?PEDIDOS_LIN\s+WHERE\s+PEDIDO_ID/i.test(sql)) return Promise.resolve([line]);
      if (/DESCUENTO_GLOBAL/i.test(sql) && /PEDIDOS_CAB/i.test(sql)) return Promise.resolve([{ DESCUENTO_GLOBAL: 0, PORCENTAJEDESCUENTO1: 0 }]);
      if (/FROM\s+DSEDAC\.ARO/i.test(sql)) return Promise.resolve([{ CODE: 'ART-CONCURRENT', ENVASES: 100, UNIDADES: 0 }]);
      if (/SELECT\s+ID,\s+EJERCICIO,\s+NUMEROPEDIDO/i.test(sql)) return Promise.resolve([{ ...header, ESTADO: 'CONFIRMADO' }]);
      return Promise.resolve([]);
    });
    jest.doMock('../services/query-optimizer', () => ({
      cachedQuery: jest.fn((fn, sql, _key, _ttl, params) => fn(sql, params)),
    }));
    jest.doMock('../services/redis-cache', () => ({
      redisCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), invalidatePattern: jest.fn() },
      TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
    }));
    jest.doMock('../services/laclae', () => ({
      getClientDays: jest.fn(() => ({ deliveryDays: ['martes'], deliveryDaysShort: 'M' })),
    }));
    const applyOrderMovementsWith = jest.fn().mockResolvedValue({ allowed: true, saldo: 297 });
    jest.doMock('../services/bolsa-comercial.service', () => ({
      validateOrderWithBolsa: jest.fn().mockResolvedValue({ valid: true, consumo: 3, acumulacion: 0 }),
      applyOrderMovementsWith,
    }));

    const pedidosService = require('../services/pedidos.service');
    const results = await Promise.all([
      pedidosService.confirmOrder(44, 'CC', { deliveryDate: '2026-06-09' }),
      pedidosService.confirmOrder(44, 'CC', { deliveryDate: '2026-06-09' }),
    ]);

    expect(serialized.getState()).toBe('CONFIRMADO');
    expect(serialized.connections).toHaveLength(2);
    expect(serialized.connections.filter((conn) => conn.commit.mock.calls.length === 1)).toHaveLength(2);
    expect(applyOrderMovementsWith).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.idempotentReplay === true)).toHaveLength(1);
    expect(db.queryWithParams.mock.calls.filter(([sql]) =>
      /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?JAVIER\.TEST_PRECIO_HISTORICO/i.test(sql)
    )).toHaveLength(0);
  });

  test('confirmation uses the locked line and header-discount snapshot after a concurrent draft edit', async () => {
    const db = require('../config/db');
    const conn = installTransactionalPool(db);
    const header = {
      ID: 45, EJERCICIO: 2026, NUMEROPEDIDO: 1004, SERIEPEDIDO: 'M', TERMINAL: 1,
      DIADOCUMENTO: 9, MESDOCUMENTO: 6, ANODOCUMENTO: 2026, HORADOCUMENTO: 120000,
      CODIGOCLIENTE: 'C001', NOMBRECLIENTE: 'Cliente Test', CODIGOVENDEDOR: '10',
      CODIGOFORMAPAGO: '01', CODIGOTARIFA: 1, CODIGOALMACEN: 1, TIPOVENTA: 'CC',
      IMPORTETOTAL: 7, IMPORTEBASE: 7, IMPORTEIVA: 0, IMPORTECOSTO: 4,
      IMPORTEMARGEN: 3, OBSERVACIONES: '',
    };
    const baseLine = {
      ID: 10, PEDIDO_ID: 45, SECUENCIA: 1, CODIGOARTICULO: 'ART-EDIT', DESCRIPCION: 'Producto',
      CANTIDADENVASES: 1, CANTIDADUNIDADES: 0, UNIDADMEDIDA: 'CAJAS', UNIDADESCAJA: 1,
      PRECIOVENTA: 9, PRECIOCOSTO: 4, PRECIOTARIFA: 10, PRECIOTARIFACLIENTE: 10,
      PRECIOMINIMO: 8, IMPORTEVENTA: 9, IMPORTECOSTO: 4, IMPORTEMARGEN: 5,
      PORCENTAJEMARGEN: 55.55, DESCUENTO_LINEA: 0, PORCENTAJEDESCUENTO: 0,
      TIPOLINEA: 'R', TIPOVENTA: 'CC', CLASELINEA: 'VT', CODIGOIVA: '2', ORDEN: 1,
    };
    const lockedLine = {
      ...baseLine,
      CANTIDADENVASES: 2,
      PRECIOVENTA: 8,
      IMPORTEVENTA: 14.4,
      DESCUENTO_LINEA: 10,
      PORCENTAJEDESCUENTO: 10,
    };
    let lineReads = 0;
    let auditHeaderReads = 0;
    db.queryWithParams.mockReset();
    db.queryWithParams.mockImplementation((sql) => {
      if (/SELECT\s+ESTADO,/i.test(sql)) return Promise.resolve([{ ...header, ESTADO: 'BORRADOR' }]);
      if (/FROM\s+DSEDAC\.OPP/i.test(sql)) return Promise.resolve([{ CODIGOVEHICULO: '02', CODIGOREPARTIDOR: '10' }]);
      if (/FROM\s+JAVIER\.(?:TEST_)?PEDIDOS_LIN\s+WHERE\s+PEDIDO_ID/i.test(sql)) {
        lineReads += 1;
        return Promise.resolve([lineReads === 1 ? baseLine : lockedLine]);
      }
      if (/SELECT\s+ID,\s+TRIM\(ESTADO\).*DESCUENTO_GLOBAL/is.test(sql)) {
        auditHeaderReads += 1;
        return Promise.resolve([{
          ...header,
          ESTADO: auditHeaderReads === 1 ? 'BORRADOR' : 'CONFIRMADO',
          IMPORTETOTAL: 14.4,
          IMPORTEBASE: 14.4,
          IMPORTECOSTO: 8,
          IMPORTEMARGEN: 6.4,
          DESCUENTO_GLOBAL: 5,
          PORCENTAJEDESCUENTO1: 0,
        }]);
      }
      if (/FROM\s+DSEDAC\.ARO/i.test(sql)) return Promise.resolve([{ CODE: 'ART-EDIT', ENVASES: 100, UNIDADES: 0 }]);
      if (/SELECT\s+ID,\s+EJERCICIO,\s+NUMEROPEDIDO/i.test(sql)) return Promise.resolve([{ ...header, ESTADO: 'CONFIRMADO' }]);
      return Promise.resolve([]);
    });
    jest.doMock('../services/query-optimizer', () => ({
      cachedQuery: jest.fn((fn, sql, _key, _ttl, params) => fn(sql, params)),
    }));
    jest.doMock('../services/redis-cache', () => ({
      redisCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), invalidatePattern: jest.fn() },
      TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
    }));
    jest.doMock('../services/laclae', () => ({
      getClientDays: jest.fn(() => ({ deliveryDays: ['martes'], deliveryDaysShort: 'M' })),
    }));
    const validateOrderWithBolsa = jest.fn((_vendor, currentLines, options) => Promise.resolve({
      valid: true,
      consumo: currentLines[0].CANTIDADENVASES * 2,
      acumulacion: 0,
      lineMovements: [{
        tipo: 'CONSUMO', lineId: 10, codigoArticulo: 'ART-EDIT',
        cantidad: currentLines[0].CANTIDADENVASES,
        precioVenta: currentLines[0].PRECIOVENTA,
        importe: currentLines[0].CANTIDADENVASES * 2,
        descuento: options.globalDiscountPct,
      }],
    }));
    const applyOrderMovementsWith = jest.fn().mockResolvedValue({ allowed: true });
    jest.doMock('../services/bolsa-comercial.service', () => ({
      validateOrderWithBolsa,
      applyOrderMovementsWith,
    }));

    const pedidosService = require('../services/pedidos.service');
    await pedidosService.confirmOrder(45, 'CC', { deliveryDate: '2026-06-09' });

    expect(validateOrderWithBolsa).toHaveBeenLastCalledWith(
      '10',
      [expect.objectContaining({ CANTIDADENVASES: 2, PRECIOVENTA: 8, DESCUENTO_LINEA: 10 })],
      expect.objectContaining({ globalDiscountPct: 5, queryFn: expect.any(Function) }),
    );
    expect(applyOrderMovementsWith).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        pedidoId: 45,
        consumoAmount: 4,
        consumoMovements: [expect.objectContaining({ cantidad: 2, precioVenta: 8 })],
      }),
    );
    const reservationInsert = conn.query.mock.calls.find(([sql]) =>
      /INSERT\s+INTO\s+JAVIER\.(?:TEST_)?PEDIDOS_STOCK_RESERVE/i.test(sql)
    );
    expect(reservationInsert?.[1]).toEqual(expect.arrayContaining([45, 'ART-EDIT', 2, 0]));
    const confirmedEventInsert = conn.query.mock.calls.find(([sql, params]) =>
      /INSERT\s+INTO\s+JAVIER\.TEST_PEDIDO_STATE_EVENTS/i.test(sql)
      && params?.[2] === 'CONFIRMADO'
    );
    const confirmedPayload = JSON.parse(confirmedEventInsert[1][8]);
    expect(confirmedPayload.before.header).toMatchObject({
      ESTADO: 'BORRADOR', IMPORTETOTAL: 14.4, DESCUENTO_GLOBAL: 5,
    });
    expect(confirmedPayload.after.header).toMatchObject({
      ESTADO: 'CONFIRMADO', IMPORTETOTAL: 14.4, DESCUENTO_GLOBAL: 5,
    });
    expect(confirmedPayload.before.lines).toEqual([
      expect.objectContaining({ CANTIDADENVASES: 2, PRECIOVENTA: 8, DESCUENTO_LINEA: 10 }),
    ]);
    expect(confirmedPayload.after.lines).toEqual(confirmedPayload.before.lines);
  });

  test('a line edit that starts after the confirmation claim waits and is rejected without writes', async () => {
    const db = require('../config/db');
    const serialized = installSerializedTransactionalConnections(db);
    const header = {
      ID: 46, EJERCICIO: 2026, NUMEROPEDIDO: 1005, SERIEPEDIDO: 'M', TERMINAL: 1,
      DIADOCUMENTO: 9, MESDOCUMENTO: 6, ANODOCUMENTO: 2026, HORADOCUMENTO: 120000,
      CODIGOCLIENTE: 'C001', NOMBRECLIENTE: 'Cliente Test', CODIGOVENDEDOR: '10',
      CODIGOFORMAPAGO: '01', CODIGOTARIFA: 1, CODIGOALMACEN: 1, TIPOVENTA: 'CC',
      IMPORTETOTAL: 10, IMPORTEBASE: 10, IMPORTEIVA: 0, IMPORTECOSTO: 4,
      IMPORTEMARGEN: 6, OBSERVACIONES: '',
    };
    const line = {
      ID: 11, PEDIDO_ID: 46, SECUENCIA: 1, CODIGOARTICULO: 'ART-LOCK', DESCRIPCION: 'Producto',
      CANTIDADENVASES: 1, CANTIDADUNIDADES: 0, UNIDADMEDIDA: 'CAJAS', UNIDADESCAJA: 1,
      PRECIOVENTA: 10, PRECIOCOSTO: 4, PRECIOTARIFA: 10, PRECIOTARIFACLIENTE: 10,
      PRECIOMINIMO: 8, IMPORTEVENTA: 10, IMPORTECOSTO: 4, IMPORTEMARGEN: 6,
      PORCENTAJEMARGEN: 60, DESCUENTO_LINEA: 0, PORCENTAJEDESCUENTO: 0,
      TIPOLINEA: 'R', TIPOVENTA: 'CC', CLASELINEA: 'VT', CODIGOIVA: '2', ORDEN: 1,
    };
    db.queryWithParams.mockReset();
    db.queryWithParams.mockImplementation((sql) => {
      if (/SELECT\s+ESTADO,/i.test(sql)) return Promise.resolve([{ ...header, ESTADO: 'BORRADOR' }]);
      if (/SELECT\s+PEDIDO_ID,\s+CANTIDADENVASES/i.test(sql)) return Promise.resolve([line]);
      if (/FROM\s+DSEDAC\.OPP/i.test(sql)) return Promise.resolve([{ CODIGOVEHICULO: '02', CODIGOREPARTIDOR: '10' }]);
      if (/FROM\s+JAVIER\.(?:TEST_)?PEDIDOS_LIN\s+WHERE\s+PEDIDO_ID/i.test(sql)) return Promise.resolve([line]);
      if (/DESCUENTO_GLOBAL/i.test(sql) && /PEDIDOS_CAB/i.test(sql)) return Promise.resolve([{ DESCUENTO_GLOBAL: 0, PORCENTAJEDESCUENTO1: 0 }]);
      if (/FROM\s+DSEDAC\.ARO/i.test(sql)) return Promise.resolve([{ CODE: 'ART-LOCK', ENVASES: 100, UNIDADES: 0 }]);
      if (/SELECT\s+ID,\s+EJERCICIO,\s+NUMEROPEDIDO/i.test(sql)) return Promise.resolve([{ ...header, ESTADO: 'CONFIRMADO' }]);
      return Promise.resolve([]);
    });
    jest.doMock('../services/query-optimizer', () => ({
      cachedQuery: jest.fn((fn, sql, _key, _ttl, params) => fn(sql, params)),
    }));
    jest.doMock('../services/redis-cache', () => ({
      redisCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), invalidatePattern: jest.fn() },
      TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
    }));
    jest.doMock('../services/laclae', () => ({
      getClientDays: jest.fn(() => ({ deliveryDays: ['martes'], deliveryDaysShort: 'M' })),
    }));
    let validateCalls = 0;
    let releaseLockedValidation;
    let signalLockedValidation;
    const lockedValidationEntered = new Promise((resolve) => { signalLockedValidation = resolve; });
    const lockedValidationGate = new Promise((resolve) => { releaseLockedValidation = resolve; });
    const validateOrderWithBolsa = jest.fn(() => {
      validateCalls += 1;
      if (validateCalls === 2) {
        signalLockedValidation();
        return lockedValidationGate.then(() => ({ valid: true, consumo: 0, acumulacion: 0 }));
      }
      return Promise.resolve({ valid: true, consumo: 0, acumulacion: 0 });
    });
    jest.doMock('../services/bolsa-comercial.service', () => ({
      validateOrderWithBolsa,
      applyOrderMovementsWith: jest.fn(),
    }));

    const pedidosService = require('../services/pedidos.service');
    const confirmPromise = pedidosService.confirmOrder(46, 'CC', { deliveryDate: '2026-06-09' });
    await lockedValidationEntered;
    const editPromise = pedidosService.updateOrderLine(11, { cantidadEnvases: 2 }, 46);
    const editExpectation = expect(editPromise).rejects.toMatchObject({
      code: 'ORDER_NOT_EDITABLE',
      status: 409,
    });
    releaseLockedValidation();

    await expect(confirmPromise).resolves.toBeDefined();
    await editExpectation;
    expect(serialized.getState()).toBe('CONFIRMADO');
    expect(serialized.connections).toHaveLength(2);
    expect(serialized.connections.some((connection) => connection.query.mock.calls.some(([sql]) =>
      /UPDATE\s+JAVIER\.(?:TEST_)?PEDIDOS_LIN\s+SET\s+CANTIDADENVASES/i.test(sql)
    ))).toBe(false);
  });

  test('authorized force confirmation still blocks when locked stock is insufficient', async () => {
    const db = require('../config/db');
    const conn = installTransactionalPool(db);
    const header = {
      ID: 43, EJERCICIO: 2026, NUMEROPEDIDO: 1002, SERIEPEDIDO: 'M', TERMINAL: 1,
      DIADOCUMENTO: 9, MESDOCUMENTO: 6, ANODOCUMENTO: 2026, HORADOCUMENTO: 120000,
      CODIGOCLIENTE: 'C001', NOMBRECLIENTE: 'Cliente Test', CODIGOVENDEDOR: '10',
      CODIGOFORMAPAGO: '01', CODIGOTARIFA: 1, CODIGOALMACEN: 1, TIPOVENTA: 'CC',
      ESTADO: 'BORRADOR', IMPORTETOTAL: 10, IMPORTEBASE: 10, IMPORTEIVA: 0,
      IMPORTECOSTO: 5, IMPORTEMARGEN: 5, OBSERVACIONES: '',
    };
    const line = {
      ID: 8, PEDIDO_ID: 43, SECUENCIA: 1, CODIGOARTICULO: 'ART-STOCK',
      DESCRIPCION: 'Producto', CANTIDADENVASES: 2, CANTIDADUNIDADES: 0,
      UNIDADMEDIDA: 'CAJAS', UNIDADESCAJA: 1, PRECIOVENTA: 5, PRECIOCOSTO: 2,
      PRECIOTARIFA: 5, PRECIOTARIFACLIENTE: 5, PRECIOMINIMO: 5,
      IMPORTEVENTA: 10, IMPORTECOSTO: 4, IMPORTEMARGEN: 6,
      PORCENTAJEMARGEN: 60, TIPOLINEA: 'R', TIPOVENTA: 'CC', CLASELINEA: 'VT',
      CODIGOIVA: '2', ORDEN: 1,
    };
    let stockReads = 0;
    db.queryWithParams.mockReset();
    db.queryWithParams.mockImplementation(promisedImplementation((sql) => {
      if (/UPDATE\s+JAVIER\.(?:TEST_)?PEDIDOS_CAB/i.test(sql) && sql.includes('CONFIRMANDO')) return { count: 1 };
      if (/SELECT\s+ESTADO,/i.test(sql)) return [header];
      if (/FROM\s+DSEDAC\.OPP/i.test(sql)) return [{ CODIGOVEHICULO: '02', CODIGOREPARTIDOR: '10' }];
      if (/FROM\s+JAVIER\.(?:TEST_)?PEDIDOS_LIN\s+WHERE\s+PEDIDO_ID/i.test(sql)) return [line];
      if (/DESCUENTO_GLOBAL/i.test(sql) && /PEDIDOS_CAB/i.test(sql)) return [{ DESCUENTO_GLOBAL: 0, PORCENTAJEDESCUENTO1: 0 }];
      if (/FROM\s+DSEDAC\.ARO/i.test(sql)) {
        stockReads++;
        return [{ CODE: 'ART-STOCK', ENVASES: stockReads === 1 ? 10 : 1, UNIDADES: 0 }];
      }
      return [];
    }));
    jest.doMock('../services/query-optimizer', () => ({
      cachedQuery: jest.fn((fn, sql, _key, _ttl, params) => fn(sql, params)),
    }));
    jest.doMock('../services/redis-cache', () => ({
      redisCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), invalidatePattern: jest.fn() },
      TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
    }));
    jest.doMock('../services/laclae', () => ({
      getClientDays: jest.fn(() => ({ deliveryDays: ['martes'], deliveryDaysShort: 'M' })),
    }));
    jest.doMock('../services/bolsa-comercial.service', () => ({
      validateOrderWithBolsa: jest.fn().mockResolvedValue({ valid: true, consumo: 0, acumulacion: 0 }),
      applyOrderMovementsWith: jest.fn(),
    }));

    const pedidosService = require('../services/pedidos.service');
    const result = await pedidosService.confirmOrder(43, 'CC', {
      forceConfirm: true,
      adminOverride: true,
      userRole: 'JEFE_VENTAS',
      forceConfirmReason: 'Validacion stock demo',
      deliveryDate: '2026-06-09',
    });

    expect(result).toMatchObject({ blocked: true, reason: 'STOCK_CHANGED_DURING_CONFIRM' });
    expect(stockReads).toBe(2);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) =>
      /INSERT\s+INTO\s+JAVIER\.(?:TEST_)?PEDIDOS_STOCK_RESERVE/i.test(sql)
    )).toBe(false);
  });
});

describe('expired draft purge transaction contract', () => {
  beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

  test('rechecks a stale candidate under locks and preserves a no-longer-eligible order', async () => {
    const db = require('../config/db');
    const conn = installTransactionalPool(db);
    db.queryWithParams.mockReset();
    db.queryWithParams.mockImplementation(promisedImplementation((sql) => {
      if (/SELECT\s+C\.ID/i.test(sql)) return [{ ID: 77 }];
      if (/SELECT\s+ID,\s+TRIM\(ESTADO\)/i.test(sql)) return [];
      return [];
    }));

    const pedidos = require('../services/pedidos/index');
    const result = await pedidos.purgeExpiredDraftReservations({ limit: 1 });

    expect(result).toMatchObject({ purged: 0, candidates: 1 });
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.map(([sql]) => String(sql))).toEqual(expect.arrayContaining([
      expect.stringMatching(/LOCK TABLE JAVIER\.(?:TEST_)?PEDIDOS_STOCK_RESERVE IN EXCLUSIVE MODE/i),
      expect.stringMatching(/LOCK TABLE JAVIER\.(?:TEST_)?PEDIDOS_CAB IN EXCLUSIVE MODE/i),
    ]));
    expect(conn.query.mock.calls.some(([sql]) => /DELETE\s+FROM/i.test(sql))).toBe(false);
  });

  test('rolls back when the driver omits final state count and cancellation cannot be verified', async () => {
    const db = require('../config/db');
    const conn = installTransactionalPool(db);
    db.queryWithParams.mockReset();
    db.queryWithParams.mockImplementation(promisedImplementation((sql) => {
      if (/SELECT\s+C\.ID/i.test(sql)) return [{ ID: 78 }];
      if (/SELECT\s+ID,\s+TRIM\(ESTADO\)/i.test(sql)) return [{ ID: 78, ESTADO: 'BORRADOR' }];
      if (/SET\s+ESTADO\s*=\s*'CANCELADO'/i.test(sql)) return {};
      if (/SELECT\s+ID\s+FROM\s+JAVIER\.(?:TEST_)?PEDIDOS_CAB\s+WHERE\s+ID/i.test(sql)) return [];
      return { count: 1 };
    }));

    const pedidos = require('../services/pedidos/index');
    const result = await pedidos.purgeExpiredDraftReservations({ limit: 1 });

    expect(result).toMatchObject({ purged: 0, candidates: 1 });
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) => /DELETE\s+FROM\s+JAVIER\.(?:TEST_)?PEDIDOS_LIN/i.test(sql))).toBe(false);
    expect(conn.query.mock.calls.some(([sql]) => /DELETE\s+FROM\s+JAVIER\.(?:TEST_)?PEDIDOS_CAB/i.test(sql))).toBe(false);
  });

  test('expires an eligible draft into an audited tombstone without deleting its header or lines', async () => {
    const db = require('../config/db');
    const conn = installTransactionalPool(db);
    let state = 'BORRADOR';
    db.queryWithParams.mockReset();
    db.queryWithParams.mockImplementation(promisedImplementation((sql) => {
      if (/SELECT\s+C\.ID/i.test(sql)) return [{ ID: 79 }];
      if (/SELECT\s+ID,\s+TRIM\(ESTADO\)/i.test(sql)) return [{ ID: 79, ESTADO: state }];
      if (/SELECT\s+ID,\s+TRIM\(ESTADO\)\s+AS\s+ESTADO,\s+TRIM\(CODIGOCLIENTE\)/i.test(sql)) {
        return [{ ID: 79, ESTADO: state, CODIGOCLIENTE: 'C001', CODIGOVENDEDOR: '01' }];
      }
      if (/SELECT\s+ID,\s+PEDIDO_ID,\s+SECUENCIA/i.test(sql)) return [];
      if (/SELECT\s+PAYLOAD_HASH/i.test(sql)) return [];
      if (/SET\s+ESTADO\s*=\s*'CANCELANDO'/i.test(sql)) {
        state = 'CANCELANDO';
        return { count: 1 };
      }
      if (/SET\s+ESTADO\s*=\s*'CANCELADO'/i.test(sql)) {
        state = 'CANCELADO';
        return { count: 1 };
      }
      return { count: 1 };
    }));

    const pedidos = require('../services/pedidos/index');
    const result = await pedidos.purgeExpiredDraftReservations({ limit: 1 });

    expect(result).toMatchObject({ purged: 1, candidates: 1 });
    expect(state).toBe('CANCELADO');
    expect(conn.query.mock.calls.some(([sql]) => /DELETE\s+FROM\s+JAVIER\.(?:TEST_)?PEDIDOS_STOCK_RESERVE/i.test(sql))).toBe(true);
    expect(conn.query.mock.calls.some(([sql]) => /DELETE\s+FROM\s+JAVIER\.(?:TEST_)?PEDIDOS_(?:LIN|CAB)/i.test(sql))).toBe(false);
    expect(conn.query.mock.calls.filter(([sql]) => /INSERT\s+INTO\s+JAVIER\.(?:TEST_)?PEDIDO_STATE_EVENTS/i.test(sql))).toHaveLength(2);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });
});

describe('bolsa ledger per-line persistence', () => {
  let svc, q;
  beforeEach(() => { jest.resetModules(); jest.dontMock('../services/bolsa-comercial.service'); q = require('../config/db').queryWithParams; q.mockReset(); svc = require('../services/bolsa-comercial.service'); });

  test('writes one ledger row per line movement preserving distinct metadata', async () => {
    q.mockResolvedValueOnce([{ ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 6, LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 300, CONSUMIDO: 0, ACUMULADO: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await svc.consumirBolsa('10', 42, 8, [
      { timestamp: '2026-06-09T23:36:39.000Z', lineId: 7, codigoArticulo: 'ART-UNDER-1', precioMinimoCongelado: 10, precioVenta: 7, cantidad: 2, unidadMedida: 'CAJAS', importe: 6, idempotencyKey: 'pedido-42-line-7-under-min' },
      { timestamp: '2026-06-09T23:36:39.000Z', lineId: 8, codigoArticulo: 'ART-UNDER-2', precioMinimoCongelado: 5, precioVenta: 3, cantidad: 1, unidadMedida: 'UNIDADES', importe: 2, idempotencyKey: 'pedido-42-line-8-under-min' },
    ]);

    const movementInserts = q.mock.calls.filter(([sql]) => /INSERT\s+INTO\s+JAVIER\.(?:TEST_)?MOVIMIENTOS_BOLSA/i.test(sql));
    expect(movementInserts).toHaveLength(1);
    const [sql, params] = movementInserts[0];
    expect((sql.match(/\(\?, \?, \?, \?, \?, \?,/g) || []).length).toBe(2);
    expect(params.filter((value) => value === 'CONSUMO')).toHaveLength(2);
    expect(params).toEqual(expect.arrayContaining([7, 'ART-UNDER-1', 10, 7, 2, 'CAJAS', 'pedido-42-line-7-under-min']));
    expect(params).toEqual(expect.arrayContaining([8, 'ART-UNDER-2', 5, 3, 1, 'UNIDADES', 'pedido-42-line-8-under-min']));
  });

  test('rolls back balance update when ledger insert fails in DB2 transaction path', async () => {
    jest.resetModules();
    const conn = {
      query: jest.fn(),
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
    mockOpenDedicatedConnection.mockResolvedValue(conn);
    conn.query.mockImplementation((sql) => {
      if (/^LOCK TABLE JAVIER\.(?:TEST_)?(BOLSA_COMERCIAL|MOVIMIENTOS_BOLSA) IN EXCLUSIVE MODE$/i.test(sql)) return [];
      if (/SELECT\s+ID,\s+CODIGOVENDEDOR/i.test(sql)) {
        return [{ ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 6, LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 300, CONSUMIDO: 0, ACUMULADO: 0 }];
      }
      if (/SELECT\s+IDEMPOTENCY_KEY\s+FROM\s+JAVIER\.(?:TEST_)?MOVIMIENTOS_BOLSA/i.test(sql)) return [];
      if (/UPDATE\s+JAVIER\.(?:TEST_)?BOLSA_COMERCIAL/i.test(sql)) return [];
      if (/INSERT\s+INTO\s+JAVIER\.(?:TEST_)?MOVIMIENTOS_BOLSA/i.test(sql)) throw new Error('ledger insert failed');
      return [];
    });
    svc = require('../services/bolsa-comercial.service');

    await expect(svc.consumirBolsa('10', 42, 6, [
      { lineId: 7, codigoArticulo: 'ART-UNDER-1', precioMinimoCongelado: 10, precioVenta: 7, cantidad: 2, unidadMedida: 'CAJAS', importe: 6 },
    ])).rejects.toThrow(/ledger insert failed/);

    const sqls = conn.query.mock.calls.map(([sql]) => sql).join('\n');
    expect(sqls).toMatch(/LOCK TABLE JAVIER\.(?:TEST_)?BOLSA_COMERCIAL IN EXCLUSIVE MODE/);
    expect(sqls).toMatch(/UPDATE\s+JAVIER\.(?:TEST_)?BOLSA_COMERCIAL/);
    expect(sqls).toMatch(/INSERT\s+INTO\s+JAVIER\.(?:TEST_)?MOVIMIENTOS_BOLSA/);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.close).toHaveBeenCalled();
  });
});


describe('bolsa idempotency and DSEDAC safety', () => {
  let svc, q;
  beforeEach(() => { jest.resetModules(); q = require('../config/db').queryWithParams; q.mockReset(); svc = require('../services/bolsa-comercial.service'); });
  test('generates deterministic idempotency keys and skips duplicate movement application', async () => {
    q.mockResolvedValueOnce([{ ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 6, LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 300, CONSUMIDO: 0, ACUMULADO: 0 }]).mockResolvedValueOnce([{ IDEMPOTENCY_KEY: 'pedido-42-line-7-under-min' }]);
    const result = await svc.consumirBolsa('10', 42, 6, [{ timestamp: '2026-06-09T23:36:39.000Z', lineId: 7, codigoArticulo: 'ART-UNDER-1', precioMinimoCongelado: 10, precioVenta: 7, cantidad: 2, unidadMedida: 'CAJAS', importe: 6 }]);
    expect(result).toMatchObject({ allowed: true, saldo: 300, duplicate: true });
    const sqls = q.mock.calls.map(([sql]) => sql).join('\n');
    expect(sqls).toMatch(/SELECT\s+IDEMPOTENCY_KEY\s+FROM\s+JAVIER\.(?:TEST_)?MOVIMIENTOS_BOLSA/i);
    expect(q.mock.calls.some(([sql]) => /UPDATE\s+JAVIER\.(?:TEST_)?BOLSA_COMERCIAL/i.test(sql))).toBe(false);
    expect(q.mock.calls.some(([sql]) => /INSERT\s+INTO\s+JAVIER\.(?:TEST_)?MOVIMIENTOS_BOLSA/i.test(sql))).toBe(false);
  });
  test('bolsa service never writes to DSEDAC tables', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../services/bolsa-comercial.service.js'), 'utf8');
    expect(source).not.toMatch(/INSERT\s+INTO\s+DSEDAC\./i);
    expect(source).not.toMatch(/UPDATE\s+DSEDAC\./i);
    expect(source).not.toMatch(/DELETE\s+FROM\s+DSEDAC\./i);
  });
  test('init tables enforces unique idempotency key for bolsa ledger', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../migrations/init-tables.js'), 'utf8');
    expect(source).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+JAVIER\.UQ_MOV_BOLSA_IDEMP\s+ON\s+JAVIER\.MOVIMIENTOS_BOLSA\s*\(\s*IDEMPOTENCY_KEY\s*\)/i);
  });
});

describe('confirmOrder DESCUENTO_GLOBAL write-path contract', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.dontMock('../services/bolsa-comercial.service');
  });

  test('source wires DESCUENTO_GLOBAL into validate and blocks silent consumo=0 mismatch', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../services/pedidos/index.js'), 'utf8');
    expect(source).toMatch(/DESCUENTO_GLOBAL/);
    expect(source).toMatch(/globalDiscountPct/);
    expect(source).toMatch(/BOLSA_DISCOUNT_CONSUMO_MISMATCH/);
    expect(source).toMatch(/mustWriteBolsaLedger/);
    expect(source).toMatch(/applyOrderMovementsWith\(/);
  });

  test('confirmOrder applies bolsa in the caller transaction when pie discount undercuts client tariff', async () => {
    const db = require('../config/db');
    installTransactionalPool(db);
    const header = {
      ID: 67,
      EJERCICIO: 2026,
      NUMEROPEDIDO: 1067,
      SERIEPEDIDO: 'M',
      TERMINAL: 1,
      DIADOCUMENTO: 22,
      MESDOCUMENTO: 9,
      ANODOCUMENTO: 2026,
      HORADOCUMENTO: 120000,
      CODIGOCLIENTE: 'C001',
      NOMBRECLIENTE: 'Cliente Test',
      CODIGOVENDEDOR: '05',
      CODIGOFORMAPAGO: '01',
      CODIGOTARIFA: 1,
      CODIGOALMACEN: 1,
      TIPOVENTA: 'CC',
      IMPORTETOTAL: 39.07,
      IMPORTEBASE: 39.07,
      IMPORTEIVA: 0,
      IMPORTECOSTO: 20,
      IMPORTEMARGEN: 19,
      OBSERVACIONES: '',
    };
    const lines = [
      {
        ID: 78,
        PEDIDO_ID: 67,
        SECUENCIA: 1,
        CODIGOARTICULO: '1412',
        DESCRIPCION: 'Art 1412',
        CANTIDADENVASES: 3,
        CANTIDADUNIDADES: 3,
        UNIDADMEDIDA: 'CAJAS',
        UNIDADESCAJA: 1,
        PRECIOVENTA: 9.593,
        PRECIOCOSTO: 5,
        PRECIOTARIFA: 9.593,
        PRECIOTARIFACLIENTE: 9.593,
        PRECIOMINIMO: 8.51,
        IMPORTEVENTA: 28.78,
        IMPORTECOSTO: 15,
        IMPORTEMARGEN: 13,
        PORCENTAJEMARGEN: 45,
        DESCUENTO_LINEA: 0,
        PORCENTAJEDESCUENTO: 0,
        TIPOLINEA: 'R',
        TIPOVENTA: 'CC',
        CLASELINEA: 'VT',
        CODIGOIVA: '2',
        ORDEN: 1,
      },
      {
        ID: 79,
        PEDIDO_ID: 67,
        SECUENCIA: 2,
        CODIGOARTICULO: '1686',
        DESCRIPCION: 'Art 1686',
        CANTIDADENVASES: 2.5,
        CANTIDADUNIDADES: 2.5,
        UNIDADMEDIDA: 'KILOGRAMOS',
        UNIDADESCAJA: 1,
        PRECIOVENTA: 5.85,
        PRECIOCOSTO: 3,
        PRECIOTARIFA: 5.85,
        PRECIOTARIFACLIENTE: 5.85,
        PRECIOMINIMO: 5.189,
        IMPORTEVENTA: 14.63,
        IMPORTECOSTO: 7.5,
        IMPORTEMARGEN: 7,
        PORCENTAJEMARGEN: 48,
        DESCUENTO_LINEA: 0,
        PORCENTAJEDESCUENTO: 0,
        TIPOLINEA: 'R',
        TIPOVENTA: 'CC',
        CLASELINEA: 'VT',
        CODIGOIVA: '2',
        ORDEN: 2,
      },
    ];

    db.queryWithParams.mockReset();
    db.queryWithParams.mockImplementation(async (sql) => {
      if (/UPDATE\s+JAVIER\.(?:TEST_)?PEDIDOS_CAB/i.test(sql) && sql.includes('CONFIRMANDO')) return { count: 1 };
      if (/SELECT\s+ESTADO,/i.test(sql)) return [{ ...header, ESTADO: 'BORRADOR' }];
      if (/FROM\s+DSEDAC\.OPP/i.test(sql)) return [{ CODIGOVEHICULO: '02', CODIGOREPARTIDOR: '05' }];
      if (/FROM\s+JAVIER\.(?:TEST_)?PEDIDOS_LIN\s+WHERE\s+PEDIDO_ID/i.test(sql)) return lines;
      if (/DESCUENTO_GLOBAL/i.test(sql) && /PEDIDOS_CAB/i.test(sql)) {
        return [{ DESCUENTO_GLOBAL: 10, PORCENTAJEDESCUENTO1: 10 }];
      }
      if (/FROM\s+JAVIER\.(?:TEST_)?BOLSA_COMERCIAL/i.test(sql)) {
        return [{
          ID: 2,
          CODIGOVENDEDOR: '05  ',
          EJERCICIO: 2026,
          MES: 9,
          LIMITE_PCT: 3,
          LIMITE_IMPORTE: 0,
          SALDO_DISPONIBLE: 300,
          CONSUMIDO: 0,
          ACUMULADO: 0,
        }];
      }
      if (/FROM\s+DSEDAC\.ARO/i.test(sql)) {
        return [
          { CODE: '1412', ENVASES: 100, UNIDADES: 100 },
          { CODE: '1686', ENVASES: 100, UNIDADES: 100 },
        ];
      }
      if (/INSERT\s+INTO\s+JAVIER\.(?:TEST_)?PEDIDOS_STOCK_RESERVE/i.test(sql)) return [];
      if (/UPDATE\s+JAVIER\.(?:TEST_)?PEDIDOS_CAB/i.test(sql) && sql.includes('CONFIRMADO')) return [];
      if (/SELECT\s+ID,\s+EJERCICIO,\s+NUMEROPEDIDO/i.test(sql)) return [{ ...header, ESTADO: 'CONFIRMADO' }];
      if (/FROM\s+JAVIER\.(?:TEST_)?MOVIMIENTOS_BOLSA/i.test(sql)) return [];
      return [];
    });

    jest.doMock('../services/query-optimizer', () => ({
      cachedQuery: jest.fn((fn, sql, _key, _ttl, params) => fn(sql, params)),
    }));
    jest.doMock('../services/redis-cache', () => ({
      redisCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), invalidatePattern: jest.fn() },
      TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
    }));
    jest.doMock('../services/laclae', () => ({
      getClientDays: jest.fn(() => ({ deliveryDays: ['martes'], deliveryDaysShort: 'M' })),
    }));

    const realBolsa = jest.requireActual('../services/bolsa-comercial.service');
    const applyOrderMovementsWith = jest.fn().mockResolvedValue({
      allowed: true,
      consumo: { allowed: true, saldo: 295.66 },
    });
    jest.doMock('../services/bolsa-comercial.service', () => ({
      ...realBolsa,
      validateOrderWithBolsa: realBolsa.validateOrderWithBolsa,
      applyOrderMovementsWith,
      resolveBolsaReferencePrice: realBolsa.resolveBolsaReferencePrice,
      getLineQuantity: realBolsa.getLineQuantity,
      resolveEffectiveSalePrice: realBolsa.resolveEffectiveSalePrice,
    }));

    const pedidosService = require('../services/pedidos.service');
    await pedidosService.confirmOrder(67, 'CC', { deliveryDate: '2026-09-22' });

    expect(applyOrderMovementsWith).toHaveBeenCalled();
    const [queryFn, payload] = applyOrderMovementsWith.mock.calls[0];
    expect(typeof queryFn).toBe('function');
    expect(payload.pedidoId).toBe(67);
    expect(Number(payload.consumoAmount)).toBeGreaterThan(0);
    expect(payload.consumoMovements.length).toBeGreaterThan(0);
  });
});
