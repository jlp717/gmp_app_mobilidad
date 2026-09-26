'use strict';

/**
 * HTTP cache contract for money routes (Tier-1 MEDIA).
 *
 * Documents and locks the REAL contract (see header block in
 * backend/middleware/http-cache.js): money paths are ALWAYS no-store at the
 * HTTP layer, whatever the query-layer TTLs do. No TTL or invalidation logic
 * is changed by this suite — it only pins the decision function and the
 * middleware's no-store response. Tested against the cache decision function,
 * never against real HTTP.
 */

const {
  cacheMiddleware,
  isMoneyNoStorePath,
  isSensitiveRepartoPath,
} = require('../middleware/http-cache');

function reqFor(url, { method = 'GET', user = { codigo: '80' } } = {}) {
  const [path, queryString] = String(url).split('?');
  return {
    method,
    path,
    originalUrl: url,
    baseUrl: '',
    query: Object.fromEntries(new URLSearchParams(queryString || '')),
    headers: {},
    user,
  };
}

function resCapture() {
  const headers = {};
  const res = {
    headersSent: false,
    writableEnded: false,
    locals: {},
    statusCode: 200,
    setHeader: jest.fn((name, value) => {
      headers[String(name).toLowerCase()] = String(value);
    }),
    getHeader: jest.fn((name) => headers[String(name).toLowerCase()]),
    json: jest.fn(),
    status: jest.fn(() => res),
    end: jest.fn(() => res),
  };
  return { res, headers };
}

describe('cache contract: money routes are no-store', () => {
  const moneyPaths = [
    '/api/cobros',
    '/api/cobros/2026-P-15-2296',
    '/api/cobros?page=2',
    '/api/repartidor-finanzas/diario?repartidorId=12',
    '/api/repartidor-finanzas/rutero/confirmations/112/receipt',
    '/api/liquidaciones/2026-09-25',
    '/api/repartidor/liquidaciones/cierre',
    '/api/entregas/pendientes?repartidorId=12',
  ];

  test.each(moneyPaths)('isMoneyNoStorePath(%s) === true', (url) => {
    expect(isMoneyNoStorePath(reqFor(url))).toBe(true);
  });

  const cacheablePaths = [
    '/api/dashboard/metrics',
    '/api/dashboard/sales-evolution',
    '/api/clients?page=1',
    '/api/products?search=toro',
    '/api/pedidos?estado=confirmado',
    '/api/facturas/2026-P-15-2296',
    '/api/commissions/resumen',
    '/api/objectives/actual',
    '/api/rutero/semana',
  ];

  test.each(cacheablePaths)('isMoneyNoStorePath(%s) === false', (url) => {
    expect(isMoneyNoStorePath(reqFor(url))).toBe(false);
  });

  test.each(moneyPaths)('cacheMiddleware(%s) responde no-store y delega sin cachear', (url) => {
    const { res, headers } = resCapture();
    const next = jest.fn();

    cacheMiddleware(reqFor(url), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(headers['cache-control']).toBe('private, no-store');
    expect(headers['x-cache-status']).toBeUndefined();
    expect(res.json).not.toHaveBeenCalled();
  });

  test('sensitive reparto evidence/receipt paths tambien son no-store', () => {
    const sensitive = [
      '/api/repartidor-finanzas/rutero/evidence/abc123',
      '/api/repartidor-finanzas/rutero/confirmations/112/receipt',
    ];
    for (const url of sensitive) {
      const req = reqFor(url);
      expect(isSensitiveRepartoPath(req)).toBe(true);
      const { res, headers } = resCapture();
      const next = jest.fn();
      cacheMiddleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(headers['cache-control']).toBe('private, no-store');
    }
  });

  test('rutas no-money no reciben no-store de este middleware', () => {
    const { res, headers } = resCapture();
    const next = jest.fn();
    // /api/health no es publica-cacheable ni money: pasa sin marca no-store
    // (las familias con cached() marcan MISS/HIT, nunca no-store aqui).
    cacheMiddleware(reqFor('/api/dashboard/metrics'), res, next);
    expect(headers['cache-control']).not.toBe('private, no-store');
  });
});
