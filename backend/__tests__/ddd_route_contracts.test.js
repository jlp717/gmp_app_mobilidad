'use strict';

const request = require('supertest');
const express = require('express');

const mockPedidosService = {
  getOrders: jest.fn(),
  getAvailableVehicles: jest.fn(),
  getStockBatch: jest.fn(),
  deleteOrderLine: jest.fn(),
  createOrder: jest.fn(),
  extractIdempotencyKeyFromRequest: jest.fn(() => null),
  confirmOrder: jest.fn(),
  updateOrderStatus: jest.fn(),
  cancelOrder: jest.fn(),
  cloneOrder: jest.fn(),
  getOrderAlbaran: jest.fn(),
  generateOrderPdf: jest.fn(),
  getOrderVendorForAuth: jest.fn(),
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

function makeApp(router, user = { id: '01', code: '01', role: 'COMERCIAL' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use(router);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCache.get.mockResolvedValue(null);
  mockCache.set.mockResolvedValue(undefined);
  const db = require('../config/db');
  db.queryWithParams.mockResolvedValue([{ OK: 1 }]);
  mockPedidosService.getOrderVendorForAuth.mockResolvedValue({ vendedorCode: '01' });
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

  test('POST /create rejects commercial creating order for client outside vendor scope', async () => {
    const db = require('../config/db');
    db.queryWithParams.mockResolvedValueOnce([]);

    const res = await request(makeApp(createPedidosRoutes()))
      .post('/create')
      .send({
        clientCode: 'C999',
        vendedorCode: '01',
        lines: [{ codigoArticulo: 'P001', cantidadEnvases: 1 }],
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockPedidosService.createOrder).not.toHaveBeenCalled();
  });

  test('GET / rejects ALL vendor query for commercial users', async () => {
    const res = await request(makeApp(createPedidosRoutes()))
      .get('/')
      .query({ vendedorCodes: 'ALL' });

    expect(res.status).toBe(403);
    expect(mockPedidosService.getOrders).not.toHaveBeenCalled();
  });

  test('GET /products rejects client outside vendor scope', async () => {
    const db = require('../config/db');
    db.queryWithParams.mockResolvedValueOnce([]);

    const res = await request(makeApp(createPedidosRoutes()))
      .get('/products')
      .query({ vendedorCodes: '01', clientCode: 'C999' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockPedidosRepo.searchProducts).not.toHaveBeenCalled();
  });

  test('GET /products strips cost and minimum price for commercial users', async () => {
    mockPedidosRepo.searchProducts.mockResolvedValue({
      products: [{
        code: 'P001',
        name: 'Producto',
        precioVenta: 10,
        precioCosto: 6,
        precioMinimo: 8,
      }],
      count: 1,
    });

    const res = await request(makeApp(createPedidosRoutes()))
      .get('/products')
      .query({ vendedorCodes: '01', clientCode: 'C001' });

    expect(res.status).toBe(200);
    expect(res.body.products[0].precioVenta).toBe(10);
    expect(res.body.products[0]).not.toHaveProperty('precioCosto');
    expect(res.body.products[0]).not.toHaveProperty('precioMinimo');
  });

  test('GET /:id rejects cross-vendor commercial ownership', async () => {
    mockPedidosService.getOrderVendorForAuth.mockResolvedValueOnce({ vendedorCode: '99' });

    const res = await request(makeApp(createPedidosRoutes())).get('/22');

    expect(res.status).toBe(403);
    expect(mockPedidosRepo.getOrderById).not.toHaveBeenCalled();
  });

  test('GET /:id strips order margin fields for commercial users', async () => {
    mockPedidosRepo.getOrderById.mockResolvedValue({
      id: 22,
      total: 100,
      costo: 60,
      margen: 40,
      header: { id: 22, costo: 60, margen: 40 },
      lines: [{
        id: 1,
        precioVenta: 10,
        precioCosto: 6,
        importeCosto: 60,
        importeMargen: 40,
        porcentajeMargen: 40,
      }],
    });

    const res = await request(makeApp(createPedidosRoutes())).get('/22');

    expect(res.status).toBe(200);
    expect(res.body.order.total).toBe(100);
    expect(res.body.order).not.toHaveProperty('costo');
    expect(res.body.order.header).not.toHaveProperty('margen');
    expect(res.body.order.lines[0]).not.toHaveProperty('precioCosto');
    expect(res.body.order.lines[0]).not.toHaveProperty('porcentajeMargen');
  });

  test('GET /available-vehicles returns vehicles for Flutter truck assignment', async () => {
    const vehicles = [
      {
        code: 'CAM01',
        matricula: '1234ABC',
        description: 'Camion uno',
        driverCode: '01',
      },
    ];
    mockPedidosService.getAvailableVehicles.mockResolvedValue(vehicles);

    const res = await request(makeApp(createPedidosRoutes()))
      .get('/available-vehicles');

    expect(res.status).toBe(200);
    expect(mockPedidosService.getAvailableVehicles).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual({ success: true, vehicles });
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

  test('PUT /:id/confirm maps BOLSA_INSUFICIENTE blocked response to top-level code', async () => {
    mockPedidosService.confirmOrder.mockResolvedValueOnce({
      blocked: true,
      reason: 'BOLSA_INSUFICIENTE',
      message: 'Bolsa insuficiente',
    });

    const res = await request(makeApp(createPedidosRoutes()))
      .put('/22/confirm')
      .send({ saleType: 'VC' });

    expect(res.status).toBe(409);
    expect(res.body.blocked).toBe(true);
    expect(res.body.reason).toBe('BOLSA_INSUFICIENTE');
    expect(res.body.code).toBe('BOLSA_INSUFICIENTE');
  });

  test('PUT /:id/confirm rejects invalid saleType and cross-vendor commercial ownership', async () => {
    const invalidType = await request(makeApp(createPedidosRoutes()))
      .put('/22/confirm')
      .send({ saleType: 'BAD' });

    expect(invalidType.status).toBe(400);
    expect(mockPedidosService.confirmOrder).not.toHaveBeenCalled();

    mockPedidosService.getOrderVendorForAuth.mockResolvedValueOnce({ vendedorCode: '99' });
    const forbidden = await request(makeApp(createPedidosRoutes()))
      .put('/22/confirm')
      .send({ saleType: 'CC' });

    expect(forbidden.status).toBe(403);
    expect(mockPedidosService.confirmOrder).not.toHaveBeenCalled();
  });

  test('POST /confirm direct DDD shortcut is disabled', async () => {
    const res = await request(makeApp(createPedidosRoutes()))
      .post('/confirm')
      .send({
        clientCode: 'C001',
        lines: [{ productCode: 'P001', quantity: 1 }],
      });

    expect(res.status).toBe(410);
    expect(res.body.code).toBe('DIRECT_CONFIRM_DISABLED');
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
    expect(res.body.resumen.total).toBe(42);
  });

  test('GET /:codigoCliente/pendientes cache key includes authenticated commercial scope', async () => {
    mockCobrosRepo.getPendientes.mockResolvedValue({
      cobros: [],
      resumen: { totalPendiente: 0 },
    });

    await request(makeApp(createCobrosRoutes(), { id: '01', code: '01', role: 'COMERCIAL' }))
      .get('/C001/pendientes');
    await request(makeApp(createCobrosRoutes(), { id: '02', code: '02', role: 'COMERCIAL' }))
      .get('/C001/pendientes');

    expect(mockCache.set.mock.calls[0][0]).toContain('COMERCIAL:01');
    expect(mockCache.set.mock.calls[1][0]).toContain('COMERCIAL:02');
  });

  test('GET /:codigoCliente/estado hides raw repository errors', async function () {
    mockCobrosRepo.getPendientes.mockRejectedValue(new Error('SQL0204 internal table missing'));

    const res = await request(makeApp(createCobrosRoutes())).get('/C001/estado');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: 'Error obteniendo estado de cobros',
      code: 'COBROS_ESTADO_ERROR',
    });
    expect(res.body.error).not.toContain('SQL0204');
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

  test('GET /pending-summary/:vendedorCode forwards manager visible vendorCodes', async () => {
    mockCobrosRepo.getPendingSummary.mockResolvedValue({ summary: {}, grandTotal: 0, clientCount: 0 });

    const res = await request(makeApp(createCobrosRoutes(), {
      id: '98',
      code: '98',
      role: 'JEFE_VENTAS',
      isJefeVentas: true,
      vendorCodes: ['01', '02'],
    })).get('/pending-summary/ALL');

    expect(res.status).toBe(200);
    expect(mockCobrosRepo.getPendingSummary).toHaveBeenCalledWith(
      'ALL',
      expect.objectContaining({ vendorCodes: ['01', '02'] }),
    );
  });

  test('GET /:codigoCliente/historico rejects client outside vendor scope', async () => {
    const db = require('../config/db');
    db.queryWithParams.mockResolvedValueOnce([]);

    const res = await request(makeApp(createCobrosRoutes())).get('/C999/historico');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockCobrosRepo.getHistorico).not.toHaveBeenCalled();
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
