'use strict';

/**
 * REQ-21 tanda4: send-email aplica delivery-policy allowlist/sink en TEST.
 * - isolated_test auto-envío a email allowlist → success:true,
 *   effectiveRecipients == [sink], to/cc intencionales en payload/log.
 * - 422 existente intacto para terceros no autorizados fuera de TEST.
 */

const request = require('supertest');
const express = require('express');

const mockSendEmailWithPdf = jest.fn();
const mockGetFacturaDetail = jest.fn();
const mockGetAlbaranDetailForPdf = jest.fn();

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
  getAlbaranDetailForPdf: (...args) => mockGetAlbaranDetailForPdf(...args),
  isFacturaClientOwnedByVendors: jest.fn().mockResolvedValue(true),
  generateWhatsAppMessage: jest.fn(),
}));

jest.mock('../services/pdf.service', () => ({
  generateInvoicePDF: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
}));

jest.mock('../app/services/pdfService', () => ({
  generateInvoicePDF: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
}));

jest.mock('../services/emailPdfService', () => ({
  sendEmailWithPdf: (...args) => mockSendEmailWithPdf(...args),
  generateInvoiceEmailHtml: jest.fn(() => '<p>Factura</p>'),
  generateDeliveryEmailHtml: jest.fn(() => '<p>Albaran</p>'),
  cachePdf: jest.fn(),
  getCachedPdf: jest.fn().mockReturnValue(Buffer.from('%PDF-1.4')),
}));

const facturasRoutes = require('../routes/facturas');

const OLD_ENV = { ...process.env };

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/facturas', facturasRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...OLD_ENV };
  mockGetFacturaDetail.mockResolvedValue({
    header: {
      fecha: '12/06/2026',
      total: 10,
      clienteNombre: 'Cliente',
      vendedor: '01',
      clienteId: '4300010400',
      // QSYS2: DSEDAC.CLI sin columna EMAIL → detalle sin clienteEmail.
    },
  });
  mockSendEmailWithPdf.mockResolvedValue({ success: true, messageId: '<test@localhost>' });
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe('REQ-21 send-email delivery-policy TEST', () => {
  test('isolated_test auto-envío allowlist → success con sink efectivo auditado', async () => {
    process.env.REPARTO_TABLE_SET = 'isolated_test';
    process.env.REPARTO_EMAIL_TEST_ALLOWLIST = 'reparto-test@localhost';
    process.env.REPARTO_EMAIL_TEST_SINK = 'reparto-test@localhost';

    const res = await request(makeApp())
      .post('/api/facturas/send-email')
      .send({
        serie: 'F',
        numero: 4306,
        ejercicio: 2026,
        destinatario: 'reparto-test@localhost',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.effectiveRecipients).toEqual(['reparto-test@localhost']);
    expect(res.body.intendedRecipients).toEqual(['reparto-test@localhost']);
    expect(mockSendEmailWithPdf).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'reparto-test@localhost' }),
    );
  });

  test('422 intacto para tercero no autorizado fuera de TEST', async () => {
    delete process.env.REPARTO_TABLE_SET;

    const res = await request(makeApp())
      .post('/api/facturas/send-email')
      .send({
        serie: 'F',
        numero: 4306,
        ejercicio: 2026,
        destinatario: 'tercero@externo.example',
      });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('EMAIL_DESTINATARIO_NOT_ALLOWED');
    expect(mockSendEmailWithPdf).not.toHaveBeenCalled();
  });
});
