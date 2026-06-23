/**
 * Unit Tests - Bolsa Comercial Service
 * =====================================
 */
'use strict';

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

const SCHEMA = 'JAVIER';

beforeEach(() => {
    const db = require('../config/db');
    if (db.getPool && db.getPool.mockReturnValue) db.getPool.mockReturnValue(null);
    if (db.initDb && db.initDb.mockReset) db.initDb.mockReset();
});

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
    const movementInsert = q.mock.calls.find(([sql]) => /INSERT\s+INTO\s+JAVIER\.MOVIMIENTOS_BOLSA/i.test(sql));
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
  beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); jest.dontMock("../services/bolsa-comercial.service"); });
  test("confirmOrder rejects instead of silently succeeding when bolsa movement write fails", async () => {
    const db = require("../config/db");
    db.queryWithParams.mockReset();
    db.queryWithParams.mockImplementation(async (sql) => {
      if (/UPDATE\s+JAVIER\.PEDIDOS_CAB/i.test(sql) && sql.includes("CONFIRMANDO")) return { count: 1 };
      if (/SELECT\s+ESTADO,/i.test(sql)) return [{ ID: 42, ESTADO: "CONFIRMANDO", EJERCICIO: 2026, NUMEROPEDIDO: 1001, SERIEPEDIDO: "M", TERMINAL: 1, DIADOCUMENTO: 9, MESDOCUMENTO: 6, ANODOCUMENTO: 2026, HORADOCUMENTO: 233639, CODIGOCLIENTE: "C001", NOMBRECLIENTE: "Cliente Test", CODIGOVENDEDOR: "10", CODIGOFORMAPAGO: "01", CODIGOTARIFA: 1, CODIGOALMACEN: 1, TIPOVENTA: "CC", IMPORTETOTAL: 7, IMPORTEBASE: 7, IMPORTEIVA: 0, IMPORTECOSTO: 4, IMPORTEMARGEN: 3, OBSERVACIONES: "" }];
      if (/FROM\s+DSEDAC\.OPP/i.test(sql)) return [{ CODIGOVEHICULO: "02", CODIGOREPARTIDOR: "10" }];
      if (/FROM\s+JAVIER\.PEDIDOS_LIN\s+WHERE\s+PEDIDO_ID/i.test(sql)) return [{ ID: 7, PEDIDO_ID: 42, SECUENCIA: 1, CODIGOARTICULO: "ART-UNDER", DESCRIPCION: "Producto bajo minimo", CANTIDADENVASES: 1, CANTIDADUNIDADES: 0, UNIDADMEDIDA: "CAJAS", UNIDADESCAJA: 1, PRECIOVENTA: 7, PRECIOCOSTO: 4, PRECIOTARIFA: 10, PRECIOTARIFACLIENTE: 10, PRECIOMINIMO: 10, IMPORTEVENTA: 7, IMPORTECOSTO: 4, IMPORTEMARGEN: 3, PORCENTAJEMARGEN: 42.85, TIPOLINEA: "R", TIPOVENTA: "CC", CLASELINEA: "VT", ORDEN: 1 }];
      if (/FROM\s+DSEDAC\.ARO/i.test(sql)) return [{ CODE: "ART-UNDER", ENVASES: 100, UNIDADES: 0 }];
      if (/UPDATE\s+JAVIER\.PEDIDOS_CAB/i.test(sql) && sql.includes("CONFIRMADO")) return [];
      if (/SELECT\s+ID,\s+EJERCICIO,\s+NUMEROPEDIDO/i.test(sql)) return [{ ID: 42, EJERCICIO: 2026, NUMEROPEDIDO: 1001, SERIEPEDIDO: "M", TERMINAL: 1, DIADOCUMENTO: 9, MESDOCUMENTO: 6, ANODOCUMENTO: 2026, HORADOCUMENTO: 233639, CODIGOCLIENTE: "C001", NOMBRECLIENTE: "Cliente Test", CODIGOVENDEDOR: "10", CODIGOFORMAPAGO: "01", CODIGOTARIFA: 1, CODIGOALMACEN: 1, TIPOVENTA: "CC", ESTADO: "CONFIRMADO", IMPORTETOTAL: 7, IMPORTEBASE: 7, IMPORTEIVA: 0, IMPORTECOSTO: 4, IMPORTEMARGEN: 3, OBSERVACIONES: "" }];
      return [];
    });
    jest.doMock("../services/query-optimizer", () => ({ cachedQuery: jest.fn((fn, sql, _key, _ttl, params) => fn(sql, params)) }));
    jest.doMock("../services/redis-cache", () => ({ redisCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), invalidatePattern: jest.fn() }, TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 } }));
    jest.doMock("../services/laclae", () => ({ getClientDays: jest.fn(() => ({ deliveryDays: ["martes"], deliveryDaysShort: "M" })) }));
    jest.doMock("../services/bolsa-comercial.service", () => ({ validateOrderWithBolsa: jest.fn().mockResolvedValue({ valid: true, consumo: 3, saldo: 297 }), consumirBolsa: jest.fn().mockRejectedValue(new Error("movement write failed")) }));
    const pedidosService = require("../services/pedidos.service");
    await expect(pedidosService.confirmOrder(42, "CC", { deliveryDate: "2026-06-09" })).rejects.toThrow(/movement write failed|bolsa/i);
    expect(db.queryWithParams.mock.calls.some(([sql]) =>
      /UPDATE\s+JAVIER\.PEDIDOS_CAB/i.test(sql) &&
      /SET\s+ESTADO\s*=\s*'BORRADOR'/i.test(sql) &&
      /ESTADO\s+IN\s*\(\s*'CONFIRMANDO'\s*,\s*'CONFIRMADO'\s*\)/i.test(sql)
    )).toBe(true);
  });

  test("confirmOrder returns refreshed bolsa summary after movement write", async () => {
    const db = require("../config/db");
    const header = { ID: 42, EJERCICIO: 2026, NUMEROPEDIDO: 1001, SERIEPEDIDO: "M", TERMINAL: 1, DIADOCUMENTO: 9, MESDOCUMENTO: 6, ANODOCUMENTO: 2026, HORADOCUMENTO: 233639, CODIGOCLIENTE: "C001", NOMBRECLIENTE: "Cliente Test", CODIGOVENDEDOR: "10", CODIGOFORMAPAGO: "01", CODIGOTARIFA: 1, CODIGOALMACEN: 1, TIPOVENTA: "CC", IMPORTETOTAL: 36, IMPORTEBASE: 36, IMPORTEIVA: 0, IMPORTECOSTO: 24, IMPORTEMARGEN: 12, OBSERVACIONES: "" };
    const line = { ID: 7, PEDIDO_ID: 42, SECUENCIA: 1, CODIGOARTICULO: "ART-OVER", DESCRIPCION: "Producto sobre minimo", CANTIDADENVASES: 3, CANTIDADUNIDADES: 0, UNIDADMEDIDA: "CAJAS", UNIDADESCAJA: 1, PRECIOVENTA: 12, PRECIOCOSTO: 8, PRECIOTARIFA: 10, PRECIOTARIFACLIENTE: 10, PRECIOMINIMO: 10, IMPORTEVENTA: 36, IMPORTECOSTO: 24, IMPORTEMARGEN: 12, PORCENTAJEMARGEN: 33.33, TIPOLINEA: "R", TIPOVENTA: "CC", CLASELINEA: "VT", CODIGOIVA: "2", ORDEN: 1 };
    let movementReads = 0;
    db.queryWithParams.mockReset();
    db.queryWithParams.mockImplementation(async (sql) => {
      if (/UPDATE\s+JAVIER\.PEDIDOS_CAB/i.test(sql) && sql.includes("CONFIRMANDO")) return { count: 1 };
      if (/SELECT\s+ESTADO,/i.test(sql)) return [{ ...header, ESTADO: "CONFIRMANDO" }];
      if (/FROM\s+DSEDAC\.OPP/i.test(sql)) return [{ CODIGOVEHICULO: "02", CODIGOREPARTIDOR: "10" }];
      if (/FROM\s+JAVIER\.PEDIDOS_LIN\s+WHERE\s+PEDIDO_ID/i.test(sql)) return [line];
      if (/FROM\s+DSEDAC\.ARO/i.test(sql)) return [{ CODE: "ART-OVER", ENVASES: 100, UNIDADES: 0 }];
      if (/INSERT\s+INTO\s+JAVIER\.PEDIDOS_STOCK_RESERVE/i.test(sql)) return [];
      if (/UPDATE\s+JAVIER\.PEDIDOS_CAB/i.test(sql) && sql.includes("CONFIRMADO")) return [];
      if (/SELECT\s+ID,\s+EJERCICIO,\s+NUMEROPEDIDO/i.test(sql)) return [{ ...header, ESTADO: "CONFIRMADO" }];
      if (/FROM\s+JAVIER\.MOVIMIENTOS_BOLSA/i.test(sql)) {
        movementReads += 1;
        return movementReads === 1 ? [] : [{
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
    jest.doMock("../services/bolsa-comercial.service", () => ({
      validateOrderWithBolsa: mockValidateOrderWithBolsa,
      acumularBolsa: mockAcumularBolsa,
      consumirBolsa: jest.fn(),
    }));

    const pedidosService = require("../services/pedidos.service");
    const result = await pedidosService.confirmOrder(42, "CC", { deliveryDate: "2026-06-09" });

    expect(mockAcumularBolsa).toHaveBeenCalledWith("10", 42, 6, [expect.objectContaining({ lineId: 7, importe: 6 })]);
    expect(movementReads).toBe(2);
    expect(result.bolsaSummary).toMatchObject({ acumulacion: 6, consumo: 0, neto: 6, movementCount: 1 });
    expect(result.lines[0].bolsaImpact).toMatchObject({ acumulacion: 6, hasImpact: true });
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

    const movementInserts = q.mock.calls.filter(([sql]) => /INSERT\s+INTO\s+JAVIER\.MOVIMIENTOS_BOLSA/i.test(sql));
    expect(movementInserts).toHaveLength(1);
    const [sql, params] = movementInserts[0];
    expect((sql.match(/\(\?, \?, \?, \?, \?, \?,/g) || []).length).toBe(2);
    expect(params.filter((value) => value === 'CONSUMO')).toHaveLength(2);
    expect(params).toEqual(expect.arrayContaining([7, 'ART-UNDER-1', 10, 7, 2, 'CAJAS', 'pedido-42-line-7-under-min']));
    expect(params).toEqual(expect.arrayContaining([8, 'ART-UNDER-2', 5, 3, 1, 'UNIDADES', 'pedido-42-line-8-under-min']));
  });

  test('rolls back balance update when ledger insert fails in DB2 transaction path', async () => {
    jest.resetModules();
    const db = require('../config/db');
    const conn = { query: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
    db.getPool.mockReturnValue({ connect: jest.fn().mockResolvedValue(conn) });
    conn.query.mockImplementation(async (sql) => {
      if (/SET TRANSACTION ISOLATION LEVEL READ COMMITTED/i.test(sql)) return [];
      if (/^LOCK TABLE JAVIER\.(BOLSA_COMERCIAL|MOVIMIENTOS_BOLSA) IN EXCLUSIVE MODE$/i.test(sql)) return [];
      if (/SELECT\s+ID,\s+CODIGOVENDEDOR/i.test(sql)) {
        return [{ ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 6, LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 300, CONSUMIDO: 0, ACUMULADO: 0 }];
      }
      if (/SELECT\s+IDEMPOTENCY_KEY\s+FROM\s+JAVIER\.MOVIMIENTOS_BOLSA/i.test(sql)) return [];
      if (/UPDATE\s+JAVIER\.BOLSA_COMERCIAL/i.test(sql)) return [];
      if (/INSERT\s+INTO\s+JAVIER\.MOVIMIENTOS_BOLSA/i.test(sql)) throw new Error('ledger insert failed');
      if (/^ROLLBACK$/i.test(sql)) return [];
      return [];
    });
    svc = require('../services/bolsa-comercial.service');

    await expect(svc.consumirBolsa('10', 42, 6, [
      { lineId: 7, codigoArticulo: 'ART-UNDER-1', precioMinimoCongelado: 10, precioVenta: 7, cantidad: 2, unidadMedida: 'CAJAS', importe: 6 },
    ])).rejects.toThrow(/ledger insert failed/);

    const sqls = conn.query.mock.calls.map(([sql]) => sql).join('\n');
    expect(sqls).toMatch(/SET TRANSACTION ISOLATION LEVEL READ COMMITTED/);
    expect(sqls).toMatch(/LOCK TABLE JAVIER\.BOLSA_COMERCIAL IN EXCLUSIVE MODE/);
    expect(sqls).toMatch(/UPDATE\s+JAVIER\.BOLSA_COMERCIAL/);
    expect(sqls).toMatch(/INSERT\s+INTO\s+JAVIER\.MOVIMIENTOS_BOLSA/);
    expect(sqls).toMatch(/ROLLBACK/);
    expect(sqls).not.toMatch(/^COMMIT$/m);
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
    expect(sqls).toMatch(/SELECT\s+IDEMPOTENCY_KEY\s+FROM\s+JAVIER\.MOVIMIENTOS_BOLSA/i);
    expect(q.mock.calls.some(([sql]) => /UPDATE\s+JAVIER\.BOLSA_COMERCIAL/i.test(sql))).toBe(false);
    expect(q.mock.calls.some(([sql]) => /INSERT\s+INTO\s+JAVIER\.MOVIMIENTOS_BOLSA/i.test(sql))).toBe(false);
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
