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
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, res, next) => {
    if (!req.headers.authorization || !mockUser) {
      return res.status(401).json({ success: false, code: 'MISSING_TOKEN' });
    }
    req.user = { ...mockUser };
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

const routes = require('../routes/repartidor');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/repartidor', routes);
  return app;
}

function authenticatedGet(path) {
  return request(makeApp()).get(path).set('Authorization', 'Bearer test-token');
}

function authenticatedPost(path, body) {
  return request(makeApp())
    .post(path)
    .set('Authorization', 'Bearer test-token')
    .send(body);
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
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQueryWithParams.mock.calls[0];
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

  test('allows explicit ADMIN and JEFE_VENTAS roles to use multi-id scope', async () => {
    for (const role of ['ADMIN', 'JEFE_VENTAS']) {
      mockUser = { id: '90', code: '90', role };
      const response = await authenticatedGet('/repartidor/collections/daily/05,06')
        .query({ year: 2026, month: 8 });
      expect(response.status).toBe(200);
    }

    expect(mockQueryWithParams).toHaveBeenCalledTimes(2);
    expect(mockQueryWithParams.mock.calls[0][1]).toEqual([2026, 8, '05', '06']);
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
    expect(params).toEqual(['05', '4300030041', 2026, 20260801, 20260803, 10, 35]);
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
      code: 'REPARTIDOR_DATA_UNAVAILABLE',
      error: 'No se pudo completar la solicitud',
    });
    expect(JSON.stringify(response.body)).not.toContain('SQL30081N');
    expect(JSON.stringify(response.body)).not.toContain('internal-db2');
  });

  test('rejects malformed list members instead of silently truncating them', async () => {
    mockUser = { id: '90', code: '90', role: 'ADMIN' };

    const response = await authenticatedGet('/repartidor/collections/summary/05,123');

    expect(response.status).toBe(400);
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

  test('allows the exact owner and explicit privileged roles', async () => {
    mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '05' }]);
    const own = await authenticatedGet(
      '/repartidor/history/signature?ejercicio=2026&serie=A&terminal=0&numero=1',
    );
    expect(own.status).toBe(200);

    for (const role of ['ADMIN', 'JEFE_VENTAS']) {
      jest.clearAllMocks();
      mockUser = { id: '90', code: '90', role };
      mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '06' }]);
      const privileged = await authenticatedGet(
        '/repartidor/history/signature?ejercicio=2026&serie=A&terminal=0&numero=1',
      );
      expect(privileged.status).toBe(200);
    }
  });

  test.each([
    [[], 404, 'DOCUMENT_NOT_FOUND'],
    [[{ OWNER_ID: '05' }, { OWNER_ID: '06' }], 409, 'DOCUMENT_OWNER_AMBIGUOUS'],
  ])('fails closed for missing or ambiguous ownership', async (owners, status, code) => {
    mockQueryWithParams.mockResolvedValue(owners);

    const response = await authenticatedGet(
      '/repartidor/history/signature?ejercicio=2026&serie=A&terminal=0&numero=1',
    );

    expect(response.status).toBe(status);
    expect(response.body.code).toBe(code);
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);
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
  test('email fails closed after ownership and never invokes a sender or PDF generator', async () => {
    mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '05' }]);

    const response = await authenticatedPost('/repartidor/document/send-email', {
      ...albaranBody,
      destinatario: 'cliente@example.test',
    });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('EMAIL_DELIVERY_LEDGER_REQUIRED');
    expect(mockSendEmailWithPdf).not.toHaveBeenCalled();
    expect(mockGenerateDeliveryReceipt).not.toHaveBeenCalled();
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
    expect(mockQueryWithParams.mock.calls[0][1]).toEqual(['05', 126]);
  });
});
