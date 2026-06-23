'use strict';

const request = require('supertest');
const express = require('express');

const mockGetOrCreateBolsa = jest.fn();
const mockGetBolsaStatus = jest.fn();
const mockGetMovimientos = jest.fn();
const mockGetGroupedStatus = jest.fn();
let mockUser = { code: '01', role: 'COMERCIAL' };

jest.mock('../services/bolsa-comercial.service', function() { return {
  getOrCreateBolsa: mockGetOrCreateBolsa,
  getBolsaStatus: mockGetBolsaStatus,
  getMovimientos: mockGetMovimientos,
  getGroupedStatus: mockGetGroupedStatus,
  getHistorialMensual: jest.fn(),
  updateBolsaConfig: jest.fn(),
}; });

jest.mock('../middleware/auth', function() { return {
  verifyToken: function(req, _res, next) {
    req.user = mockUser;
    next();
  },
  requireRoles: function() { return function(_req, _res, next) { next(); }; },
}; });

jest.mock('../middleware/security', function() { return {
  bolsaLimiter: function(_req, _res, next) { next(); },
}; });

jest.mock('../middleware/logger', function() { return {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}; });

const bolsaRouter = require('../routes/bolsa');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/bolsa', bolsaRouter);
  return app;
}

beforeEach(function() {
  jest.clearAllMocks();
  mockUser = { code: '01', role: 'COMERCIAL' };
});

describe('bolsa route validation contracts', function() {
  test('GET /api/bolsa/:vendedorCode/status returns machine-readable validation error', async function() {
    const res = await request(makeApp()).get('/api/bolsa/bad-code/status');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'INVALID_VENDEDOR_CODE',
      error: 'Invalid vendedorCode format',
    });
    expect(mockGetOrCreateBolsa).not.toHaveBeenCalled();
  });

  test('GET /api/bolsa/:vendedorCode/movements returns machine-readable validation error', async function() {
    const res = await request(makeApp()).get('/api/bolsa/bad-code/movements');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'INVALID_VENDEDOR_CODE',
      error: 'Invalid vendedorCode format',
    });
    expect(mockGetMovimientos).not.toHaveBeenCalled();
  });

  test('GET /api/bolsa/:vendedorCode/movements returns detailed movement contract fields', async function() {
    mockUser = { code: '80', role: 'JEFE_VENTAS', isJefeVentas: true };
    const movement = {
      id: 1,
      tipo: 'ACUMULACION',
      importe: 6,
      saldoAnterior: 300,
      saldoPosterior: 306,
      codigoArticulo: 'ART-OVER',
      descripcion: 'Producto sobre minimo',
      pedidoId: 42,
      fecha: '2026-06-09T23:36:39.000Z',
      lineId: 7,
      precioMinimoCongelado: 10,
      precioVenta: 12,
      cantidad: 3,
      unidadMedida: 'CAJAS',
      idempotencyKey: 'pedido-42-line-7-over-min',
    };
    mockGetMovimientos.mockResolvedValueOnce([movement]);

    const res = await request(makeApp())
      .get('/api/bolsa/10/movements?year=2026&month=6&limit=25');

    expect(res.status).toBe(200);
    expect(mockGetMovimientos).toHaveBeenCalledWith('10', 2026, 6, 25, expect.objectContaining({}));
    expect(mockGetOrCreateBolsa).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      success: true,
      movements: [
        {
          id: 1,
          tipo: 'ACUMULACION',
          importe: 6,
          saldoAnterior: 300,
          saldoPosterior: 306,
          codigoArticulo: 'ART-OVER',
          descripcion: 'Producto sobre minimo',
          pedidoId: 42,
          fecha: '2026-06-09T23:36:39.000Z',
          lineId: 7,
          precioMinimoCongelado: 10,
          precioVenta: 12,
          cantidad: 3,
          unidadMedida: 'CAJAS',
          idempotencyKey: 'pedido-42-line-7-over-min',
        },
      ],
    });
  });

  test('GET /api/bolsa/:vendedorCode/movements strips margin fields for commercial users', async function() {
    mockUser = { code: '10', role: 'COMERCIAL' };
    mockGetMovimientos.mockResolvedValueOnce([{
      id: 1,
      tipo: 'ACUMULACION',
      importe: 6,
      saldoAnterior: 300,
      saldoPosterior: 306,
      precioMinimoCongelado: 10,
      precioVenta: 12,
      cantidad: 3,
      unidadMedida: 'CAJAS',
    }]);

    const res = await request(makeApp())
      .get('/api/bolsa/10/movements?year=2026&month=6');

    expect(res.status).toBe(200);
    expect(res.body.movements[0]).not.toHaveProperty('precioMinimoCongelado');
    expect(res.body.movements[0]).not.toHaveProperty('precioVenta');
    expect(res.body.movements[0]).toMatchObject({
      id: 1,
      tipo: 'ACUMULACION',
      importe: 6,
      saldoAnterior: 300,
      saldoPosterior: 306,
      cantidad: 3,
    });
  });

  test('GET /api/bolsa/grouped is manager-only and scoped', async function() {
    mockUser = { code: '80', role: 'JEFE_VENTAS', isJefeVentas: true, vendorCodes: ['01', '02'] };
    mockGetGroupedStatus.mockResolvedValueOnce({
      ejercicio: 2026,
      mes: 6,
      vendedores: [{ vendedor: '02', saldoDisponible: 120 }],
      totals: { saldoDisponible: 120, consumido: 0, acumulado: 120, vendedores: 1 },
    });

    const res = await request(makeApp()).get('/api/bolsa/grouped?year=2026&month=6&vendedorCodes=02');

    expect(res.status).toBe(200);
    expect(mockGetGroupedStatus).toHaveBeenCalledWith(['02'], 2026, 6);
    expect(res.body).toMatchObject({
      success: true,
      vendedores: [{ vendedor: '02', saldoDisponible: 120 }],
    });
  });

  test('GET /api/bolsa/grouped rejects non-manager users', async function() {
    mockUser = { code: '01', role: 'COMERCIAL' };
    const res = await request(makeApp()).get('/api/bolsa/grouped');

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, code: 'MANAGER_REQUIRED' });
    expect(mockGetGroupedStatus).not.toHaveBeenCalled();
  });
});


describe('bolsa route authorization and public errors', function() {
  test('GET /api/bolsa/:vendedorCode/status allows COMERCIAL to access own vendor only', async function() {
    mockUser = { code: '01', role: 'COMERCIAL' };
    mockGetBolsaStatus.mockResolvedValueOnce({ vendedor: '01', saldoDisponible: 300 });
    const own = await request(makeApp()).get('/api/bolsa/01/status');
    const cross = await request(makeApp()).get('/api/bolsa/02/status').set('x-request-id', 'req-cross');
    expect(own.status).toBe(200);
    expect(mockGetBolsaStatus).toHaveBeenCalledWith('01', expect.any(Number), expect.any(Number));
    expect(mockGetOrCreateBolsa).not.toHaveBeenCalled();
    expect(cross.status).toBe(403);
    expect(cross.body).toMatchObject({ success: false, code: 'FORBIDDEN_VENDOR', error: 'No autorizado para consultar este vendedor', request_id: 'req-cross' });
    expect(mockGetBolsaStatus).toHaveBeenCalledTimes(1);
  });
  test('GET /api/bolsa/:vendedorCode/status allows JEFE_VENTAS cross-vendor access', async function() {
    mockUser = { code: '80', role: 'JEFE_VENTAS', isJefeVentas: true };
    mockGetBolsaStatus.mockResolvedValueOnce({ vendedor: '02', saldoDisponible: 300 });
    const res = await request(makeApp()).get('/api/bolsa/02/status');
    expect(res.status).toBe(200);
    expect(mockGetBolsaStatus).toHaveBeenCalledWith('02', expect.any(Number), expect.any(Number));
    expect(mockGetOrCreateBolsa).not.toHaveBeenCalled();
  });
  test('GET /api/bolsa/:vendedorCode/status rejects JEFE_VENTAS outside visible vendor scope', async function() {
    mockUser = { code: '80', role: 'JEFE_VENTAS', isJefeVentas: true, vendorCodes: ['01'] };
    const res = await request(makeApp()).get('/api/bolsa/02/status').set('x-request-id', 'req-manager-scope');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, code: 'FORBIDDEN_VENDOR', request_id: 'req-manager-scope' });
    expect(mockGetBolsaStatus).not.toHaveBeenCalled();
    expect(mockGetOrCreateBolsa).not.toHaveBeenCalled();
  });
  test('GET /api/bolsa/:vendedorCode/status hides raw DB2 errors behind public code and request_id', async function() {
    mockUser = { code: '01', role: 'COMERCIAL' };
    mockGetBolsaStatus.mockRejectedValueOnce(new Error('SQLSTATE 42S02 ODBC table missing'));
    const res = await request(makeApp()).get('/api/bolsa/01/status').set('x-request-id', 'req-db2');
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ success: false, code: 'BOLSA_INTERNAL_ERROR', error: 'No se pudo procesar la bolsa comercial', request_id: 'req-db2' });
    expect(JSON.stringify(res.body)).not.toContain('SQLSTATE');
    expect(JSON.stringify(res.body)).not.toContain('ODBC');
  });
});
