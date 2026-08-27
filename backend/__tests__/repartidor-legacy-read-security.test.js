'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockSendEmailWithPdf = jest.fn();
const mockGenerateDeliveryReceipt = jest.fn();
const mockCachedQuery = jest.fn((queryFn, sql, _cacheKey, _ttl, params) => queryFn(sql, params));
let mockUser = { id: '05', code: '05', role: 'REPARTIDOR' };

jest.mock('../config/db', () => ({
  query: (...args) => mockQuery(...args),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));
jest.mock('../services/query-optimizer', () => ({
  cachedQuery: (...args) => mockCachedQuery(...args),
}));
jest.mock('../services/redis-cache', () => ({
  TTL: { REALTIME: 0, SHORT: 60, MEDIUM: 300, LONG: 3600 },
}));
jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../app/services/pdfService', () => ({ generateInvoicePDF: jest.fn() }));
jest.mock('../utils/delivery-status-check', () => ({
  isDeliveryStatusAvailable: jest.fn(() => false),
  isDeliveryStatusNewSchema: jest.fn(() => false),
  getDeliveryStatusJoin: jest.fn(() => ''),
  getDeliveryStatusColumns: jest.fn(() => "CAST(NULL AS VARCHAR(20)) as DELIVERY_STATUS"),
}));
jest.mock('../services/emailPdfService', () => ({
  sendEmailWithPdf: (...args) => mockSendEmailWithPdf(...args),
  generateInvoiceEmailHtml: jest.fn(),
  generateDeliveryEmailHtml: jest.fn(),
  cachePdf: jest.fn(),
  getCachedPdf: jest.fn(),
}));
jest.mock('../services/whatsappCloudService', () => ({
  isConfigured: jest.fn(() => false),
  isEnabled: jest.fn(() => false),
  sendDocumentFromBot: jest.fn(),
}));
jest.mock('../services/whatsappBaileysService', () => ({
  isConfigured: jest.fn(() => false),
  isEnabled: jest.fn(() => false),
  isReady: jest.fn(() => false),
  getStatus: jest.fn(() => ({ provider: 'BAILEYS', enabled: false, ready: false })),
  ensureReady: jest.fn(async () => false),
  sendDocumentFromBot: jest.fn(),
  getQrDataUrl: jest.fn(),
  startSocket: jest.fn(),
}));
jest.mock('../services/whatsappGatewayService', () => ({
  isBotConfigured: jest.fn(() => false),
  isBotReady: jest.fn(() => false),
  getStatus: jest.fn(() => ({ activeProvider: 'NONE', botReady: false })),
  sendDocumentFromBot: jest.fn(),
  baileys: {
    isConfigured: jest.fn(() => false),
    getQrDataUrl: jest.fn(),
    startSocket: jest.fn(),
  },
  cloud: {
    isConfigured: jest.fn(() => false),
  },
}));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, res, next) => {
    if (!req.headers.authorization || !mockUser) {
      return res.status(401).json({ success: false, code: 'MISSING_TOKEN' });
    }
    const selfFleet = mockUser.role === 'REPARTIDOR'
      ? { repartidorCodes: mockUser.repartidorCodes || [mockUser.code] }
      : {};
    req.user = { ...mockUser, ...selfFleet };
    return next();
  },
  requireJefeVentas: (req, res, next) => {
    const role = String(req.user?.role || '').toUpperCase();
    if (role !== 'JEFE_VENTAS' && role !== 'ADMIN') {
      return res.status(403).json({ success: false, code: 'AUTH_JEFE_VENTAS_DENIED' });
    }
    return next();
  },
  requireRoles: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ success: false, code: 'AUTH_ROLE_DENIED' });
    }
    return next();
  },
}));
jest.mock('../services/circuit-breaker', () => ({
  CircuitBreaker: class CircuitBreaker {
    constructor(options) {
      this.options = options;
    }
  },
}));
jest.mock('../app/services/deliveryReceiptService', () => ({
  generateDeliveryReceipt: (...args) => mockGenerateDeliveryReceipt(...args),
}));
jest.mock('../services/facturas.service', () => ({}));
jest.mock('../services/pdf.service', () => ({}));

const previousTableSet = process.env.REPARTO_TABLE_SET;
const previousEmailTestAllowlist = process.env.REPARTO_EMAIL_TEST_ALLOWLIST;
const previousEmailTestSink = process.env.REPARTO_EMAIL_TEST_SINK;
process.env.REPARTO_TABLE_SET = 'isolated_test';
process.env.REPARTO_EMAIL_TEST_ALLOWLIST = 'cliente@example.test,jefe@example.test';
process.env.REPARTO_EMAIL_TEST_SINK = 'cliente@example.test';
const routes = require('../routes/repartidor');

afterAll(() => {
  if (previousTableSet === undefined) delete process.env.REPARTO_TABLE_SET;
  else process.env.REPARTO_TABLE_SET = previousTableSet;
  if (previousEmailTestAllowlist === undefined) delete process.env.REPARTO_EMAIL_TEST_ALLOWLIST;
  else process.env.REPARTO_EMAIL_TEST_ALLOWLIST = previousEmailTestAllowlist;
  if (previousEmailTestSink === undefined) delete process.env.REPARTO_EMAIL_TEST_SINK;
  else process.env.REPARTO_EMAIL_TEST_SINK = previousEmailTestSink;
});

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/repartidor', routes);
  return app;
}

function authenticatedGet(requestPath) {
  const strictDocumentPath = /\/repartidor\/(?:history\/signature|history\/legacy-signature\/|entregas\/[^/]+\/firma|document\/(?:albaran|invoice)\/)/.test(requestPath);
  const hasOwner = /[?&]repartidorId=/.test(requestPath);
  const separator = requestPath.includes('?') ? '&' : '?';
  const scopedPath = mockUser?.role === 'REPARTIDOR' && strictDocumentPath && !hasOwner
    ? `${requestPath}${separator}repartidorId=${encodeURIComponent(mockUser.code)}`
    : requestPath;
  return request(makeApp()).get(scopedPath).set('Authorization', 'Bearer test-token');
}

function authenticatedPost(path, body) {
  const strictDocumentPath = path === '/repartidor/document/send-email'
    || path === '/repartidor/document/share/whatsapp';
  const scopedBody = mockUser?.role === 'REPARTIDOR' && strictDocumentPath && body?.repartidorId === undefined
    ? { ...body, repartidorId: mockUser.code }
    : body;
  return request(makeApp())
    .post(path)
    .set('Authorization', 'Bearer test-token')
    .send(scopedBody);
}

describe('legacy repartidor read security contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: '05', code: '05', role: 'REPARTIDOR' };
    mockQueryWithParams.mockResolvedValue([]);
    mockCachedQuery.mockImplementation((queryFn, sql, _cacheKey, _ttl, params) => queryFn(sql, params));
  });

  test('allows a repartidor to read only its own summary', async () => {
    const response = await authenticatedGet('/repartidor/collections/summary/05')
      .query({ year: 2026, month: 8 });

    expect(response.status).toBe(200);
    const collectionCalls = mockQueryWithParams.mock.calls
      .filter(([sql]) => String(sql).includes('CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA'));
    expect(collectionCalls).toHaveLength(1);
    const [sql, params] = collectionCalls[0];
    expect(params).toEqual([8, 2026, '05']);
    expect(sql).toContain('CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA');
    expect(sql).toContain('CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION');
  });

  test('rejects a repartidor reading a foreign or multi-id scope', async () => {
    const foreign = await authenticatedGet('/repartidor/collections/summary/06');
    const multi = await authenticatedGet('/repartidor/collections/summary/05,06');

    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe('REPARTIDOR_ACCESS_DENIED');
    expect(multi.status).toBe(403);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('allows ADMIN and JEFE_VENTAS in reparto mode to use multi-id scope', async () => {
    for (const role of ['ADMIN', 'JEFE_VENTAS']) {
      mockUser = { id: '90', code: '90', role, activeMode: 'REPARTIDOR', repartidorCodes: ['05', '06'] };
      const response = await authenticatedGet('/repartidor/collections/daily/05,06')
        .query({ year: 2026, month: 8 });
      expect(response.status).toBe(200);
    }

    const collectionCalls = mockQueryWithParams.mock.calls
      .filter(([sql]) => String(sql).includes('CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA'));
    expect(collectionCalls).toHaveLength(2);
    expect(collectionCalls[0][1]).toEqual([2026, 8, '05', '06']);
  });

  test('canonicalizes a one-digit own code before DB2', async () => {
    const response = await authenticatedGet('/repartidor/collections/summary/5')
      .query({ year: 2026, month: 8 });
    expect(response.status).toBe(200);
    const collectionCall = mockQueryWithParams.mock.calls
      .find(([sql]) => String(sql).includes('CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA'));
    expect(collectionCall[1]).toEqual([8, 2026, '05']);
  });

  test('JEFE outside Perfil Reparto is denied fleet access before DB2', async () => {
    mockUser = { id: '90', code: '90', role: 'JEFE_VENTAS', isJefeVentas: true };
    const response = await authenticatedGet('/repartidor/collections/daily/05,06')
      .query({ year: 2026, month: 8 });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('REPARTIDOR_MODE_REQUIRED');
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('does not elevate an inconsistent privilege flag', async () => {
    mockUser = { id: '05', code: '05', role: 'REPARTIDOR', isJefeVentas: true };

    const response = await authenticatedGet('/repartidor/collections/summary/06');

    expect(response.status).toBe(403);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('requires a token before any legacy read', async () => {
    const response = await request(makeApp()).get('/repartidor/collections/summary/05');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('MISSING_TOKEN');
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('requires repartidorId for client documents', async () => {
    const response = await authenticatedGet('/repartidor/history/documents/4300030041');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('REPARTIDOR_ID_REQUIRED');
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('validates and applies deterministic document pagination', async () => {
    const response = await authenticatedGet('/repartidor/history/documents/4300030041')
      .query({
        repartidorId: '05',
        year: 2026,
        dateFrom: '2026-08-01',
        dateTo: '2026-08-03',
        limit: 25,
        offset: 10,
      });

    expect(response.status).toBe(200);
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/LOGICAL_DOCUMENTS[\s\S]*NUMBERED_DOCUMENTS[\s\S]*PAGED_DOCUMENTS/i);
    expect(sql).toContain('ORDER BY SORT_DATE DESC, SORT_NUMBER DESC, LOGICAL_KEY DESC');
    // DB2 for i rejects OFFSET inside CTEs (SQLSTATE 42000). Paginate by ROW_NUMBER bounds.
    expect(sql).toContain('LOGICAL_POSITION > ?');
    expect(sql).toContain('LOGICAL_POSITION <= ?');
    expect(sql).not.toContain('OFFSET ? ROWS');
    expect(params).toEqual(['05', '4300030041', '05', 'ENTREGADO', 'PARCIAL', 'NO_ENTREGADO', 'RECHAZADO', '05', 2026, 20260801, 20260803, 10, 35]);
    expect(response.body.pagination).toEqual({ limit: 25, offset: 10, hasMore: false, nextOffset: 10 });
  });

  test.each([
    [{ limit: 101 }, 'LIMIT_INVALID'],
    [{ offset: 1000001 }, 'OFFSET_INVALID'],
    [{ dateFrom: '2026-02-30' }, 'DATE_FROM_INVALID'],
    [{ year: 1999 }, 'YEAR_INVALID'],
  ])('rejects invalid document filters %#', async (query, code) => {
    const response = await authenticatedGet('/repartidor/history/documents/4300030041')
      .query({ repartidorId: '05', ...query });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe(code);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('returns a typed redacted error instead of a successful empty payload on DB2 failure', async () => {
    mockQueryWithParams.mockRejectedValue(new Error('SQL30081N host=internal-db2 secret-detail'));

    const response = await authenticatedGet('/repartidor/collections/summary/05')
      .query({ year: 2026, month: 8 });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      code: 'REPARTIDOR_COLLECTIONS_UNAVAILABLE',
      error: 'No se pudo completar la solicitud',
    });
    expect(JSON.stringify(response.body)).not.toContain('SQL30081N');
    expect(JSON.stringify(response.body)).not.toContain('internal-db2');
  });

  test('rejects malformed list members instead of silently truncating them', async () => {
    mockUser = { id: '90', code: '90', role: 'ADMIN' };

    const response = await authenticatedGet('/repartidor/collections/summary/05,123');

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('REPARTIDOR_ID_INVALID');
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });
});

describe('retired repartidor mutation contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: '05', code: '05', role: 'REPARTIDOR' };
    mockQuery.mockResolvedValue([]);
    mockQueryWithParams.mockResolvedValue([]);
  });

  test.each([
    '/repartidor/entregas',
    '/repartidor/entregas/123/firma',
    '/repartidor/entregas/123/lineas',
    '/repartidor/cobros',
  ])('returns the typed canonical-route retirement before DB2 work: %s', async (endpoint) => {
    const response = await authenticatedPost(endpoint, { opaque: 'legacy-payload-must-not-run' });

    expect(response.status).toBe(410);
    expect(response.body).toEqual({
      success: false,
      code: 'CANONICAL_REPARTO_ROUTE_REQUIRED',
      error: 'Usa POST /api/repartidor-finanzas/rutero/confirm-delivery-cobro',
    });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('keeps one retirement route per endpoint and removes legacy mutation SQL', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'repartidor.js'), 'utf8');
    const count = (fragment) => source.split(fragment).length - 1;

    expect(count("router.post('/entregas', verifyToken,")).toBe(1);
    expect(count("router.post('/entregas/:entregaId/firma', verifyToken,")).toBe(1);
    expect(count("router.post('/entregas/:entregaId/lineas', verifyToken,")).toBe(1);
    expect(count("router.post('/cobros', verifyToken,")).toBe(1);
    expect(source).toContain('canonicalRepartoMutationRequired');
    expect(source).not.toContain('DELETE FROM JAVIER.REPARTIDOR_FIRMAS WHERE ENTREGA_ID');
    expect(source).not.toContain('DELETE FROM JAVIER.REPARTIDOR_ENTREGA_LINEAS WHERE ENTREGA_ID');
    expect(source).not.toContain('INSERT INTO JAVIER.REPARTIDOR_ENTREGA_LINEAS');
    expect(source).not.toContain('ENTREGA_APP_ID');
    expect(source).not.toContain('exportEntregaToSystem');
    expect(source).not.toContain('Math.random().toString(36).slice(2)');
    expect(source).not.toContain('Error in POST /entregas');
    expect(source).not.toContain('Error in POST /cobros');
  });
});

describe('document ownership and side-effect contracts', () => {
  const albaranBody = {
    ejercicio: 2026,
    serie: 'A',
    terminal: 0,
    numero: 1,
    type: 'albaran',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ENABLE_REPARTIDOR_SIGNATURE_DEBUG;
    mockUser = { id: '05', code: '05', role: 'REPARTIDOR' };
    mockQuery.mockResolvedValue([]);
    mockQueryWithParams.mockResolvedValue([]);
  });

  test.each([
    ['/repartidor/history/signature?ejercicio=2026&serie=A&terminal=0&numero=1', [2026, 'A', 0, 1]],
    ['/repartidor/entregas/123/firma', ['123']],
    ['/repartidor/history/legacy-signature/2026-A-0-1', [2026, 'A', 0, 1]],
    ['/repartidor/document/albaran/2026/A/0/1/pdf', [2026, 'A', 0, 1]],
    ['/repartidor/document/invoice/2026/F/7/pdf', [2026, 'F', 7]],
  ])('rejects foreign ownership before route work: %s', async (path, expectedParams) => {
    mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '06' }]);

    const response = await authenticatedGet(path);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('DOCUMENT_ACCESS_DENIED');
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);
    expect(mockQueryWithParams.mock.calls[0][1]).toEqual(expectedParams);
  });

  test.each([
    '/repartidor/history/signature?ejercicio=2026&serie=A&terminal=0&numero=1',
    '/repartidor/entregas/123/firma',
    '/repartidor/history/legacy-signature/2026-A-0-1',
  ])('JEFE reparto signatures require a concrete owner before DB2: %s', async (path) => {
    mockUser = { id: '90', code: '90', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' };
    const response = await authenticatedGet(path);
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('DOCUMENT_OWNER_REQUIRED');
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('allows the exact owner and explicit privileged roles', async () => {
    mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '05' }]);
    const own = await authenticatedGet(
      '/repartidor/history/signature?ejercicio=2026&serie=A&terminal=0&numero=1',
    );
    expect(own.status).toBe(200);

    for (const role of ['ADMIN', 'JEFE_VENTAS']) {
      jest.clearAllMocks();
      mockUser = { id: '90', code: '90', role, activeMode: 'REPARTIDOR', repartidorCodes: ['06'] };
      mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '06' }]);
      const suffix = '&repartidorId=06';
      const privileged = await authenticatedGet(
        `/repartidor/history/signature?ejercicio=2026&serie=A&terminal=0&numero=1${suffix}`,
      );
      expect(privileged.status).toBe(200);
    }
  });

  test('fails closed for missing ownership', async () => {
    mockQueryWithParams.mockResolvedValue([]);

    const response = await authenticatedGet(
      '/repartidor/history/signature?ejercicio=2026&serie=A&terminal=0&numero=1',
    );

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('DOCUMENT_NOT_FOUND');
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);
  });

  test('owner among multiple OPP rows can read the document', async () => {
    mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '05' }, { OWNER_ID: '06' }]);

    const response = await authenticatedGet(
      '/repartidor/history/signature?ejercicio=2026&serie=A&terminal=0&numero=1',
    );

    expect(response.status).toBe(200);
  });

  test('non-owner among multiple OPP rows is denied', async () => {
    mockUser = { id: '07', code: '07', role: 'REPARTIDOR' };
    mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '05' }, { OWNER_ID: '06' }]);

    const response = await authenticatedGet(
      '/repartidor/history/signature?ejercicio=2026&serie=A&terminal=0&numero=1',
    );

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('DOCUMENT_ACCESS_DENIED');
  });

  test('allows COMERCIAL to preview an albaran sold by their vendor code', async () => {
    mockUser = { id: '33', code: '33', role: 'COMERCIAL' };
    mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '06', VENDOR_ID: '33' }]);

    const response = await authenticatedGet('/repartidor/document/albaran/2026/A/0/1/pdf');

    expect(response.status).not.toBe(403);
    expect(response.body.code).not.toBe('DOCUMENT_ACCESS_DENIED');
  });

  test('denies COMERCIAL when vendor does not match even if driver code collides', async () => {
    mockUser = { id: '33', code: '33', role: 'COMERCIAL' };
    mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '33', VENDOR_ID: '06' }]);

    const response = await authenticatedGet('/repartidor/document/albaran/2026/A/0/1/pdf');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('DOCUMENT_ACCESS_DENIED');
  });

  test('denies REPARTIDOR when they are not the driver even if they match vendor', async () => {
    mockUser = { id: '33', code: '33', role: 'REPARTIDOR' };
    mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '06', VENDOR_ID: '33' }]);

    const response = await authenticatedGet('/repartidor/document/albaran/2026/A/0/1/pdf');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('DOCUMENT_ACCESS_DENIED');
  });

  test('privileged role without hint fails closed on ambiguous owners', async () => {
    mockUser = { id: '90', code: '90', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' };

    const response = await authenticatedGet(
      '/repartidor/document/invoice/2026/F/7/pdf',
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('DOCUMENT_OWNER_REQUIRED');
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('privileged role with owner hint resolves ambiguous invoice ownership', async () => {
    mockUser = { id: '90', code: '90', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', repartidorCodes: ['05'] };
    mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '05' }, { OWNER_ID: '06' }]);

    const response = await authenticatedGet(
      '/repartidor/document/invoice/2026/F/7/pdf?repartidorId=05',
    );

    expect(response.status).not.toBe(409);
    expect(response.status).not.toBe(403);
    expect(response.body.code).not.toBe('DOCUMENT_OWNER_AMBIGUOUS');
  });

  test('hides signature debug by default without querying DB2', async () => {
    mockUser = { id: '90', code: '90', role: 'ADMIN' };

    const response = await authenticatedGet('/repartidor/debug/signatures');

    expect(response.status).toBe(404);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('signature debug requires both non-production flag and ADMIN', async () => {
    process.env.ENABLE_REPARTIDOR_SIGNATURE_DEBUG = 'true';
    mockUser = { id: '05', code: '05', role: 'REPARTIDOR' };
    const repartidor = await authenticatedGet('/repartidor/debug/signatures');
    expect(repartidor.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();

    mockUser = { id: '90', code: '90', role: 'ADMIN' };
    mockQuery.mockResolvedValue([]);
    const admin = await authenticatedGet('/repartidor/debug/signatures');
    expect(admin.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
  test('email sends the owned document PDF, writes the TEST ledger, and invokes the sender', async () => {
    const previous = process.env.REPARTO_TABLE_SET;
    process.env.REPARTO_TABLE_SET = 'isolated_test';
    const { generateInvoicePDF } = require('../app/services/pdfService');
    generateInvoicePDF.mockResolvedValue(Buffer.from('%PDF-1.4'));
    mockSendEmailWithPdf.mockResolvedValue({ messageId: 'mid-1' });
    mockQueryWithParams
      .mockResolvedValueOnce([{ OWNER_ID: '05' }])
      .mockResolvedValueOnce([{
        NUMEROALBARAN: 1, SERIEALBARAN: 'A', IMPORTETOTAL: 10, NOMBRECLIENTEFACTURA: 'Cliente',
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    try {
      const response = await authenticatedPost('/repartidor/document/send-email', {
        ...albaranBody,
        destinatario: 'cliente@example.test',
        repartidorId: '05',
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ success: true, messageId: 'mid-1', ledgerWritten: true });
      expect(mockSendEmailWithPdf).toHaveBeenCalledTimes(1);
      expect(mockSendEmailWithPdf.mock.calls[0][0]).toMatchObject({
        to: 'cliente@example.test',
        pdfFilename: expect.stringMatching(/Albaran_A-1\.pdf/i),
      });
      const ledgerCall = mockQueryWithParams.mock.calls.find(([sql]) =>
        /INSERT INTO JAVIER\.TEST_REPARTIDOR_COBROS_AUDIT/i.test(sql));
      expect(ledgerCall).toBeDefined();
      expect(ledgerCall[1][3]).not.toContain('@');
    } finally {
      if (previous === undefined) delete process.env.REPARTO_TABLE_SET;
      else process.env.REPARTO_TABLE_SET = previous;
    }
  });

  test('email validates recipient before DB2 and rejects JEFE selector BOLA', async () => {
    const invalidEmail = await authenticatedPost('/repartidor/document/send-email', {
      ...albaranBody,
      destinatario: 'basura',
      repartidorId: '05',
    });
    expect(invalidEmail.status).toBe(422);
    expect(invalidEmail.body.code).toBe('EMAIL_INVALID');
    expect(mockQueryWithParams).not.toHaveBeenCalled();

    mockUser = {
      id: '90',
      code: '90',
      role: 'JEFE_VENTAS',
      activeMode: 'REPARTIDOR',
      repartidorCodes: ['05', '06'],
    };
    const missing = await authenticatedPost('/repartidor/document/send-email', {
      ...albaranBody,
      destinatario: 'jefe@example.test',
    });
    const all = await authenticatedPost('/repartidor/document/send-email', {
      ...albaranBody,
      destinatario: 'jefe@example.test',
      repartidorId: 'ALL',
    });
    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe('DOCUMENT_OWNER_REQUIRED');
    expect(all.status).toBe(422);
    expect(all.body.code).toBe('DOCUMENT_OWNER_REQUIRED');
    expect(mockQueryWithParams).not.toHaveBeenCalled();

    mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '05' }]);
    const foreign = await authenticatedPost('/repartidor/document/send-email', {
      ...albaranBody,
      destinatario: 'jefe@example.test',
      repartidorId: '06',
    });
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe('DOCUMENT_ACCESS_DENIED');
    expect(mockSendEmailWithPdf).not.toHaveBeenCalled();
  });

  test('JEFE reparto PDF rejects foreign and ALL owner hints', async () => {
    mockUser = {
      id: '90', code: '90', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR',
      repartidorCodes: ['05', '06'],
    };
    mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '05' }]);
    const foreign = await authenticatedGet(
      '/repartidor/document/invoice/2026/F/7/pdf?repartidorId=06',
    );
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe('DOCUMENT_ACCESS_DENIED');

    jest.clearAllMocks();
    mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '05' }]);
    const all = await authenticatedGet(
      '/repartidor/document/invoice/2026/F/7/pdf?repartidorId=ALL',
    );
    expect(all.status).toBe(422);
    expect(all.body.code).toBe('DOCUMENT_OWNER_REQUIRED');
  });

  test('email requires JEFE reparto mode before DB2', async () => {
    mockUser = { id: '90', code: '90', role: 'JEFE_VENTAS' };
    const response = await authenticatedPost('/repartidor/document/send-email', {
      ...albaranBody,
      destinatario: 'jefe@example.test',
      repartidorId: '05',
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('DOCUMENT_REPARTO_MODE_REQUIRED');
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('email fails closed when provider omits messageId', async () => {
    const { generateInvoicePDF } = require('../app/services/pdfService');
    generateInvoicePDF.mockResolvedValue(Buffer.from('%PDF-1.4'));
    mockSendEmailWithPdf.mockResolvedValue({});
    mockQueryWithParams
      .mockResolvedValueOnce([{ OWNER_ID: '05' }])
      .mockResolvedValueOnce([{
        NUMEROALBARAN: 1, SERIEALBARAN: 'A', IMPORTETOTAL: 10, NOMBRECLIENTEFACTURA: 'Cliente',
      }])
      .mockResolvedValueOnce([]);
    const response = await authenticatedPost('/repartidor/document/send-email', {
      ...albaranBody,
      destinatario: 'cliente@example.test',
      repartidorId: '05',
    });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('DOCUMENT_EMAIL_MESSAGE_ID_REQUIRED');
    expect(mockQueryWithParams).toHaveBeenCalledTimes(3);
  });

  test('email fails closed when TEST ledger write fails', async () => {
    const previous = process.env.REPARTO_TABLE_SET;
    process.env.REPARTO_TABLE_SET = 'isolated_test';
    const { generateInvoicePDF } = require('../app/services/pdfService');
    generateInvoicePDF.mockResolvedValue(Buffer.from('%PDF-1.4'));
    mockSendEmailWithPdf.mockResolvedValue({ messageId: 'mid-ledger-fail' });
    mockQueryWithParams
      .mockResolvedValueOnce([{ OWNER_ID: '05' }])
      .mockResolvedValueOnce([{
        NUMEROALBARAN: 1, SERIEALBARAN: 'A', IMPORTETOTAL: 10, NOMBRECLIENTEFACTURA: 'Cliente',
      }])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('ledger unavailable'));
    try {
      const response = await authenticatedPost('/repartidor/document/send-email', {
        ...albaranBody,
        destinatario: 'cliente@example.test',
        repartidorId: '05',
      });
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('EMAIL_DELIVERY_LEDGER_REQUIRED');
      expect(mockSendEmailWithPdf).toHaveBeenCalledTimes(1);
    } finally {
      if (previous === undefined) delete process.env.REPARTO_TABLE_SET;
      else process.env.REPARTO_TABLE_SET = previous;
    }
  });

  test('server routes document email through the finance write guard', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    expect(source).toMatch(
      /req\.path === '\/document\/send-email'[\s\S]{0,120}repartoFinanceWriteGuard/,
    );
  });

  test('WhatsApp rejects BOLA and returns only a local share intent to the owner', async () => {
    mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '06' }]);
    const foreign = await authenticatedPost('/repartidor/document/share/whatsapp', {
      ...albaranBody,
      telefono: '+34 600 000 000',
    });
    expect(foreign.status).toBe(403);
    expect(mockGenerateDeliveryReceipt).not.toHaveBeenCalled();

    mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '05' }]);
    const own = await authenticatedPost('/repartidor/document/share/whatsapp', {
      ...albaranBody,
      telefono: '+34 600 000 000',
    });
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({
      localShare: true,
      sent: false,
      deliveryConfirmed: false,
      shareMode: 'LOCAL_USER_ACTION',
    });
    expect(own.body.pdfBase64).toBeUndefined();
    expect(mockSendEmailWithPdf).not.toHaveBeenCalled();
    expect(mockGenerateDeliveryReceipt).not.toHaveBeenCalled();
  });

  test.each([
    '/repartidor/history/signature?ejercicio=2026&serie=A&terminal=0&numero=1',
    '/repartidor/entregas/123/firma',
    '/repartidor/history/legacy-signature/2026-A-0-1',
  ])('returns typed 503 when signature SQL fails: %s', async (path) => {
    mockQueryWithParams
      .mockResolvedValueOnce([{ OWNER_ID: '05' }])
      .mockRejectedValueOnce(new Error('SQL30081N host=internal-db2 secret-detail'));

    const response = await authenticatedGet(path);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      code: 'REPARTIDOR_SIGNATURE_FAILED',
      error: 'No se pudo completar la solicitud',
    });
    expect(JSON.stringify(response.body)).not.toContain('SQL30081N');
    expect(JSON.stringify(response.body)).not.toContain('internal-db2');
  });

  test('objectives cache isolates normalized client scopes', async () => {
    const first = await authenticatedGet('/repartidor/history/objectives/05')
      .query({ clientId: ' C1 ' });
    const second = await authenticatedGet('/repartidor/history/objectives/05')
      .query({ clientId: 'C2' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mockCachedQuery).toHaveBeenCalledTimes(2);
    expect(mockCachedQuery.mock.calls[0][2]).toBe('repartidor:objectives:05:C1');
    expect(mockCachedQuery.mock.calls[0][4]).toEqual(['05', 'C1']);
    expect(mockCachedQuery.mock.calls[1][2]).toBe('repartidor:objectives:05:C2');
    expect(mockCachedQuery.mock.calls[1][4]).toEqual(['05', 'C2']);
  });
  test('redacts DB2 ownership failures', async () => {
    mockQueryWithParams.mockRejectedValue(new Error('SQL30081N host=internal-db2 customer=secret'));

    const response = await authenticatedGet(
      '/repartidor/history/signature?ejercicio=2026&serie=A&terminal=0&numero=1',
    );

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('DOCUMENT_OWNER_LOOKUP_FAILED');
    expect(JSON.stringify(response.body)).not.toContain('SQL30081N');
    expect(JSON.stringify(response.body)).not.toContain('internal-db2');
  });
});
describe('fleet client cards preserve a concrete owner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: '90', code: '90', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', repartidorCodes: ['05', '06'] };
    mockCachedQuery.mockImplementation((queryFn, sql, _cacheKey, _ttl, params) => queryFn(sql, params));
  });

  test('same ERP client assigned to two drivers remains two isolated cards', async () => {
    mockQueryWithParams.mockResolvedValue([
      { ID: 'C1', NAME: 'Cliente', ADDRESS: 'Ruta 1', TOTAL_DOCS: 2, TOTAL_AMOUNT: 20, LAST_VISIT: 20260818, OWNER_ID: '5' },
      { ID: 'C1', NAME: 'Cliente', ADDRESS: 'Ruta 2', TOTAL_DOCS: 3, TOTAL_AMOUNT: 30, LAST_VISIT: 20260817, OWNER_ID: '06' },
    ]);
    const response = await authenticatedGet('/repartidor/history/clients/5,06');
    expect(response.status).toBe(200);
    expect(response.body.clients).toEqual([
      expect.objectContaining({ id: 'C1', repCode: '05', totalDocuments: 2 }),
      expect.objectContaining({ id: 'C1', repCode: '06', totalDocuments: 3 }),
    ]);
    expect(mockQueryWithParams.mock.calls[0][0]).toContain(
      'ORDER BY LAST_VISIT DESC, ID ASC, OWNER_ID ASC',
    );
    const [sql] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/CODIGOREPARTIDOR[\s\S]*OWNER_ID/);
  });
});

describe('client pagination beyond the first 100', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: '05', code: '05', role: 'REPARTIDOR' };
    mockCachedQuery.mockImplementation((queryFn, sql, _cacheKey, _ttl, params) =>
      queryFn(sql, params),
    );
  });

  test('returns page two with deterministic hasMore metadata', async () => {
    mockQueryWithParams.mockResolvedValue(
      Array.from({ length: 126 }, (_, index) => ({
        ID: `C${String(index).padStart(3, '0')}`,
        NAME: `Cliente ${index}`,
        ADDRESS: '',
        TOTAL_DOCS: 1,
        TOTAL_AMOUNT: 10,
        LAST_VISIT: 20260803 - index,
        OWNER_ID: '05',
      })),
    );

    const response = await authenticatedGet('/repartidor/history/clients/05')
      .query({ limit: 25, offset: 100 });

    expect(response.status).toBe(200);
    expect(response.body.clients).toHaveLength(25);
    expect(response.body.pagination).toEqual({
      limit: 25,
      offset: 100,
      hasMore: true,
    });
    expect(mockQueryWithParams.mock.calls[0][1]).toEqual(['05', '05', 100, 26]);
  });
});
