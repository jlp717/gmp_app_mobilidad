'use strict';

const express = require('express');
const request = require('supertest');

Object.assign(process.env, {
  REPARTO_ENVIRONMENT: 'test', REPARTO_TABLE_SET: 'isolated_test',
  REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24', ODBC_DSN: 'GMP',
  REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC', REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
  REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER', REPARTO_WRITES_ENABLED: 'true',
  REPARTO_PRODUCTION_WRITES_APPROVED: 'false', JWT_ACCESS_SECRET: 'test-jwt-secret-for-testing-only',
});

let mockUser = { id: '94', code: '94', role: 'REPARTIDOR' };
const mockFinance = { getDailySummary: jest.fn(), getSummary: jest.fn(), getSaldoActual: jest.fn() };

jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { ...mockUser }; next(); },
  requireRoles: () => (_req, _res, next) => next(),
}));
jest.mock('../middleware/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../services/repartidor-finance-service', () => mockFinance);
jest.mock('../services/redis-cache', () => ({ deleteCachePattern: jest.fn().mockResolvedValue(undefined) }));

const routes = require('../routes/repartidor-finanzas');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/finanzas', routes);
  return app;
}

function body(overrides = {}) {
  return {
    repartidorId: '94', date: '2026-08-09',
    idempotencyToken: 'liquidacion-route-test-0001', sendEmails: false,
    ...overrides,
  };
}

describe('repartidor liquidation route boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: '94', code: '94', role: 'REPARTIDOR' };
    routes.resetCanonicalLiquidacionService();
  });
  afterEach(() => routes.resetCanonicalLiquidacionService());

  test('fails closed with 503 when no transactional liquidation port is wired', async () => {
    const result = await request(makeApp()).post('/finanzas/liquidaciones').send(body());
    expect(result.status).toBe(503);
    expect(result.body.code).toBe('LIQUIDACION_CAPABILITY_UNAVAILABLE');
  });

  test('structured writer also fails closed with 503 when no canonical port is wired', async () => {
    const result = await request(makeApp()).post('/finanzas/liquidaciones/gastos').send({
      repartidorId: '94', date: '2026-08-09', amount: 8.25,
      category: 'PEAJE', idempotencyToken: 'expense-route-00000001',
    });
    expect(result.status).toBe(503);
    expect(result.body.code).toBe('LIQUIDACION_CAPABILITY_UNAVAILABLE');
  });

  test.each(['totals', 'snapshot', 'deliveries', 'payments', 'expenses', 'adjustments', 'bankDeposits', 'openingBalance', 'pending', 'balance'])(
    'rejects client-derived %s with 422 before the service', async (field) => {
      const closeDay = jest.fn();
      routes.setCanonicalLiquidacionService({ closeDay });
      const result = await request(makeApp()).post('/finanzas/liquidaciones').send(body({ [field]: [] }));
      expect(result.status).toBe(422);
      expect(result.body.code).toBe('LIQUIDACION_CLIENT_DERIVED_FIELDS_FORBIDDEN');
      expect(closeDay).not.toHaveBeenCalled();
    },
  );

  test('delegates only the minimal command and authenticated actor', async () => {
    const outboxIntent = { type: 'REPARTIDOR_LIQUIDACION_EMAIL', liquidacionId: '701', status: 'PENDING' };
    const closeDay = jest.fn().mockResolvedValue({ created: true, liquidacion: { id: '701' }, outboxIntent });
    routes.setCanonicalLiquidacionService({ closeDay });
    const input = body({ matricula: '1234ABC' });
    const result = await request(makeApp()).post('/finanzas/liquidaciones').send(input);
    expect(result.status).toBe(201);
    expect(result.body.outboxIntent).toEqual(outboxIntent);
    expect(closeDay).toHaveBeenCalledWith(input, { actorId: '94', actorRole: 'REPARTIDOR' });
  });

  test('defaults sendEmails to true at the HTTP boundary', async () => {
    const closeDay = jest.fn().mockResolvedValue({
      created: true,
      liquidacion: { id: '701' },
      outboxIntent: { type: 'REPARTIDOR_LIQUIDACION_EMAIL' },
      outboxId: 9,
    });
    routes.setCanonicalLiquidacionService({ closeDay });
    const input = body();
    delete input.sendEmails;
    const result = await request(makeApp()).post('/finanzas/liquidaciones').send(input);
    expect(result.status).toBe(201);
    expect(closeDay.mock.calls[0][0]).toMatchObject({ sendEmails: true });
  });

  test('returns 200 for replay and maps typed application errors', async () => {
    routes.setCanonicalLiquidacionService({
      closeDay: jest.fn()
        .mockResolvedValueOnce({ created: false, liquidacion: { id: '701' } })
        .mockRejectedValueOnce(Object.assign(new Error('closed'), { code: 'LIQUIDACION_DAY_ALREADY_CLOSED', statusCode: 409 })),
    });
    expect((await request(makeApp()).post('/finanzas/liquidaciones').send(body())).status).toBe(200);
    const conflict = await request(makeApp()).post('/finanzas/liquidaciones').send(body());
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('LIQUIDACION_DAY_ALREADY_CLOSED');
  });

  test('denies another driver before service access', async () => {
    const closeDay = jest.fn();
    routes.setCanonicalLiquidacionService({ closeDay });
    expect((await request(makeApp()).post('/finanzas/liquidaciones').send(body({ repartidorId: '95' }))).status).toBe(403);
    expect(closeDay).not.toHaveBeenCalled();
  });

  test.each([
    ['/finanzas/liquidaciones/gastos', 'createExpense', { amount: 8.25, category: 'PEAJE', idempotencyToken: 'expense-route-00000001' }, 'EXPENSE'],
    ['/finanzas/liquidaciones/ingresos-bancarios', 'createBankDeposit', { amount: 30, reference: 'TRX-42', idempotencyToken: 'deposit-route-00000001' }, 'BANK_DEPOSIT'],
  ])('creates owner structured input at %s with the Flutter response contract', async (path, method, fields, type) => {
    const handler = jest.fn().mockResolvedValue({ created: true, entry: {
      id: '501', type, repartidorId: '94', date: '2026-08-09', ...fields,
      idempotencyToken: undefined, status: 'PENDING', createdAt: '2026-08-09T10:00:00.000Z',
    } });
    routes.setCanonicalLiquidacionService({ closeDay: jest.fn(), [method]: handler });
    const result = await request(makeApp()).post(path).send({ repartidorId: '94', date: '2026-08-09', ...fields });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ success: true, created: true, entry: { type, status: 'PENDING' } });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ repartidorId: '94', date: '2026-08-09' }), {
      actorId: '94', actorRole: 'REPARTIDOR',
    });
  });

  test('returns 200 for exact entry replay and 409 for mismatched token identity', async () => {
    const createExpense = jest.fn()
      .mockResolvedValueOnce({ created: false, entry: { id: '501', type: 'EXPENSE', status: 'PENDING' } })
      .mockRejectedValueOnce(Object.assign(new Error('token mismatch'), {
        code: 'LIQUIDACION_ENTRY_REPLAY_MISMATCH', statusCode: 409,
      }));
    routes.setCanonicalLiquidacionService({ closeDay: jest.fn(), createExpense });
    const payload = { repartidorId: '94', date: '2026-08-09', amount: 8.25,
      category: 'PEAJE', idempotencyToken: 'expense-route-00000001' };
    expect((await request(makeApp()).post('/finanzas/liquidaciones/gastos').send(payload)).status).toBe(200);
    const conflict = await request(makeApp()).post('/finanzas/liquidaciones/gastos').send(payload);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('LIQUIDACION_ENTRY_REPLAY_MISMATCH');
  });

  test('allows only JEFE_VENTAS or ADMIN to create a signed adjustment', async () => {
    const createAdjustment = jest.fn().mockResolvedValue({ created: true, entry: { id: '601' } });
    routes.setCanonicalLiquidacionService({ closeDay: jest.fn(), createAdjustment });
    const payload = { repartidorId: '94', date: '2026-08-09', amount: -2,
      reason: 'DIFERENCIA', idempotencyToken: 'adjustment-route-000001' };
    expect((await request(makeApp()).post('/finanzas/liquidaciones/ajustes').send(payload)).status).toBe(403);
    expect(createAdjustment).not.toHaveBeenCalled();
    mockUser = { id: '7', code: '7', role: 'JEFE_VENTAS', isJefeVentas: true };
    expect((await request(makeApp()).post('/finanzas/liquidaciones/ajustes').send(payload)).status).toBe(201);
  });

  test.each([
    [{ amount: '8.25' }, 'amount'],
    [{ date: '2026-02-30' }, 'date'],
    [{ idempotencyToken: 'x'.repeat(129) }, 'idempotencyToken'],
    [{ unknown: true }, 'unknown'],
  ])('returns 422 for invalid structured input field %s', async (override) => {
    const createExpense = jest.fn();
    routes.setCanonicalLiquidacionService({ closeDay: jest.fn(), createExpense });
    const payload = { repartidorId: '94', date: '2026-08-09', amount: 8.25,
      category: 'PEAJE', idempotencyToken: 'expense-route-00000001', ...override };
    const result = await request(makeApp()).post('/finanzas/liquidaciones/gastos').send(payload);
    expect(result.status).toBe(422);
    expect(result.body.code).toBe('INVALID_LIQUIDACION_ENTRY');
    expect(createExpense).not.toHaveBeenCalled();
  });

  test('returns daily server-derived structured breakdown without PII', async () => {
    const getDayEntries = jest.fn().mockResolvedValue({
      repartidorId: '94', date: '2026-08-09', status: 'OPEN', expenses: [], adjustments: [],
      bankDeposits: [], totals: { expenses: 0, adjustments: 0, bankDeposits: 0 },
    });
    routes.setCanonicalLiquidacionService({ closeDay: jest.fn(), getDayEntries });
    const result = await request(makeApp()).get('/finanzas/liquidaciones/94/desglose').query({ date: '2026-08-09' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ success: true, ledger: expect.objectContaining({ status: 'OPEN' }) });
    expect(getDayEntries).toHaveBeenCalledWith({ repartidorId: '94', date: '2026-08-09' }, {
      actorId: '94', actorRole: 'REPARTIDOR',
    });
  });

  test('disables cobro reversal explicitly at the daily-summary top level', async () => {
    mockFinance.getDailySummary.mockResolvedValue({
      repartidorId: '94', canReverseCobros: true, summary: { canReverseCobros: true },
    });
    const result = await request(makeApp()).get('/finanzas/daily-summary/94').query({ date: '2026-08-09' });
    expect(result.status).toBe(200);
    expect(result.body.canReverseCobros).toBe(false);
  });

  test('legacy resend endpoint cannot bypass the canonical outbox', async () => {
    const result = await request(makeApp())
      .post('/finanzas/liquidaciones/liquidacion-route-test-0001/resend-emails').send({});
    expect(result.status).toBe(503);
    expect(result.body.code).toBe('LIQUIDACION_OUTBOX_RESEND_UNAVAILABLE');
    expect(mockFinance.findLiquidacionByToken).toBeUndefined();
  });

  test.each([
    ['/daily-summary/ALL', 'getDailySummary'], ['/summary/ALL', 'getSummary'], ['/cuentas/ALL', 'getSaldoActual'],
  ])('rejects ALL for %s with 422 before service', async (path, method) => {
    const result = await request(makeApp()).get(`/finanzas${path}`);
    expect(result.status).toBe(422);
    expect(result.body.code).toBe('UNSUPPORTED_REPARTIDOR_SELECTOR');
    expect(mockFinance[method]).not.toHaveBeenCalled();
  });

  test.each(['/daily-summary/94,95', '/summary/94,95', '/cuentas/94,95'])(
    'denies a multi-selector to a driver: %s', async (path) => {
      const result = await request(makeApp()).get(`/finanzas${path}`);
      expect(result.status).toBe(403);
      expect(result.body.code).toBe('MULTIPLE_REPARTIDOR_SELECTOR_FORBIDDEN');
    },
  );

  test('allows JEFE_VENTAS an explicit multi-selector on all list endpoints', async () => {
    mockUser = { id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true };
    mockFinance.getDailySummary.mockResolvedValue({ repartidorId: '94,95', summary: {} });
    mockFinance.getSummary.mockResolvedValue({ repartidorId: '94,95', summary: {} });
    mockFinance.getSaldoActual.mockResolvedValue(4);
    expect((await request(makeApp()).get('/finanzas/daily-summary/94,95').query({ date: '2026-08-09' })).status).toBe(200);
    expect((await request(makeApp()).get('/finanzas/summary/94,95').query({ year: 2026, month: 8 })).status).toBe(200);
    expect((await request(makeApp()).get('/finanzas/cuentas/94,95')).status).toBe(200);
  });

  test('maps cuentas daily summary failure instead of fabricating ultimoCierre', async () => {
    mockFinance.getSaldoActual.mockResolvedValue(4);
    mockFinance.getDailySummary.mockRejectedValue(Object.assign(new Error('temporarily unavailable'), {
      code: 'REPARTO_SCHEMA_UNAVAILABLE', statusCode: 503,
    }));
    const result = await request(makeApp()).get('/finanzas/cuentas/94');
    expect(result.status).toBe(503);
    expect(result.body.code).toBe('REPARTO_SCHEMA_UNAVAILABLE');
    expect(result.body.cuenta).toBeUndefined();
  });
});
