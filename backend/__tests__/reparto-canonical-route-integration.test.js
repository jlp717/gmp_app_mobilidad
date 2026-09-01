'use strict';

const express = require('express');
const request = require('supertest');
const { RepartoPersistenceError } = require('../services/reparto-confirmation-service');
const { RepartoCatalogError } = require('../services/reparto-catalog-service');

const SIGNATURE_EVIDENCE_ID = `ev_${'a'.repeat(64)}`;

jest.mock('../middleware/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => {
    req.user = { id: 'V94', code: '94', role: 'REPARTIDOR', activeMode: 'REPARTIDOR', repartidorCodes: ['94'] };
    next();
  },
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

function body() {
  return {
    delivery: {
      itemId: 'delivery-94-1',
      status: 'ENTREGADO',
      repartidorId: '94',
      occurredAt: '2026-04-23T11:30:00.000Z',
      receiver: { nombre: 'Ana', apellidos: 'Lopez Ruiz', dni: '12345678Z' },
      firma: SIGNATURE_EVIDENCE_ID,
      lineas: [{
        lineaId: '1', codigoArticulo: 'ART-1', cantidadPedida: 2,
        cantidadEntregada: 2, cantidadRechazada: 0, cantidadPendiente: 0,
      }],
    },
  };
}

function inject({ validateConfirmation, confirm } = {}) {
  const catalogService = { validateConfirmation: validateConfirmation || jest.fn().mockResolvedValue(undefined) };
  const confirmationService = { confirm: confirm || jest.fn().mockResolvedValue({
    created: true, idempotent: false, confirmationId: '81', deliveryStatus: 'ENTREGADO', cobroId: null,
  }) };
  routes.setCanonicalConfirmationRuntime({ catalogService, confirmationService });
  return { catalogService, confirmationService };
}

describe('canonical reparto confirmation route', () => {
  afterEach(() => {
    routes.resetCanonicalConfirmationRuntime();
    routes.setCanonicalConfirmationTimeoutMs(30000);
  });

  test('fails closed with 503 by default and never falls back to legacy finance persistence', async () => {
    const response = await request(app())
      .post('/finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'route-default-503')
      .send(body());

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ success: false, code: 'REPARTO_CATALOG_UNAVAILABLE' });
  });

  test('validates catalog before persistence and returns 201 for a created confirmation', async () => {
    const calls = [];
    const ports = inject({
      validateConfirmation: jest.fn(async (command) => { calls.push(['catalog', command]); }),
      confirm: jest.fn(async (command) => { calls.push(['persist', command]); return {
        created: true, idempotent: false, confirmationId: '81', deliveryStatus: 'ENTREGADO', cobroId: null,
      }; }),
    });

    const response = await request(app())
      .post('/finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'route-created-201')
      .send(body());

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ success: true, confirmationId: '81', created: true });
    expect(calls.map(([step]) => step)).toEqual(['catalog', 'persist']);
    expect(ports.confirmationService.confirm.mock.calls[0][0]).toMatchObject({
      idempotencyKey: 'route-created-201', actor: { repartidorId: '94' }, delivery: { repartidorId: '94' },
    });
  });

  test('returns 200 for an exact replay and 409 for typed idempotency conflict', async () => {
    inject({ confirm: jest.fn()
      .mockResolvedValueOnce({ created: false, idempotent: true, confirmationId: '81', deliveryStatus: 'ENTREGADO', cobroId: null })
      .mockRejectedValueOnce(new RepartoPersistenceError('Clave reutilizada', { code: 'IDEMPOTENCY_CONFLICT', statusCode: 409 })),
    });
    const first = await request(app()).post('/finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'route-replay-200').send(body());
    const conflict = await request(app()).post('/finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'route-conflict-409').send(body());

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ success: true, created: false, idempotent: true });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ success: false, code: 'IDEMPOTENCY_CONFLICT' });
  });

  test('returns catalog validation errors without calling persistence', async () => {
    const confirmationService = { confirm: jest.fn() };
    routes.setCanonicalConfirmationRuntime({
      catalogService: { validateConfirmation: jest.fn().mockRejectedValue(new RepartoCatalogError('Estado invalido', {
        code: 'REPARTO_CATALOG_VALUE_UNKNOWN', statusCode: 422,
      })) },
      confirmationService,
    });

    const response = await request(app()).post('/finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'route-catalog-422').send(body());

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ success: false, code: 'REPARTO_CATALOG_VALUE_UNKNOWN' });
    expect(confirmationService.confirm).not.toHaveBeenCalled();
  });

    test('returns a sanitized 504 when confirmation persistence never resolves', async () => {
      routes.setCanonicalConfirmationTimeoutMs(5);
      let signalSeen;
      const confirmationService = {
        confirm: jest.fn((_command, { signal }) => {
          signalSeen = signal;
          return new Promise(() => {});
        }),
      };
    routes.setCanonicalConfirmationRuntime({
      catalogService: { validateConfirmation: jest.fn().mockResolvedValue(undefined) },
      confirmationService,
    });

    const response = await request(app())
      .post('/finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'route-timeout-504')
      .send(body());

    expect(response.status).toBe(504);
      expect(response.body).toEqual({
        success: false,
        code: 'REPARTO_CONFIRMATION_TIMEOUT',
        error: 'Servicio temporalmente no disponible',
      });
      expect(signalSeen).toBeInstanceOf(AbortSignal);
      expect(signalSeen.aborted).toBe(true);
    });
});
