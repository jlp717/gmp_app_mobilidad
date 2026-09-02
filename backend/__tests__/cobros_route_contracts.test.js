'use strict';

const request = require('supertest');
const express = require('express');
const crypto = require('crypto');

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockCachedQuery = jest.fn((fn, sql) => fn(sql));
const mockInvalidateCache = jest.fn();

jest.mock('../config/db', () => ({
  query: mockQuery,
  queryWithParams: mockQueryWithParams,
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

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockReset();
  mockQueryWithParams.mockReset();
});

describe('legacy cobros route DB2 contracts', () => {
  test('GET /:cliente/pendientes reads real CVC long-column layout', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (mockVendorClientScopeHit(sql)) return [{ OK: 1 }];
      if (/FROM\s+JAVIER\.VISTA_DEUDA_BASE\s+C/i.test(sql)) {
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

    const cvcSql = mockQueryWithParams.mock.calls.find(([sql]) => /FROM\s+JAVIER\.VISTA_DEUDA_BASE\s+C/i.test(sql))[0];
    expect(cvcSql).toContain('CODIGOCLIENTEALBARAN');
    expect(cvcSql).toContain('IMPORTEPENDIENTE');
    expect(cvcSql).not.toMatch(/CVIMCO|CVIMVT|CVCDCL/i);
  });

  test('GET /:cliente/pendientes maps UI document aliases and filters on CVC vencimiento', async () => {
    mockQueryWithParams.mockImplementation(async (sql, params) => {
      if (mockVendorClientScopeHit(sql)) return [{ OK: 1 }];
      if (/FROM\s+JAVIER\.VISTA_DEUDA_BASE\s+C/i.test(sql)) {
        expect(params).toEqual(['C001', 'COB', 20260601, 20260630]);
        return [];
      }
      return [];
    });

    const res = await request(makeApp())
      .get('/C001/pendientes')
      .query({ tipoDocumento: 'FAC', fechaDesde: '2026-06-01', fechaHasta: '2026-06-30' });

    expect(res.status).toBe(200);
    const cvcSql = mockQueryWithParams.mock.calls.find(([sql]) => /FROM\s+JAVIER\.VISTA_DEUDA_BASE\s+C/i.test(sql))[0];
    expect(cvcSql).toMatch(/TRIM\(C\.TIPODOCUMENTO\)\s+IN\s+\(\?\)/i);
    expect(cvcSql).toMatch(/C\.ANOVENCIMIENTO\s*\*\s*10000\s*\+\s*C\.MESVENCIMIENTO\s*\*\s*100\s*\+\s*C\.DIAVENCIMIENTO\)\s*>=\s*\?/i);
    expect(cvcSql).toMatch(/C\.ANOVENCIMIENTO\s*\*\s*10000\s*\+\s*C\.MESVENCIMIENTO\s*\*\s*100\s*\+\s*C\.DIAVENCIMIENTO\)\s*<=\s*\?/i);
  });

  test('GET /:cliente/estado sums real CVC pending amount without CV aliases', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (mockVendorClientScopeHit(sql)) return [{ OK: 1 }];
      if (/FROM\s+JAVIER\.VISTA_DEUDA_BASE\s+C/i.test(sql)) return [{ TOTAL_PENDIENTE: 75, NUM_DOCS: 2 }];
      if (/FROM\s+JAVIER\.COBROS/i.test(sql)) return [{ TOTAL_APP: 10 }];
      if (/FROM\s+JAVIER\.REPARTIDOR_COBROS/i.test(sql)) return [{ TOTAL_REP: 5 }];
      if (/FROM\s+DSEDAC\.CLI/i.test(sql)) return [{ LIMITECREDITO: 1000 }];
      return [];
    });

    const res = await request(makeApp()).get('/C001/estado');

    expect(res.status).toBe(200);
    expect(res.body.estadoCliente.totalPendiente).toBe(60);
    expect(res.body.estadoCliente.limiteCredito).toBe(1000);

    const cvcSql = mockQueryWithParams.mock.calls.find(([sql]) => /FROM\s+JAVIER\.VISTA_DEUDA_BASE\s+C/i.test(sql))[0];
    expect(cvcSql).toContain('CODIGOCLIENTEALBARAN');
    expect(cvcSql).toContain('IMPORTEPENDIENTE');
    expect(cvcSql).not.toMatch(/CVIMCO|CVIMVT|CVCDCL/i);
  });

  test('GET /pending-summary/ALL applies limit/page offset and returns pagination contract', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/OFFSET\s+50\s+ROWS/i.test(sql)) {
        return [{ CLIENTE: 'C001', SERIE_DOCUMENTO: 'M', NUMERO_DOCUMENTO: 1, TOTAL_PENDIENTE: '100.00', TOTAL_VENCIDO: '0.00', NOMBRE_ALT: 'Cliente Uno', NOMBRE_CLI: 'Cliente Uno' }];
      }
      if (/FROM\s+JAVIER\.VISTA_DEUDA_BASE\s+CVC/i.test(sql)) {
        return [{ CLIENTE: 'C001', SERIE_DOCUMENTO: 'M', NUMERO_DOCUMENTO: 1, TOTAL_PENDIENTE: '100.00', TOTAL_VENCIDO: '0.00' }];
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
    expect(summarySql).toMatch(/ORDER BY\s+TOTAL_PENDIENTE\s+DESC,\s+CLIENTE\s+ASC,\s+SERIE_DOCUMENTO\s+ASC,\s+NUMERO_DOCUMENTO\s+ASC/i);
    expect(summarySql).toMatch(/OFFSET\s+50\s+ROWS\s+FETCH\s+FIRST\s+25\s+ROWS\s+ONLY/i);
  });

  test('POST /:cliente/registrar writes ERP-compatible payment columns when available', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (mockVendorClientScopeHit(sql)) return [{ OK: 1 }];
      if (/FROM\s+JAVIER\.REPARTIDOR_COBROS/i.test(sql)) return [{ TOTAL_REP: 0 }];
      if (/FROM\s+JAVIER\.COBROS\s+WHERE\s+ID\s+=\s+\?/i.test(sql)) return [];
      if (/INSERT\s+INTO\s+JAVIER\.COBROS/i.test(sql)) return [];
      return [];
    });

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
    const insertCall = mockQueryWithParams.mock.calls.find(([sql]) =>
      /INSERT\s+INTO\s+JAVIER\.COBROS/i.test(sql),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[0]).toContain('CODIGOCLIENTEFACTURA');
    expect(insertCall[0]).toContain('IMPORTECOBRADO');
    expect(insertCall[0]).toContain('IDMARCALIQUIDACION');
    expect(insertCall[1]).toContain('C001');
    expect(insertCall[1]).toContain(60);
    expect(insertCall[1]).toContain('token-erp-cobro-001');
  });
  test('POST /:cliente/registrar uses DB2-safe primary id for 128 char idem value', async () => {
    const raw = 'A'.repeat(128);
    const normalized = crypto.createHash('sha256').update(raw).digest('hex');
    const expectedId = paymentIdForTest(normalized);
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (mockVendorClientScopeHit(sql)) return [{ OK: 1 }];
      if (/FROM\s+JAVIER\.REPARTIDOR_COBROS/i.test(sql)) return [{ TOTAL_REP: 0 }];
      if (new RegExp('FROM\\s+JAVIER\\.COBROS\\s+WHERE\\s+ID\\s+=\\s+\\?\\s+OR\\s+IDEMPOTENCY_TOKEN\\s+=\\s+\\?', 'i').test(sql)) return [];
      if (/INSERT\s+INTO\s+JAVIER\.COBROS/i.test(sql)) return [];
      return [];
    });

    const res = await request(makeApp({ code: '01', role: 'COMERCIAL' }))
      .post('/C001/registrar')
      .send({ referencia: 'M-123', importe: 60, formaPago: '02', idempotencyToken: raw });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(expectedId);
    expect(res.body.id.length).toBeLessThanOrEqual(36);
    const lookupCall = mockQueryWithParams.mock.calls.find(([sql]) => /FROM\s+JAVIER\.COBROS\s+WHERE\s+ID\s+=\s+\?/i.test(sql));
    expect(lookupCall[1]).toEqual([expectedId, normalized]);
    const insertCall = mockQueryWithParams.mock.calls.find(([sql]) => /INSERT\s+INTO\s+JAVIER\.COBROS/i.test(sql));
    expect(insertCall[1][0]).toBe(expectedId);
    expect(insertCall[1][0].length).toBeLessThanOrEqual(36);
    expect(insertCall[1][10]).toBe(normalized);
    expect(insertCall[1][10].length).toBeLessThanOrEqual(128);
  });

  test('POST /:cliente/registrar replays same idem value with same payload', async () => {
    const raw = 'B'.repeat(64);
    const expectedId = paymentIdForTest(raw);
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (mockVendorClientScopeHit(sql)) return [{ OK: 1 }];
      if (/FROM\s+JAVIER\.REPARTIDOR_COBROS/i.test(sql)) return [{ TOTAL_REP: 0 }];
      if (/FROM\s+JAVIER\.COBROS\s+WHERE\s+ID\s+=\s+\?/i.test(sql)) {
        return [{ ID: expectedId, CODIGO_CLIENTE: 'C001', REFERENCIA: 'M-123', IMPORTE: '60.00', FORMA_PAGO: '02', CODIGO_USUARIO: '01' }];
      }
      if (/INSERT\s+INTO\s+JAVIER\.COBROS/i.test(sql)) return [];
      return [];
    });

    const res = await request(makeApp({ code: '01', role: 'COMERCIAL' }))
      .post('/C001/registrar')
      .send({ referencia: 'M-123', importe: 60, formaPago: '02', idempotencyToken: raw });

    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /INSERT\s+INTO\s+JAVIER\.COBROS/i.test(sql))).toBe(false);
  });

  test('POST /:cliente/registrar rejects same idem value with different payload', async () => {
    const raw = 'C'.repeat(64);
    const expectedId = paymentIdForTest(raw);
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (mockVendorClientScopeHit(sql)) return [{ OK: 1 }];
      if (/FROM\s+JAVIER\.REPARTIDOR_COBROS/i.test(sql)) return [{ TOTAL_REP: 0 }];
      if (/FROM\s+JAVIER\.COBROS\s+WHERE\s+ID\s+=\s+\?/i.test(sql)) {
        return [{ ID: expectedId, CODIGO_CLIENTE: 'C001', REFERENCIA: 'M-123', IMPORTE: '61.00', FORMA_PAGO: '02', CODIGO_USUARIO: '01' }];
      }
      return [];
    });

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
      if (/FROM\s+JAVIER\.VISTA_DEUDA_BASE\s+C/i.test(sql)) {
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

  test('GET /:cliente/historico returns JAVIER.COBROS rows with pagination contract', async () => {
    const fecha = new Date('2026-06-10T12:30:00.000Z');
    mockQueryWithParams.mockImplementation(async (sql, params) => {
      if (mockVendorClientScopeHit(sql)) return [{ OK: 1 }];
      if (/FROM\s+JAVIER\.COBROS\s+C/i.test(sql)) {
        expect(params).toEqual(['C001']);
        return [{
          ID: 'CBR-1',
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
      id: 'CBR-1',
      codigoCliente: 'C001',
      importe: 25.5,
      formaPago: '02',
      referencia: 'M-100',
      observaciones: 'Cobro app',
      fecha: fecha.toISOString(),
      IMPORTE: 25.5,
      REFERENCIA: 'M-100',
    });
    const historicoSql = mockQueryWithParams.mock.calls.find(([sql]) => /FROM\s+JAVIER\.COBROS\s+C/i.test(sql))[0];
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
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /FROM\s+JAVIER\.VISTA_DEUDA_BASE/i.test(sql))).toBe(false);
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
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /FROM\s+JAVIER\.VISTA_DEUDA_BASE/i.test(sql))).toBe(false);
  });

  test('Db2CobrosRepository ensureCobrosTable rejects COBROS_TABLE_UNAVAILABLE without CREATE TABLE', async () => {
    const { Db2CobrosRepository } = require('../src/modules/cobros/infrastructure/db2-cobros-repository');
    mockQuery.mockRejectedValueOnce(new Error('SQL0204 Table JAVIER.COBROS not found'));

    const repo = new Db2CobrosRepository();
    await expect(repo.ensureCobrosTable()).rejects.toMatchObject({
      code: 'COBROS_TABLE_UNAVAILABLE',
      status: 503,
      message: 'Servicio de cobros no disponible: tabla de cobros no configurada',
    });
    expect(mockQuery.mock.calls.some(([sql]) => /CREATE\s+TABLE/i.test(String(sql)))).toBe(false);
  });

  test('Db2CobrosRepository getPendientes applies due-date filters on CVC vencimiento', async () => {
    const { Db2CobrosRepository } = require('../src/modules/cobros/infrastructure/db2-cobros-repository');
    let cvcSql = '';
    let cvcParams = [];
    mockQuery.mockResolvedValue([]);
    mockQueryWithParams.mockImplementation(async (sql, params) => {
      if (/FROM\s+JAVIER\.VISTA_DEUDA_BASE\s+C/i.test(sql)) {
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
});
