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

function setupCreateMocks({ existingIdempotency = null } = {}) {
  let nextOrderNumber = 100;
  mockQueryWithParams.mockImplementation(async (sql, params) => {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();

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

  test('POST /api/pedidos/create returns 200 idempotent replay via route contract', async () => {
    mockQueryWithParams.mockResolvedValueOnce([{ 1: 1 }]);
    jest.resetModules();
    const request = require('supertest');
    const express = require('express');
    const mockService = {
      ensurePedidoIdempotencyKeyFromRequest: jest.fn().mockReturnValue('offlinesynckey002'),
      extractIdempotencyKeyFromRequest: jest.fn().mockReturnValue('offlinesynckey002'),
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
});
