'use strict';

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockPoolConnect = jest.fn();
const mockConnQuery = jest.fn();
const mockConnClose = jest.fn();

jest.mock('../config/db', () => ({
  query: (...args) => mockQuery(...args),
  queryWithParams: (...args) => mockQueryWithParams(...args),
  getPool: () => ({ connect: mockPoolConnect }),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../services/query-optimizer', () => ({
  cachedQuery: jest.fn((fn, sql) => fn(sql)),
  invalidateOnMutation: jest.fn(),
}));

jest.mock('../services/redis-cache', () => ({
  redisCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), invalidatePattern: jest.fn() },
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
}));

const pedidosService = require('../services/pedidos.service');

const baseLine = {
  codigoArticulo: 'ART001',
  cantidadEnvases: 1,
  cantidadUnidades: 0,
  precioVenta: 10,
  unidadMedida: 'CAJAS',
};

const baseCreatePayload = {
  clientCode: 'C001',
  clientName: 'Cliente Demo',
  vendedorCode: '01',
  tipoventa: 'CC',
  observaciones: 'offline replay',
  lines: [baseLine],
};

function cabRow(id = 77) {
  return {
    ID: id,
    EJERCICIO: 2026,
    NUMEROPEDIDO: 100,
    SERIEPEDIDO: 'M',
    TERMINAL: 999,
    DIADOCUMENTO: 12,
    MESDOCUMENTO: 6,
    ANODOCUMENTO: 2026,
    HORADOCUMENTO: 120000,
    CODIGOCLIENTE: 'C001',
    NOMBRECLIENTE: 'Cliente Demo',
    CODIGOVENDEDOR: '01',
    CODIGOFORMAPAGO: '02',
    CODIGOTARIFA: 1,
    CODIGOALMACEN: 1,
    TIPOVENTA: 'CC',
    ESTADO: 'BORRADOR',
    IMPORTETOTAL: 10,
    IMPORTEBASE: 10,
    IMPORTEIVA: 0,
    IMPORTECOSTO: 0,
    IMPORTEMARGEN: 0,
    OBSERVACIONES: 'offline replay',
    CREATED_AT: '2026-06-12',
    UPDATED_AT: '2026-06-12',
  };
}

function setupCreateMocks({ existingIdempotency = null, clientDefaults = null } = {}) {
  let nextOrderNumber = 100;
  mockQueryWithParams.mockImplementation(async (sql, params) => {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();

    if (/FROM\s+DSEDAC\.CLI\s+CLI\s+LEFT JOIN\s+DSEDAC\.CLC\s+CLC/i.test(normalized)) {
      if (!clientDefaults) return [];
      return [{
        NOMBRECLIENTE: clientDefaults.clientName || 'Cliente Maestro',
        CODIGORUTA: clientDefaults.routeCode || '',
        CODIGOFORMAPAGO: clientDefaults.formaPago || '',
        CODIGOTARIFA: clientDefaults.tarifa || 1,
      }];
    }

    if (/FROM\s+JAVIER\.PEDIDO_IDEMPOTENCY/i.test(normalized)) {
      if (!existingIdempotency) return [];
      return [{
        PEDIDO_ID: existingIdempotency.pedidoId,
        PAYLOAD_HASH: existingIdempotency.payloadHash,
      }];
    }

    if (/INSERT INTO\s+JAVIER\.PEDIDO_IDEMPOTENCY/i.test(normalized)) {
      return [];
    }

    if (/FROM\s+JAVIER\.PEDIDOS_SEQ/i.test(normalized) || /UPDATE\s+JAVIER\.PEDIDOS_SEQ/i.test(normalized)) {
      return [{ ULTIMO_NUMERO: nextOrderNumber }];
    }

    if (/INSERT INTO\s+JAVIER\.PEDIDOS_CAB/i.test(normalized)) {
      return [];
    }

    if (/SELECT ID FROM\s+JAVIER\.PEDIDOS_CAB WHERE EJERCICIO/i.test(normalized)) {
      return [{ ID: 77 }];
    }

    if (/INSERT INTO\s+JAVIER\.PEDIDOS_LIN/i.test(normalized)) {
      return [];
    }

    if (/FROM\s+JAVIER\.PEDIDOS_CAB\s+WHERE ID = \?/i.test(normalized) && !/PEDIDOS_LIN/i.test(normalized)) {
      return [cabRow(77)];
    }

    if (/FROM\s+JAVIER\.PEDIDOS_LIN/i.test(normalized)) {
      return [{
        ID: 1,
        PEDIDO_ID: 77,
        SECUENCIA: 1,
        CODIGOARTICULO: 'ART001',
        DESCRIPCION: 'Producto',
        CANTIDADENVASES: 1,
        CANTIDADUNIDADES: 0,
        UNIDADMEDIDA: 'CAJAS',
        UNIDADESCAJA: 1,
        PRECIOVENTA: 10,
        PRECIOCOSTO: 0,
        PRECIOTARIFA: 10,
        PRECIOTARIFACLIENTE: 10,
        PRECIOMINIMO: 0,
        IMPORTEVENTA: 10,
        IMPORTECOSTO: 0,
        IMPORTEMARGEN: 0,
        PORCENTAJEMARGEN: 0,
        TIPOLINEA: 'R',
        TIPOVENTA: 'CC',
        CLASELINEA: 'VT',
        ORDEN: 1,
        CREATED_AT: '2026-06-12',
      }];
    }

    if (/UPDATE\s+JAVIER\.PEDIDOS_CAB SET/i.test(normalized)) {
      return [];
    }

    if (/FROM\s+JAVIER\.MOVIMIENTOS_BOLSA/i.test(normalized)) {
      return [];
    }

    return [];
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockReset();
  mockQueryWithParams.mockReset();
  mockConnQuery.mockReset();
  mockConnClose.mockReset();
  mockPoolConnect.mockReset();
});

describe('pedidos create idempotency', () => {
  test('normalizePedidoIdempotencyKey rejects short tokens', () => {
    expect(() => pedidosService.normalizePedidoIdempotencyKey('short')).toThrow(
      expect.objectContaining({ code: 'INVALID_IDEMPOTENCY_KEY' }),
    );
  });

  test('getNextOrderNumber serializes concurrent sequence allocation', async () => {
    let activeAllocations = 0;
    let maxActiveAllocations = 0;
    let nextSequence = 100;
    mockQueryWithParams.mockImplementation(async (sql) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (/FINAL TABLE\s*\(\s*UPDATE\s+JAVIER\.PEDIDOS_SEQ/i.test(normalized)) {
        activeAllocations += 1;
        maxActiveAllocations = Math.max(maxActiveAllocations, activeAllocations);
        try {
          await new Promise((resolve) => setTimeout(resolve, 5));
          nextSequence += 1;
          return [{ ULTIMO_NUMERO: nextSequence }];
        } finally {
          activeAllocations -= 1;
        }
      }
      throw new Error(`Unexpected sequence SQL: ${normalized}`);
    });

    const values = await Promise.all(
      Array.from({ length: 6 }, () => pedidosService._private.getNextOrderNumber(2026)),
    );

    expect(values).toEqual([101, 102, 103, 104, 105, 106]);
    expect(maxActiveAllocations).toBe(1);
  });

  test('exportCommercialOrderToSystem serializes DSEDAC system number allocation', async () => {
    const previousEnv = {
      PEDIDOS_DSEDAC_STORAGE_APPROVED: process.env.PEDIDOS_DSEDAC_STORAGE_APPROVED,
      PEDIDOS_EXPORT_TO_SYSTEM: process.env.PEDIDOS_EXPORT_TO_SYSTEM,
      PEDIDOS_DSEDAC_EXPORT_APPROVED: process.env.PEDIDOS_DSEDAC_EXPORT_APPROVED,
    };
    process.env.PEDIDOS_DSEDAC_STORAGE_APPROVED = 'true';
    process.env.PEDIDOS_EXPORT_TO_SYSTEM = 'true';
    process.env.PEDIDOS_DSEDAC_EXPORT_APPROVED = 'true';

    let activeAllocations = 0;
    let maxActiveAllocations = 0;
    let nextSystemNumber = 3664;
    const conn = {
      query: jest.fn(async (sql) => {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        if (/SELECT COALESCE\(MAX\(NUMEROPEDIDO\), 0\) \+ 1 AS NEXT_NUMERO FROM DSEDAC\.CPC/i.test(normalized)) {
          activeAllocations += 1;
          maxActiveAllocations = Math.max(maxActiveAllocations, activeAllocations);
          try {
            await new Promise((resolve) => setTimeout(resolve, 5));
            nextSystemNumber += 1;
            return [{ NEXT_NUMERO: nextSystemNumber }];
          } finally {
            activeAllocations -= 1;
          }
        }
        if (/INSERT INTO\s+DSEDAC\.CPC/i.test(normalized)) return [];
        if (/INSERT INTO\s+DSEDAC\.LPC/i.test(normalized)) return [];
        if (/INSERT INTO\s+DSEDAC\.OCPC/i.test(normalized)) return [];
        throw new Error(`Unexpected export SQL: ${normalized}`);
      }),
    };

    const header = {
      EJERCICIO: 2026,
      DIADOCUMENTO: 24,
      MESDOCUMENTO: 6,
      ANODOCUMENTO: 2026,
      HORADOCUMENTO: 121224,
      CODIGOCLIENTE: '4300007781',
      CODIGOVENDEDOR: '02',
      CODIGOFORMAPAGO: '02',
      CODIGOTARIFA: 87,
      CODIGOALMACEN: 1,
      IMPORTETOTAL: 16.78,
      IMPORTEBASE: 15.25,
      IMPORTECOSTO: 10.41,
      IMPORTEMARGEN: 4.84,
      OBSERVACIONES: '',
    };
    const line = {
      SECUENCIA: 1,
      CODIGOARTICULO: '1273',
      DESCRIPCION: 'CALAMAR NAC.P',
      CANTIDADENVASES: 1,
      CANTIDADUNIDADES: 0,
      UNIDADMEDIDA: 'CAJAS',
      PRECIOVENTA: 15.248,
      IMPORTEVENTA: 15.25,
      PRECIOCOSTO: 10.412,
      IMPORTECOSTO: 10.41,
      PRECIOTARIFACLIENTE: 15.248,
      PRECIOTARIFA: 16.3,
      CODIGOIVA: '1',
      TIPOLINEA: 'R',
      TIPOVENTA: 'CC',
      CLASELINEA: 'VT',
    };
    const deliveryPlan = {
      date: { day: 26, month: 6, year: 2026 },
    };

    try {
      const results = await Promise.all(
        Array.from({ length: 5 }, () => pedidosService._private.exportCommercialOrderToSystem(conn, {
          header,
          lines: [line],
          deliveryPlan,
          routeCode: '',
          saleType: 'CC',
          userId: '98',
        })),
      );

      expect(results.map((result) => result.systemRef.numero)).toEqual([3665, 3666, 3667, 3668, 3669]);
      expect(maxActiveAllocations).toBe(1);
    } finally {
      if (previousEnv.PEDIDOS_DSEDAC_STORAGE_APPROVED === undefined) delete process.env.PEDIDOS_DSEDAC_STORAGE_APPROVED;
      else process.env.PEDIDOS_DSEDAC_STORAGE_APPROVED = previousEnv.PEDIDOS_DSEDAC_STORAGE_APPROVED;
      if (previousEnv.PEDIDOS_EXPORT_TO_SYSTEM === undefined) delete process.env.PEDIDOS_EXPORT_TO_SYSTEM;
      else process.env.PEDIDOS_EXPORT_TO_SYSTEM = previousEnv.PEDIDOS_EXPORT_TO_SYSTEM;
      if (previousEnv.PEDIDOS_DSEDAC_EXPORT_APPROVED === undefined) delete process.env.PEDIDOS_DSEDAC_EXPORT_APPROVED;
      else process.env.PEDIDOS_DSEDAC_EXPORT_APPROVED = previousEnv.PEDIDOS_DSEDAC_EXPORT_APPROVED;
    }
  });

  test('createOrder replays same clientRequestId without creating a duplicate order', async () => {
    const payloadHash = pedidosService.buildCreateOrderPayloadHash(baseCreatePayload);
    setupCreateMocks({
      existingIdempotency: { pedidoId: 77, payloadHash },
    });

    const result = await pedidosService.createOrder({
      ...baseCreatePayload,
      clientRequestId: 'offlinesynckey001',
    });

    expect(result.idempotent).toBe(true);
    expect(result.header).toMatchObject({ id: 77, estado: 'BORRADOR' });
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /INSERT INTO\s+JAVIER\.PEDIDOS_CAB/i.test(sql))).toBe(false);
  });

  test('createOrder rejects same clientRequestId with different payload', async () => {
    const payloadHash = pedidosService.buildCreateOrderPayloadHash(baseCreatePayload);
    setupCreateMocks({
      existingIdempotency: { pedidoId: 77, payloadHash },
    });

    await expect(pedidosService.createOrder({
      ...baseCreatePayload,
      lines: [{ ...baseLine, cantidadEnvases: 2 }],
      clientRequestId: 'offlinesynckey001',
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  test('createOrder fails closed when idempotency lookup is unavailable', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (/FROM\s+JAVIER\.PEDIDO_IDEMPOTENCY/i.test(normalized)) {
        const error = new Error('SQL0204 PEDIDO_IDEMPOTENCY not found');
        error.odbcErrors = [{ code: -204, state: '42704' }];
        throw error;
      }
      throw new Error(`Unexpected SQL after idempotency failure: ${normalized}`);
    });

    await expect(pedidosService.createOrder({
      ...baseCreatePayload,
      clientRequestId: 'offlinesynckey010',
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_UNAVAILABLE' });

    expect(mockQueryWithParams.mock.calls.some(([sql]) => /INSERT INTO\s+JAVIER\.PEDIDOS_CAB/i.test(sql))).toBe(false);
  });

  test('POST /api/pedidos/create returns 200 idempotent replay via route contract', async () => {
    mockQueryWithParams.mockResolvedValueOnce([{ 1: 1 }]);
    jest.resetModules();
    const request = require('supertest');
    const express = require('express');
    const mockService = {
      ensurePedidoIdempotencyKeyFromRequest: jest.fn().mockReturnValue('offlinesynckey002'),
      extractIdempotencyKeyFromRequest: jest.fn().mockReturnValue('offlinesynckey002'),
      normalizePedidoSaleType: jest.fn().mockReturnValue('CC'),
      createOrder: jest.fn().mockResolvedValue({
        header: { id: 88, estado: 'BORRADOR' },
        lines: [{ id: 1 }],
        idempotent: true,
      }),
      getOrderVendorForAuth: jest.fn(),
    };
    jest.doMock('../services/pedidos.service', () => mockService);
    jest.doMock('../middleware/auth', () => ({
      verifyToken: (req, _res, next) => {
        req.user = { code: '01', role: 'COMERCIAL' };
        next();
      },
    }));
    jest.doMock('../middleware/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));

    const pedidosRouter = require('../routes/pedidos');
    const app = express();
    app.use(express.json());
    app.use('/api/pedidos', pedidosRouter);

    const res = await request(app)
      .post('/api/pedidos/create')
      .set('Idempotency-Key', 'offlinesynckey002')
      .send({
        clientCode: 'C001',
        vendedorCode: '01',
        lines: [baseLine],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, idempotent: true });
    expect(mockService.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'offlinesynckey002' }),
    );
  });

  test('createOrder persists a server-side BORRADOR draft without confirmation', async () => {
    setupCreateMocks();

    const result = await pedidosService.createOrder({
      ...baseCreatePayload,
      clientRequestId: 'offlinesynckey003',
    });

    expect(result.idempotent).toBeUndefined();
    expect(result.header).toMatchObject({ id: 77, estado: 'BORRADOR' });
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /INSERT INTO\s+JAVIER\.PEDIDOS_CAB/i.test(sql))).toBe(true);
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /UPDATE\s+JAVIER\.PEDIDOS_CAB\s+SET\s+ESTADO\s*=\s*'CONFIRMADO'/i.test(sql))).toBe(false);
  });

  test('createOrder stores normalized client and vendor scope in idempotency table', async () => {
    setupCreateMocks();

    await pedidosService.createOrder({
      ...baseCreatePayload,
      clientCode: '4300007781_EXTRA',
      vendedorCode: '95,02,03,27',
      userId: '98',
      clientRequestId: 'offlinesynckey011',
    });

    const idempotencyInsert = mockQueryWithParams.mock.calls.find(([sql]) =>
      /INSERT INTO\s+JAVIER\.PEDIDO_IDEMPOTENCY/i.test(sql),
    );
    expect(idempotencyInsert).toBeDefined();
    expect(idempotencyInsert[1][3]).toBe('4300007781');
    expect(idempotencyInsert[1][4]).toBe('95');
  });

  test.each([
    ['Venta', 'CC'],
    ['Venta sin nombres', 'VC'],
    ['No venta', 'NV'],
  ])('createOrder persists sale state %s as %s in header and lines', async (saleLabel, expectedCode) => {
    setupCreateMocks();

    await pedidosService.createOrder({
      ...baseCreatePayload,
      tipoventa: saleLabel,
      clientRequestId: `salestate${expectedCode.toLowerCase()}01`,
    });

    const cabInsert = mockQueryWithParams.mock.calls.find(([sql]) =>
      /INSERT INTO\s+JAVIER\.PEDIDOS_CAB/i.test(sql),
    );
    const lineInsert = mockQueryWithParams.mock.calls.find(([sql]) =>
      /INSERT INTO\s+JAVIER\.PEDIDOS_LIN/i.test(sql),
    );
    expect(cabInsert).toBeDefined();
    expect(lineInsert).toBeDefined();
    expect(cabInsert[1]).toContain(expectedCode);
    expect(lineInsert[1]).toContain(expectedCode);
  });

  test('createOrder uses client master payment and tariff when request omits them', async () => {
    setupCreateMocks({
      clientDefaults: {
        clientName: 'CHIRINGUITO MARINERO PURIAS',
        routeCode: 'L101',
        formaPago: 'D6',
        tarifa: 87,
      },
    });

    await pedidosService.createOrder({
      ...baseCreatePayload,
      clientCode: '4300007781',
      clientName: '',
      vendedorCode: '02',
      tarifa: undefined,
      formaPago: undefined,
      clientRequestId: 'offlinesynckey004',
    });

    const cabInsert = mockQueryWithParams.mock.calls.find(([sql]) => /INSERT INTO\s+JAVIER\.PEDIDOS_CAB/i.test(sql));
    expect(cabInsert).toBeTruthy();
    expect(cabInsert[1]).toEqual(expect.arrayContaining(['D6', 87, 'CHIRINGUITO MARINERO PURIAS']));
  });

  test('getDefaultTruckAssignment falls back to client master route when history has no route', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (/FROM\s+DSEDAC\.OPP\s+OPP/i.test(normalized)) {
        return [{
          CODIGOVEHICULO: '11',
          CODIGOREPARTIDOR: '57',
          RUTA: '',
          MATRICULA: '1234ABC',
          DESC_VEHICULO: 'Camion 11',
        }];
      }
      if (/FROM\s+DSEDAC\.CLI\s+CLI\s+LEFT JOIN\s+DSEDAC\.CLC\s+CLC/i.test(normalized)) {
        return [{
          NOMBRECLIENTE: 'CHIRINGUITO MARINERO PURIAS',
          CODIGORUTA: 'L101',
          CODIGOFORMAPAGO: 'D6',
          CODIGOTARIFA: 87,
        }];
      }
      return [];
    });

    const assignment = await pedidosService._private.getDefaultTruckAssignment({
      clientCode: '4300007781',
      vendedorCode: '02',
    });

    expect(assignment).toMatchObject({
      vehicleCode: '11',
      driverCode: '57',
      routeCode: 'L101',
      source: 'DSEDAC.OPP',
    });
  });
});
