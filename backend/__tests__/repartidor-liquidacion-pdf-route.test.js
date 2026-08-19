'use strict';

const express = require('express');
const request = require('supertest');

let mockUser = { id: '94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };
const mockFinance = { buildClosedLiquidacionPdf: jest.fn() };

jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { ...mockUser }; next(); },
  requireRoles: () => (_req, _res, next) => next(),
}));
jest.mock('../middleware/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../services/repartidor-finance-service', () => mockFinance);
jest.mock('../services/redis-cache', () => ({ deleteCachePattern: jest.fn().mockResolvedValue(undefined) }));

const routes = require('../routes/repartidor-finanzas');

function app() {
  const value = express();
  value.use(express.json());
  value.use('/finanzas', routes);
  return value;
}

describe('daily liquidation PDF route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: '94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };
  });

  test('returns only a private base64 PDF rebuilt from the closed immutable selector', async () => {
    mockFinance.buildClosedLiquidacionPdf.mockResolvedValue({
      pdfBuffer: Buffer.from('%PDF-test'), fileName: 'Liquidacion_GMP_2026_A_94.pdf',
      liquidacionId: '701', repartidorId: '94', date: '2026-08-19', status: 'CLOSED',
    });

    const response = await request(app())
      .get('/finanzas/liquidaciones/liquidacion-pdf-token-0001/pdf')
      .query({ repartidorId: '94' });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toEqual({
      success: true, pdfBase64: Buffer.from('%PDF-test').toString('base64'),
      fileName: 'Liquidacion_GMP_2026_A_94.pdf', liquidacionId: '701',
      repartidorId: '94', date: '2026-08-19', status: 'CLOSED',
    });
    expect(mockFinance.buildClosedLiquidacionPdf).toHaveBeenCalledWith({
      idempotencyToken: 'liquidacion-pdf-token-0001', repartidorId: '94',
    });
  });

  test('enforces the concrete owner scope before reading the PDF', async () => {
    mockUser = { id: '95', code: '95', role: 'REPARTIDOR', repartidorCodes: ['95'] };
    const response = await request(app())
      .get('/finanzas/liquidaciones/liquidacion-pdf-token-0001/pdf')
      .query({ repartidorId: '94' });

    expect(response.status).toBe(403);
    expect(mockFinance.buildClosedLiquidacionPdf).not.toHaveBeenCalled();
  });
});
