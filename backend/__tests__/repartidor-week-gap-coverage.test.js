'use strict';

const express = require('express');
const request = require('supertest');

const mockQueryWithParams = jest.fn();
const mockIsDeliveryStatusAvailable = jest.fn();
const mockGetDeliveryStatusJoin = jest.fn();

jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));
jest.mock('../services/query-optimizer', () => ({
  cachedQuery: (queryFn, sql, _key, _ttl, params) => queryFn(sql, params),
}));
jest.mock('../services/redis-cache', () => ({
  TTL: { REALTIME: 0, SHORT: 60, MEDIUM: 300, LONG: 3600 },
}));
jest.mock('../middleware/logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));
jest.mock('../app/services/pdfService', () => ({ generateInvoicePDF: jest.fn() }));
jest.mock('../utils/delivery-status-check', () => ({
  isDeliveryStatusAvailable: (...args) => mockIsDeliveryStatusAvailable(...args),
  isDeliveryStatusNewSchema: jest.fn(() => false),
  getDeliveryStatusJoin: (...args) => mockGetDeliveryStatusJoin(...args),
  getDeliveryStatusColumns: jest.fn(() => "CAST(NULL AS VARCHAR(20)) as DELIVERY_STATUS"),
}));
jest.mock('../services/emailPdfService', () => ({
  sendEmailWithPdf: jest.fn(),
  generateInvoiceEmailHtml: jest.fn(),
  generateDeliveryEmailHtml: jest.fn(),
  cachePdf: jest.fn(),
  getCachedPdf: jest.fn(),
}));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => {
    req.user = { id: '05', code: '05', role: 'REPARTIDOR' };
    next();
  },
}));
jest.mock('../services/circuit-breaker', () => ({
  CircuitBreaker: class CircuitBreaker { constructor(options) { this.options = options; } },
}));
jest.mock('../app/services/deliveryReceiptService', () => ({ generateDeliveryReceipt: jest.fn() }));
jest.mock('../services/facturas.service', () => ({}));
jest.mock('../services/pdf.service', () => ({}));

const routes = require('../routes/repartidor');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/repartidor', routes);
  return app;
}

describe('GET /rutero/week/:repartidorId delivery truth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryWithParams.mockResolvedValue([]);
    mockIsDeliveryStatusAvailable.mockReturnValue(false);
    mockGetDeliveryStatusJoin.mockReturnValue('');
  });

  test('does not infer delivery from a past date and counts the complete document identity', async () => {
    mockQueryWithParams.mockResolvedValue([{
      DIA: 3,
      MES: 8,
      ANO: 2026,
      TOTAL_ALBARANES: 2,
      ENTREGADOS: 1,
    }]);

    const res = await request(makeApp())
      .get('/repartidor/rutero/week/05')
      .query({ date: '2026-08-03' });

    expect(res.status).toBe(200);
    const monday = res.body.days.find(day => day.date === '2026-08-03');
    expect(monday).toMatchObject({ clients: 2, completed: 1, status: 'bad' });

    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toContain('WITH DOCUMENTOS_SEMANA AS');
    expect(sql).toContain('CPC.EJERCICIOALBARAN');
    expect(sql).toContain('CPC.SERIEALBARAN');
    expect(sql).toContain('CPC.TERMINALALBARAN');
    expect(sql).toContain('CPC.NUMEROALBARAN');
    expect(sql).toContain('GROUP BY OPP.ANOREPARTO, OPP.MESREPARTO, OPP.DIAREPARTO,');
    expect(sql).toContain('COUNT(*) as TOTAL_ALBARANES');
    expect(sql).toContain('SUM(ENTREGADO) as ENTREGADOS');
    expect(sql).not.toMatch(/OPP\.DIAREPARTO\)\s*<\s*\?/);
    expect(params).toEqual([20260803, 20260809, '05']);
  });

  test('keeps app-confirmed delivery as an explicit per-document state', async () => {
    mockIsDeliveryStatusAvailable.mockReturnValue(true);
    mockGetDeliveryStatusJoin.mockReturnValue(
      'LEFT JOIN JAVIER.DELIVERY_STATUS DS ON DS.NUMEROALBARAN = CPC.NUMEROALBARAN',
    );

    const res = await request(makeApp())
      .get('/repartidor/rutero/week/05')
      .query({ date: '2026-08-03' });

    expect(res.status).toBe(200);
    const [sql] = mockQueryWithParams.mock.calls[0];
    expect(sql).toContain('LEFT JOIN JAVIER.DELIVERY_STATUS DS');
    expect(sql).toContain("WHEN DS.STATUS = 'ENTREGADO' THEN 1");
    expect(sql).toContain('MAX(CASE');
  });

  test('returns a typed sanitized 503 when the weekly DB2 aggregate fails', async () => {
    mockQueryWithParams.mockRejectedValue(new Error('SQL30081N host=internal-db2 customer=secret'));

    const res = await request(makeApp())
      .get('/repartidor/rutero/week/05')
      .query({ date: '2026-08-03' });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      success: false,
      code: 'REPARTIDOR_WEEK_FAILED',
      error: 'No se pudo completar la solicitud',
    });
    expect(JSON.stringify(res.body)).not.toContain('SQL30081N');
    expect(JSON.stringify(res.body)).not.toContain('internal-db2');
  });
});
