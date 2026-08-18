'use strict';

const express = require('express');
const request = require('supertest');

let mockUser = { id: 'V08', code: '08', role: 'REPARTIDOR', repartidorCodes: ['08'] };

jest.mock('../middleware/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = mockUser && { ...mockUser }; next(); },
  requireRoles: () => (_req, _res, next) => next(),
}));
jest.mock('../services/redis-cache', () => ({
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
  invalidateCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/repartidor-finance-service', () => ({
  getSummary: jest.fn(),
  reverseCobro: jest.fn(),
}));

const financeService = require('../services/repartidor-finance-service');
const routes = require('../routes/repartidor-finanzas');
const { buildConfirmationCommand } = require('../services/reparto-confirmation-contract');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/finanzas', routes);
  return instance;
}

function confirmationPayload(repartidorId) {
  return {
    delivery: {
      itemId: '2026-S-10-404-4300009479',
      repartidorId,
      status: 'ENTREGADO',
      occurredAt: '2026-08-18T09:00:00.000Z',
      receiver: { nombre: 'Ana', apellidos: 'Lopez Ruiz', dni: '12345678Z' },
      firma: `ev_${'a'.repeat(64)}`,
      lineas: [{
        lineaId: '1', codigoArticulo: 'ART-1', cantidadPedida: 1,
        cantidadEntregada: 1, cantidadRechazada: 0, cantidadPendiente: 0,
      }],
    },
  };
}

function confirmationRequest(user, repartidorId) {
  return buildConfirmationCommand({
    user,
    headers: { 'idempotency-key': 'fleet-scope-contract-1' },
    body: confirmationPayload(repartidorId),
  });
}

describe('finance fleet authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: 'V08', code: '08', role: 'REPARTIDOR', repartidorCodes: ['08'] };
    financeService.getSummary.mockResolvedValue({ repartidorId: '8', summary: {} });
    financeService.reverseCobro.mockResolvedValue({ reversed: true });
    routes.resetCanonicalConfirmationRuntime();
  });

  afterAll(() => routes.resetCanonicalConfirmationRuntime());

  test('REPARTIDOR accepts its numeric-equivalent code and rejects a foreign code', async () => {
    let response = await request(app()).get('/finanzas/summary/8?year=2026&month=8');
    expect(response.status).toBe(200);
    expect(financeService.getSummary).toHaveBeenCalledTimes(1);

    financeService.getSummary.mockClear();
    response = await request(app()).get('/finanzas/summary/9?year=2026&month=8');
    expect(response.status).toBe(403);
    expect(financeService.getSummary).not.toHaveBeenCalled();
  });

  test('JEFE reparto can read only codes in authenticated fleet claims', async () => {
    mockUser = {
      id: 'V98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR',
      repartidorCodes: ['08', '09'], vendedorCodes: ['09'],
    };

    let response = await request(app()).get('/finanzas/summary/8,09?year=2026&month=8');
    expect(response.status).toBe(200);
    expect(financeService.getSummary).toHaveBeenCalledTimes(1);

    financeService.getSummary.mockClear();
    response = await request(app()).get('/finanzas/summary/08,10?year=2026&month=8');
    expect(response.status).toBe(403);
    expect(financeService.getSummary).not.toHaveBeenCalled();
  });

  test('JEFE missing fleet scope fails closed before finance service', async () => {
    mockUser = { id: 'V98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' };
    const response = await request(app()).get('/finanzas/summary/08?year=2026&month=8');
    expect(response.status).toBe(403);
    expect(financeService.getSummary).not.toHaveBeenCalled();
  });

  test('ADMIN has explicit concrete finance access while ALL remains unsupported', async () => {
    mockUser = { id: 'A1', code: '1', role: 'ADMIN', activeMode: 'REPARTIDOR', repartidorCodes: ['77'] };
    let response = await request(app()).get('/finanzas/summary/77?year=2026&month=8');
    expect(response.status).toBe(200);

    financeService.getSummary.mockClear();
    response = await request(app()).get('/finanzas/summary/ALL?year=2026&month=8');
    expect(response.status).toBe(422);
    expect(financeService.getSummary).not.toHaveBeenCalled();
  });

  test('finance mutation rejects foreign or absent JEFE scope before service', async () => {
    const body = { idempotencyToken: 'fleet-reverse-0001', repartidorId: '08', reason: 'Duplicado' };
    mockUser = {
      id: 'V98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', repartidorCodes: ['08'],
    };
    let response = await request(app()).post('/finanzas/cobros/reverse').send(body);
    expect(response.status).toBe(200);
    expect(financeService.reverseCobro).toHaveBeenCalledTimes(1);

    financeService.reverseCobro.mockClear();
    response = await request(app()).post('/finanzas/cobros/reverse')
      .send({ ...body, repartidorId: '09' });
    expect(response.status).toBe(403);
    expect(financeService.reverseCobro).not.toHaveBeenCalled();

    mockUser = { id: 'V98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' };
    response = await request(app()).post('/finanzas/cobros/reverse').send(body);
    expect(response.status).toBe(403);
    expect(financeService.reverseCobro).not.toHaveBeenCalled();
  });
});

describe('confirmation fleet authorization', () => {
  test('JEFE reparto selects only a visible owner and canonicalizes 8 to 08', () => {
    const command = confirmationRequest({
      id: 'V98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR',
      repartidorCodes: ['08'],
    }, '8');
    expect(command.actor).toMatchObject({ role: 'JEFE_VENTAS', repartidorId: '08' });
    expect(command.delivery.repartidorId).toBe('08');
  });
  test('canonicalizes a numeric fleet claim independently from request spelling', () => {
    const command = confirmationRequest({
      id: 'V98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR',
      repartidorCodes: ['8'],
    }, '08');
    expect(command.actor.repartidorId).toBe('08');
    expect(command.delivery.repartidorId).toBe('08');
  });


  test.each([
    [{ id: 'V98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' }, '08'],
    [{
      id: 'V98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', repartidorCodes: ['08'],
    }, '09'],
    [{ id: 'V08', code: '08', role: 'REPARTIDOR', repartidorCodes: ['08'] }, '09'],
  ])('rejects missing scope or foreign confirmation ownership', (user, target) => {
    expect(() => confirmationRequest(user, target)).toThrow(expect.objectContaining({
      code: 'DELIVERY_OWNERSHIP_REQUIRED', statusCode: 403,
    }));
  });

  test.each(['ALL', '08,09'])('rejects non-concrete confirmation selector %s', (target) => {
    expect(() => confirmationRequest({ id: 'A1', code: '1', role: 'ADMIN', activeMode: 'REPARTIDOR', repartidorCodes: ['77'] }, target))
      .toThrow(expect.objectContaining({ statusCode: 422 }));
  });

  test('ADMIN can confirm for an explicit concrete owner', () => {
    expect(confirmationRequest({ id: 'A1', code: '1', role: 'ADMIN', activeMode: 'REPARTIDOR', repartidorCodes: ['77'] }, '77').actor)
      .toMatchObject({ role: 'ADMIN', repartidorId: '77', privileged: true });
  });

  test('HTTP confirmation rejects foreign JEFE owner before catalog and persistence', async () => {
    const validateConfirmation = jest.fn().mockResolvedValue(undefined);
    const confirm = jest.fn().mockResolvedValue({ created: true, confirmationId: '1' });
    routes.setCanonicalConfirmationRuntime({
      catalogService: { validateConfirmation }, confirmationService: { confirm },
    });
    mockUser = {
      id: 'V98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', repartidorCodes: ['08'],
    };

    let response = await request(app()).post('/finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'fleet-route-denied-1').send(confirmationPayload('09'));
    expect(response.status).toBe(403);
    expect(validateConfirmation).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();

    response = await request(app()).post('/finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'fleet-route-allowed-1').send(confirmationPayload('8'));
    expect(response.status).toBe(201);
    expect(validateConfirmation).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
