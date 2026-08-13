'use strict';

const express = require('express');
const request = require('supertest');

let mockAuthUser = { id: 'V94', code: '94', role: 'REPARTIDOR' };
let mockUploadFile = null;
const mockQueryWithParams = jest.fn();
const mockConnQuery = jest.fn();
const mockSaveReceipt = jest.fn();
const mockGenerateDeliveryReceipt = jest.fn();
const mockSendEmailWithPdf = jest.fn();
const mockGetCachedPdf = jest.fn();
const mockCachePdf = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerError = jest.fn();
const mockWriteFile = jest.fn();

jest.mock('multer', () => {
  const multer = jest.fn(() => ({
    single: () => (req, _res, next) => {
      req.file = mockUploadFile;
      next();
    },
  }));
  multer.memoryStorage = jest.fn(() => ({}));
  multer.MulterError = class MulterError extends Error {};
  return multer;
});

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: (...args) => mockWriteFile(...args),
    unlink: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: (...args) => mockQueryWithParams(...args),
  getPool: () => ({
    connect: jest.fn().mockResolvedValue({
      query: (...args) => mockConnQuery(...args),
      close: jest.fn().mockResolvedValue(undefined),
    }),
  }),
}));

jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => {
    req.user = { ...mockAuthUser };
    next();
  },
}));

jest.mock('../middleware/logger', () => ({
  info: (...args) => mockLoggerInfo(...args),
  warn: (...args) => mockLoggerWarn(...args),
  error: (...args) => mockLoggerError(...args),
  debug: jest.fn(),
}));

jest.mock('../services/query-optimizer', () => ({
  cachedQuery: (queryFn, sql, _cacheKey, _ttl, params) => queryFn(sql, params),
}));

jest.mock('../services/redis-cache', () => ({
  TTL: { REALTIME: 0, SHORT: 60, MEDIUM: 300, LONG: 3600 },
}));

jest.mock('../utils/delivery-status-check', () => ({
  isDeliveryStatusAvailable: jest.fn(() => true),
  isDeliveryStatusNewSchema: jest.fn(() => true),
  getDeliveryStatusJoin: jest.fn(() => ''),
}));

jest.mock('../app/services/deliveryReceiptService', () => ({
  saveReceipt: (...args) => mockSaveReceipt(...args),
  generateDeliveryReceipt: (...args) => mockGenerateDeliveryReceipt(...args),
}));

jest.mock('../services/emailPdfService', () => ({
  sendEmailWithPdf: (...args) => mockSendEmailWithPdf(...args),
  generateDeliveryEmailHtml: jest.fn(() => '<p>receipt</p>'),
  cachePdf: (...args) => mockCachePdf(...args),
  getCachedPdf: (...args) => mockGetCachedPdf(...args),
}));

const entregasRoutes = require('../routes/entregas');

function makeApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/', entregasRoutes);
  return app;
}

function pngFile(overrides = {}) {
  return {
    originalname: 'proof.png',
    mimetype: 'image/png',
    size: 8,
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    path: 'C:\\server\\uploads\\photos\\proof.png',
    filename: 'proof.png',
    ...overrides,
  };
}

function ownerRow(code = '94') {
  return [{ CODIGO_REPARTIDOR: code }];
}

describe('legacy reparto mutation endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = { id: 'V94', code: '94', role: 'REPARTIDOR' };
    mockUploadFile = pngFile();
    mockQueryWithParams.mockResolvedValue(ownerRow('94'));
  });

  test.each([
    ['/uploads/photo', '/api/repartidor-finanzas/rutero/evidence/photo'],
    ['/uploads/signature', '/api/repartidor-finanzas/rutero/evidence/signature'],
    ['/update', '/api/repartidor-finanzas/rutero/confirm-delivery-cobro'],
  ])('returns 410 for %s without filesystem or DB2 writes', async (url, canonicalEndpoint) => {
    const res = await request(makeApp()).post(url).send({
      entregaId: '2026-S-10-404-4300009479',
      firma: 'data:image/png;base64,iVBORw0KGgo=',
      status: 'ENTREGADO',
      repartidorId: '94',
    });

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({
      success: false,
      code: 'REPARTO_CANONICAL_ENDPOINT_REQUIRED',
      canonicalEndpoint,
    });
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

describe('server-derived and ownership-protected receipts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = { id: 'V94', code: '94', role: 'REPARTIDOR' };
    mockUploadFile = pngFile();
    mockQueryWithParams.mockResolvedValue(ownerRow('94'));
    mockSaveReceipt.mockResolvedValue({
      buffer: Buffer.from('%PDF-1.4'),
      filePath: 'receipt.pdf',
      relativePath: 'receipt.pdf',
    });
    mockGenerateDeliveryReceipt.mockResolvedValue(Buffer.from('%PDF-1.4'));
    mockSendEmailWithPdf.mockResolvedValue({ success: true, messageId: 'message-1' });
    mockGetCachedPdf.mockReturnValue(null);
  });

  test.each([
    ['/receipt/2026-S-10-404-4300009479', {}],
    ['/receipt/2026-S-10-404-4300009479/email', { email: 'recipient@example.invalid' }],
    ['/receipt/2026-S-10-404-4300009479/whatsapp', { telefono: '600000000' }],
  ])('returns 410 for retired receipt endpoint %s without reads or side effects', async (url, extra) => {
    const res = await request(makeApp())
      .post(url)
      .send({
        ...extra,
        clientName: 'FORGED CLIENT',
        total: 999,
        items: [{ descripcion: 'FORGED ITEM', cantidad: 99 }],
      });

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({
      success: false,
      code: 'REPARTO_CANONICAL_RECEIPT_ENDPOINT_REQUIRED',
    });
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockSaveReceipt).not.toHaveBeenCalled();
    expect(mockGenerateDeliveryReceipt).not.toHaveBeenCalled();
    expect(mockSendEmailWithPdf).not.toHaveBeenCalled();
  });

  test('never accepts client-provided receipt quantities or identity', async () => {
    const res = await request(makeApp())
      .post('/receipt/2026-S-10-404-4300009479')
      .send({
        signaturePath: 'opaque-signature-id',
        clientCode: 'FORGED',
        clientName: 'FORGED CLIENT',
        subtotal: 999,
        iva: 999,
        total: 999,
        items: [{ descripcion: 'FORGED ITEM', cantidad: 99 }],
        firmante: 'FORGED PERSON',
        firmanteDni: '00000000T',
      });

    expect(res.status).toBe(410);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockSaveReceipt).not.toHaveBeenCalled();
    expect(mockGenerateDeliveryReceipt).not.toHaveBeenCalled();
  });
});

describe('delivery detail identity and ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = { id: 'V94', code: '94', role: 'REPARTIDOR' };
  });

  test('requires client code before querying a non-unique albarán number', async () => {
    mockQueryWithParams.mockResolvedValueOnce([
      { CLIENTE: '4300009479' },
      { CLIENTE: '4300001111' },
    ]);

    const res = await request(makeApp()).get('/albaran/404/2026?serie=S&terminal=10');

    expect(res.status).toBe(400);
    expect(res.body).toEqual(expect.objectContaining({ code: 'CLIENT_REQUIRED' }));
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);
    expect(mockQueryWithParams.mock.calls[0][0]).toMatch(/SELECT DISTINCT/i);
  });

  test('returns 409 instead of selecting an arbitrary header for an ambiguous identity', async () => {
    mockQueryWithParams.mockResolvedValue([
      { CODIGO_REPARTIDOR: '94', CLIENTE: '4300009479' },
      { CODIGO_REPARTIDOR: '94', CLIENTE: '4300009479' },
    ]);

    const res = await request(makeApp()).get('/albaran/404/2026?serie=S&terminal=10&cliente=4300009479');

    expect(res.status).toBe(409);
    expect(res.body).toEqual(expect.objectContaining({ code: 'AMBIGUOUS_DELIVERY_IDENTITY' }));
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/OPP\.SUBEMPRESA\s*=\s*CPC\.SUBEMPRESAPEDIDO/i);
    expect(sql).not.toMatch(/FETCH FIRST 1 ROWS ONLY/i);
    expect(params).toEqual(['404', '2026', '4300009479', 'S', '10']);
  });

  test('enforces the resolved delivery owner after the complete identity lookup', async () => {
    mockQueryWithParams.mockResolvedValue([{ CODIGO_REPARTIDOR: '95', CLIENTE: '4300009479' }]);

    const res = await request(makeApp()).get('/albaran/404/2026?serie=S&terminal=10&cliente=4300009479');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);
  });

  test('uses the real LAC quantity, package, unit-price and amount columns with deterministic order', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (sql.includes('FROM DSEDAC.CPC CPC')) return [{
        CODIGO_REPARTIDOR: '94', EJERCICIOALBARAN: 2026, SERIEALBARAN: 'S', TERMINALALBARAN: 10,
        NUMEROALBARAN: 404, CLIENTE: '4300009479', IMPORTE: 0, IMPORTE_BRUTO: 0,
      }];
      if (sql.includes('FROM JAVIER.TEST_REPARTO_CONFIRMACIONES')) return [];
      if (sql.includes('FROM DSEDAC.LAC')) return [];
      return [];
    });

    const res = await request(makeApp()).get('/albaran/404/2026?serie=S&terminal=10&cliente=4300009479');

    expect(res.status).toBe(200);
    const lacCall = mockQueryWithParams.mock.calls.find(([sql]) => sql.includes('FROM DSEDAC.LAC'));
    expect(lacCall).toBeTruthy();
    const [sql] = lacCall;
    expect(sql).toMatch(/CANTIDADUNIDADES[\s\S]*CANTIDADENVASES[\s\S]*PRECIOVENTA[\s\S]*IMPORTEVENTA[\s\S]*UNIDADMEDIDA/i);
    expect(sql).toMatch(/ORDER BY SECUENCIA/i);
  });
});
