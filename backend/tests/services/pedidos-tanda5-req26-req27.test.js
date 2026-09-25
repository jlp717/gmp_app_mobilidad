'use strict';

const gates = require('../../services/pedidos-comercial-gates');

function loadPedidosService() {
  jest.resetModules();
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  jest.doMock('../../middleware/logger', () => logger);
  jest.doMock('../../config/db', () => ({
    query: jest.fn(async () => []),
    queryWithParams: jest.fn(async () => []),
    getPool: jest.fn(() => null),
    initDb: jest.fn(async () => null),
  }));
  jest.doMock('../../services/redis-cache', () => ({
    redisCache: { get: jest.fn(async () => null), set: jest.fn(async () => true), invalidatePattern: jest.fn(async () => 0) },
    TTL: { SHORT: 60, MEDIUM: 300, LONG: 1800, STATIC: 3600 },
    deleteCachePattern: jest.fn(async () => 0),
  }));
  jest.doMock('../../services/query-optimizer', () => ({
    cachedQuery: jest.fn(async (fn, sql) => fn(sql)),
    invalidateOnMutation: jest.fn(),
    patternFor: jest.fn((p) => p),
  }));
  return require('../../services/pedidos/index');
}

describe('REQ-26 gate min-cobro CTR exento', () => {
  test('CT/CTR/CONTADO exentos', () => {
    expect(gates.isContadoExemptSaleType('CT')).toBe(true);
    expect(gates.isContadoExemptSaleType('CTR')).toBe(true);
    expect(gates.isContadoExemptSaleType('contado')).toBe(true);
    expect(gates.isContadoExemptSaleType('CC')).toBe(false);
  });

  test('assert exento no bloquea sin cartera', async () => {
    const gate = await gates.assertMinCobroAllowsOrder({ clientCode: 'C1', vendorCode: '01', saleType: 'CT' });
    expect(gate.blocked).toBe(false);
  });

  test('normalize acepta CT/CTR', () => {
    const svc = loadPedidosService();
    expect(svc.normalizePedidoSaleType('CTR')).toBe('CT');
    expect(svc.normalizePedidoSaleType('CT')).toBe('CT');
  });
});

describe('REQ-27 minimo politica tarifa1', () => {
  test('competitivo 10 + margen 20% => minimo 12.5', () => {
    const svc = loadPedidosService();
    expect(svc.resolvePrecioMinimoPolitica(10, 20)).toBeCloseTo(12.5, 4);
    expect(svc.resolvePrecioMinimoPolitica(0, 20)).toBe(0);
  });

  test('margen configurable por env, no hardcode fijo', () => {
    const svc = loadPedidosService();
    process.env.MARGEN_OBJETIVO_PCT = '25';
    expect(svc.resolveMargenObjetivoPct({})).toBe(25);
    expect(svc.resolvePrecioMinimoPolitica(10, svc.resolveMargenObjetivoPct({}))).toBeCloseTo(13.3333, 3);
    delete process.env.MARGEN_OBJETIVO_PCT;
  });
});
