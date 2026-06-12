'use strict';

const request = require('supertest');
const express = require('express');

globalThis['process']['env'].FACTURA_EMAIL_SEND_TIMEOUT_MS = '5';

const mockSendEmailWithPdf = jest.fn();
const mockGetFacturaDetail = jest.fn();

jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => {
    req.user = { id: '01', code: '01', role: 'COMERCIAL' };
    next();
  },
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../services/facturas.service', () => ({
  getFacturaDetail: (...args) => mockGetFacturaDetail(...args),
  generateWhatsAppMessage: jest.fn(),
}));

jest.mock('../services/pdf.service', () => ({
  generateInvoicePDF: jest.fn(),
}));

jest.mock('../services/emailPdfService', () => ({
  sendEmailWithPdf: (...args) => mockSendEmailWithPdf(...args),
  generateInvoiceEmailHtml: jest.fn(() => '<p>Factura</p>'),
  cachePdf: jest.fn(),
  getCachedPdf: jest.fn(() => Buffer.from('%PDF-1.4')),
}));

const facturasRoutes = require('../routes/facturas');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/facturas', facturasRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFacturaDetail.mockResolvedValue({
    header: { fecha: '12/06/2026', total: 10, clienteNombre: 'Cliente' },
  });
});

describe('POST /api/facturas/send-email', () => {
  test('times out SMTP send with typed generic error and no automatic retry reason', async () => {
    mockSendEmailWithPdf.mockReturnValue(new Promise(() => {}));

    const res = await request(makeApp())
      .post('/api/facturas/send-email')
      .send({
        serie: 'F',
        numero: 4306,
        ejercicio: 2026,
        destinatario: 'cliente@example.com',
      });

    expect(res.status).toBe(504);
    expect(res.body).toMatchObject({
      success: false,
      code: 'EMAIL_SEND_TIMEOUT',
      error: 'No se pudo completar el envío de email en este momento.',
    });
    expect(res.body.no_retry_reason).toContain('no reintentar automaticamente');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
