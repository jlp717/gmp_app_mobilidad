'use strict';

/**
 * REQ-28 tanda5: historico de precios desde pedidos canónicos (mock DB2).
 * - No mantiene una segunda tabla TEST_PRECIO_HISTORICO susceptible de drift.
 * - GET product-price-history devuelve ultimo/%subida/competitivo.
 * - Cero DSEDAC: solo lectura ARA (tarifa 1) + tabla TEST.
 */

const { resolveAppProfile } = require('../../config/app-profile');
const testProfile = resolveAppProfile({ APP_ENV: 'test' });
const testProfileEnv = {
  APP_ENV: 'test',
  ...testProfile.assignments,
};
const originalProfileEnv = Object.fromEntries(
  Object.keys(testProfileEnv).map((key) => [key, process.env[key]]),
);

function loadService({ historicoRows = [], araRows = [] } = {}) {
  jest.resetModules();
  Object.assign(process.env, testProfileEnv);
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  jest.doMock('../../middleware/logger', () => logger);
  const queryWithParams = jest.fn(async (sql) => {
    const s = String(sql || '');
    if (s.includes('JAVIER.TEST_PEDIDOS_CAB') && s.includes('JAVIER.TEST_PEDIDOS_LIN')) {
      return historicoRows;
    }
    if (s.includes('ARA')) return araRows;
    return [];
  });
  jest.doMock('../../config/db', () => ({
    query: jest.fn(async () => []),
    queryWithParams,
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
  const svc = require('../../services/pedidos/index');
  return { svc, logger, queryWithParams };
}

afterAll(() => {
  for (const [key, value] of Object.entries(originalProfileEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('REQ-28 historico precios canónico (mock DB2)', () => {
  test('no duplica precios confirmados en una tabla histórica paralela', async () => {
    const { svc, queryWithParams } = loadService();
    const saved = await svc.savePrecioHistoricoTEST({
      clientCode: 'C001',
      lines: [
        { CODIGOARTICULO: 'P1', PRECIOVENTA: 10.5, CLASELINEA: 'VT' },
        // Regalos y precios 0 no se historifican.
        { CODIGOARTICULO: 'G1', PRECIOVENTA: 3, CLASELINEA: 'G' },
        { CODIGOARTICULO: 'P2', PRECIOVENTA: 0, CLASELINEA: 'VT' },
      ],
    });
    expect(saved).toBe(0);
    expect(queryWithParams).not.toHaveBeenCalled();
  });

  test('GET price-history devuelve ultimo + %subida + competitivo', async () => {
    const { svc, queryWithParams } = loadService({
      historicoRows: [
        { PRECIOVENTA: 10.5, FECHA: '2026-09-24-10.00.00.000000' },
        { PRECIOVENTA: 10.0, FECHA: '2026-09-20-10.00.00.000000' },
      ],
      araRows: [{ PRECIO: 9.5 }],
    });
    const res = await svc.getProductPriceHistory('P1', 'C001');
    expect(res).toMatchObject({
      productCode: 'P1',
      clientCode: 'C001',
      ultimoPrecio: 10.5,
      precioAnterior: 10.0,
      pctSubida: 5,
      competitivo: 9.5,
    });
    const statements = queryWithParams.mock.calls.map(([sql]) => String(sql)).join('\n');
    // Lectura DSEDAC.ARA (tarifa 1, solo lectura) + pedidos TEST canónicos.
    expect(statements).not.toMatch(/INSERT INTO\s+DSEDAC/i);
    expect(statements).not.toMatch(/UPDATE\s+DSEDAC/i);
    expect(statements).toContain('JAVIER.TEST_PEDIDOS_CAB');
    expect(statements).toContain('JAVIER.TEST_PEDIDOS_LIN');
    expect(statements).toMatch(/TRIM\(C\.ESTADO\)\s*=\s*'CONFIRMADO'/i);
    expect(statements).not.toContain('TEST_PRECIO_HISTORICO');
  });

  test('sin historico devuelve ceros sin romper', async () => {
    const { svc } = loadService({ historicoRows: [], araRows: [] });
    const res = await svc.getProductPriceHistory('PX', 'CX');
    expect(res).toMatchObject({ ultimoPrecio: 0, precioAnterior: 0, pctSubida: 0, competitivo: 0 });
  });
});
