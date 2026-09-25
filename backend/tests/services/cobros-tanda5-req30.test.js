'use strict';

/**
 * REQ-30 tanda5: registrarCobro (total y parcial) invalida liquidacion
 * (repartidor:liquidacion) y el desglose incluye el movimiento.
 * Mock DB2 + mock redis. Sin escrituras reales.
 */

const express = require('express');

function loadCobrosApp({ invalidateCache, queryImpl }) {
  jest.resetModules();
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  jest.doMock('../../middleware/logger', () => logger);
  const queryWithParams = jest.fn(queryImpl);
  jest.doMock('../../config/db', () => ({
    query: jest.fn(async () => []),
    queryWithParams,
    getPool: jest.fn(() => null),
    initDb: jest.fn(async () => null),
  }));
  jest.doMock('../../services/redis-cache', () => ({
    redisCache: { get: jest.fn(async () => null), set: jest.fn(async () => true) },
    TTL: { SHORT: 60, MEDIUM: 300, LONG: 1800, STATIC: 3600 },
    invalidateCache,
  }));
  jest.doMock('../../services/query-optimizer', () => ({
    cachedQuery: jest.fn(async (fn, sql) => fn(sql)),
    invalidateOnMutation: jest.fn(),
    patternFor: jest.fn((p) => p),
  }));
  const router = require('../../routes/cobros');
  const app = express();
  app.use(express.json());
  app.use('/api/cobros', router);
  return { app, logger, queryWithParams };
}

const baseQueryImpl = async (sql) => {
  const s = String(sql || '');
  // Cross-table REPARTIDOR_COBROS: nada cobrado por el repartidor.
  if (s.includes('TOTAL_REP')) return [{ TOTAL_REP: 0 }];
  // Replay/idempotency lookup: sin duplicados.
  if (s.includes('IDEMPOTENCY_TOKEN')) return [];
  // INSERT cobro + resto de lecturas.
  return [];
};

function token(suffix) {
  return `cobro:07:C001:DOC-${suffix}:${Date.now()}${suffix}`;
}

describe('REQ-30 registrarCobro invalida liquidacion (mock DB2)', () => {
  test.each([
    ['total', 100],
    ['parcial', 40],
  ])('cobro %s → 200 e invalida repartidor:liquidacion', async (_label, importe) => {
    const invalidateCache = jest.fn(async () => 0);
    const { app, queryWithParams } = loadCobrosApp({ invalidateCache, queryImpl: baseQueryImpl });
    const request = require('supertest');
    const res = await request(app)
      .post('/api/cobros/C001/registrar')
      .send({
        referencia: `SERIE-15-100${importe}`,
        importe,
        formaPago: 'EFECTIVO',
        tipoVenta: 'CC',
        tipoModo: 'NORMAL',
        tipoUsuario: 'REPARTIDOR',
        codigoUsuario: '07',
        observaciones: `REQ-30 ${_label}`,
        idempotencyToken: token(importe),
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const patterns = invalidateCache.mock.calls.map(([pattern]) => String(pattern));
    expect(patterns.some((p) => p.includes('repartidor:liquidacion'))).toBe(true);
    expect(patterns.some((p) => p.includes('repartidor:finance'))).toBe(true);
    // El INSERT del cobro usa binding (sin concatenar valores).
    const inserts = queryWithParams.mock.calls.filter(([sql]) => /INSERT INTO/i.test(String(sql)));
    expect(inserts.length).toBeGreaterThan(0);
    expect(String(inserts[0][0])).toContain('?');
  });
});

describe('REQ-30 desglose incluye el movimiento', () => {
  function serviceWithLedger(ledger) {
    const tx = {
      listStructuredEntries: jest.fn(async () => ledger),
    };
    const repository = {
      assertCapabilities: jest.fn(async () => undefined),
      withTransaction: jest.fn(async (work) => work(tx)),
    };
    const { createRepartidorLiquidacionService } = require('../../services/repartidor-liquidacion-service');
    return createRepartidorLiquidacionService({ repository });
  }

  const actor = { actorId: '07', actorRole: 'REPARTIDOR' };
  const emptyLedger = {
    closed: false, expenses: [], adjustments: [], bankDeposits: [],
  };

  test('cobro total aparece en desglose con su importe', async () => {
    const service = serviceWithLedger({
      ...emptyLedger,
      payments: [{
        id: 'COB-TOTAL-1', amount: 100, paymentMethod: 'EF',
        collectedAt: '2026-09-24T10:00:00.000Z',
        codigoCliente: 'C001', tipoDocumento: 'ALB', documento: 'ALB P-15-2296',
      }],
    });
    const res = await service.getDayEntries({ repartidorId: '07', date: '2026-09-24' }, actor);
    expect(res.payments).toHaveLength(1);
    expect(res.payments[0]).toMatchObject({ id: 'COB-TOTAL-1', amount: 100 });
    expect(res.totals.payments).toBe(100);
    expect(JSON.stringify(res)).not.toMatch(/idempotencyToken|actorId/i);
  });

  test('cobros parciales suman en el total del desglose', async () => {
    const service = serviceWithLedger({
      ...emptyLedger,
      payments: [
        { id: 'COB-P-1', amount: 40, paymentMethod: 'EF', collectedAt: '2026-09-24T10:00:00.000Z' },
        { id: 'COB-P-2', amount: 60, paymentMethod: 'TJ', collectedAt: '2026-09-24T11:00:00.000Z' },
      ],
    });
    const res = await service.getDayEntries({ repartidorId: '07', date: '2026-09-24' }, actor);
    expect(res.payments).toHaveLength(2);
    expect(res.totals.payments).toBe(100);
  });

  test('ledger sin payments (repositorio antiguo) sigue devolviendo []', async () => {
    const service = serviceWithLedger(emptyLedger);
    const res = await service.getDayEntries({ repartidorId: '07', date: '2026-09-24' }, actor);
    expect(res.payments).toEqual([]);
    expect(res.totals.payments).toBe(0);
  });
});
