'use strict';

// Route-boundary regression tests.  They deliberately replace DB2 and auth
// infrastructure so every assertion proves the HTTP guard runs before a
// service (and therefore before a possible DB call).
const express = require('express');
const request = require('supertest');

Object.assign(process.env, {
  REPARTO_ENVIRONMENT: 'test',
  REPARTO_TABLE_SET: 'isolated_test',
  REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
  ODBC_DSN: 'GMP',
  REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
  REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
  REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
  REPARTO_WRITES_ENABLED: 'true',
  REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
});

const mockQuery = jest.fn();
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const mockCaptureException = jest.fn();
let mockAuthMode = 'ok';
let mockAuthUser = { id: '94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };

jest.mock('../config/db', () => ({
  queryWithParams: (...args) => mockQuery(...args),
  getPool: () => ({ connect: jest.fn() }),
}));
jest.mock('../middleware/logger', () => mockLogger);
jest.mock('@sentry/node', () => ({ captureException: mockCaptureException }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, res, next) => {
    if (mockAuthMode === 'missing') return res.status(401).json({ success: false, code: 'AUTH_REQUIRED' });
    req.user = { ...mockAuthUser };
    return next();
  },
  requireRoles: (...roles) => (req, res, next) => (
    roles.includes(req.user?.role) ? next() : res.status(403).json({ success: false, code: 'ROLE_REQUIRED' })
  ),
}));

const routes = require('../routes/repartidor-finanzas');
const financeService = require('../services/repartidor-finance-service');
const repartoVarianceNotificationService = require('../services/reparto-variance-notification-service');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/finanzas', routes);
  return instance;
}

const validCobro = () => ({
  codigoCliente: '4300009479', codigoRepartidor: '94', tipoDocumento: 'ALB',
  ejercicioDocumento: 2026, serieDocumento: 'S', terminalDocumento: 10,
  numeroDocumento: 404, importeCobrado: 10, formaPago: 'EFECTIVO',
  idempotencyToken: 'cobro-gap-0001',
});
const validClose = () => ({ repartidorId: '94', date: '2026-08-10', idempotencyToken: 'close-gap-0001' });
const validTiers = () => ({ tiers: [{ thresholdPct: 30, commissionPct: 1 }] });

function expectNoInfrastructure(spy) {
  expect(mockQuery).not.toHaveBeenCalled();
  if (spy) expect(spy).not.toHaveBeenCalled();
}

describe('repartidor finance HTTP guard coverage', () => {
  let server;

  beforeEach(() => {
    jest.restoreAllMocks();
    Object.values(mockLogger).forEach((spy) => spy.mockClear());
    mockCaptureException.mockClear();
    mockQuery.mockReset();
    mockAuthMode = 'ok';
    mockAuthUser = { id: '94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };
    routes.resetCanonicalLiquidacionService();
    server = app();
  });

  afterEach(() => routes.resetCanonicalLiquidacionService());

  test.each([
    ['post', '/cobros', validCobro],
    ['post', '/cobros/reverse', () => ({ idempotencyToken: 'reverse-gap-0001', repartidorId: '94', reason: 'Duplicado' })],
    ['post', '/liquidaciones', validClose],
    ['post', '/liquidaciones/reopen-gap-0001/reopen', () => undefined],
    ['post', '/liquidaciones/resend-gap-0001/resend-emails', () => undefined],
    ['get', '/commissions/tiers', () => undefined],
    ['put', '/commissions/tiers', validTiers],
    ['get', '/cuentas/94', () => undefined],
    ['get', '/evolution/94', () => undefined],
    ['get', '/vencimientos/94/ALB-2026-S-10-404-1/detalle', () => undefined],
  ])('returns 401 before infrastructure for %s %s', async (method, path, body) => {
    mockAuthMode = 'missing';
    const response = await request(server)[method](`/finanzas${path}`).send(body());
    expect(response.status).toBe(401);
    expectNoInfrastructure();
  });

  test('cobros rejects another driver before validation or service access', async () => {
    const spy = jest.spyOn(financeService, 'registerCobro');
    const response = await request(server).post('/finanzas/cobros').send({ ...validCobro(), codigoRepartidor: '95' });
    expect(response.status).toBe(403);
    expectNoInfrastructure(spy);
  });

  test('cobros rejects an ill-typed body before its service', async () => {
    const spy = jest.spyOn(financeService, 'registerCobro');
    const response = await request(server).post('/finanzas/cobros').send({ ...validCobro(), importeCobrado: 'not-money' });
    expect(response.status).toBe(400);
    expectNoInfrastructure(spy);
  });

  test('cobros returns success without coupling the HTTP response to email resolution', async () => {
    const spy = jest.spyOn(financeService, 'registerCobro').mockResolvedValue({ created: true, cobro: { id: '1' } });
    const notifySpy = jest.spyOn(repartoVarianceNotificationService, 'notifyAfterCobro').mockResolvedValue({ skipped: false, attempted: 0 });
    const response = await request(server).post('/finanzas/cobros').send(validCobro());
    expect(response.status).toBe(201);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ codigoRepartidor: '94', operador: '94' }));
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ created: true }) }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('reverse cobro enforces ownership, validates input, and preserves fail-closed 503', async () => {
    const spy = jest.spyOn(financeService, 'reverseCobro');
    let response = await request(server).post('/finanzas/cobros/reverse').send({ idempotencyToken: 'reverse-gap-0001', repartidorId: '95', reason: 'Duplicado' });
    expect(response.status).toBe(403);
    expectNoInfrastructure(spy);

    response = await request(server).post('/finanzas/cobros/reverse').send({ idempotencyToken: 'short', repartidorId: '94', reason: '' });
    expect(response.status).toBe(400);
    expectNoInfrastructure(spy);

    spy.mockRejectedValue(Object.assign(new Error('No habilitado'), { code: 'REPARTO_SCHEMA_UNAVAILABLE', statusCode: 503 }));
    response = await request(server).post('/finanzas/cobros/reverse').send({ idempotencyToken: 'reverse-gap-0001', repartidorId: '94', reason: 'Duplicado' });
    expect(response.status).toBe(503);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('reverse cobro never trusts an inconsistent jefe boolean or a jefe outside reparto mode', async () => {
    const spy = jest.spyOn(financeService, 'reverseCobro').mockResolvedValue({ reversed: true });
    const command = { idempotencyToken: 'reverse-gap-0002', repartidorId: '95', reason: 'Duplicado' };

    mockAuthUser = { id: '94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'], isJefeVentas: true };
    let response = await request(server).post('/finanzas/cobros/reverse').send(command);
    expect(response.status).toBe(403);
    expectNoInfrastructure(spy);

    mockAuthUser = { id: '7', code: '7', role: 'JEFE_VENTAS' };
    response = await request(server).post('/finanzas/cobros/reverse').send(command);
    expect(response.status).toBe(403);
    expectNoInfrastructure(spy);

    mockAuthUser = { id: '7', code: '7', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', repartidorCodes: ['95'] };
    response = await request(server).post('/finanzas/cobros/reverse').send(command);
    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      repartidorId: '95', allowAcrossRepartidores: true,
    }));
  });

  test('liquidacion close guards ownership and derived client totals before the canonical service', async () => {
    const closeDay = jest.fn();
    routes.setCanonicalLiquidacionService({ closeDay });
    let response = await request(server).post('/finanzas/liquidaciones').send({ ...validClose(), repartidorId: '95' });
    expect(response.status).toBe(403);
    expectNoInfrastructure(closeDay);

    response = await request(server).post('/finanzas/liquidaciones').send({ ...validClose(), totals: { totalEfectivo: 1 } });
    expect(response.status).toBe(422);
    expectNoInfrastructure(closeDay);
  });

  test('liquidacion close delegates valid input and returns canonical 201', async () => {
    const closeDay = jest.fn().mockResolvedValue({ created: true, liquidacion: { id: 'L1' }, outboxIntent: null });
    routes.setCanonicalLiquidacionService({ closeDay });
    const response = await request(server).post('/finanzas/liquidaciones').send(validClose());
    expect(response.status).toBe(201);
    expect(closeDay).toHaveBeenCalledWith(
      expect.objectContaining({ ...validClose(), sendEmails: true }),
      expect.objectContaining({ actorId: '94', actorRole: 'REPARTIDOR' }),
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('typed DB2 failure never forwards raw diagnostics to logger or Sentry', async () => {
    const secret = ['private', 'client', 'token', 'and', 'SQL', 'value'].join('-');
    const raw = Object.assign(new Error(secret), {
      code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE', statusCode: 503,
      stack: `stack ${secret}`, sql: `SELECT '${secret}'`, params: [secret],
      odbcErrors: [{ state: '42703', code: -204, message: secret }],
    });
    const closeDay = jest.fn().mockRejectedValue(raw);
    routes.setCanonicalLiquidacionService({ closeDay });

    const response = await request(server).post('/finanzas/liquidaciones').send(validClose());

    expect(response.status).toBe(503);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException.mock.calls[0][0]).toEqual({
      name: 'RepartidorFinanzasIncident',
      code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE',
      statusCode: 503,
    });
    const telemetry = JSON.stringify(mockCaptureException.mock.calls);
    const logs = JSON.stringify(mockLogger.error.mock.calls);
    expect(`${telemetry}${logs}`).not.toContain(secret);
    expect(`${telemetry}${logs}`).not.toMatch(/SELECT|stack|odbcErrors|params/i);
  });

  test('reopen validates the token and remains explicitly unavailable', async () => {
    let response = await request(server).post('/finanzas/liquidaciones/short/reopen');
    expect(response.status).toBe(400);
    expectNoInfrastructure();
    response = await request(server).post('/finanzas/liquidaciones/reopen-gap-0001/reopen');
    expect(response.status).toBe(501);
    expect(response.body.code).toBe('LIQUIDACION_REOPEN_RULE_UNDEFINED');
    expectNoInfrastructure();
  });

  test('resend emails validates its token then blocks the legacy direct-email path', async () => {
    const spy = jest.spyOn(financeService, 'findLiquidacionByToken');
    let response = await request(server).post('/finanzas/liquidaciones/short/resend-emails');
    expect(response.status).toBe(400);
    expectNoInfrastructure(spy);

    response = await request(server).post('/finanzas/liquidaciones/resend-gap-0001/resend-emails');
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('LIQUIDACION_OUTBOX_RESEND_UNAVAILABLE');
    expect(spy).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('commission tiers permit authenticated reads, restrict writes by role, and validate writes first', async () => {
    let spy = jest.spyOn(financeService, 'getCommissionTiers').mockResolvedValue([{ thresholdPct: 0, commissionPct: 1 }]);
    let response = await request(server).get('/finanzas/commissions/tiers');
    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();

    spy = jest.spyOn(financeService, 'saveCommissionTiers');
    response = await request(server).put('/finanzas/commissions/tiers').send(validTiers());
    expect(response.status).toBe(403);
    expectNoInfrastructure(spy);

    mockAuthUser = { id: '1', code: '1', role: 'ADMIN', activeMode: 'REPARTIDOR' };
    response = await request(server).put('/finanzas/commissions/tiers').send({ tiers: [] });
    expect(response.status).toBe(400);
    expectNoInfrastructure(spy);
  });

  test('JEFE finance privilege requires active reparto mode and ignores inconsistent boolean flags', async () => {
    const summary = jest.spyOn(financeService, 'getSummary');
    mockAuthUser = { id: '94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'], isJefeVentas: true };
    let response = await request(server).get('/finanzas/summary/95');
    expect(response.status).toBe(403);
    expect(summary).not.toHaveBeenCalled();

    const save = jest.spyOn(financeService, 'saveCommissionTiers').mockResolvedValue(validTiers().tiers);
    mockAuthUser = { id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true };
    response = await request(server).put('/finanzas/commissions/tiers').send(validTiers());
    expect(response.status).toBe(403);
    expect(save).not.toHaveBeenCalled();

    mockAuthUser.activeMode = 'REPARTIDOR';
    response = await request(server).put('/finanzas/commissions/tiers').send(validTiers());
    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('vencimiento detail rejects ALL and CSV before service access', async () => {
    mockAuthUser = { id: '98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' };
    const detail = jest.spyOn(financeService, 'getDetalleVencimiento');
    for (const selector of ['ALL', '94,95']) {
      const response = await request(server)
        .get('/finanzas/vencimientos/' + selector + '/ALB-2026-S-10-404-1/detalle');
      expect(response.status).toBe(422);
    }
    expect(detail).not.toHaveBeenCalled();
  });

  test('commission tier writes delegate only with a permitted role and valid body', async () => {
    mockAuthUser = { id: '1', code: '1', role: 'ADMIN', activeMode: 'REPARTIDOR' };
    const spy = jest.spyOn(financeService, 'saveCommissionTiers').mockResolvedValue(validTiers().tiers);
    const response = await request(server).put('/finanzas/commissions/tiers').send(validTiers());
    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledWith({ tiers: validTiers().tiers, updatedBy: '1' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test.each([
    ['cuentas', '/cuentas/95', 'getSaldoActual'],
    ['evolution', '/evolution/95', 'getEvolution'],
    ['vencimiento detalle', '/vencimientos/95/ALB-2026-S-10-404-1/detalle', 'getDetalleVencimiento'],
  ])('%s denies cross-driver ownership before service access', async (_name, path, method) => {
    const spy = jest.spyOn(financeService, method);
    const response = await request(server).get(`/finanzas${path}`);
    expect(response.status).toBe(403);
    expectNoInfrastructure(spy);
  });

  test('cuentas validates a malformed selector before its services', async () => {
    const saldo = jest.spyOn(financeService, 'getSaldoActual');
    const daily = jest.spyOn(financeService, 'getDailySummary');
    const response = await request(server).get('/finanzas/cuentas/94$');
    expect(response.status).toBe(400);
    expectNoInfrastructure(saldo);
    expect(daily).not.toHaveBeenCalled();
  });

  test('evolution and detalle delegate valid owned reads without route DB access', async () => {
    const evolution = jest.spyOn(financeService, 'getEvolution').mockResolvedValue([]);
    const products = jest.spyOn(financeService, 'getTopProducts').mockResolvedValue([]);
    let response = await request(server).get('/finanzas/evolution/94');
    expect(response.status).toBe(200);
    expect(evolution).toHaveBeenCalledWith('94');
    expect(products).toHaveBeenCalledWith('94');

    const detalle = jest.spyOn(financeService, 'getDetalleVencimiento').mockResolvedValue({ documento: 'ALB' });
    response = await request(server).get('/finanzas/vencimientos/94/ALB-2026-S-10-404-1/detalle');
    expect(response.status).toBe(200);
    expect(detalle).toHaveBeenCalledWith(expect.objectContaining({ repartidorId: '94', numero: 404 }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('detalle rejects malformed document id before service access', async () => {
    const spy = jest.spyOn(financeService, 'getDetalleVencimiento');
    const response = await request(server).get('/finanzas/vencimientos/94/not-a-document/detalle');
    expect(response.status).toBe(400);
    expectNoInfrastructure(spy);
  });
});
