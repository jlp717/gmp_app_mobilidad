'use strict';

const express = require('express');
const request = require('supertest');

const mockConfirmRuteroDelivery = jest.fn();
const mockValidateCatalog = jest.fn();
const mockQueryWithParams = jest.fn();
const mockExportEntregaToSystem = jest.fn();
let mockAuthUser = { id: 'V94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };
const SIGNATURE_EVIDENCE_ID = `ev_${'a'.repeat(64)}`;

jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));

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
  confirmRuteroDeliveryWithCobro: (...args) => mockConfirmRuteroDelivery(...args),
}));

jest.mock('../services/redis-cache', () => ({
  TTL: { REALTIME: 0, SHORT: 60, MEDIUM: 300, LONG: 3600 },
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
  invalidateCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/query-optimizer', () => ({
  cachedQuery: (queryFn, sql, _cacheKey, _ttl, params) => queryFn(sql, params),
}));

jest.mock('../utils/delivery-status-check', () => ({
  isDeliveryStatusAvailable: jest.fn(() => false),
  isDeliveryStatusNewSchema: jest.fn(() => false),
  getDeliveryStatusJoin: jest.fn(() => ''),
  getDeliveryStatusColumns: jest.fn(() => "CAST(NULL AS VARCHAR(20)) AS DS_STATUS"),
}));

jest.mock('../services/emailPdfService', () => ({
  sendEmailWithPdf: jest.fn(),
  generateInvoiceEmailHtml: jest.fn(),
  generateDeliveryEmailHtml: jest.fn(),
  cachePdf: jest.fn(),
  getCachedPdf: jest.fn(),
}));

jest.mock('../app/services/pdfService', () => ({
  generateInvoicePDF: jest.fn(),
}));

jest.mock('../app/services/deliveryReceiptService', () => ({
  generateDeliveryReceipt: jest.fn(),
}));

jest.mock('../services/circuit-breaker', () => ({
  CircuitBreaker: class CircuitBreaker {
    constructor(options) {
      this.options = options;
    }
  },
}));

jest.mock('../services/facturas.service', () => ({}));
jest.mock('../services/pdf.service', () => ({}));

jest.mock('../services/dsedac-exports.service', () => ({
  exportEntregaToSystem: (...args) => mockExportEntregaToSystem(...args),
}));

const finanzasRoutes = require('../routes/repartidor-finanzas');
const legacyRepartidorRoutes = require('../routes/repartidor');

function makeApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/repartidor-finanzas', finanzasRoutes);
  app.use('/api/repartidor', legacyRepartidorRoutes);
  return app;
}

function deliveryPayload(overrides = {}) {
  return {
    itemId: '2026-S-10-404-4300009479',
    status: 'ENTREGADO',
    occurredAt: '2026-08-03T11:30:00.000Z',
    receiver: {
      nombre: 'Ana',
      apellidos: 'Lopez Ruiz',
      dni: '12345678Z',
    },
    lineas: [{
      lineaId: '1',
      codigoArticulo: 'ART-1',
      cantidadPedida: 4,
      cantidadEntregada: 4,
      cantidadRechazada: 0,
      cantidadPendiente: 0,
      motivoDiferencia: null,
    }],
    firma: SIGNATURE_EVIDENCE_ID,
    observaciones: 'Entrega comprobada',
    latitud: 37.6,
    longitud: -1.7,
    ...overrides,
  };
}

function paymentPayload(overrides = {}) {
  return {
    entregaId: '2026-S-10-404-4300009479',
    importeCobrado: 189.6,
    formaPago: 'EFECTIVO',
    ...overrides,
  };
}

describe('canonical reparto confirmation contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = { id: 'V94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };
    mockQueryWithParams.mockResolvedValue([]);
    mockValidateCatalog.mockResolvedValue(undefined);
    mockConfirmRuteroDelivery.mockResolvedValue({
      created: true,
      idempotent: false,
      deliveryStatus: 'ENTREGADO',
      cobroId: '901',
    });
    finanzasRoutes.setCanonicalConfirmationRuntime({
      confirmationService: { confirm: (...args) => mockConfirmRuteroDelivery(...args) },
      catalogService: { validateConfirmation: (...args) => mockValidateCatalog(...args) },
    });
  });

  afterAll(() => {
    finanzasRoutes.resetCanonicalConfirmationRuntime();
  });

  test('accepts a paid delivery and derives both ownership and operator from req.user', async () => {
    const res = await request(makeApp())
      .post('/api/repartidor-finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'delivery-2026-S-10-404-paid')
      .send({ delivery: deliveryPayload(), cobro: paymentPayload() });

    expect(res.status).toBe(201);
    expect(mockConfirmRuteroDelivery).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'delivery-2026-S-10-404-paid',
      actor: expect.objectContaining({
        userId: 'V94',
        repartidorId: '94',
      }),
      delivery: expect.objectContaining({
        repartidorId: '94',
        receiver: expect.objectContaining({ dni: '12345678Z' }),
        lineas: expect.arrayContaining([
          expect.objectContaining({ cantidadPedida: 4, cantidadEntregada: 4 }),
        ]),
      }),
      cobro: expect.objectContaining({
        importeCobrado: 189.6,
      }),
    }), { signal: expect.any(AbortSignal) });
  });

  test('accepts an unpaid delivery without manufacturing a cobro', async () => {
    mockConfirmRuteroDelivery.mockResolvedValue({
      created: true,
      idempotent: false,
      deliveryStatus: 'ENTREGADO',
      cobroId: null,
    });

    const res = await request(makeApp())
      .post('/api/repartidor-finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'delivery-2026-S-10-404-unpaid')
      .send({ delivery: deliveryPayload() });

    expect(res.status).toBe(201);
    expect(mockConfirmRuteroDelivery).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'delivery-2026-S-10-404-unpaid',
      delivery: expect.objectContaining({ repartidorId: '94' }),
      cobro: undefined,
    }), { signal: expect.any(AbortSignal) });
  });

  test('rejects a missing Idempotency-Key even when a legacy body token is supplied', async () => {
    const res = await request(makeApp())
      .post('/api/repartidor-finanzas/rutero/confirm-delivery-cobro')
      .send({
        delivery: deliveryPayload({ repartidorId: '94' }),
        cobro: paymentPayload({
          codigoRepartidor: '94',
          idempotencyToken: 'legacy-body-token-404',
        }),
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
    expect(mockConfirmRuteroDelivery).not.toHaveBeenCalled();
  });

  test('rejects a malformed Idempotency-Key before invoking the service', async () => {
    const res = await request(makeApp())
      .post('/api/repartidor-finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'short')
      .send({ delivery: deliveryPayload(), cobro: paymentPayload() });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      success: false,
      code: 'INVALID_IDEMPOTENCY_KEY',
    });
    expect(mockConfirmRuteroDelivery).not.toHaveBeenCalled();
  });

  test('fails closed with 403 when a repartidor token lacks signed reparto claims', async () => {
    mockAuthUser = { id: 'V94', code: '94', role: 'REPARTIDOR' };

    const res = await request(makeApp())
      .post('/api/repartidor-finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'delivery-2026-S-10-404-missing-fleet')
      .send({ delivery: deliveryPayload(), cobro: paymentPayload() });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      code: 'DELIVERY_OWNERSHIP_REQUIRED',
    });
    expect(mockConfirmRuteroDelivery).not.toHaveBeenCalled();
  });
  test('blocks an authenticated repartidor from confirming for another repartidor', async () => {
    mockConfirmRuteroDelivery.mockRejectedValueOnce(Object.assign(
      new Error('La entrega no pertenece al repartidor autenticado'),
      { code: 'DELIVERY_OWNERSHIP_REQUIRED', statusCode: 403 },
    ));
    const res = await request(makeApp())
      .post('/api/repartidor-finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'delivery-2026-S-10-404-cross-driver')
      .send({
        delivery: deliveryPayload({ itemId: '2026-S-10-405-OTHER-CLIENT' }),
        cobro: paymentPayload({ entregaId: '2026-S-10-405-OTHER-CLIENT' }),
      });

    expect(res.status).toBe(403);
    expect(mockConfirmRuteroDelivery).toHaveBeenCalledTimes(1);
  });

  test('returns 201 once, exact replay 200, and changed-payload replay 409', async () => {
    const seen = new Map();
    mockConfirmRuteroDelivery.mockImplementation(async (command) => {
      const fingerprint = JSON.stringify({
        delivery: command.delivery,
        cobro: command.cobro,
        repartidorId: command.actor?.repartidorId,
      });
      const prior = seen.get(command.idempotencyKey);
      if (prior && prior !== fingerprint) {
        const error = new Error('Idempotency key reused with another payload');
        error.code = 'IDEMPOTENCY_CONFLICT';
        error.statusCode = 409;
        throw error;
      }
      if (prior) {
        return { created: false, idempotent: true, deliveryStatus: 'ENTREGADO', cobroId: '901' };
      }
      seen.set(command.idempotencyKey, fingerprint);
      return { created: true, idempotent: false, deliveryStatus: 'ENTREGADO', cobroId: '901' };
    });

    const key = 'delivery-2026-S-10-404-replay';
    const payload = { delivery: deliveryPayload(), cobro: paymentPayload() };
    const first = await request(makeApp())
      .post('/api/repartidor-finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', key)
      .send(payload);
    const replay = await request(makeApp())
      .post('/api/repartidor-finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', key)
      .send(payload);
    const conflict = await request(makeApp())
      .post('/api/repartidor-finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', key)
      .send({
        delivery: payload.delivery,
        cobro: paymentPayload({ importeCobrado: 180 }),
      });

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ created: false, idempotent: true });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ success: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(mockConfirmRuteroDelivery).toHaveBeenCalledTimes(3);
  });
});

describe('legacy reparto mutation routes cannot bypass the canonical contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = { id: 'V94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };
    mockQueryWithParams.mockResolvedValue([]);
  });

  test('legacy POST /repartidor/entregas is non-mutating and never exports to DSEDAC', async () => {
    const res = await request(makeApp())
      .post('/api/repartidor/entregas')
      .set('Idempotency-Key', 'delivery-legacy-route-disabled')
      .send({
        numeroAlbaran: 404,
        ejercicioAlbaran: 2026,
        serieAlbaran: 'S',
        codigoCliente: '4300009479',
        codigoRepartidor: '94',
        estado: 'ENTREGADO',
      });

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({
      success: false,
      code: 'CANONICAL_REPARTO_ROUTE_REQUIRED',
    });
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockExportEntregaToSystem).not.toHaveBeenCalled();
  });

  test('legacy POST /repartidor/cobros cannot create a second non-idempotent write path', async () => {
    const res = await request(makeApp())
      .post('/api/repartidor/cobros')
      .send({
        entregaId: '2026-S-10-404-4300009479',
        codigoCliente: '4300009479',
        codigoRepartidor: '94',
        tipoDocumento: 'CAC',
        numeroDocumento: 404,
        ejercicioDocumento: 2026,
        serieDocumento: 'S',
        terminalDocumento: 10,
        importeCobrado: 189.6,
        formaPago: 'EFECTIVO',
      });

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({
      success: false,
      code: 'CANONICAL_REPARTO_ROUTE_REQUIRED',
    });
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });
});
