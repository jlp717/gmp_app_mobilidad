'use strict';

const request = require('supertest');
const express = require('express');

const mockPedidosService = {
  getOrders: jest.fn(),
  createOrder: jest.fn(),
  confirmOrder: jest.fn(),
  updateOrderStatus: jest.fn(),
  cancelOrder: jest.fn(),
};
const mockPedidosRepo = {
  searchProducts: jest.fn(),
  getProductDetail: jest.fn(),
  getPromotions: jest.fn(),
  getOrderHistory: jest.fn(),
  getOrderStats: jest.fn(),
  getOrderById: jest.fn(),
  deleteOrder: jest.fn(),
};
const mockCobrosRepo = {
  getPendientes: jest.fn(),
  registerPayment: jest.fn(),
  getPendingSummary: jest.fn(),
  getHistorico: jest.fn(),
};
const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
  invalidatePattern: jest.fn(),
};

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../services/pedidos.service', () => mockPedidosService);
jest.mock('../services/query-optimizer', () => ({ cachedQuery: jest.fn() }));
jest.mock('../services/redis-cache', () => ({
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
}));
jest.mock('../services/laclae', () => ({ getClientCodesFromCache: jest.fn() }));
jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: jest.fn(),
}));

jest.mock('../src/modules/pedidos', () => ({
  Db2PedidosRepository: jest.fn(() => mockPedidosRepo),
}));
jest.mock('../src/modules/cobros', () => ({
  Db2CobrosRepository: jest.fn(() => mockCobrosRepo),
}));
jest.mock('../src/modules/entregas', () => ({
  Db2EntregasRepository: jest.fn(() => ({})),
}));
jest.mock('../src/modules/rutero', () => ({
  Db2RuteroRepository: jest.fn(() => ({})),
}));
jest.mock('../src/modules/auth', () => ({
  Db2AuthRepository: jest.fn(() => ({})),
}));
jest.mock('../src/modules/clients/infrastructure/db2-client-repository', () => ({
  Db2ClientRepository: jest.fn(() => ({})),
}));
jest.mock('../src/core/infrastructure/database/db2-connection-pool', () => ({
  Db2ConnectionPool: jest.fn(() => ({})),
}));
jest.mock('../src/core/infrastructure/cache/response-cache', () => ({
  ResponseCache: jest.fn(() => mockCache),
}));
jest.mock('../src/core/infrastructure/cache/performance-cache', () => ({
  performanceCache: {
    getTTL: jest.fn(() => 60),
    getOrFetch: jest.fn(async (_key, fn) => ({
      source: 'test',
      cached: false,
      data: await fn(),
    })),
  },
}));
jest.mock('../routes/entregas', () => {
  const express = require('express');
  const router = express.Router();
  router.post('/receipt/:entregaId/email', (req, res) => {
    res.json({ success: true, entregaId: req.params.entregaId, channel: 'email' });
  });
  router.post('/receipt/:entregaId/whatsapp', (req, res) => {
    res.json({ success: true, entregaId: req.params.entregaId, channel: 'whatsapp' });
  });
  return router;
});

const { createPedidosRoutes, createCobrosRoutes, createEntregasRoutes } = require('../src/shared/routes/ddd-adapters');

function makeApp(router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: '01', code: '01', role: 'COMERCIAL' };
    next();
  });
  app.use(router);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCache.get.mockResolvedValue(null);
  mockCache.set.mockResolvedValue(undefined);
});

describe('DDD pedidos route contracts', () => {
  test('GET / accepts status and returns orders as a top-level list', async () => {
    mockPedidosService.getOrders.mockResolvedValue({
      orders: [{ id: 10, estado: 'CONFIRMADO' }],
      count: 1,
    });

    const res = await request(makeApp(createPedidosRoutes()))
      .get('/')
      .query({ vendedorCodes: '01', status: 'CONFIRMADO' });

    expect(res.status).toBe(200);
    expect(mockPedidosService.getOrders).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CONFIRMADO', vendedorCodes: '01' }),
    );
    expect(Array.isArray(res.body.orders)).toBe(true);
    expect(res.body.orders).toEqual([{ id: 10, estado: 'CONFIRMADO' }]);
    expect(res.body.count).toBe(1);
  });

  test('POST /create returns created order header at top level', async () => {
    mockPedidosService.createOrder.mockResolvedValue({
      header: { id: 22, estado: 'BORRADOR' },
      lines: [{ id: 1 }],
    });

    const res = await request(makeApp(createPedidosRoutes()))
      .post('/create')
      .send({
        clientCode: 'C001',
        vendedorCode: '01',
        observaciones: 'nota',
        lines: [{ codigoArticulo: 'P001', cantidadEnvases: 1 }],
      });

    expect(res.status).toBe(201);
    expect(mockPedidosService.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ observaciones: 'nota' }),
    );
    expect(res.body.id).toBe(22);
    expect(res.body.header).toEqual({ id: 22, estado: 'BORRADOR' });
    expect(res.body.lines).toEqual([{ id: 1 }]);
  });

  test('POST /create rejects commercial creating orders for another vendor', async () => {
    const res = await request(makeApp(createPedidosRoutes()))
      .post('/create')
      .send({
        clientCode: 'C001',
        vendedorCode: '99',
        lines: [{ codigoArticulo: 'P001', cantidadEnvases: 1 }],
      });

    expect(res.status).toBe(403);
    expect(mockPedidosService.createOrder).not.toHaveBeenCalled();
  });

  test('GET / rejects ALL vendor query for commercial users', async () => {
    const res = await request(makeApp(createPedidosRoutes()))
      .get('/')
      .query({ vendedorCodes: 'ALL' });

    expect(res.status).toBe(403);
    expect(mockPedidosService.getOrders).not.toHaveBeenCalled();
  });

  test('PUT /:id/confirm returns stock blocks as 409 and confirmed header at top level', async () => {
    mockPedidosService.confirmOrder.mockResolvedValueOnce({
      blocked: true,
      reason: 'STOCK_INSUFICIENTE',
      stockWarnings: [{ product: 'P001' }],
      message: 'Stock insuficiente',
    });

    const blocked = await request(makeApp(createPedidosRoutes()))
      .put('/22/confirm')
      .send({ saleType: 'VC' });

    expect(blocked.status).toBe(409);
    expect(blocked.body.blocked).toBe(true);
    expect(mockPedidosService.confirmOrder).toHaveBeenCalledWith(
      22,
      'VC',
      expect.objectContaining({ userId: '01' }),
    );

    mockPedidosService.confirmOrder.mockResolvedValueOnce({
      header: { id: 22, estado: 'CONFIRMADO' },
      lines: [],
    });

    const confirmed = await request(makeApp(createPedidosRoutes()))
      .put('/22/confirm')
      .send({ saleType: 'CC' });

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.header.estado).toBe('CONFIRMADO');
  });
});

describe('DDD cobros route contracts', () => {
  test('GET /:codigoCliente/pendientes returns cobros and resumen at top level', async () => {
    mockCobrosRepo.getPendientes.mockResolvedValue({
      cobros: [{ id: 'c1', referencia: 'M-1' }],
      resumen: { totalPendiente: 42, pedidos: { cantidad: 1, total: 42 } },
    });

    const res = await request(makeApp(createCobrosRoutes())).get('/C001/pendientes');

    expect(res.status).toBe(200);
    expect(mockCobrosRepo.getPendientes).toHaveBeenCalledWith(
      'C001',
      expect.objectContaining({ userId: '01', userRole: 'COMERCIAL' }),
    );
    expect(res.body.cobros).toEqual([{ id: 'c1', referencia: 'M-1' }]);
    expect(res.body.resumen.totalPendiente).toBe(42);
  });

  test('POST /:codigoCliente/registrar is available for Flutter and registers payment', async () => {
    mockCobrosRepo.registerPayment.mockResolvedValue({ id: 'pay1', status: 'REGISTRADO' });

    const res = await request(makeApp(createCobrosRoutes()))
      .post('/C001/registrar')
      .send({
        referencia: 'M-1',
        importe: 42,
        formaPago: 'CONTADO',
        codigoUsuario: '99',
        idempotencyToken: 'cobro-token-route-001',
      });

    expect(res.status).toBe(200);
    expect(mockCobrosRepo.registerPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        clientCode: 'C001',
        amount: 42,
        paymentMethod: 'CONTADO',
        reference: 'M-1',
        userId: '01',
        userRole: 'COMERCIAL',
        idempotencyToken: 'cobro-token-route-001',
      }),
    );
    expect(res.body.success).toBe(true);
  });

  test('POST /:codigoCliente/registrar maps idempotency conflicts to 409', async () => {
    const error = new Error('Token de idempotencia reutilizado con otro payload');
    error.code = 'IDEMPOTENCY_CONFLICT';
    error.status = 409;
    mockCobrosRepo.registerPayment.mockRejectedValue(error);

    const res = await request(makeApp(createCobrosRoutes()))
      .post('/C001/registrar')
      .send({
        referencia: 'M-1',
        importe: 42,
        formaPago: 'CONTADO',
        idempotencyToken: 'cobro-token-route-002',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  test('GET /pending-summary/:vendedorCode delegates authorization to repository', async () => {
    mockCobrosRepo.getPendingSummary.mockResolvedValue({
      summary: { C001: { total: 42, count: 1 } },
      grandTotal: 42,
      clientCount: 1,
    });

    const res = await request(makeApp(createCobrosRoutes())).get('/pending-summary/01');

    expect(res.status).toBe(200);
    expect(mockCobrosRepo.getPendingSummary).toHaveBeenCalledWith(
      '01',
      expect.objectContaining({ userId: '01', userRole: 'COMERCIAL' }),
    );
    expect(res.body.grandTotal).toBe(42);
  });
});

describe('DDD entregas document route contracts', () => {
  test('receipt email and WhatsApp endpoints remain available under DDD routes', async () => {
    const app = makeApp(createEntregasRoutes());

    const email = await request(app)
      .post('/receipt/E001/email')
      .send({ email: 'cliente@example.com' });

    expect(email.status).toBe(200);
    expect(email.body).toEqual({ success: true, entregaId: 'E001', channel: 'email' });

    const whatsapp = await request(app)
      .post('/receipt/E001/whatsapp')
      .send({ phone: '600000000' });

    expect(whatsapp.status).toBe(200);
    expect(whatsapp.body).toEqual({ success: true, entregaId: 'E001', channel: 'whatsapp' });
  });
});
