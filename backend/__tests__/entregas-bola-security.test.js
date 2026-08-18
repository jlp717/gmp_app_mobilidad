'use strict';

const express = require('express');
const request = require('supertest');

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockCachedQuery = jest.fn();
let mockUser = { id: '08', code: '08', role: 'REPARTIDOR', repartidorCodes: ['08'] };

jest.mock('../config/db', () => ({
  query: (...args) => mockQuery(...args),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));
jest.mock('../services/query-optimizer', () => ({
  cachedQuery: (...args) => mockCachedQuery(...args),
}));
jest.mock('../services/redis-cache', () => ({ TTL: { SHORT: 60, LONG: 3600 } }));
jest.mock('../middleware/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { ...mockUser }; next(); },
}));
jest.mock('../utils/delivery-status-check', () => ({
  isDeliveryStatusAvailable: () => false,
  isDeliveryStatusNewSchema: () => false,
  getDeliveryStatusJoin: () => '',
}));

const router = require('../routes/entregas');

function app() {
  const value = express();
  value.use(express.json());
  value.use('/', router);
  return value;
}

function paymentCatalog() {
  return [{
    CODIGO: 'CTR', DESCRIPCION: 'Contado', TIPO: 'CONTADO', DIAS_PAGO: 0,
    DEBE_COBRAR: 'S', PUEDE_COBRAR: 'S', COLOR: 'red',
  }];
}

describe('entregas BOLA and active-mode guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: '08', code: '08', role: 'REPARTIDOR', repartidorCodes: ['08'] };
    mockCachedQuery.mockResolvedValue(paymentCatalog());
    mockQueryWithParams.mockResolvedValue([]);
  });

  test.each(['ALL', 'BOLA', '08,,09', '08,123']) (
    'rejects malformed pendientes selector %s before DB access',
    async (selector) => {
      const response = await request(app()).get(`/pendientes/${selector}?date=2026-08-18`);
      expect(response.status).toBe(422);
      expect(response.body.code).toBe('REPARTIDOR_ID_INVALID');
      expect(mockCachedQuery).not.toHaveBeenCalled();
      expect(mockQueryWithParams).not.toHaveBeenCalled();
    },
  );

  test('canonicalizes leading zeros and allows only the driver own selector', async () => {
    const own = await request(app()).get('/pendientes/8?date=2026-08-18');
    expect(own.status).toBe(200);
    expect(mockQueryWithParams.mock.calls[0][1]).toEqual(expect.arrayContaining(['08']));

    jest.clearAllMocks();
    const foreign = await request(app()).get('/pendientes/09?date=2026-08-18');
    expect(foreign.status).toBe(403);
    expect(mockCachedQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('JEFE requires reparto mode for fleet lists and valid CSV is canonical', async () => {
    mockUser = { id: '98', code: '98', role: 'JEFE_VENTAS', repartidorCodes: [] };
    let response = await request(app()).get('/pendientes/08,09?date=2026-08-18');
    expect(response.status).toBe(403);
    expect(mockQueryWithParams).not.toHaveBeenCalled();

    mockUser.activeMode = 'REPARTIDOR';
    mockUser.repartidorCodes = ['08', '09'];
    response = await request(app()).get('/pendientes/8,09?date=2026-08-18');
    expect(response.status).toBe(200);
    expect(mockQueryWithParams.mock.calls[0][1]).toEqual(expect.arrayContaining(['08', '09']));
  });

  test.each([undefined, 'ALL', '08,09', 'BOLA'])(
    'JEFE albaran requires one concrete owner before any DB lookup (%s)',
    async (owner) => {
      mockUser = { id: '98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', repartidorCodes: ['08'] };
      const suffix = owner === undefined ? '' : `&repartidorId=${owner}`;
      const response = await request(app()).get(`/albaran/42/2026?serie=A&terminal=1&cliente=C1${suffix}`);
      expect(response.status).toBe(422);
      expect(mockQueryWithParams).not.toHaveBeenCalled();
    },
  );

  test('JEFE selected owner must match the ERP delivery owner', async () => {
    mockUser = { id: '98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', repartidorCodes: ['08', '09'] };
    mockQueryWithParams.mockResolvedValueOnce([{
      SUBEMPRESAALBARAN: '01', EJERCICIOALBARAN: 2026, SERIEALBARAN: 'A',
      TERMINALALBARAN: 1, NUMEROALBARAN: 42, CLIENTE: 'C1',
      CODIGO_REPARTIDOR: '08', IMPORTE: 10, IMPORTE_BRUTO: 10,
    }]);

    const response = await request(app())
      .get('/albaran/42/2026?serie=A&terminal=1&cliente=C1&repartidorId=09');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('DELIVERY_OWNERSHIP_REQUIRED');
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);
  });

  test('JEFE outside reparto and REPARTIDOR foreign hints fail before albaran DB work', async () => {
    mockUser = { id: '98', code: '98', role: 'JEFE_VENTAS' };
    const wrongMode = await request(app())
      .get('/albaran/42/2026?serie=A&terminal=1&cliente=C1&repartidorId=08');
    expect(wrongMode.status).toBe(403);
    expect(mockQueryWithParams).not.toHaveBeenCalled();

    mockUser = { id: '08', code: '08', role: 'REPARTIDOR', repartidorCodes: ['08'], isJefeVentas: true };
    const foreign = await request(app())
      .get('/albaran/42/2026?serie=A&terminal=1&cliente=C1&repartidorId=09');
    expect(foreign.status).toBe(403);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });
});
