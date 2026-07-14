'use strict';

const request = require('supertest');
const express = require('express');
const crypto = require('crypto');

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockCachedQuery = jest.fn((fn, sql) => fn(sql));
const mockInvalidateCache = jest.fn();
const mockExportCobroToSystem = jest.fn();
const mockPoolConnect = jest.fn();
const mockConnQuery = jest.fn();
const mockConnClose = jest.fn();

jest.mock('../config/db', () => ({
  query: mockQuery,
  queryWithParams: mockQueryWithParams,
  getPool: () => ({ connect: mockPoolConnect }),
}));

jest.mock('../services/query-optimizer', () => ({
  cachedQuery: mockCachedQuery,
}));

jest.mock('../services/redis-cache', () => ({
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 1800 },
  invalidateCache: mockInvalidateCache,
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../services/dsedac-exports.service', () => ({
  exportCobroToSystem: (...args) => mockExportCobroToSystem(...args),
}));

const cobrosRouter = require('../routes/cobros');

function mockVendorClientScopeHit(sql) {
  return /DSEDAC\.CLP/i.test(sql) || /DSED\.LACLAE/i.test(sql);
}

function makeApp(user = { code: '01', role: 'COMERCIAL' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/', cobrosRouter);
  return app;
}

function paymentIdForTest(value) {
  return `CBR-${crypto.createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function paymentHashForTest({
  clientCode = 'C001',
  reference = 'CVC:FAC:CVC:GMP:2026:M:1:123:1:0',
  amount = 60,
  paymentMethod = '02',
  userId = '01',
} = {}) {
  return crypto.createHash('sha256').update(JSON.stringify({
    clientCode,
    reference,
    amountCents: Math.round(amount * 100),
    paymentMethod,
    userId,
  })).digest('hex');
}

function cvcPaymentRow(overrides = {}) {
  return {
    ID: 'CVC:FAC:CVC:GMP:2026:M:1:123:1:0',
    SOURCE: 'CVC',
    CODIGOCLIENTE: 'C001',
    CODIGOVENDEDOR: '01',
    TIPO_DOCUMENTO: 'FAC',
    ORIGEN_DOCUMENTO: 'CVC',
    SUBEMPRESA: 'GMP',
    EJERCICIO_DOCUMENTO: 2026,
    SERIEPEDIDO: 'M',
    TERMINAL_DOCUMENTO: 1,
    NUMEROPEDIDO: 123,
    XDE: 1,
    DEX: 0,
    IMPORTETOTAL: '100.00',
    ESTADO: 'PENDIENTE',
    LEGACY_COLLISION_COUNT: 1,
    ...overrides,
  };
}

function setupRuntimeRegisterMocks({ existingToken = [], paid = '0.00', pending = '100.00', repartidorPaid = '0.00' } = {}) {
  mockQueryWithParams.mockImplementation(async (sql) => {
    if (/FROM\s+DSEDAC\.CLI\s+CLI/i.test(sql)) return [{ OK: 1 }];
    if (/QSYS2\.SYSTABLES/i.test(sql)) return [{ N: 4 }];
    if (/FROM\s+JAVIER\.PEDIDOS_CAB\s+PC/i.test(sql)) return [];
    if (/FROM\s+DSEDAC\.CVC\s+C/i.test(sql)) return [cvcPaymentRow({ IMPORTETOTAL: pending })];
    if (/FROM\s+JAVIER\.COBROS_IDEMPOTENCY/i.test(sql)) return existingToken;
    if (/COALESCE\(SUM\(IMPORTECOBRADO\)/i.test(sql)) return [{ TOTAL_COBRADO: paid }];
    if (/FROM\s+JAVIER\.REPARTIDOR_COBROS/i.test(sql)) return [{ TOTAL_REP: repartidorPaid }];
    return [];
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockReset();
  mockQueryWithParams.mockReset();
  mockConnQuery.mockReset();
  mockConnClose.mockReset();
  mockPoolConnect.mockReset();
  mockPoolConnect.mockResolvedValue({ query: mockConnQuery, close: mockConnClose });
  mockConnQuery.mockImplementation(async (sql) => {
    if (/FINAL TABLE/i.test(sql)) return [{ RESERVED_NUMERO: 1001 }];
    return [];
  });
});

describe('legacy cobros route DB2 contracts', () => {
  test('GET /:cliente/pendientes reads real CVC long-column layout', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (mockVendorClientScopeHit(sql)) return [{ OK: 1 }];
      if (/FROM\s+DSEDAC\.CVC\s+C/i.test(sql)) {
        return [{
          SERIE_DOCUMENTO: 'M',
          NUMERO_DOCUMENTO: 123,
          XDE: 1,
          CODIGO_CLIENTE: 'C001',
          IMPORTE_TOTAL: 100,
          IMPORTE_COBRADO: 40,
          IMPORTE_PENDIENTE: 60,
          ANO_DOCUMENTO: 2026,
          MES_DOCUMENTO: 6,
          DIA_DOCUMENTO: 1,
          ANO_VENCIMIENTO: 2026,
          MES_VENCIMIENTO: 6,
          DIA_VENCIMIENTO: 30,
          SUBEMPRESA: 'GMP',
          TIPO_DOCUMENTO: 'FAC',
          FORMA_PAGO: '02',
        }];
      }
      return [];
    });

    const res = await request(makeApp()).get('/C001/pendientes');

    expect(res.status).toBe(200);
    expect(res.body.resumen.source).toBe('CVC');
    expect(res.body.resumen.totalPendiente).toBe(60);
    expect(res.body.resumen.documentos.total).toBe(60);
    expect(res.body.resumen.total).toBe(60);
    expect(res.body.cobros[0]).toMatchObject({
      referencia: 'M-123',
      importePendiente: 60,
      importeCobrado: 40,
      fecha: '2026-06-01T00:00:00.000Z',
      fechaVencimiento: '2026-06-30T00:00:00.000Z',
    });

    const cvcSql = mockQueryWithParams.mock.calls.find(([sql]) => /FROM\s+DSEDAC\.CVC\s+C/i.test(sql))[0];
    expect(cvcSql).toContain('CODIGOCLIENTEALBARAN');
    expect(cvcSql).toContain('IMPORTEPENDIENTE');
    expect(cvcSql).not.toMatch(/CVIMCO|CVIMVT|CVCDCL/i);
  });

  test('GET /:cliente/pendientes maps UI document aliases and filters on CVC vencimiento', async () => {
    mockQueryWithParams.mockImplementation(async (sql, params) => {
      if (mockVendorClientScopeHit(sql)) return [{ OK: 1 }];
      if (/FROM\s+DSEDAC\.CVC\s+C/i.test(sql)) {
        expect(params).toEqual(['C001', 'COB', 20260601, 20260630]);
        return [];
      }
      return [];
    });

    const res = await request(makeApp())
      .get('/C001/pendientes')
      .query({ tipoDocumento: 'FAC', fechaDesde: '2026-06-01', fechaHasta: '2026-06-30' });

    expect(res.status).toBe(200);
    const cvcSql = mockQueryWithParams.mock.calls.find(([sql]) => /FROM\s+DSEDAC\.CVC\s+C/i.test(sql))[0];
    expect(cvcSql).toMatch(/TRIM\(C\.TIPODOCUMENTO\)\s+IN\s+\(\?\)/i);
    expect(cvcSql).toMatch(/C\.ANOVENCIMIENTO\s*\*\s*10000\s*\+\s*C\.MESVENCIMIENTO\s*\*\s*100\s*\+\s*C\.DIAVENCIMIENTO\)\s*>=\s*\?/i);
    expect(cvcSql).toMatch(/C\.ANOVENCIMIENTO\s*\*\s*10000\s*\+\s*C\.MESVENCIMIENTO\s*\*\s*100\s*\+\s*C\.DIAVENCIMIENTO\)\s*<=\s*\?/i);
  });

  test('GET /:cliente/estado sums real CVC pending amount without CV aliases', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (mockVendorClientScopeHit(sql)) return [{ OK: 1 }];
      if (/FROM\s+DSEDAC\.CVC\s+C/i.test(sql)) return [{ TOTAL_PENDIENTE: 75, NUM_DOCS: 2 }];
      if (/FROM\s+JAVIER\.COBROS/i.test(sql)) return [{ TOTAL_APP: 10 }];
      if (/FROM\s+JAVIER\.REPARTIDOR_COBROS/i.test(sql)) return [{ TOTAL_REP: 5 }];
      if (/FROM\s+DSEDAC\.CLI/i.test(sql)) return [{ LIMITECREDITO: 1000 }];
      return [];
    });

    const res = await request(makeApp()).get('/C001/estado');

    expect(res.status).toBe(200);
    expect(res.body.estadoCliente.totalPendiente).toBe(60);
    expect(res.body.estadoCliente.limiteCredito).toBe(1000);

    const cvcSql = mockQueryWithParams.mock.calls.find(([sql]) => /FROM\s+DSEDAC\.CVC\s+C/i.test(sql))[0];
    expect(cvcSql).toContain('CODIGOCLIENTEALBARAN');
    expect(cvcSql).toContain('IMPORTEPENDIENTE');
    expect(cvcSql).not.toMatch(/CVIMCO|CVIMVT|CVCDCL/i);
  });

  test('GET /pending-summary/ALL applies limit/page offset and returns pagination contract', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/CLIENT_RANKED/i.test(sql)) {
        return [{
          CLIENTE: 'C001', NOMBRE: 'Cliente Uno', DOC_COUNT: 1,
          TOTAL_PENDIENTE: '100.00', TOTAL_VENCIDO: '0.00',
          GRAND_TOTAL: '100.00', GRAND_TOTAL_VENCIDO: '0.00',
          CVC_GRAND_TOTAL: '100.00', CVC_GRAND_TOTAL_VENCIDO: '0.00',
          CLIENT_COUNT: 1, VENCIDO_CLIENT_COUNT: 0,
        }];
      }
      return [];
    });
    mockQueryWithParams.mockResolvedValue([]);

    const res = await request(makeApp({ code: '98', role: 'JEFE_VENTAS', isJefeVentas: true }))
      .get('/pending-summary/ALL?limit=25&page=3');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      summary: { C001: { total: 100, vencido: 0, count: 1, estado: 'PENDIENTE', nombre: 'Cliente Uno' } },
      grandTotal: 100,
      grandTotalVencido: 0,
      clientCount: 1,
      source: 'CVC',
    });
    expect(res.body.pagination).toEqual({ limit: 25, page: 3, offset: 50, returnedDocuments: 1 });
    const summarySql = mockQuery.mock.calls[0][0];
    expect(summarySql).toMatch(/CLIENT_NET/i);
    expect(summarySql).toMatch(/SCOPE_TOTALS/i);
    expect(summarySql).toMatch(/ROW_NUMBER\(\)\s+OVER\s*\(ORDER BY C\.TOTAL_PENDIENTE DESC,\s+C\.CLIENTE ASC\)/i);
    expect(summarySql).toMatch(/R\.RN\s*>\s*50\s+AND\s+R\.RN\s*<=\s*75/i);
    expect(mockCachedQuery).toHaveBeenCalledTimes(1);
  });

  test('GET /pending-summary/ALL clamps legacy limit to 200', async () => {
    mockQuery.mockResolvedValue([]);
    mockQueryWithParams.mockResolvedValue([]);

    const res = await request(makeApp({ code: '98', role: 'JEFE_VENTAS', isJefeVentas: true }))
      .get('/pending-summary/ALL?limit=999&page=1');

    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(200);
    const sql = mockQuery.mock.calls.map(([text]) => String(text)).join('\n');
    expect(sql).toMatch(/R\.RN\s*>\s*0\s+AND\s+R\.RN\s*<=\s*200/i);
    expect(sql).not.toMatch(/pending-summary-portfolio/i);
  });

  test('GET /pending-summary/ALL uses DB2 aggregate totals for 400-client portfolio without JS portfolio materialization', async () => {
    mockQuery.mockImplementation(async (sql) => {
      expect(sql).toMatch(/CLIENT_RANKED/i);
      return [{
        CLIENTE: 'C001', NOMBRE: 'Cliente Uno', DOC_COUNT: 3,
        TOTAL_PENDIENTE: '250.00', TOTAL_VENCIDO: '50.00',
        GRAND_TOTAL: '40000.00', GRAND_TOTAL_VENCIDO: '5000.00',
        CVC_GRAND_TOTAL: '41000.00', CVC_GRAND_TOTAL_VENCIDO: '5100.00',
        CLIENT_COUNT: 400, VENCIDO_CLIENT_COUNT: 80,
      }];
    });
    mockQueryWithParams.mockResolvedValue([]);

    const res = await request(makeApp({ code: '98', role: 'JEFE_VENTAS', isJefeVentas: true }))
      .get('/pending-summary/ALL?limit=200&page=1');

    expect(res.status).toBe(200);
    expect(res.body.clientCount).toBe(400);
    expect(res.body.grandTotal).toBe(40000);
    expect(res.body.pagination).toEqual({ limit: 200, page: 1, offset: 0, returnedDocuments: 1 });
    expect(mockCachedQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('POST /:cliente/registrar writes runtime COBROS_CAB/LIN payment columns', async () => {
    setupRuntimeRegisterMocks();

    const res = await request(makeApp({ code: '01', role: 'COMERCIAL' }))
      .post('/C001/registrar')
      .send({
        referencia: 'M-123',
        importe: 60,
        formaPago: '02',
        observaciones: 'Pago parcial',
        idempotencyToken: 'token-erp-cobro-001',
      });

    expect(res.status).toBe(200);
    const txSql = mockConnQuery.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(txSql).toMatch(/INSERT\s+INTO\s+JAVIER\.COBROS_IDEMPOTENCY/i);
    expect(txSql).toMatch(/INSERT\s+INTO\s+JAVIER\.COBROS_CAB/i);
    expect(txSql).toMatch(/INSERT\s+INTO\s+JAVIER\.COBROS_LIN/i);
    const cabInsert = mockConnQuery.mock.calls.find(([sql]) => /INSERT\s+INTO\s+JAVIER\.COBROS_CAB/i.test(sql));
    const linInsert = mockConnQuery.mock.calls.find(([sql]) => /INSERT\s+INTO\s+JAVIER\.COBROS_LIN/i.test(sql));
    expect(cabInsert[0]).toContain('IMPORTECOBRADO');
    expect(linInsert[0]).toContain('DOCUMENTOSERIE');
    expect(cabInsert[1]).toContain('C001');
    expect(cabInsert[1]).toContain(60);
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /INSERT\s+INTO\s+JAVIER\.COBROS\b/i.test(sql))).toBe(false);
    expect(mockExportCobroToSystem).not.toHaveBeenCalled();
  });
  test('POST /:cliente/registrar uses DB2-safe primary id for 128 char idem value', async () => {
    const raw = 'A'.repeat(128);
    const normalized = crypto.createHash('sha256').update(raw).digest('hex');
    const expectedId = paymentIdForTest(normalized);
    setupRuntimeRegisterMocks();

    const res = await request(makeApp({ code: '01', role: 'COMERCIAL' }))
      .post('/C001/registrar')
      .send({ referencia: 'M-123', importe: 60, formaPago: '02', idempotencyToken: raw });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(expectedId);
    expect(res.body.id.length).toBeLessThanOrEqual(36);
    const lookupCall = mockQueryWithParams.mock.calls.find(([sql]) => /FROM\s+JAVIER\.COBROS_IDEMPOTENCY/i.test(sql));
    expect(lookupCall[1]).toEqual([expectedId, normalized]);
    const idemInsert = mockConnQuery.mock.calls.find(([sql]) => /INSERT\s+INTO\s+JAVIER\.COBROS_IDEMPOTENCY/i.test(sql));
    expect(idemInsert[1][0]).toBe(normalized);
    expect(idemInsert[1][0].length).toBeLessThanOrEqual(128);
  });

  test('POST /:cliente/registrar replays same idem value with same payload', async () => {
    const raw = 'B'.repeat(64);
    const expectedId = paymentIdForTest(raw);
    setupRuntimeRegisterMocks({ existingToken: [{ IDEMPOTENCY_TOKEN: raw, REQUEST_HASH: paymentHashForTest(), STATUS: 'COMPLETED' }] });

    const res = await request(makeApp({ code: '01', role: 'COMERCIAL' }))
      .post('/C001/registrar')
      .send({ referencia: 'M-123', importe: 60, formaPago: '02', idempotencyToken: raw });

    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
    expect(mockConnQuery.mock.calls.some(([sql]) => /INSERT\s+INTO\s+JAVIER\.COBROS_/i.test(sql))).toBe(false);
  });

  test('POST /:cliente/registrar rejects same idem value with different payload', async () => {
    const raw = 'C'.repeat(64);
    const expectedId = paymentIdForTest(raw);
    setupRuntimeRegisterMocks({ existingToken: [{ IDEMPOTENCY_TOKEN: raw, REQUEST_HASH: 'different-payload', STATUS: 'COMPLETED' }] });

    const res = await request(makeApp({ code: '01', role: 'COMERCIAL' }))
      .post('/C001/registrar')
      .send({ referencia: 'M-123', importe: 60, formaPago: '02', idempotencyToken: raw });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  test('POST /:cliente/registrar preserves repartidor double-payment prevention', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (mockVendorClientScopeHit(sql)) return [{ OK: 1 }];
      if (/FROM\s+JAVIER\.REPARTIDOR_COBROS/i.test(sql)) return [{ TOTAL_REP: 60 }];
      if (/INSERT\s+INTO\s+JAVIER\.COBROS/i.test(sql)) return [];
      return [];
    });

    const res = await request(makeApp({ code: '01', role: 'COMERCIAL' }))
      .post('/C001/registrar')
      .send({ referencia: 'M-123', importe: 60, formaPago: '02', idempotencyToken: 'idem-repartidor-001' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('COBRO_ALREADY_COLLECTED_BY_REPARTIDOR');
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /INSERT\s+INTO\s+JAVIER\.COBROS/i.test(sql))).toBe(false);
  });

  test('GET /:cliente/pendientes flags cobradoPorRepartidor for CTR and REPARTIDOR_COBROS', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (mockVendorClientScopeHit(sql)) return [{ OK: 1 }];
      if (/FROM\s+DSEDAC\.CVC\s+C/i.test(sql)) {
        return [
          {
            SERIE_DOCUMENTO: 'M',
            NUMERO_DOCUMENTO: 10,
            XDE: 1,
            IMPORTE_TOTAL: 100,
            IMPORTE_COBRADO: 0,
            IMPORTE_PENDIENTE: 100,
            ANO_DOCUMENTO: 2026,
            MES_DOCUMENTO: 6,
            DIA_DOCUMENTO: 1,
            ANO_VENCIMIENTO: 2026,
            MES_VENCIMIENTO: 6,
            DIA_VENCIMIENTO: 30,
            TIPO_DOCUMENTO: 'FAC',
            FORMA_PAGO: '01',
          },
          {
            SERIE_DOCUMENTO: 'M',
            NUMERO_DOCUMENTO: 11,
            XDE: 1,
            IMPORTE_TOTAL: 50,
            IMPORTE_COBRADO: 0,
            IMPORTE_PENDIENTE: 50,
            ANO_DOCUMENTO: 2026,
            MES_DOCUMENTO: 6,
            DIA_DOCUMENTO: 1,
            ANO_VENCIMIENTO: 2026,
            MES_VENCIMIENTO: 6,
            DIA_VENCIMIENTO: 30,
            TIPO_DOCUMENTO: 'FAC',
            FORMA_PAGO: '02',
          },
        ];
      }
      if (/FROM\s+JAVIER\.REPARTIDOR_COBROS/i.test(sql)) {
        return [{ DOC_KEY: 'M-11', TOTAL: 50 }];
      }
      if (/FROM\s+JAVIER\.COBROS/i.test(sql)) return [];
      return [];
    });

    const res = await request(makeApp()).get('/C001/pendientes');

    expect(res.status).toBe(200);
    const ctrDoc = res.body.cobros.find((c) => c.referencia === 'M-10');
    const repDoc = res.body.cobros.find((c) => c.referencia === 'M-11');
    expect(ctrDoc).toMatchObject({
      cobradoPorRepartidor: true,
      esCTR: true,
      responsabilidad: 'REPARTIDOR',
    });
    expect(repDoc).toMatchObject({
      cobradoPorRepartidor: true,
      estado: 'COBRADO',
      importePendiente: 0,
    });
  });

  test('GET /:cliente/historico returns COBROS_CAB/LIN rows with pagination contract', async () => {
    const fecha = new Date('2026-06-10T12:30:00.000Z');
    mockQueryWithParams.mockImplementation(async (sql, params) => {
      if (/FROM\s+DSEDAC\.CLI\s+CLI/i.test(sql)) return [{ OK: 1 }];
      if (mockVendorClientScopeHit(sql)) return [{ OK: 1 }];
      if (/FROM\s+JAVIER\.COBROS_CAB\s+C/i.test(sql)) {
        expect(params).toEqual(['C001']);
        return [{
          ID: 'GMP-2026-R-10-1001',
          CODIGO_CLIENTE: 'C001',
          IMPORTE: 25.5,
          FORMA_PAGO: '02',
          REFERENCIA: 'M-100',
          OBSERVACIONES: 'Cobro app',
          FECHA: fecha,
        }];
      }
      return [];
    });

    const res = await request(makeApp()).get('/C001/historico?limit=10&offset=0');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.historico).toHaveLength(1);
    expect(res.body.historico[0]).toMatchObject({
      id: 'GMP-2026-R-10-1001',
      codigoCliente: 'C001',
      importe: 25.5,
      formaPago: '02',
      referencia: 'M-100',
      observaciones: 'Cobro app',
      fecha: fecha.toISOString(),
      IMPORTE: 25.5,
      REFERENCIA: 'M-100',
    });
    const historicoSql = mockQueryWithParams.mock.calls.find(([sql]) => /FROM\s+JAVIER\.COBROS_CAB\s+C/i.test(sql))[0];
    expect(historicoSql).toMatch(/LEFT JOIN\s+JAVIER\.COBROS_LIN\s+L/i);
    expect(historicoSql).toMatch(/OFFSET\s+0\s+ROWS\s+FETCH\s+FIRST\s+10\s+ROWS\s+ONLY/i);
  });

  test('GET /:cliente/historico rejects COMERCIAL outside assigned client scope before DB reads', async () => {
    const res = await request(makeApp({ id: '01', code: '01', role: 'COMERCIAL', clientCodes: ['C001'] }))
      .get('/C999/historico');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockCachedQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });
});

describe('legacy cobros vendor-scope fallback without clientCodes', () => {
  function mockVendorClientScopeMiss() {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/FROM\s+DSEDAC\.CLI/i.test(sql) || /DSEDAC\.CLP/i.test(sql) || /DSED\.LACLAE/i.test(sql)) {
        return [];
      }
      return [];
    });
  }

  test('GET /:cliente/pendientes rejects COMERCIAL outside vendor client scope before debt reads', async () => {
    mockVendorClientScopeMiss();

    const res = await request(makeApp({ id: '01', code: '01', role: 'COMERCIAL' }))
      .get('/C999/pendientes');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockCachedQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /FROM\s+DSEDAC\.CVC/i.test(sql))).toBe(false);
  });

  test('GET /:cliente/pendientes blocks PEDIDOS_CAB fallback for out-of-scope client', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/FROM\s+DSEDAC\.CLI/i.test(sql) || /DSEDAC\.CLP/i.test(sql) || /DSED\.LACLAE/i.test(sql)) {
        return [];
      }
      if (/FROM\s+JAVIER\.PEDIDOS_CAB/i.test(sql)) {
        return [{
          ID: 99,
          NUMEROPEDIDO: 1,
          SERIEPEDIDO: 'M',
          IMPORTETOTAL: 120,
          ESTADO: 'CONFIRMADO',
        }];
      }
      return [];
    });
    mockCachedQuery.mockImplementationOnce(async () => {
      throw new Error('CVC unavailable');
    });

    const res = await request(makeApp({ id: '01', code: '01', role: 'COMERCIAL' }))
      .get('/C999/pendientes');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /PEDIDOS_CAB/i.test(sql))).toBe(false);
  });

  test('GET /:cliente/estado rejects COMERCIAL outside vendor client scope before debt reads', async () => {
    mockVendorClientScopeMiss();

    const res = await request(makeApp({ id: '01', code: '01', role: 'COMERCIAL' }))
      .get('/C999/estado');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockCachedQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /FROM\s+DSEDAC\.CVC/i.test(sql))).toBe(false);
  });

  test('Db2CobrosRepository ensureCobrosTable rejects runtime support unavailable without CREATE TABLE', async () => {
    const { Db2CobrosRepository } = require('../src/modules/cobros/infrastructure/db2-cobros-repository');
    mockQueryWithParams.mockRejectedValueOnce(new Error('SQL0204 Table JAVIER.COBROS_IDEMPOTENCY not found'));

    const repo = new Db2CobrosRepository();
    await expect(repo.ensureCobrosTable()).rejects.toMatchObject({
      code: 'COBROS_RUNTIME_SUPPORT_UNAVAILABLE',
      status: 503,
      message: 'Servicio de cobros no disponible: soporte runtime no configurado',
    });
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /CREATE\s+TABLE/i.test(String(sql)))).toBe(false);
  });

  test('Db2CobrosRepository getPendientes applies due-date filters on CVC vencimiento', async () => {
    const { Db2CobrosRepository } = require('../src/modules/cobros/infrastructure/db2-cobros-repository');
    let cvcSql = '';
    let cvcParams = [];
    mockQuery.mockResolvedValue([]);
    mockQueryWithParams.mockImplementation(async (sql, params) => {
      if (/FROM\s+DSEDAC\.CVC\s+C/i.test(sql)) {
        cvcSql = sql;
        cvcParams = params;
      }
      return [];
    });

    const repo = new Db2CobrosRepository();
    await repo.getPendientes('C001', {
      tipoDocumento: 'FAC',
      fechaDesde: '2026-06-01',
      fechaHasta: '2026-06-30',
    });

    expect(cvcParams.slice(0, 4)).toEqual(['C001', 'COB', 20260601, 20260630]);
    expect(cvcSql).toMatch(/TRIM\(C\.TIPODOCUMENTO\)\s+IN\s+\(\?\)/i);
    expect(cvcSql).toMatch(/C\.ANOVENCIMIENTO\s*\*\s*10000\s*\+\s*C\.MESVENCIMIENTO\s*\*\s*100\s*\+\s*C\.DIAVENCIMIENTO\)\s*>=\s*\?/i);
    expect(cvcSql).toMatch(/C\.ANOVENCIMIENTO\s*\*\s*10000\s*\+\s*C\.MESVENCIMIENTO\s*\*\s*100\s*\+\s*C\.DIAVENCIMIENTO\)\s*<=\s*\?/i);
  });

  test('POST /:cliente/registrar rejects cross-client payment before JAVIER.COBROS insert', async () => {
    mockVendorClientScopeMiss();

    const res = await request(makeApp({ id: '01', code: '01', role: 'COMERCIAL' }))
      .post('/C999/registrar')
      .send({
        referencia: 'M-1',
        importe: 10,
        formaPago: 'CONTADO',
        idempotencyToken: 'legacy-route-vendor-scope-001',
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /INSERT\s+INTO\s+JAVIER\.COBROS/i.test(sql))).toBe(false);
    expect(mockQueryWithParams.mock.calls[0][0]).toMatch(/DSEDAC\.CLI|DSEDAC\.CLP/i);
  });

  describe('commercial cobros daily liquidation contracts', () => {
    test('GET /vencimientos-pendientes/:vendorCode returns tabbed pending maturities with cents, ageing, pagination and vendor scope', async () => {
      mockQuery.mockResolvedValue([
        {
          CLIENTE: 'C001', NOMBRE: 'Cliente Uno', SERIE_DOCUMENTO: 'M', NUMERO_DOCUMENTO: 10,
          TOTAL_PENDIENTE: '75.00', TOTAL_VENCIDO: '0.00', DAYS_REMAINING: 4,
          DAYS_OVERDUE: 0, FORMA_PAGO: '02', TAB: 'CREDITO', CODIGOVENDEDOR: '01',
        },
      ]);
      mockQueryWithParams.mockImplementation(async (sql) => {
        if (/DSEDAC\.CVC/i.test(sql)) {
          return [{
            CLIENTE: 'C001', NOMBRE: 'Cliente Uno', SERIE_DOCUMENTO: 'M', NUMERO_DOCUMENTO: 10,
            TOTAL_PENDIENTE: '75.00', TOTAL_VENCIDO: '0.00', DAYS_REMAINING: 4,
            DAYS_OVERDUE: 0, FORMA_PAGO: '02', TAB: 'CREDITO', CODIGOVENDEDOR: '01',
          }];
        }
        if (/JAVIER\.COBROS/i.test(sql)) return [{ REFERENCIA: 'CVC:M-10', TOTAL_APP: '25.00' }];
        if (/DSEDAC\.CLP|DSED\.LACLAE|DSEDAC\.CLI/i.test(sql)) return [{ OK: 1 }];
        return [];
      });

      const res = await request(makeApp({ code: '01', role: 'COMERCIAL' }))
        .get('/vencimientos-pendientes/01')
        .query({ tab: 'CREDITO', limit: 25, page: 2 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.tabs).toEqual(expect.arrayContaining(['CONTADO', 'CREDITO', 'TALONES']));
      expect(res.body.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          codigoCliente: 'C001',
          tab: 'CREDITO',
          daysRemaining: 4,
          daysOverdue: 0,
          amountPendingCents: 7500,
        }),
      ]));
      expect(res.body.pagination).toMatchObject({ limit: 25, page: 2, offset: 25 });
      const sqls = [...mockQuery.mock.calls, ...mockQueryWithParams.mock.calls]
        .map(([sql]) => String(sql))
        .join('\n');
      expect(sqls).toMatch(/DSEDAC\.CVC/i);
      expect(sqls).toMatch(/DSEDAC\.CLP|DSED\.LACLAE|VENDEDORCOMERCIAL|CODIGOVENDEDOR/i);
      expect(JSON.stringify(mockQueryWithParams.mock.calls.map((call) => call[1] || []))).toContain('01');
    });

    test('GET /minimum-obligation/:vendorCode returns minimum obligation cents and met flag', async () => {
      mockQuery.mockResolvedValue([{ COLLECTABLE_CENTS: 12500, REGISTERED_CENTS: 4000 }]);
      mockQueryWithParams.mockImplementation(async (sql) => {
        if (/DSEDAC\.CVC|JAVIER\.COBROS_CAB/i.test(sql)) {
          return [{ COLLECTABLE_CENTS: 12500, REGISTERED_CENTS: 4000 }];
        }
        if (/DSEDAC\.CLP|DSED\.LACLAE|DSEDAC\.CLI/i.test(sql)) return [{ OK: 1 }];
        return [];
      });

      const res = await request(makeApp({ code: '01', role: 'COMERCIAL' }))
        .get('/minimum-obligation/01')
        .query({ date: '2026-06-27' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        minimumPercent: 60,
        collectableCents: 12500,
        registeredCents: 4000,
        remainingCents: 3500,
        met: false,
      });
      const obligationCall = mockQueryWithParams.mock.calls.find(([sql]) => /REGISTERED AS/i.test(sql));
      expect(obligationCall[0]).toMatch(/C\.FECHAEMISIONANO \* 10000 \+ C\.FECHAEMISIONMES \* 100 \+ C\.FECHAEMISIONDIA/i);
      expect(obligationCall[1]).toEqual(expect.arrayContaining(['01', '2026-06-27', '2026-06-27']));
    });

    test('POST /:codigoCliente/registrar allows partial commercial payment and requires idempotency', async () => {
      setupRuntimeRegisterMocks();

      const partial = await request(makeApp({ code: '01', role: 'COMERCIAL' }))
        .post('/C001/registrar')
        .send({ referencia: 'M-123', importe: 40, formaPago: '02', idempotencyToken: 'partial-cobro-001' });
      const missingIdem = await request(makeApp({ code: '01', role: 'COMERCIAL' }))
        .post('/C001/registrar')
        .send({ referencia: 'M-123', importe: 40, formaPago: '02' });

      expect(partial.status).toBe(200);
      expect(partial.body.success).toBe(true);
      expect(missingIdem.status).toBe(400);
      expect(missingIdem.body.code).toMatch(/IDEMPOTENCY/i);
    });

    test('POST /:codigoCliente/registrar blocks overpay before inserting COBROS row', async () => {
      setupRuntimeRegisterMocks();

      const res = await request(makeApp({ code: '01', role: 'COMERCIAL' }))
        .post('/C001/registrar')
        .send({ referencia: 'M-123', importe: 100.01, formaPago: '02', idempotencyToken: 'overpay-cobro-001' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('OVERPAY_NOT_ALLOWED');
      expect(mockConnQuery.mock.calls.some(([sql]) => /INSERT\s+INTO\s+JAVIER\.COBROS_/i.test(sql))).toBe(false);
    });
  });

});
