'use strict';

/**
 * FACTURAS BOLA/IDOR SCOPE TESTS (ASVS V8 / H-01)
 * ===============================================
 * Regression tests for object-level authorization on commercial documents:
 * a COMERCIAL must only read/share invoices of vendors inside their signed
 * scope (code/vendorCodes), while JEFE_VENTAS/ADMIN supervise everything.
 * Mirrors the authorizeVendorScope contract from commissions.js.
 */

const request = require('supertest');
const express = require('express');

globalThis['process']['env'].FACTURA_EMAIL_SEND_TIMEOUT_MS = '5';

const mockSendEmailWithPdf = jest.fn();
const mockGetFacturaDetail = jest.fn();
const mockGetAlbaranDetailForPdf = jest.fn();
const mockIsFacturaClientOwnedByVendors = jest.fn();
const mockGetCachedPdf = jest.fn();
const mockCachePdf = jest.fn();
const mockGeneratePdf = jest.fn();
const mockGenerateDocumentPdf = jest.fn();

let mockUser = { id: '01', code: '01', role: 'COMERCIAL', vendorCodes: ['01'] };

jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => {
    req.user = mockUser;
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
  isFacturaClientOwnedByVendors: (...args) => mockIsFacturaClientOwnedByVendors(...args),
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

const facturaF4306 = {
  header: {
    serie: 'F',
    numero: 4306,
    ejercicio: 2026,
    fecha: '30/04/2026',
    clienteId: '4300010400',
    clienteNombre: 'CANITO COMIDAS',
    vendedor: '01',
    total: 3618.44,
    bases: [],
  },
  lines: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: '01', code: '01', role: 'COMERCIAL', vendorCodes: ['01'] };
  mockGetCachedPdf.mockReturnValue(Buffer.from('%PDF-1.4'));
  mockGeneratePdf.mockResolvedValue(Buffer.from('%PDF-1.4'));
  mockGenerateDocumentPdf.mockResolvedValue(Buffer.from('%PDF-1.4'));
  mockGetFacturaDetail.mockResolvedValue(facturaF4306);
  mockGetAlbaranDetailForPdf.mockResolvedValue({
    documentType: 'albaran',
    header: {
      SERIEALBARAN: 'J',
      NUMEROALBARAN: 1183,
      EJERCICIOALBARAN: 2026,
      TERMINALALBARAN: 93,
      fecha: '26/06/2026',
      total: 1172.49,
      clienteId: '4300001183',
      clienteNombre: 'CLIENTE ALBARAN',
      vendedor: '01',
    },
    lines: [],
  });
  mockIsFacturaClientOwnedByVendors.mockResolvedValue(false);
  mockSendEmailWithPdf.mockResolvedValue({ messageId: '<test@example.com>' });
});

describe('GET /api/facturas/:serie/:numero/:ejercicio (document scope)', () => {
  test('comercial reads a document of their own vendor: 200', async () => {
    const res = await request(makeApp()).get('/api/facturas/F/4306/2026');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.factura.header.vendedor).toBe('01');
  });

  test('comercial reading a document of another vendor gets typed 403', async () => {
    mockGetFacturaDetail.mockResolvedValueOnce({
      ...facturaF4306,
      header: { ...facturaF4306.header, vendedor: '97' },
    });

    const res = await request(makeApp()).get('/api/facturas/F/4306/2026');

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      code: 'DOCUMENT_SCOPE_FORBIDDEN',
    });
    expect(typeof res.body.error).toBe('string');
  });

  test('jefe ventas reads any vendor document: 200', async () => {
    mockUser = { id: '97', code: '97', role: 'JEFE_VENTAS', isJefeVentas: true, vendorCodes: ['ALL'] };
    mockGetFacturaDetail.mockResolvedValueOnce({
      ...facturaF4306,
      header: { ...facturaF4306.header, vendedor: '93' },
    });

    const res = await request(makeApp()).get('/api/facturas/F/4306/2026');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('admin reads any vendor document: 200', async () => {
    mockUser = { id: 'ADMIN', code: 'ADMIN', role: 'ADMIN', vendorCodes: ['ALL'] };
    mockGetFacturaDetail.mockResolvedValueOnce({
      ...facturaF4306,
      header: { ...facturaF4306.header, vendedor: '93' },
    });

    const res = await request(makeApp()).get('/api/facturas/F/4306/2026');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('factura with empty vendor is allowed only when the client is owned by the scoped vendors', async () => {
    mockGetFacturaDetail.mockResolvedValueOnce({
      ...facturaF4306,
      header: { ...facturaF4306.header, vendedor: '' },
    });

    const denied = await request(makeApp()).get('/api/facturas/F/4306/2026');
    expect(denied.status).toBe(403);
    // vendor-scope normalizeCode strips leading zeros: user code "01" -> scope "1"
    expect(mockIsFacturaClientOwnedByVendors).toHaveBeenCalledWith('4300010400', ['1'], 2026);

    mockIsFacturaClientOwnedByVendors.mockResolvedValueOnce(true);
    const allowed = await request(makeApp()).get('/api/facturas/F/4306/2026');
    expect(allowed.status).toBe(200);
  });

  test('forbidden comercial PDF request never generates a PDF', async () => {
    mockGetFacturaDetail.mockResolvedValueOnce({
      ...facturaF4306,
      header: { ...facturaF4306.header, vendedor: '97' },
    });

    const res = await request(makeApp()).get('/api/facturas/F/4306/2026/pdf');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DOCUMENT_SCOPE_FORBIDDEN');
    expect(mockGetCachedPdf).not.toHaveBeenCalled();
    expect(mockGeneratePdf).not.toHaveBeenCalled();
    expect(mockGenerateDocumentPdf).not.toHaveBeenCalled();
  });
});

describe('GET /api/facturas list scoping', () => {
  test('comercial requesting ALL gets typed 403', async () => {
    const res = await request(makeApp()).get('/api/facturas?vendedorCodes=ALL');

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      code: 'VENDOR_SCOPE_FORBIDDEN',
    });
  });

  test('comercial requesting a vendor outside scope gets typed 403', async () => {
    const res = await request(makeApp()).get('/api/facturas?vendedorCodes=93,97');

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      code: 'VENDOR_SCOPE_FORBIDDEN',
      denied: ['93', '97'],
    });
  });

  test('comercial requesting their own vendor passes scope to the service', async () => {
    const service = require('../services/facturas.service');
    const mockGetFacturas = jest.fn().mockResolvedValue({ facturas: [] });
    service.getFacturas = mockGetFacturas;

    const res = await request(makeApp()).get('/api/facturas?vendedorCodes=01&year=2026');

    expect(res.status).toBe(200);
    expect(mockGetFacturas).toHaveBeenCalledWith(expect.objectContaining({ vendedorCodes: '01' }));
    delete service.getFacturas;
  });

  test('jefe ventas requesting ALL is allowed through to the service', async () => {
    mockUser = { id: '97', code: '97', role: 'JEFE_VENTAS', isJefeVentas: true, vendorCodes: ['ALL'] };
    const service = require('../services/facturas.service');
    const mockGetFacturas = jest.fn().mockResolvedValue({ facturas: [] });
    service.getFacturas = mockGetFacturas;

    const res = await request(makeApp()).get('/api/facturas?vendedorCodes=ALL');

    expect(res.status).toBe(200);
    expect(mockGetFacturas).toHaveBeenCalledWith(expect.objectContaining({ vendedorCodes: 'ALL' }));
    delete service.getFacturas;
  });

  test('missing vendedorCodes still returns 400', async () => {
    const res = await request(makeApp()).get('/api/facturas');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('vendedorCodes is required');
  });

  test('years endpoint blocks ALL for comercial', async () => {
    const res = await request(makeApp()).get('/api/facturas/years?vendedorCodes=ALL');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('VENDOR_SCOPE_FORBIDDEN');
  });

  test('summary endpoint blocks foreign vendor for comercial', async () => {
    const res = await request(makeApp()).get('/api/facturas/summary?vendedorCodes=93');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('VENDOR_SCOPE_FORBIDDEN');
  });
});

describe('POST /api/facturas/send-email recipient restriction', () => {
  test('comercial sending to an email that is not the client email gets typed 422', async () => {
    const res = await request(makeApp())
      .post('/api/facturas/send-email')
      .send({
        serie: 'F',
        numero: 4306,
        ejercicio: 2026,
        destinatario: 'attacker@example.com',
      });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      success: false,
      code: 'EMAIL_DESTINATARIO_NOT_ALLOWED',
    });
    expect(res.body.no_retry_reason).toEqual(expect.any(String));
    expect(mockSendEmailWithPdf).not.toHaveBeenCalled();
  });

  test('comercial sending to the client email on file is allowed', async () => {
    mockGetFacturaDetail.mockResolvedValueOnce({
      ...facturaF4306,
      header: { ...facturaF4306.header, clienteEmail: 'cliente@canito.example' },
    });

    const res = await request(makeApp())
      .post('/api/facturas/send-email')
      .send({
        serie: 'F',
        numero: 4306,
        ejercicio: 2026,
        destinatario: 'cliente@canito.example',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSendEmailWithPdf).toHaveBeenCalledTimes(1);
  });

  test('jefe ventas can send to any destinatario', async () => {
    mockUser = { id: '97', code: '97', role: 'JEFE_VENTAS', isJefeVentas: true, vendorCodes: ['ALL'] };

    const res = await request(makeApp())
      .post('/api/facturas/send-email')
      .send({
        serie: 'F',
        numero: 4306,
        ejercicio: 2026,
        destinatario: 'cualquiera@example.com',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('document without client email on file fails closed for comercial (422)', async () => {
    const res = await request(makeApp())
      .post('/api/facturas/send-email')
      .send({
        serie: 'F',
        numero: 4306,
        ejercicio: 2026,
        destinatario: 'alguien@example.com',
      });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('EMAIL_DESTINATARIO_NOT_ALLOWED');
  });
});

describe('POST /api/facturas/share/whatsapp recipient restriction', () => {
  test('comercial sharing to an arbitrary phone gets typed 422', async () => {
    const res = await request(makeApp())
      .post('/api/facturas/share/whatsapp')
      .send({
        serie: 'F',
        numero: 4306,
        ejercicio: 2026,
        telefono: '600123456',
      });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      success: false,
      code: 'SHARE_DESTINATARIO_NOT_ALLOWED',
    });
  });

  test('jefe ventas can share to any phone', async () => {
    mockUser = { id: '97', code: '97', role: 'JEFE_VENTAS', isJefeVentas: true, vendorCodes: ['ALL'] };

    const res = await request(makeApp())
      .post('/api/facturas/share/whatsapp')
      .send({
        serie: 'F',
        numero: 4306,
        ejercicio: 2026,
        telefono: '600123456',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.whatsappUrl).toContain('wa.me');
  });
});

describe('emailLimiter middleware mounts', () => {
  test('emailLimiter is mounted on send-email and share/email (routes that send SMTP)', () => {
    const { emailLimiter } = require('../middleware/security');

    const routesWithLimiter = facturasRoutes.stack
      .filter((layer) => layer.route)
      .filter((layer) => layer.route.stack.some((mw) => mw.handle === emailLimiter))
      .map((layer) => layer.route.path);

    expect(routesWithLimiter).toEqual(['/send-email', '/share/email']);
  });

  test('emailLimiter is NOT mounted on share/whatsapp (no server-side send)', () => {
    const { emailLimiter } = require('../middleware/security');

    const whatsappLayer = facturasRoutes.stack.find((layer) => layer.route?.path === '/share/whatsapp');
    expect(whatsappLayer).toBeDefined();
    expect(whatsappLayer.route.stack.some((mw) => mw.handle === emailLimiter)).toBe(false);
  });
});
