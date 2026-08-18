'use strict';

const express = require('express');
const request = require('supertest');

let mockUser = { id: 'V94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };
const SIGNATURE_EVIDENCE_ID = `ev_${'a'.repeat(64)}`;
jest.mock('../middleware/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = mockUser && { ...mockUser }; next(); },
  requireRoles: () => (_req, _res, next) => next(),
}));
jest.mock('../services/repartidor-finance-service', () => ({}));
jest.mock('../services/redis-cache', () => ({ deleteCachePattern: jest.fn().mockResolvedValue(undefined) }));

const routes = require('../routes/repartidor-finanzas');

function app() {
  const value = express();
  value.use(express.json());
  value.use('/finanzas', routes);
  return value;
}

function payload(repartidorId = '94') {
  return {
    delivery: {
      itemId: 'delivery-security-1', status: 'ENTREGADO', repartidorId,
      occurredAt: '2026-04-23T11:30:00.000Z', firma: SIGNATURE_EVIDENCE_ID,
      receiver: { nombre: 'Ana', apellidos: 'Lopez Ruiz', dni: '12345678Z' },
      lineas: [{ lineaId: '1', codigoArticulo: 'ART-1', cantidadPedida: 1, cantidadEntregada: 1, cantidadRechazada: 0, cantidadPendiente: 0 }],
    },
  };
}

describe('canonical reparto confirmation authorization', () => {
  beforeEach(() => {
    routes.setCanonicalConfirmationRuntime({
      catalogService: { validateConfirmation: jest.fn().mockResolvedValue(undefined) },
      confirmationService: { confirm: jest.fn().mockResolvedValue({ created: true, confirmationId: '1' }) },
    });
  });
  afterEach(() => {
    mockUser = { id: 'V94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };
    routes.resetCanonicalConfirmationRuntime();
  });

  test.each([
    [{ id: 'C1', code: 'C1', role: 'COMERCIAL' }],
    [{ id: 'J1', code: 'J1', role: 'JEFE_VENTAS', isJefeVentas: true }],
    [{ id: 'J1', code: 'J1', role: 'JEFE_VENTAS', activeMode: 'COMERCIAL', isJefeVentas: true }],
  ])('rejects non-reparto role with 403', async (user) => {
    mockUser = user;
    const response = await request(app()).post('/finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'route-role-denied').send(payload());
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ success: false, code: 'REPARTO_CONFIRMATION_ROLE_REQUIRED' });
  });

  test('allows JEFE in Perfil Reparto mode past the confirmation role gate', async () => {
    mockUser = {
      id: 'V98',
      code: '98',
      role: 'JEFE_VENTAS',
      activeMode: 'REPARTIDOR',
      repartidorCodes: ['05'],
      isJefeVentas: true,
    };
    const response = await request(app()).post('/finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'route-jefe-supervision').send(payload('05'));
    // Role gate passed; ownership/catalog may still reject the fake payload.
    expect(response.status).not.toBe(403);
    expect(response.body.code).not.toBe('REPARTO_CONFIRMATION_ROLE_REQUIRED');
  });

  test('requires an authenticated actor with 401', async () => {
    mockUser = null;
    const response = await request(app()).post('/finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'route-actor-missing').send(payload());
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ success: false, code: 'AUTHENTICATED_ACTOR_REQUIRED' });
  });

  test('rejects a repartidor attempting to confirm another repartidor document', async () => {
    const response = await request(app()).post('/finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'route-owner-denied').send(payload('95'));
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ success: false, code: 'DELIVERY_OWNERSHIP_REQUIRED' });
  });
});
