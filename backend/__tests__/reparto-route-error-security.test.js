'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const mockFinance = { getDailySummary: jest.fn() };
const mockCaptureException = jest.fn();

jest.mock('../middleware/logger', () => mockLogger);
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 'V94', code: '94', role: 'REPARTIDOR' }; next(); },
  requireRoles: () => (_req, _res, next) => next(),
}));
jest.mock('../services/repartidor-finance-service', () => mockFinance);
jest.mock('../services/redis-cache', () => ({
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
  invalidateCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@sentry/node', () => ({ captureException: mockCaptureException }));

const routes = require('../routes/repartidor-finanzas');

function app() {
  const value = express();
  value.use(express.json());
  value.use('/finanzas', routes);
  return value;
}

describe('reparto route error security', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'production';
    routes.resetCanonicalConfirmationRuntime();
  });
  afterEach(() => routes.resetCanonicalConfirmationRuntime());
  afterAll(() => {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });

  test('maps typed schema unavailability to 503 without ODBC message, details, or stack', async () => {
    const error = new Error('DB2 message containing secret payload');
    error.name = 'FinanceSchemaUnavailableError';
    error.code = 'FINANCE_SCHEMA_UNAVAILABLE';
    error.statusCode = 503;
    error.details = { query: 'SELECT secret', sensitiveField: 'never-return-this' };
    error.odbcErrors = [{ state: '42703', code: -204, message: 'SQL text and private values' }];
    mockFinance.getDailySummary.mockRejectedValue(error);

    const response = await request(app()).get('/finanzas/daily-summary/94').query({ date: '2026-04-23' });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      code: 'FINANCE_SCHEMA_UNAVAILABLE',
      error: 'Servicio temporalmente no disponible',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/secret|SQL|stack|detail|odbc/i);
    const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'repartidor-finanzas.js'), 'utf8');
    expect(source).toContain("logger.error('[REPARTIDOR_FINANZAS] request failed', safeLog)");
    expect(source).toContain("name: 'RepartidorFinanzasIncident', code, statusCode");
    expect(source).not.toContain('sqlState: odbc0?.state || undefined');
    expect(source).not.toContain('odbc0.message');
    expect(source).not.toContain('error.stack');
  });

  test('confirmation failure sends only operation metadata to Sentry', async () => {
    routes.setCanonicalConfirmationRuntime({
      catalogService: { validateConfirmation: jest.fn().mockResolvedValue(undefined) },
      confirmationService: { confirm: jest.fn().mockRejectedValue(new Error('unexpected persistence failure')) },
    });
    const signatureId = `ev_${'a'.repeat(64)}`;
    const photoId = `ev_${'b'.repeat(64)}`;
    const itemId = '2026-S-10-404-sensitive-document';
    const idempotencyKey = 'sentry-safe-request-123';

    const response = await request(app())
      .post('/finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', idempotencyKey)
      .send({
        delivery: {
          itemId,
          status: 'ENTREGADO',
          repartidorId: '94',
          occurredAt: '2026-04-23T11:30:00.000Z',
          receiver: { nombre: 'Ana', apellidos: 'Lopez Ruiz', dni: '12345678Z' },
          firma: signatureId,
          evidencias: [photoId],
          observaciones: 'opaque-sensitive-marker',
          lineas: [{
            lineaId: 'line-sensitive', codigoArticulo: 'article-sensitive', cantidadPedida: 2,
            cantidadEntregada: 2, cantidadRechazada: 0, cantidadPendiente: 0,
          }],
        },
      });

    expect(response.status).toBe(500);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException.mock.calls[0][0]).toEqual({
      name: 'RepartidorFinanzasIncident', code: 'UNEXPECTED_ERROR', statusCode: 500,
    });
    expect(mockCaptureException.mock.calls[0][1]).toEqual({
      extra: { action: 'POST /rutero/confirm-delivery-cobro' },
    });
    const sentryExtra = JSON.stringify(mockCaptureException.mock.calls[0][1]);
    expect(sentryExtra).not.toContain(itemId);
    expect(sentryExtra).not.toContain(signatureId);
    expect(sentryExtra).not.toContain(photoId);
    expect(sentryExtra).not.toContain(idempotencyKey);
    expect(sentryExtra).not.toMatch(/12345678Z|receiver|dni|bytes|hash|idempotency/i);
  });

  test('factory source is valid UTF-8 text without replacement or mojibake markers', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'reparto-confirmation-factory.js'), 'utf8');
    expect(source).not.toContain('\uFFFD');
    expect(source).not.toContain('Ã');
    expect(source).toContain('canónica');
    expect(source).toContain('catálogo');
  });
});
