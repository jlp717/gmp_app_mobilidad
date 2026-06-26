'use strict';

const request = require('supertest');
const express = require('express');

globalThis['process']['env'].FACTURA_EMAIL_SEND_TIMEOUT_MS = '5';

const mockSendEmailWithPdf = jest.fn();
const mockGetFacturaDetail = jest.fn();
const mockGetAlbaranDetailForPdf = jest.fn();
const mockGetCachedPdf = jest.fn();
const mockCachePdf = jest.fn();
const mockGeneratePdf = jest.fn();
const mockGenerateDocumentPdf = jest.fn();

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
  generateWhatsAppMessage: jest.fn(),
}));

jest.mock('../services/pdf.service', () => ({
  generateInvoicePDF: (...args) => mockGeneratePdf(...args),
}));

jest.mock('../app/services/pdfService', () => ({
  generateInvoicePDF: (...args) => mockGenerateDocumentPdf(...args),
}));

jest.mock('../services/emailPdfService', () => ({
  sendEmailWithPdf: (...args) => mockSendEmailWithPdf(...args),
  generateInvoiceEmailHtml: jest.fn(() => '<p>Factura</p>'),
  generateDeliveryEmailHtml: jest.fn(() => '<p>Albaran</p>'),
  cachePdf: (...args) => mockCachePdf(...args),
  getCachedPdf: (...args) => mockGetCachedPdf(...args),
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
  mockGetCachedPdf.mockReturnValue(Buffer.from('%PDF-1.4'));
  mockGeneratePdf.mockResolvedValue(Buffer.from('%PDF-1.4'));
  mockGenerateDocumentPdf.mockResolvedValue(Buffer.from('%PDF-1.4'));
  mockGetFacturaDetail.mockResolvedValue({
    header: { fecha: '12/06/2026', total: 10, clienteNombre: 'Cliente' },
  });
  mockGetAlbaranDetailForPdf.mockResolvedValue({
    documentType: 'albaran',
    header: {
      SERIEALBARAN: 'J',
      NUMEROALBARAN: 1183,
      EJERCICIOALBARAN: 2026,
      TERMINALALBARAN: 93,
      fecha: '26/06/2026',
      total: 1172.49,
      IMPORTETOTAL: 1172.49,
      clienteNombre: 'Cliente Albaran',
      NOMBRECLIENTEFACTURA: 'Cliente Albaran',
    },
    lines: [],
  });
});

describe('GET /api/facturas/:serie/:numero/:ejercicio/pdf', () => {
  test('falls back to albaran when legacy factura URL has no CFC row', async () => {
    mockGetFacturaDetail.mockRejectedValueOnce(new Error('Factura no encontrada'));

    const res = await request(makeApp())
      .get('/api/facturas/J/1183/2026/pdf?preview=true');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toContain('inline');
    expect(res.headers['content-disposition']).toContain('Albaran_2026_J_93_1183.pdf');
    expect(mockGetFacturaDetail).toHaveBeenCalledWith('J', 1183, 2026);
    expect(mockGetAlbaranDetailForPdf).toHaveBeenCalledWith('J', 1183, 2026, null);
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

describe("POST /api/facturas/share/email", () => {
  test("times out with same typed response and no-store header", async () => {
    mockSendEmailWithPdf.mockReturnValue(new Promise(() => {}));

    const res = await request(makeApp())
      .post("/api/facturas/share/email")
      .send({
        serie: "F",
        numero: 4306,
        ejercicio: 2026,
        destinatario: "cliente@example.com",
      });

    expect(res.status).toBe(504);
    expect(res.body).toMatchObject({
      success: false,
      code: "EMAIL_SEND_TIMEOUT",
      error: "No se pudo completar el envío de email en este momento.",
    });
    expect(res.body.no_retry_reason).toContain("no reintentar automaticamente");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
