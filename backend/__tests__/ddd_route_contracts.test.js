'use strict';

const request = require('supertest');
const express = require('express');

function expectDb2SafeBind(sql, bind, maxLen) {
  const text = bind == null ? '' : String(bind);
  const normalized = text.length <= maxLen;
  const casted = new RegExp(`CAST\\(\\?\\s+AS\\s+VARCHAR\\(${maxLen}\\)\\)`, 'i').test(String(sql || ''));
  expect(normalized || casted).toBe(true);
}

const mockPedidosService = {
  getOrders: jest.fn(),
  getAvailableVehicles: jest.fn(),
  getStockBatch: jest.fn(),
  deleteOrderLine: jest.fn(),
  createOrder: jest.fn(),
  extractIdempotencyKeyFromRequest: jest.fn(() => null),
  ensurePedidoIdempotencyKeyFromRequest: jest.fn(() => 'test-idempotency-key'),
  confirmOrder: jest.fn(),
  updateOrderStatus: jest.fn(),
  cancelOrder: jest.fn(),
  cloneOrder: jest.fn(),
  getOrderAlbaran: jest.fn(),
  generateOrderPdf: jest.fn(),
  getOrderVendorForAuth: jest.fn(),
  addOrderLine: jest.fn(),
  getDeliveryOptions: jest.fn(),
  getComplementaryProducts: jest.fn(),
  getProductStock: jest.fn(),
  getSimilarProducts: jest.fn(),
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

const { createPedidosRoutes, createCobrosRoutes, createEntregasRoutes, createClientsRoutes, createCommissionsRoutes } = require('../src/shared/routes/ddd-adapters');

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

  test('POST /create masks generic service errors from SQL and ODBC details', async () => {
    const sqlError = new Error('SQL0204 Tabla interna no encontrada');
    sqlError.odbcErrors = [{ state: '42S02', code: -204, message: 'ODBC driver raw detail' }];
    mockPedidosService.createOrder.mockRejectedValue(sqlError);

    const res = await request(makeApp(createPedidosRoutes()))
      .post('/create')
      .send({
        clientCode: 'C001',
        vendedorCode: '01',
        lines: [{ codigoArticulo: 'P001', cantidadEnvases: 1 }],
      });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      error: 'Error interno del servidor',
    });
    expect(JSON.stringify(res.body)).not.toContain('SQL0204');
    expect(JSON.stringify(res.body)).not.toContain('ODBC');
    expect(JSON.stringify(res.body)).not.toContain('Tabla interna');
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

  test('GET /products client scope checks CLP.VENDEDORCOMERCIAL and LACLAE', async () => {
    const db = require('../config/db');
    mockPedidosRepo.searchProducts.mockResolvedValue({ products: [], count: 0 });

    const res = await request(makeApp(createPedidosRoutes(), { id: '98', code: '98', role: 'COMERCIAL' }))
      .get('/products')
      .query({ vendedorCodes: '98', clientCode: '4300001091' });

    expect(res.status).toBe(200);
    const scopeSql = db.queryWithParams.mock.calls[0][0];
    expect(scopeSql).toMatch(/DSEDAC\.CLP/);
    expect(scopeSql).toMatch(/VENDEDORCOMERCIAL/);
    expect(scopeSql).toMatch(/DSED\.LACLAE/);
    expect(scopeSql).not.toMatch(/CLI\.CODIGOVENDEDOR/);
    expect(scopeSql).not.toMatch(/CODIGOVENDEDOR/);
    expect(db.queryWithParams.mock.calls[0][1]).toEqual(['4300001091', '98', '98']);
  });

  test('GET /products allows JEFE_VENTAS when login vendor mismatches assigned client vendor', async () => {
    const db = require('../config/db');
    mockPedidosRepo.searchProducts.mockResolvedValue({ products: [], count: 0 });
    db.queryWithParams
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ VENDOR_CODE: '02' }])
      .mockResolvedValueOnce([{ OK: 1 }]);

    const res = await request(makeApp(createPedidosRoutes(), {
      id: '98',
      code: '98',
      role: 'JEFE_VENTAS',
      isJefeVentas: true,
    }))
      .get('/products')
      .query({ vendedorCodes: '98', clientCode: '4300001091' });

    expect(res.status).toBe(200);
    expect(db.queryWithParams.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(mockPedidosRepo.searchProducts).toHaveBeenCalledWith(expect.objectContaining({
      vendedorCodes: '02',
      clientCode: '4300001091',
    }));
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

  test('GET /products truncates long clientCode for DB2 binds and catalog search', async () => {
    const db = require('../config/db');
    mockPedidosRepo.searchProducts.mockResolvedValue({ products: [], count: 0 });
    const longClient = '4300001091_OVERFLOW';

    const res = await request(makeApp(createPedidosRoutes()))
      .get('/products')
      .query({ vendedorCodes: '01', clientCode: longClient });

    expect(res.status).toBe(200);
    const [scopeSql, scopeParams] = db.queryWithParams.mock.calls[0];
    expect(scopeParams[0]).toBe('4300001091');
    expectDb2SafeBind(scopeSql, scopeParams[0], 10);
    expect(mockPedidosRepo.searchProducts).toHaveBeenCalledWith(
      expect.objectContaining({ clientCode: '4300001091' }),
    );
  });

  test('GET /products truncates long vendedorCodes for DB2 scope binds', async () => {
    const db = require('../config/db');
    db.queryWithParams.mockResolvedValue([{ OK: 1 }]);
    mockPedidosRepo.searchProducts.mockResolvedValue({ products: [], count: 0 });
    const managerUser = { id: '80', code: '80', role: 'JEFE_VENTAS', isJefeVentas: true };

    const res = await request(makeApp(createPedidosRoutes(), managerUser))
      .get('/products')
      .query({ vendedorCodes: '0199', clientCode: '4300001091' });

    expect(res.status).toBe(200);
    const [scopeSql, scopeParams] = db.queryWithParams.mock.calls[0];
    scopeParams.slice(1).forEach((code) => {
      if (typeof code === 'string' && /^[A-Za-z0-9]+$/.test(code)) {
        expectDb2SafeBind(scopeSql, code, 2);
      }
    });
  });

  test('GET /products/:code truncates long article path before product detail lookup', async () => {
    mockPedidosRepo.getProductDetail.mockResolvedValue({ code: 'ART0012345', name: 'Prod' });
    const longArticle = 'ART0012345_EXTRA_LONG_SUFFIX';

    const res = await request(makeApp(createPedidosRoutes()))
      .get(`/products/${encodeURIComponent(longArticle)}`)
      .query({ vendedorCodes: '01', clientCode: 'C001' });

    expect(res.status).toBe(200);
    expect(mockPedidosRepo.getProductDetail).toHaveBeenCalledWith(expect.objectContaining({
      code: 'ART0012345',
      clientCode: 'C001',
    }));
  });

  test('GET /client-evolution/:clientCode truncates long path client and vendor SQL binds', async () => {
    const db = require('../config/db');
    db.queryWithParams
      .mockResolvedValueOnce([{ OK: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const longClient = '4300001091_OVERFLOW';
    const res = await request(makeApp(createPedidosRoutes()))
      .get(`/client-evolution/${longClient}`)
      .query({ vendedorCodes: '01' });

    expect(res.status).toBe(200);
    db.queryWithParams.mock.calls.forEach(([sql, params]) => {
      expect(params[0]).toBe('4300001091');
      expectDb2SafeBind(sql, params[0], 10);
    });
    db.queryWithParams.mock.calls
      .flatMap(([, params]) => params)
      .filter((value) => typeof value === 'string' && /^[A-Za-z0-9]+$/.test(value) && value.length <= 2)
      .forEach((vendor) => expectDb2SafeBind(db.queryWithParams.mock.calls[0][0], vendor, 2));
  });

  test('GET /products and /products/:code cache keys include margin-aware authenticated scope', async function () {
    mockPedidosRepo.searchProducts.mockResolvedValue({ products: [{ code: 'P001', name: 'Producto', precioVenta: 10 }], count: 1 });
    mockPedidosRepo.getProductDetail.mockResolvedValue({ code: 'P001', name: 'Producto', precioVenta: 10 });
    const commercialUser = { id: '01', code: '01', role: 'COMERCIAL' };
    const managerUser = { id: '80', code: '80', role: 'JEFE_VENTAS', isJefeVentas: true, vendorCodes: ['01'] };
    await request(makeApp(createPedidosRoutes(), commercialUser)).get('/products').query({ vendedorCodes: '01', clientCode: 'C001' });
    await request(makeApp(createPedidosRoutes(), managerUser)).get('/products').query({ vendedorCodes: '01', clientCode: 'C001' });
    await request(makeApp(createPedidosRoutes(), commercialUser)).get('/products/P001').query({ vendedorCodes: '01' });
    await request(makeApp(createPedidosRoutes(), managerUser)).get('/products/P001').query({ vendedorCodes: '01' });
    const cacheKeys = mockCache.set.mock.calls.map(function (call) { return call[0]; });
    expect(cacheKeys[0]).toContain('ddd:products:scope:v2:role=COMERCIAL:user=01:visible=self:canSeeMargin=0');
    expect(cacheKeys[1]).toContain('ddd:products:scope:v2:role=JEFE_VENTAS:user=80:visible=01:canSeeMargin=1');
    expect(cacheKeys[2]).toContain('ddd:product:scope:v2:role=COMERCIAL:user=01:visible=self:canSeeMargin=0:P001');
    expect(cacheKeys[3]).toContain('ddd:product:scope:v2:role=JEFE_VENTAS:user=80:visible=01:canSeeMargin=1:P001');
    expect(new Set(cacheKeys).size).toBe(cacheKeys.length);
  });

  test('POST /acciones-rapidas returns typed stock error with alternativa', async () => {
    mockPedidosService.getProductStock.mockResolvedValueOnce({ envases: 0, unidades: 0 });
    mockPedidosService.getSimilarProducts.mockResolvedValueOnce([
      { code: 'ALT001', name: 'Alternativa', precioCosto: 4, precioMinimo: 8 },
    ]);

    const res = await request(makeApp(createPedidosRoutes()))
      .post('/acciones-rapidas')
      .send({ codigoArticulo: 'ART001', cantidadEnvases: 1, unidadMedida: 'CAJAS' });

    expect(res.status).toBe(409);
    expect(mockPedidosService.getSimilarProducts).toHaveBeenCalledWith('ART001');
    expect(res.body).toMatchObject({
      success: false,
      error: 'STOCK_INSUFICIENTE',
      code: 'STOCK_INSUFICIENTE',
      sufficient: false,
      alternativa: { code: 'ALT001', name: 'Alternativa' },
    });
    expect(res.body.alternativa).not.toHaveProperty('precioCosto');
    expect(res.body.alternativa).not.toHaveProperty('precioMinimo');
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

  test('PUT /:id/confirm does not honor client forceConfirm for normal commercial confirm', async () => {
    mockPedidosService.confirmOrder.mockResolvedValueOnce({
      header: { id: 22, estado: 'CONFIRMADO' },
      lines: [],
    });

    const res = await request(makeApp(createPedidosRoutes()))
      .put('/22/confirm')
      .send({ saleType: 'CC', forceConfirm: true });

    expect(res.status).toBe(200);
    expect(mockPedidosService.confirmOrder).toHaveBeenCalledWith(
      22,
      'CC',
      expect.objectContaining({ forceConfirm: false, userId: '01' }),
    );
  });

  test('PUT /:id/lines validates codigoArticulo and claseLinea before service call', async () => {
    const missingArticle = await request(makeApp(createPedidosRoutes()))
      .put('/22/lines')
      .send({ cantidadEnvases: 1, claseLinea: 'VT' });

    expect(missingArticle.status).toBe(400);
    expect(missingArticle.body).toMatchObject({ success: false, code: 'INVALID_LINE_PAYLOAD' });
    expect(mockPedidosService.addOrderLine).not.toHaveBeenCalled();

    const invalidClass = await request(makeApp(createPedidosRoutes()))
      .put('/22/lines')
      .send({ codigoArticulo: 'P001', cantidadEnvases: 1, claseLinea: 'BAD' });

    expect(invalidClass.status).toBe(400);
    expect(invalidClass.body).toMatchObject({ success: false, code: 'INVALID_LINE_PAYLOAD' });
    expect(mockPedidosService.addOrderLine).not.toHaveBeenCalled();
  });

  test('PUT /:id/confirm preserves typed service errors and hides public 500 detail', async () => {
    const alreadyConfirming = new Error('Pedido ya confirmado o en proceso de confirmacion por otra sesion');
    alreadyConfirming.code = 'PEDIDO_ALREADY_CONFIRMING';
    alreadyConfirming.status = 409;
    mockPedidosService.confirmOrder.mockRejectedValueOnce(alreadyConfirming);

    const conflict = await request(makeApp(createPedidosRoutes()))
      .put('/22/confirm')
      .send({ saleType: 'CC' });

    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ success: false, code: 'PEDIDO_ALREADY_CONFIRMING', error: 'Pedido ya confirmado o en proceso de confirmacion por otra sesion' });

    const bolsaWrite = new Error('No se pudo registrar movimiento de bolsa. SQL0204 detalle interno');
    bolsaWrite.code = 'BOLSA_MOVEMENT_WRITE_FAILED';
    bolsaWrite.status = 500;
    mockPedidosService.confirmOrder.mockRejectedValueOnce(bolsaWrite);

    const failure = await request(makeApp(createPedidosRoutes()))
      .put('/22/confirm')
      .send({ saleType: 'CC' });

    expect(failure.status).toBe(500);
    expect(failure.body).toMatchObject({ success: false, code: 'BOLSA_MOVEMENT_WRITE_FAILED', error: 'Error interno al confirmar pedido' });
    expect(failure.body.error).not.toContain('SQL0204');
  });

  test('DELETE /:id/lines/:lineId pins repeated delete as typed LINE_NOT_FOUND', async () => {
    const notFound = new Error('Línea de pedido no encontrada');
    notFound.code = 'LINE_NOT_FOUND';
    notFound.status = 404;
    mockPedidosService.deleteOrderLine.mockRejectedValueOnce(notFound);

    const res = await request(makeApp(createPedidosRoutes()))
      .delete('/22/lines/7');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, code: 'LINE_NOT_FOUND' });
  });

  test('PUT /:id/cancel preserves ERP-managed typed service error', async () => {
    const managedByErp = new Error('El pedido confirmado ya lo gestiona el ERP');
    managedByErp.code = 'PEDIDO_MANAGED_BY_ERP';
    managedByErp.status = 409;
    mockPedidosService.cancelOrder.mockRejectedValueOnce(managedByErp);

    const res = await request(makeApp(createPedidosRoutes()))
      .put('/22/cancel')
      .send({});

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, code: 'PEDIDO_MANAGED_BY_ERP', error: 'El pedido confirmado ya lo gestiona el ERP' });
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

  test('GET /delivery-options rejects COMERCIAL when clientCode is outside vendor scope', async () => {
    const db = require('../config/db');
    db.queryWithParams.mockResolvedValueOnce([]);

    const res = await request(makeApp(createPedidosRoutes()))
      .get('/delivery-options')
      .query({ clientCode: 'C999', vendedorCode: '01' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockPedidosService.getDeliveryOptions).not.toHaveBeenCalled();
    expect(db.queryWithParams.mock.calls[0][0]).toMatch(/DSEDAC\.CLI/i);
  });

  test('POST /complementary rejects COMERCIAL when clientCode is outside vendor scope', async () => {
    const db = require('../config/db');
    db.queryWithParams.mockResolvedValueOnce([]);

    const res = await request(makeApp(createPedidosRoutes()))
      .post('/complementary')
      .send({ productCodes: ['P001'], clientCode: 'C999', vendedorCode: '01' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockPedidosService.getComplementaryProducts).not.toHaveBeenCalled();
    expect(db.queryWithParams.mock.calls[0][0]).toMatch(/DSEDAC\.CLI/i);
  });

  test('GET /delivery-options rejects COMERCIAL for another vendor code', async () => {
    const db = require('../config/db');

    const res = await request(makeApp(createPedidosRoutes()))
      .get('/delivery-options')
      .query({ clientCode: 'C001', vendedorCode: '99' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_VENDOR');
    expect(mockPedidosService.getDeliveryOptions).not.toHaveBeenCalled();
    expect(db.queryWithParams).not.toHaveBeenCalled();
  });

  test('GET /delivery-options allows in-scope client and delegates to service', async () => {
    mockPedidosService.getDeliveryOptions.mockResolvedValue({
      deliveryDays: ['2026-06-25'],
      defaultTruck: { code: 'CAM01' },
    });

    const res = await request(makeApp(createPedidosRoutes()))
      .get('/delivery-options')
      .query({ clientCode: 'C001', vendedorCode: '01', deliveryDate: '2026-06-25' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockPedidosService.getDeliveryOptions).toHaveBeenCalledWith({
      clientCode: 'C001',
      vendedorCode: '01',
      deliveryDate: '2026-06-25',
    });
  });

  test('POST /complementary rejects COMERCIAL for another vendor code when clientCode present', async () => {
    const db = require('../config/db');

    const res = await request(makeApp(createPedidosRoutes()))
      .post('/complementary')
      .send({ productCodes: ['P001'], clientCode: 'C001', vendedorCode: '99' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_VENDOR');
    expect(mockPedidosService.getComplementaryProducts).not.toHaveBeenCalled();
    expect(db.queryWithParams).not.toHaveBeenCalled();
  });

  test('POST /complementary allows in-scope client and delegates to service', async () => {
    mockPedidosService.getComplementaryProducts.mockResolvedValue([{ code: 'P002' }]);

    const res = await request(makeApp(createPedidosRoutes()))
      .post('/complementary')
      .send({ productCodes: ['P001'], clientCode: 'C001', vendedorCode: '01' });

    expect(res.status).toBe(200);
    expect(res.body.products).toEqual([{ code: 'P002' }]);
    expect(mockPedidosService.getComplementaryProducts).toHaveBeenCalledWith(['P001'], 'C001');
  });

  test('POST /complementary skips client scope when clientCode omitted', async () => {
    mockPedidosService.getComplementaryProducts.mockResolvedValue([{ code: 'P002' }]);

    const res = await request(makeApp(createPedidosRoutes()))
      .post('/complementary')
      .send({ productCodes: ['P001'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockPedidosService.getComplementaryProducts).toHaveBeenCalledWith(['P001'], undefined);
    const scopeCalls = require('../config/db').queryWithParams.mock.calls.filter(([sql]) => /DSEDAC\.CLI/i.test(sql));
    expect(scopeCalls).toHaveLength(0);
  });

  test('GET /purchase-history-global applies COMERCIAL scope filters to lastYear query', async () => {
    const db = require('../config/db');
    db.queryWithParams.mockResolvedValue([]);

    const res = await request(makeApp(createPedidosRoutes(), { id: '01', code: '01', role: 'COMERCIAL' }))
      .get('/purchase-history-global')
      .query({
        from: '2026-01-01',
        to: '2026-01-31',
        vendedorCode: '99',
        clientCode: 'C001',
        productCode: 'P001',
        familia: 'F01',
        marca: 'M01',
      });

    expect(res.status).toBe(200);
    const lastYearCall = db.queryWithParams.mock.calls.find(([sql]) => /TOTAL_LAST_YEAR/i.test(sql));
    expect(lastYearCall).toBeDefined();
    expect(lastYearCall[0]).toMatch(/TRIM\(L\.LCCDVD\) IN \(\?\)/);
    expect(lastYearCall[0]).toMatch(/TRIM\(L\.LCCDCL\) = \?/);
    expect(lastYearCall[0]).toMatch(/TRIM\(L\.LCCDRF\) = \?/);
    expect(lastYearCall[0]).toMatch(/TRIM\(CODIGOFAMILIA\) = \?/);
    expect(lastYearCall[0]).toMatch(/TRIM\(CODIGOMARCA\) = \?/);
    expect(lastYearCall[1]).toEqual([20250101, 20250131, '01', 'C001', 'P001', 'F01', 'M01']);
    expect(lastYearCall[1]).not.toContain('99');
  });
});


describe('DDD clients/commissions cache scope contracts', () => {
  test('GET / cache keys include authenticated role user visibility and margin scope', async () => {
    const { cachedQuery } = require('../services/query-optimizer');
    const { performanceCache } = require('../src/core/infrastructure/cache/performance-cache');
    cachedQuery.mockResolvedValueOnce([]);
    const managerUser = { id: '80', code: '80', role: 'JEFE_VENTAS', isJefeVentas: true, vendorCodes: ['01'] };

    await request(makeApp(createClientsRoutes(), managerUser))
      .get('/')
      .query({ vendedorCodes: 'ALL', limit: 10, offset: 0 });

    await request(makeApp(createCommissionsRoutes(), managerUser))
      .get('/')
      .query({ vendedorCode: '01', year: '2026' });

    const cacheKeys = performanceCache.getOrFetch.mock.calls.map(function (call) { return call[0]; });
    expect(cacheKeys).toEqual(expect.arrayContaining([
      expect.stringContaining('ddd:clients:v4:scope:v2:role=JEFE_VENTAS:user=80:visible=01:canSeeMargin=1'),
      expect.stringContaining('ddd:commissions:v2:scope:v2:role=JEFE_VENTAS:user=80:visible=01:canSeeMargin=1'),
    ]));
  });

  test('GET / bypasses performance and Redis cache on force refresh', async () => {
    const { cachedQuery } = require('../services/query-optimizer');
    const { performanceCache } = require('../src/core/infrastructure/cache/performance-cache');
    cachedQuery.mockResolvedValueOnce([]);
    const managerUser = { id: '80', code: '80', role: 'JEFE_VENTAS', isJefeVentas: true, vendorCodes: ['01'] };

    const res = await request(makeApp(createClientsRoutes(), managerUser))
      .get('/')
      .query({ vendedorCodes: 'ALL', limit: 10, offset: 0, forceRefresh: '1' });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-cache-source']).toBe('bypass');
    expect(performanceCache.getOrFetch).not.toHaveBeenCalled();
    expect(cachedQuery.mock.calls[0][2]).toEqual(expect.objectContaining({ skipCache: true }));
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

  test('GET /:codigoCliente/pendientes forwards filters and bypasses cache on force refresh', async () => {
    mockCobrosRepo.getPendientes.mockResolvedValue({
      cobros: [],
      resumen: { totalPendiente: 0 },
    });

    const res = await request(makeApp(createCobrosRoutes(), {
      id: '98',
      code: '98',
      role: 'JEFE_VENTAS',
      isJefeVentas: true,
      vendorCodes: ['01', '02'],
    }))
      .get('/C001/pendientes')
      .query({
        vendedorCodes: '01,02',
        tipoDocumento: 'FAC',
        fechaDesde: '2026-06-01',
        fechaHasta: '2026-06-30',
        _ts: '123',
      });

    expect(res.status).toBe(200);
    expect(mockCobrosRepo.getPendientes).toHaveBeenCalledWith(
      'C001',
      expect.objectContaining({
        userId: '98',
        userRole: 'JEFE_VENTAS',
        vendedorCodes: ['01', '02'],
        tipoDocumento: 'COB',
        fechaDesde: '2026-06-01',
        fechaHasta: '2026-06-30',
      }),
    );
    expect(mockCache.set).not.toHaveBeenCalled();
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('GET /:codigoCliente/pendientes allows JEFE_VENTAS when client is visible by CVC debt scope', async () => {
    const db = require('../config/db');
    db.queryWithParams.mockImplementation(async (sql) => {
      if (/DSEDAC\.CVC/i.test(sql)) return [{ OK: 1 }];
      if (/DSEDAC\.CLI/i.test(sql)) return [];
      return [{ OK: 1 }];
    });
    mockCobrosRepo.getPendientes.mockResolvedValue({
      cobros: [{ id: 'cvc-1', referencia: 'M-1' }],
      resumen: { totalPendiente: 100 },
    });

    const res = await request(makeApp(createCobrosRoutes(), {
      id: '98',
      code: '98',
      role: 'JEFE_VENTAS',
      isJefeVentas: true,
      vendorCodes: ['01', '02'],
    }))
      .get('/4300032258/pendientes')
      .query({ vendedorCodes: 'ALL', forceRefresh: '1' });

    expect(res.status).toBe(200);
    expect(mockCobrosRepo.getPendientes).toHaveBeenCalledWith(
      '4300032258',
      expect.objectContaining({
        userId: '98',
        userRole: 'JEFE_VENTAS',
        vendedorCodes: ['01', '02'],
      }),
    );
    expect(db.queryWithParams.mock.calls[0][0]).toMatch(/DSEDAC\.CVC/i);
    expect(db.queryWithParams.mock.calls.some(([sql]) => /DSEDAC\.CLI/i.test(sql))).toBe(false);
  });

  test('GET /:codigoCliente/pendientes masks generic repository SQL and ODBC errors', async () => {
    const repositoryError = new Error('SQL0802 ODBC raw conversion detail');
    repositoryError.odbcErrors = [{ state: '22003', code: -802, message: 'Numeric conversion failed' }];
    mockCobrosRepo.getPendientes.mockRejectedValue(repositoryError);

    const res = await request(makeApp(createCobrosRoutes())).get('/C001/pendientes');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      error: 'Error interno del servidor',
    });
    expect(JSON.stringify(res.body)).not.toContain('SQL0802');
    expect(JSON.stringify(res.body)).not.toContain('ODBC');
    expect(JSON.stringify(res.body)).not.toContain('conversion');
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

  test('GET /:codigoCliente/estado preserves LIMITECREDITO when DB2 column is available', async () => {
    const db = require('../config/db');
    mockCobrosRepo.getPendientes.mockResolvedValue({
      cobros: [],
      resumen: { totalPendiente: 25 },
    });
    db.queryWithParams.mockImplementation(async (sql) => {
      if (/QSYS2\.SYSCOLUMNS/i.test(sql)) return [{ COLUMN_NAME: 'LIMITECREDITO' }];
      if (/SELECT\s+LIMITECREDITO\s+FROM\s+DSEDAC\.CLI/i.test(sql)) return [{ LIMITECREDITO: 1500 }];
      return [{ OK: 1 }];
    });

    const res = await request(makeApp(createCobrosRoutes())).get('/C001/estado');

    expect(res.status).toBe(200);
    expect(res.body.estadoCliente.totalPendiente).toBe(25);
    expect(res.body.estadoCliente.limiteCredito).toBe(1500);
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

  test('POST /4300000354/registrar maps the DDD route client before repository insert', async () => {
    mockCobrosRepo.registerPayment.mockResolvedValue({ id: 'pay-real-client', status: 'REGISTRADO' });

    const res = await request(makeApp(createCobrosRoutes()))
      .post('/4300000354/registrar')
      .send({
        referencia: 'M-1',
        importe: 42,
        formaPago: 'CONTADO',
        idempotencyToken: 'cobro-token-route-real-client-001',
      });

    expect(res.status).toBe(200);
    expect(mockCobrosRepo.registerPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        clientCode: '4300000354',
        amount: 42,
        reference: 'M-1',
        idempotencyToken: 'cobro-token-route-real-client-001',
      }),
    );
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
    expect(res.body.error).toBe('Token de idempotencia reutilizado con otro payload');
  });

  test('GET /pending-summary/:vendedorCode delegates authorization to repository', async () => {
    mockCobrosRepo.getPendingSummary.mockResolvedValue({
      summary: { C001: { total: 42, count: 1 } },
      grandTotal: 42,
      clientCount: 1,
      source: 'CVC',
      pagination: { limit: 100, page: 1, offset: 0, returnedDocuments: 1 },
    });

    const res = await request(makeApp(createCobrosRoutes())).get('/pending-summary/01');

    expect(res.status).toBe(200);
    expect(mockCobrosRepo.getPendingSummary).toHaveBeenCalledWith(
      '01',
      expect.objectContaining({ userId: '01', userRole: 'COMERCIAL' }),
    );
    expect(res.body.grandTotal).toBe(42);
    expect(res.body.source).toBe('CVC');
    expect(res.body.pagination).toEqual({ limit: 100, page: 1, offset: 0, returnedDocuments: 1 });
  });

  test('GET /pending-summary/ALL clamps pagination and passes it to repository', async function () {
    mockCobrosRepo.getPendingSummary.mockResolvedValue({
      summary: {}, grandTotal: 0, grandTotalVencido: 0, clientCount: 0, source: 'CVC',
      pagination: { limit: 100, page: 1, offset: 0, returnedDocuments: 0 },
    });

    const res = await request(makeApp(createCobrosRoutes(), { id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true }))
      .get('/pending-summary/ALL')
      .query({ limit: '999', page: '0', offset: '-5' });

    expect(res.status).toBe(200);
    expect(mockCobrosRepo.getPendingSummary).toHaveBeenCalledWith(
      'ALL',
      expect.objectContaining({ limit: 100, page: 1, offset: 0 }),
    );
    expect(res.body).toMatchObject({
      success: true, summary: {}, grandTotal: 0, grandTotalVencido: 0, clientCount: 0, source: 'CVC',
      pagination: { limit: 100, page: 1, offset: 0, returnedDocuments: 0 },
    });
  });

  test('GET /pending-summary/ALL derives page from explicit offset', async function () {
    mockCobrosRepo.getPendingSummary.mockResolvedValue({
      summary: { C001: { nombre: 'Cliente Uno', total: 100, vencido: 0, count: 1, estado: 'PENDIENTE' } },
      grandTotal: 100, grandTotalVencido: 0, clientCount: 1, source: 'CVC',
      pagination: { limit: 25, page: 3, offset: 50, returnedDocuments: 1 },
    });

    const res = await request(makeApp(createCobrosRoutes(), { id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true }))
      .get('/pending-summary/ALL')
      .query({ limit: '25', offset: '50' });

    expect(res.status).toBe(200);
    expect(mockCobrosRepo.getPendingSummary).toHaveBeenCalledWith(
      'ALL',
      expect.objectContaining({ limit: 25, page: 3, offset: 50 }),
    );
    expect(res.body.pagination).toEqual({ limit: 25, page: 3, offset: 50, returnedDocuments: 1 });
    expect(res.body.summary.C001).toEqual({ nombre: 'Cliente Uno', total: 100, vencido: 0, count: 1, estado: 'PENDIENTE' });
  });

  test('GET /pending-summary/:vendedorCode forwards manager visible vendorCodes', async () => {
    mockCobrosRepo.getPendingSummary.mockResolvedValue({ summary: {}, grandTotal: 0, grandTotalVencido: 0, clientCount: 0, source: 'CVC', pagination: { limit: 100, page: 1, offset: 0, returnedDocuments: 0 } });

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
    db.queryWithParams.mockImplementation(async (sql) => {
      if (/DSEDAC\.CVC/i.test(sql) || /DSEDAC\.CLI/i.test(sql) || /DSEDAC\.CLP/i.test(sql) || /DSED\.LACLAE/i.test(sql)) {
        return [];
      }
      return [{ OK: 1 }];
    });

    const res = await request(makeApp(createCobrosRoutes())).get('/C999/historico');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockCobrosRepo.getHistorico).not.toHaveBeenCalled();
  });

  test('GET /:codigoCliente/pendientes rejects COMERCIAL outside vendor client scope when clientCodes absent', async () => {
    const db = require('../config/db');
    mockCobrosRepo.getPendientes.mockResolvedValue({
      cobros: [{ id: 'leak', referencia: 'M-1' }],
      resumen: { totalPendiente: 99 },
    });
    db.queryWithParams.mockImplementation(async (sql) => {
      if (/DSEDAC\.CLI/i.test(sql) || /DSEDAC\.CLP/i.test(sql) || /DSED\.LACLAE/i.test(sql)) {
        return [];
      }
      return [{ OK: 1 }];
    });

    const res = await request(makeApp(createCobrosRoutes(), { id: '01', code: '01', role: 'COMERCIAL' }))
      .get('/C999/pendientes');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockCobrosRepo.getPendientes).not.toHaveBeenCalled();
  });

  test('POST /register rejects COMERCIAL outside vendor client scope before registerPayment', async () => {
    const db = require('../config/db');
    db.queryWithParams.mockImplementation(async (sql) => {
      if (/DSEDAC\.CLI/i.test(sql) || /DSEDAC\.CLP/i.test(sql) || /DSED\.LACLAE/i.test(sql)) {
        return [];
      }
      return [{ OK: 1 }];
    });

    const res = await request(makeApp(createCobrosRoutes(), { id: '01', code: '01', role: 'COMERCIAL' }))
      .post('/register')
      .send({
        clientCode: 'C999',
        amount: 10,
        paymentMethod: 'CONTADO',
        reference: 'M-1',
        idempotencyToken: 'ddd-cobros-register-scope-001',
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockCobrosRepo.registerPayment).not.toHaveBeenCalled();
  });

  test('POST /:codigoCliente/registrar rejects COMERCIAL outside vendor client scope when clientCodes absent', async () => {
    const db = require('../config/db');
    db.queryWithParams.mockImplementation(async (sql) => {
      if (/DSEDAC\.CLI/i.test(sql) || /DSEDAC\.CLP/i.test(sql) || /DSED\.LACLAE/i.test(sql)) {
        return [];
      }
      return [{ OK: 1 }];
    });

    const res = await request(makeApp(createCobrosRoutes(), { id: '01', code: '01', role: 'COMERCIAL' }))
      .post('/C999/registrar')
      .send({
        referencia: 'M-1',
        importe: 10,
        formaPago: 'CONTADO',
        idempotencyToken: 'ddd-cobros-vendor-scope-001',
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockCobrosRepo.registerPayment).not.toHaveBeenCalled();
  });

  test('GET /:codigoCliente/estado rejects COMERCIAL outside vendor client scope when clientCodes absent', async () => {
    const db = require('../config/db');
    mockCobrosRepo.getPendientes.mockResolvedValue({
      cobros: [],
      resumen: { totalPendiente: 50 },
    });
    db.queryWithParams.mockImplementation(async (sql) => {
      if (/DSEDAC\.CLI/i.test(sql) || /DSEDAC\.CLP/i.test(sql) || /DSED\.LACLAE/i.test(sql)) {
        return [];
      }
      return [{ OK: 1 }];
    });

    const res = await request(makeApp(createCobrosRoutes(), { id: '01', code: '01', role: 'COMERCIAL' }))
      .get('/C999/estado');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockCobrosRepo.getPendientes).not.toHaveBeenCalled();
  });

  test('GET /:codigoCliente/pendientes blocks PEDIDOS_CAB fallback for out-of-scope client when clientCodes absent', async () => {
    const db = require('../config/db');
    db.queryWithParams.mockImplementation(async (sql) => {
      if (/DSEDAC\.CLI/i.test(sql) || /DSEDAC\.CLP/i.test(sql) || /DSED\.LACLAE/i.test(sql)) {
        return [];
      }
      if (/PEDIDOS_CAB/i.test(sql)) {
        return [{ ID: 99, IMPORTETOTAL: 120, ESTADO: 'CONFIRMADO' }];
      }
      return [];
    });
    mockCobrosRepo.getPendientes.mockResolvedValueOnce({
      cobros: [{ id: 'fallback-leak', referencia: 'PED-99' }],
      resumen: { totalPendiente: 120 },
    });

    const res = await request(makeApp(createCobrosRoutes(), { id: '01', code: '01', role: 'COMERCIAL' }))
      .get('/C999/pendientes');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockCobrosRepo.getPendientes).not.toHaveBeenCalled();
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
