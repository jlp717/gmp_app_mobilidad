'use strict';

const express = require('express');
const request = require('supertest');

const mockPedidosService = {
  getOrderVendorForAuth: jest.fn(),
};
const mockPedidosRepo = {
  getOrderById: jest.fn(),
};
const mockCache = {
  get: jest.fn(async () => null),
  set: jest.fn(),
  invalidatePattern: jest.fn(),
};

jest.mock('../../services/pedidos.service', () => mockPedidosService);
jest.mock('../../services/query-optimizer', () => ({ cachedQuery: jest.fn() }));
jest.mock('../../services/redis-cache', () => ({ TTL: { SHORT: 60, LONG: 3600 } }));
jest.mock('../../services/laclae', () => ({ getClientCodesFromCache: jest.fn() }));
jest.mock('../../config/db', () => ({ query: jest.fn(), queryWithParams: jest.fn() }));
jest.mock('../../src/modules/pedidos', () => ({
  Db2PedidosRepository: jest.fn(() => mockPedidosRepo),
}));
jest.mock('../../src/modules/cobros', () => ({ Db2CobrosRepository: jest.fn(() => ({})) }));
jest.mock('../../src/modules/entregas', () => ({ Db2EntregasRepository: jest.fn(() => ({})) }));
jest.mock('../../src/modules/rutero', () => ({ Db2RuteroRepository: jest.fn(() => ({})) }));
jest.mock('../../src/modules/auth', () => ({ Db2AuthRepository: jest.fn(() => ({})) }));
jest.mock('../../src/modules/clients/infrastructure/db2-client-repository', () => ({
  Db2ClientRepository: jest.fn(() => ({})),
}));
jest.mock('../../src/core/infrastructure/database/db2-connection-pool', () => ({
  Db2ConnectionPool: jest.fn(() => ({})),
}));
jest.mock('../../src/core/infrastructure/cache/response-cache', () => ({
  ResponseCache: jest.fn(() => mockCache),
}));
jest.mock('../../src/core/infrastructure/cache/performance-cache', () => ({
  performanceCache: { getTTL: jest.fn(() => 60), getOrFetch: jest.fn() },
}));

const { createPedidosRoutes } = require('../../src/shared/routes/ddd-adapters');

const commercialA = { id: '01', code: '01', role: 'COMERCIAL' };

function pedidoApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.user = commercialA;
    next();
  });
  app.use(createPedidosRoutes());
  return app;
}

describe('pedido ownership IDOR', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPedidosService.getOrderVendorForAuth.mockResolvedValue({
      id: 22,
      vendedorCode: '99',
      clientCode: 'C99',
    });
  });

  test('direct route guard rejects commercial A for commercial B order', async () => {
    const router = createPedidosRoutes();
    const handler = router.stack.find((layer) => layer.route?.path === '/:id([0-9]+)' && layer.route.methods.get)
      .route.stack[0].handle;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    await handler({ params: { id: '22' }, query: {}, user: commercialA }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, code: 'FORBIDDEN_VENDOR' }));
    expect(mockPedidosService.getOrderVendorForAuth).toHaveBeenCalledWith(22);
    expect(mockPedidosRepo.getOrderById).not.toHaveBeenCalled();
  });

  test('HTTP order lookup returns 403 before repository read', async () => {
    const response = await request(pedidoApp()).get('/22');
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ success: false, code: 'FORBIDDEN_VENDOR' });
    expect(mockPedidosRepo.getOrderById).not.toHaveBeenCalled();
  });
});
