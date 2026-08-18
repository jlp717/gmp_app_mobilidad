'use strict';

const express = require('express');
const request = require('supertest');

const mockConfirm = jest.fn();
const mockValidateCatalog = jest.fn();
let mockAuthUser = { id: 'V94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };
const EVIDENCE_SIGNATURE_ID = `ev_${'a'.repeat(64)}`;
const EVIDENCE_PHOTO_ID = `ev_${'b'.repeat(64)}`;

jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => {
    req.user = { ...mockAuthUser };
    next();
  },
  requireRoles: () => (_req, _res, next) => next(),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../services/repartidor-finance-service', () => ({
  confirmRuteroDeliveryWithCobro: (...args) => mockConfirm(...args),
}));

jest.mock('../services/redis-cache', () => ({
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
  invalidateCache: jest.fn().mockResolvedValue(undefined),
}));

const routes = require('../routes/repartidor-finanzas');

function makeApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/repartidor-finanzas', routes);
  return app;
}

function receiver() {
  return { nombre: 'Ana', apellidos: 'Lopez Ruiz', dni: '12345678Z' };
}

function line(overrides = {}) {
  return {
    lineaId: '1',
    codigoArticulo: 'ART-1',
    cantidadPedida: 4,
    cantidadEntregada: 4,
    cantidadRechazada: 0,
    cantidadPendiente: 0,
    motivoDiferencia: null,
    ...overrides,
  };
}

function delivery(overrides = {}) {
  return {
    itemId: '2026-S-10-404-4300009479',
    status: 'ENTREGADO',
    occurredAt: '2026-08-03T11:30:00.000Z',
    receiver: receiver(),
    lineas: [line()],
    firma: EVIDENCE_SIGNATURE_ID,
    observaciones: 'Entrega comprobada',
    ...overrides,
  };
}

function payment() {
  return {
    entregaId: '2026-S-10-404-4300009479',
    importeCobrado: 84.5,
    formaPago: 'EFECTIVO',
  };
}

function noDelivery(overrides = {}) {
  return delivery({
    status: 'NO_ENTREGADO',
    receiver: undefined,
    firma: undefined,
    observaciones: 'Cliente ausente en el domicilio',
    incidencia: {
      tipo: 'CLIENTE_AUSENTE',
      motivo: 'No responde tras dos intentos de contacto',
    },
    lineas: [line({
      cantidadEntregada: 0,
      cantidadPendiente: 4,
      motivoDiferencia: 'CLIENTE_AUSENTE',
    })],
    ...overrides,
  });
}

async function post(deliveryPayload, { cobro, key = 'delivery-2026-S-10-404-validation' } = {}) {
  let call = request(makeApp())
    .post('/api/repartidor-finanzas/rutero/confirm-delivery-cobro')
    .set('Idempotency-Key', key);
  return call.send({
    delivery: deliveryPayload,
    ...(cobro ? { cobro } : {}),
  });
}

describe('structured reparto confirmation validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = { id: 'V94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };
    mockValidateCatalog.mockResolvedValue(undefined);
    mockConfirm.mockResolvedValue({ created: true, idempotent: false });
    routes.setCanonicalConfirmationRuntime({
      confirmationService: { confirm: (...args) => mockConfirm(...args) },
      catalogService: { validateConfirmation: (...args) => mockValidateCatalog(...args) },
    });
  });

  afterAll(() => {
    routes.resetCanonicalConfirmationRuntime();
  });

  test.each([
    ['ENTREGADO', delivery()],
    ['PARCIAL', delivery({
      status: 'PARCIAL',
      lineas: [line({
        cantidadEntregada: 2,
        cantidadRechazada: 1,
        cantidadPendiente: 1,
        motivoDiferencia: 'PRODUCTO_DANADO',
      })],
    })],
    ['RECHAZADO', delivery({
      status: 'RECHAZADO',
      lineas: [line({
        cantidadEntregada: 0,
        cantidadRechazada: 4,
        motivoDiferencia: 'RECHAZO_CLIENTE',
      })],
    })],
    ['NO_ENTREGADO', noDelivery()],
  ])('accepts %s with conserved structured quantities', async (status, payload) => {
    const res = await post(payload, {
      key: `delivery-2026-S-10-404-${status.toLowerCase()}`,
    });

    expect(res.status).toBe(201);
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      delivery: expect.objectContaining({
        status,
        repartidorId: '94',
        lineas: expect.arrayContaining([
          expect.objectContaining({
            cantidadPedida: 4,
            cantidadEntregada: expect.any(Number),
            cantidadRechazada: expect.any(Number),
            cantidadPendiente: expect.any(Number),
          }),
        ]),
      }),
    }));
  });

  test.each([
    ['empty line list on PARCIAL', delivery({ status: 'PARCIAL', lineas: [] })],
    ['negative quantities', delivery({
      lineas: [line({ cantidadEntregada: -1, cantidadPendiente: 5 })],
    })],
    ['string quantities', delivery({
      lineas: [line({ cantidadEntregada: '4' })],
    })],
    ['broken conservation', delivery({
      status: 'PARCIAL',
      lineas: [line({
        cantidadEntregada: 2,
        cantidadPendiente: 1,
        motivoDiferencia: 'PRODUCTO_FALTANTE',
      })],
    })],
    ['difference without structured reason', delivery({
      status: 'PARCIAL',
      lineas: [line({ cantidadEntregada: 2, cantidadPendiente: 2 })],
    })],
    ['complete state with pending quantity', delivery({
      lineas: [line({
        cantidadEntregada: 3,
        cantidadPendiente: 1,
        motivoDiferencia: 'PRODUCTO_FALTANTE',
      })],
    })],
    ['partial state without delivered units', delivery({
      status: 'PARCIAL',
      lineas: [line({
        cantidadEntregada: 0,
        cantidadPendiente: 4,
        motivoDiferencia: 'PRODUCTO_FALTANTE',
      })],
    })],
    ['rejected state without all units rejected', delivery({
      status: 'RECHAZADO',
      lineas: [line({
        cantidadEntregada: 0,
        cantidadRechazada: 3,
        cantidadPendiente: 1,
        motivoDiferencia: 'RECHAZO_CLIENTE',
      })],
    })],
    ['missing receiver', delivery({ receiver: undefined })],
    ['missing receiver surname', delivery({ receiver: { ...receiver(), apellidos: '' } })],
    ['invalid DNI', delivery({ receiver: { ...receiver(), dni: '1234' } })],
    ['missing signature', delivery({ firma: undefined })],
    ['malformed signature evidence id', delivery({ firma: 'signature-opaque-id-404' })],
    ['malformed photo evidence id', delivery({ evidencias: ['photo-opaque-id-404'] })],
    ['duplicate photo evidence ids', delivery({ evidencias: [EVIDENCE_PHOTO_ID, EVIDENCE_PHOTO_ID] })],
    ['signature repeated as photo evidence', delivery({ evidencias: [EVIDENCE_SIGNATURE_ID] })],
    ['non-delivery without incidence', noDelivery({ incidencia: undefined })],
  ])('returns typed 422 for %s before persistence', async (_label, payload) => {
    const res = await post(payload);

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      success: false,
      code: 'INVALID_DELIVERY_PAYLOAD',
    });
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  test.each([
    [80, 201],
    [81, 201],
    [100, 201],
    [101, 422],
  ])('accepts receiver.nombre through %i characters and rejects it at the contract boundary above that limit', async (length, expectedStatus) => {
    const res = await post(delivery({
      receiver: { ...receiver(), nombre: 'A'.repeat(length) },
    }), {
      key: `delivery-2026-S-10-404-receiver-${length}`,
    });

    expect(res.status).toBe(expectedStatus);
    if (expectedStatus === 201) {
      expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
        delivery: expect.objectContaining({
          receiver: expect.objectContaining({ nombre: 'A'.repeat(length) }),
        }),
      }));
    } else {
      expect(res.body).toMatchObject({
        success: false,
        code: 'INVALID_DELIVERY_PAYLOAD',
      });
      expect(mockConfirm).not.toHaveBeenCalled();
    }
  });

  test.each(['NO_ENTREGADO', 'RECHAZADO'])('rejects a cobro for %s', async (status) => {
    const payload = status === 'NO_ENTREGADO'
      ? noDelivery()
      : delivery({
        status: 'RECHAZADO',
        lineas: [line({
          cantidadEntregada: 0,
          cantidadRechazada: 4,
          motivoDiferencia: 'RECHAZO_CLIENTE',
        })],
      });

    const res = await post(payload, { cobro: payment() });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      success: false,
      code: 'INVALID_DELIVERY_PAYLOAD',
    });
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  test('accepts prepaid ENTREGADO with an empty line list', async () => {
    const res = await post(delivery({ lineas: [] }));

    expect(res.status).toBe(201);
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      delivery: expect.objectContaining({ status: 'ENTREGADO', lineas: [] }),
    }));
  });

  test('permits payment only on a deliverable partial state', async () => {
    const payload = delivery({
      status: 'PARCIAL',
      lineas: [line({
        cantidadEntregada: 2,
        cantidadPendiente: 2,
        motivoDiferencia: 'PRODUCTO_FALTANTE',
      })],
    });

    const res = await post(payload, { cobro: payment() });

    expect(res.status).toBe(201);
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      cobro: expect.objectContaining({ importeCobrado: 84.5 }),
    }));
  });
});
