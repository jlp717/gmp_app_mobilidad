'use strict';

const express = require('express');
const request = require('supertest');

const mockQueryWithParams = jest.fn();
const mockCachedQuery = jest.fn((queryFn, sql, _key, _ttl, params) => queryFn(sql, params));
let mockDeliveryStatusAvailable = true;

jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));
jest.mock('../services/query-optimizer', () => ({
  cachedQuery: (...args) => mockCachedQuery(...args),
}));
jest.mock('../services/redis-cache', () => ({
  TTL: { REALTIME: 0, SHORT: 60, MEDIUM: 300, LONG: 3600 },
}));
jest.mock('../middleware/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => {
    req.user = { id: '05', code: '05', role: 'REPARTIDOR' };
    next();
  },
}));
jest.mock('../utils/delivery-status-check', () => ({
  isDeliveryStatusAvailable: () => mockDeliveryStatusAvailable,
  isDeliveryStatusNewSchema: () => true,
  getDeliveryStatusJoin: (_cpc, alias) => mockDeliveryStatusAvailable
    ? `LEFT JOIN JAVIER.DELIVERY_STATUS ${alias} ON ${alias}.NUMEROALBARAN = CPC.NUMEROALBARAN`
    : '',
  getDeliveryStatusColumns: (alias) => mockDeliveryStatusAvailable
    ? `${alias}.STATUS AS DELIVERY_STATUS, ${alias}.UPDATED_AT AS DELIVERY_UPDATED_AT,
       CAST(NULL AS VARCHAR(255)) AS FIRMA_PATH, CAST(NULL AS VARCHAR(512)) AS OBSERVACIONES,
       CAST(NULL AS VARCHAR(20)) AS DELIVERY_REPARTIDOR`
    : `CAST(NULL AS VARCHAR(20)) AS DELIVERY_STATUS, CAST(NULL AS TIMESTAMP) AS DELIVERY_UPDATED_AT,
       CAST(NULL AS VARCHAR(255)) AS FIRMA_PATH, CAST(NULL AS VARCHAR(512)) AS OBSERVACIONES,
       CAST(NULL AS VARCHAR(20)) AS DELIVERY_REPARTIDOR`,
}));
jest.mock('../app/services/pdfService', () => ({ generateInvoicePDF: jest.fn() }));
jest.mock('../services/emailPdfService', () => ({
  sendEmailWithPdf: jest.fn(), generateInvoiceEmailHtml: jest.fn(),
  generateDeliveryEmailHtml: jest.fn(), cachePdf: jest.fn(), getCachedPdf: jest.fn(),
}));
jest.mock('../services/circuit-breaker', () => ({
  CircuitBreaker: class CircuitBreaker { constructor(options) { this.options = options; } },
}));
jest.mock('../app/services/deliveryReceiptService', () => ({ generateDeliveryReceipt: jest.fn() }));
jest.mock('../services/facturas.service', () => ({}));
jest.mock('../services/pdf.service', () => ({}));

const router = require('../routes/repartidor');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/', router);
  return instance;
}

function get(path) {
  return request(app()).get(path).set('Authorization', 'Bearer route-test');
}

function historyRow(overrides = {}) {
  const now = new Date();
  return {
    META_ONLY: 0, TOTAL_COUNT: 1, LOGICAL_POSITION: 1,
    SUBEMPRESAALBARAN: '01', EJERCICIOALBARAN: 2026, SERIEALBARAN: 'A',
    TERMINALALBARAN: 1, NUMEROALBARAN: 42,
    ANO: now.getFullYear(), MES: now.getMonth() + 1, DIA: now.getDate(),
    CODIGOCLIENTEALBARAN: 'C1', IMPORTETOTAL: 40,
    IMPORTETOTAL_FACTURA: null, CONFORMADOSN: 'N', SITUACIONALBARAN: '',
    DELIVERY_STATUS: null, CVC_PRESENT: 1, CVC_PENDING: 12,
    NUMEROFACTURA: 0, SERIEFACTURA: '', EJERCICIOFACTURA: 0,
    LEGACY_FIRMA_NOMBRE: '',
    ...overrides,
  };
}

describe('repartidor history document hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeliveryStatusAvailable = true;
    mockCachedQuery.mockImplementation((queryFn, sql, _key, _ttl, params) => queryFn(sql, params));
  });

  test('treats CONFORMADOSN=S as delivered even when the document date is today', async () => {
    mockQueryWithParams.mockResolvedValue([historyRow({ CONFORMADOSN: 'S' })]);

    const response = await get('/history/documents/C1').query({ repartidorId: '05' });

    expect(response.status).toBe(200);
    expect(response.body.documents[0].status).toBe('delivered');
  });

  test('overlays a just-signed TEST confirmation onto DSEDAC history documents', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (String(sql).includes('TEST_REPARTO_CONFIRMACIONES')) {
        return [{
          DOCUMENT_ID: '2026-A-1-42-C1',
          STATUS: 'ENTREGADO',
          ID: 'conf-1',
          FIRMA_EVIDENCE_ID: 'sig-1',
        }];
      }
      return [historyRow({ CONFORMADOSN: 'N', DELIVERY_STATUS: null })];
    });

    const response = await get('/history/documents/C1').query({ repartidorId: '05' });

    expect(response.status).toBe(200);
    expect(response.body.documents[0]).toMatchObject({
      status: 'delivered',
      hasSignature: true,
      confirmationId: 'conf-1',
    });
    const confirmSql = mockQueryWithParams.mock.calls
      .map(([sql]) => sql)
      .find((sql) => String(sql).includes('TEST_REPARTO_CONFIRMACIONES'));
    expect(confirmSql).toContain('TRIM(DOCUMENT_ID) IN');
    expect(confirmSql).toContain('TRIM(REPARTIDOR_ID) IN');
    expect(confirmSql).not.toContain('PEDIDOS_CAB');
  });

  test('overlays a just-signed TEST confirmation onto GET /history by route date', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (String(sql).includes('TEST_REPARTO_CONFIRMACIONES')) {
        return [{
          DOCUMENT_ID: '2026-A-1-42-C1',
          STATUS: 'ENTREGADO',
          ID: 'conf-1',
          FIRMA_EVIDENCE_ID: 'sig-1',
        }];
      }
      return [{
        FECHA: '2026-08-15',
        NUMEROALBARAN: 42,
        SERIEALBARAN: 'A',
        EJERCICIOALBARAN: 2026,
        NUMEROFACTURA: 0,
        SERIEFACTURA: '',
        EJERCICIOFACTURA: 0,
        CODIGO_CLIENTE: 'C1',
        CODIGOCLIENTEALBARAN: 'C1',
        TERMINALALBARAN: 1,
        NOMBRE_CLIENTE: 'Cliente',
        TOTAL: 40,
        ESTADO_ENTREGA: null,
        FIRMA_PATH: null,
      }];
    });

    const response = await get('/history/05').query({
      startDate: '2026-08-15',
      endDate: '2026-08-15',
    });

    expect(response.status).toBe(200);
    expect(response.body.data[0].ESTADO_ENTREGA).toBe('ENTREGADO');
    const historySql = mockQueryWithParams.mock.calls
      .map(([sql]) => sql)
      .find((sql) => String(sql).includes('ANOREPARTO'));
    expect(historySql).toContain('CODIGOCLIENTEALBARAN');
    expect(historySql).toContain('TERMINALALBARAN');
  });

  test('groups a factura after albaran dedupe without multiplying its header total', async () => {
    mockQueryWithParams.mockResolvedValue([
      historyRow({
        NUMEROALBARAN: 41, IMPORTETOTAL: 60, IMPORTETOTAL_FACTURA: 100,
        NUMEROFACTURA: 900, SERIEFACTURA: 'F', EJERCICIOFACTURA: 2026,
        DELIVERY_STATUS: 'ENTREGADO', CVC_PENDING: 0,
      }),
      historyRow({
        NUMEROALBARAN: 42, IMPORTETOTAL: 40, IMPORTETOTAL_FACTURA: 100,
        NUMEROFACTURA: 900, SERIEFACTURA: 'F', EJERCICIOFACTURA: 2026,
        DELIVERY_STATUS: null, CONFORMADOSN: 'N', CVC_PENDING: 12,
      }),
    ]);

    const response = await get('/history/documents/C1').query({ repartidorId: '05' });

    expect(response.status).toBe(200);
    expect(response.body.documents).toHaveLength(1);
    expect(response.body.documents[0]).toMatchObject({
      type: 'factura', number: 900, amount: 100, status: 'pending',
      pending: 12, pendingAvailability: 'AVAILABLE',
      albaranes: [
        expect.objectContaining({ numero: 41, amount: 60 }),
        expect.objectContaining({ numero: 42, amount: 40 }),
      ],
    });
  });

  test.each([
    ['RECHAZADO', 'no_delivered'],
    ['NO_REALIZADA', 'no_delivered'],
    ['PARCIAL', 'partial'],
  ])('preserves non-delivered constituent state %s for a factura', async (canonicalStatus, expected) => {
    mockQueryWithParams.mockResolvedValue([
      historyRow({ NUMEROALBARAN: 41, NUMEROFACTURA: 900, SERIEFACTURA: 'F', EJERCICIOFACTURA: 2026, DELIVERY_STATUS: 'ENTREGADO' }),
      historyRow({ NUMEROALBARAN: 42, NUMEROFACTURA: 900, SERIEFACTURA: 'F', EJERCICIOFACTURA: 2026, DELIVERY_STATUS: canonicalStatus }),
    ]);

    const response = await get('/history/documents/C1').query({ repartidorId: '05' });

    expect(response.status).toBe(200);
    expect(response.body.documents[0].status).toBe(expected);
  });

  test('marks a grouped factura delivered only when every constituent is delivered', async () => {
    mockQueryWithParams.mockResolvedValue([
      historyRow({ NUMEROALBARAN: 41, NUMEROFACTURA: 900, SERIEFACTURA: 'F', EJERCICIOFACTURA: 2026, DELIVERY_STATUS: 'ENTREGADO' }),
      historyRow({ NUMEROALBARAN: 42, NUMEROFACTURA: 900, SERIEFACTURA: 'F', EJERCICIOFACTURA: 2026, CONFORMADOSN: 'S' }),
    ]);

    const response = await get('/history/documents/C1').query({ repartidorId: '05' });

    expect(response.status).toBe(200);
    expect(response.body.documents[0].status).toBe('delivered');
  });

  test('exposes unavailable pending explicitly and does not emit a false numeric zero', async () => {
    mockQueryWithParams.mockResolvedValue([historyRow({ CVC_PRESENT: 0, CVC_PENDING: null })]);

    const response = await get('/history/documents/C1').query({ repartidorId: '05' });

    expect(response.status).toBe(200);
    expect(response.body.documents[0].pendingAvailability).toBe('UNAVAILABLE');
    expect(response.body.documents[0]).not.toHaveProperty('pending');
  });

  test('paginates logical documents after grouping and returns truthful metadata', async () => {
    mockQueryWithParams.mockResolvedValue([
      historyRow({ TOTAL_COUNT: 3, LOGICAL_POSITION: 2, NUMEROALBARAN: 42 }),
    ]);

    const response = await get('/history/documents/C1').query({ repartidorId: '05', limit: 1, offset: 1 });

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(3);
    expect(response.body.pagination).toEqual({ limit: 1, offset: 1, hasMore: true, nextOffset: 2 });
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/LOGICAL_DOCUMENTS[\s\S]*PAGED_DOCUMENTS/i);
    // DB2 for i rejects OFFSET inside CTEs; paginate by ROW_NUMBER bounds.
    expect(sql).toContain('LOGICAL_POSITION > ?');
    expect(sql).toContain('LOGICAL_POSITION <= ?');
    expect(sql).not.toMatch(/OFFSET \? ROWS/i);
    expect(sql).toMatch(/CVC\.TIPODOCUMENTO[\s\S]*CVC\.ORIGENDOCUMENTO[\s\S]*CVC\.SUBEMPRESADOCUMENTO[\s\S]*CVC\.EJERCICIODOCUMENTO[\s\S]*CVC\.SERIEDOCUMENTO[\s\S]*CVC\.TERMINALDOCUMENTO[\s\S]*CVC\.NUMERODOCUMENTO[\s\S]*CVC\.XDEDOCUMENTO[\s\S]*CVC\.DEXDOCUMENTO/i);
    expect(sql).toMatch(/TRIM\(CVC\.TIPODOCUMENTO\)\s*=\s*'CAC'/i);
    expect(sql).toMatch(/TRIM\(CVC\.ORIGENDOCUMENTO\)\s*=\s*'B'/i);
    expect(params.slice(-2)).toEqual([1, 2]);
    expect(mockQueryWithParams.mock.calls.some(([sql]) =>
      String(sql).includes('TEST_REPARTO_CONFIRMACIONES'))).toBe(true);
  });

  test('keeps the real total when the requested page is beyond the final logical document', async () => {
    mockQueryWithParams.mockResolvedValue([{ META_ONLY: 1, TOTAL_COUNT: 3 }]);

    const response = await get('/history/documents/C1').query({ repartidorId: '05', limit: 2, offset: 5 });

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(3);
    expect(response.body.documents).toEqual([]);
    expect(response.body.pagination).toEqual({ limit: 2, offset: 5, hasMore: false, nextOffset: 5 });
  });

  test('accepts a fourth logical page and returns a reusable nextOffset', async () => {
    mockQueryWithParams.mockResolvedValue(Array.from({ length: 50 }, (_, index) => historyRow({
      TOTAL_COUNT: 500,
      LOGICAL_POSITION: 201 + index,
      NUMEROALBARAN: 1000 + index,
    })));

    const response = await get('/history/documents/C1').query({ repartidorId: '05', limit: 50, offset: 200 });

    expect(response.status).toBe(200);
    expect(response.body.documents).toHaveLength(50);
    expect(response.body.pagination).toEqual({ limit: 50, offset: 200, hasMore: true, nextOffset: 250 });
    expect(mockQueryWithParams.mock.calls[0][1].slice(-2)).toEqual([200, 250]);
  });

  test.each([
    [1000000, 200],
    [1000001, 422],
  ])('enforces the finite history offset bound at %i', async (requestedOffset, expectedStatus) => {
    mockQueryWithParams.mockResolvedValue([{ META_ONLY: 1, TOTAL_COUNT: 0 }]);

    const response = await get('/history/documents/C1').query({ repartidorId: '05', offset: requestedOffset });

    expect(response.status).toBe(expectedStatus);
    if (expectedStatus === 200) {
      expect(response.body.pagination.offset).toBe(1000000);
    } else {
      expect(response.body.code).toBe('OFFSET_INVALID');
      expect(mockQueryWithParams).not.toHaveBeenCalled();
    }
  });

  test('keeps homonymous invoices isolated by subempresa', async () => {
    mockQueryWithParams.mockResolvedValue([
      historyRow({ SUBEMPRESAALBARAN: '01', NUMEROALBARAN: 41, IMPORTETOTAL_FACTURA: 100, NUMEROFACTURA: 900, SERIEFACTURA: 'F', EJERCICIOFACTURA: 2026 }),
      historyRow({ SUBEMPRESAALBARAN: '02', NUMEROALBARAN: 41, IMPORTETOTAL_FACTURA: 200, NUMEROFACTURA: 900, SERIEFACTURA: 'F', EJERCICIOFACTURA: 2026 }),
    ]);

    const response = await get('/history/documents/C1').query({ repartidorId: '05' });

    expect(response.status).toBe(200);
    expect(response.body.documents).toHaveLength(2);
    expect(response.body.documents.map((document) => document.subempresa).sort()).toEqual(['01', '02']);
    expect(response.body.documents.map((document) => document.amount).sort((a, b) => a - b)).toEqual([100, 200]);
    expect(new Set(response.body.documents.map((document) => document.id)).size).toBe(2);
    const [sql] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/'F-'\s*\|\|\s*TRIM\(CHAR\(DOC\.SUBEMPRESAALBARAN\)\)/i);
  });

  test('keeps homonymous albaranes isolated by subempresa', async () => {
    mockQueryWithParams.mockResolvedValue([
      historyRow({ SUBEMPRESAALBARAN: '01', NUMEROALBARAN: 42 }),
      historyRow({ SUBEMPRESAALBARAN: '02', NUMEROALBARAN: 42 }),
    ]);

    const response = await get('/history/documents/C1').query({ repartidorId: '05' });

    expect(response.status).toBe(200);
    expect(response.body.documents).toHaveLength(2);
    expect(new Set(response.body.documents.map((document) => document.id)).size).toBe(2);
    const [sql] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/'A-'\s*\|\|\s*TRIM\(CHAR\(DOC\.SUBEMPRESAALBARAN\)\)/i);
  });
});

describe('legacy collection reads use complete CVC evidence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCachedQuery.mockImplementation((queryFn, sql, _key, _ttl, params) => queryFn(sql, params));
  });

  test.each([
    ['/collections/summary/05', { year: 2026, month: 8 }],
    ['/collections/daily/05', { year: 2026, month: 8 }],
  ])('fails closed when any selected document lacks CVC evidence: %s', async (path, query) => {
    mockQueryWithParams.mockResolvedValue([{ TOTAL_COBRABLE: 100, TOTAL_COBRADO: 0, NUM_DOCUMENTOS: 1, CVC_DOCUMENTOS: 0 }]);

    const response = await get(path).query(query);

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('REPARTIDOR_COLLECTION_DATA_INCOMPLETE');
  });

  test('deduplicates full CVC installment keys and maps real collected/pending totals', async () => {
    mockQueryWithParams.mockResolvedValue([{
      CLIENTE: 'C1', NOMBRE_CLIENTE: 'Cliente', FORMA_PAGO: 'CTR',
      TOTAL_COBRABLE: 100, TOTAL_COBRADO: 35, TOTAL_PENDIENTE: 65,
      NUM_DOCUMENTOS: 1, CVC_DOCUMENTOS: 1,
    }]);

    const response = await get('/collections/summary/05').query({ year: 2026, month: 8 });

    expect(response.status).toBe(200);
    expect(response.body.clients[0]).toMatchObject({ collectable: 100, collected: 35, pending: 65, collectionAvailability: 'AVAILABLE' });
    const [sql] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/TRIM\(CVC\.TIPODOCUMENTO\)\s*=\s*'CAC'/i);
    expect(sql).toMatch(/TRIM\(CVC\.ORIGENDOCUMENTO\)\s*=\s*'B'/i);
    expect(sql).toMatch(/CVC_INSTALLMENTS[\s\S]*GROUP BY[\s\S]*CVC\.XDEDOCUMENTO[\s\S]*CVC\.DEXDOCUMENTO/i);
    expect(sql).toMatch(/MAX\(COALESCE\(CVC\.IMPORTECANCELADO, 0\)\)/i);
    expect(sql).toMatch(/MIN\(COALESCE\(CVC\.IMPORTECANCELADO, 0\)\)[\s\S]*<>[\s\S]*MAX\(COALESCE\(CVC\.IMPORTECANCELADO, 0\)\)/i);
    expect(sql).not.toMatch(/WHEN COALESCE\(CVC\.IMPORTEPENDIENTE, 0\) = 0[\s\S]*THEN CPC\.IMPORTETOTAL/i);
  });

  test.each([
    ['/collections/summary/05', { year: 2026, month: 8 }],
    ['/collections/daily/05', { year: 2026, month: 8 }],
  ])('fails closed when duplicate CVC rows disagree on money: %s', async (path, query) => {
    mockQueryWithParams.mockResolvedValue([{
      TOTAL_COBRABLE: 100, TOTAL_COBRADO: 35, TOTAL_PENDIENTE: 65,
      NUM_DOCUMENTOS: 1, CVC_DOCUMENTOS: 1, CVC_AMBIGUOUS_DOCUMENTS: 1,
    }]);

    const response = await get(path).query(query);

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('REPARTIDOR_COLLECTION_DATA_INCOMPLETE');
  });

  test('daily collection query returns real values without multiplying CPC documents', async () => {
    mockQueryWithParams.mockResolvedValue([{
      DIA: 3, TOTAL_COBRABLE: 100, TOTAL_COBRADO: 35, TOTAL_PENDIENTE: 65,
      NUM_DOCUMENTOS: 1, CVC_DOCUMENTOS: 1,
    }]);

    const response = await get('/collections/daily/05').query({ year: 2026, month: 8 });

    expect(response.status).toBe(200);
    expect(response.body.daily[0]).toMatchObject({ collectable: 100, collected: 35, pending: 65, collectionAvailability: 'AVAILABLE' });
    const [sql] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/UNIQUE_DOCUMENTS/i);
    expect(sql).toMatch(/COUNT\(\*\) AS NUM_DOCUMENTOS/i);
  });
});

describe('delivery summary canonical status precedence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeliveryStatusAvailable = true;
  });

  test('uses one exclusive canonical status before legacy CONFORMADOSN', async () => {
    mockQueryWithParams.mockResolvedValue([{
      DIA: 3, TOTAL_ALBARANES: 4, ENTREGADOS: 1, NO_ENTREGADOS: 2, PARCIALES: 1, IMPORTE_TOTAL: 100,
    }]);

    const response = await get('/history/delivery-summary/05').query({ year: 2025, month: 4 });

    expect(response.status).toBe(200);
    expect(response.body.summary).toMatchObject({ totalAlbaranes: 4, entregados: 1, noEntregados: 2, parciales: 1, pendientes: 0 });
    const [sql] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/FINAL_STATUS/i);
    expect(sql).toMatch(/RECHAZAD[AO]|RECHAZADO/i);
    expect(sql).toMatch(/NO_REALIZADA/i);
    expect(sql).not.toMatch(/CONFORMADOSN\) = 'S'\s+OR\s+DS\.STATUS/i);
    expect(mockQueryWithParams.mock.calls[0][1]).toEqual([2025, 4, '05']);
  });

  test('keeps homonymous delivery summaries independent by subempresa and client', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      expect(sql).toMatch(/DS\.SUBEMPRESAALBARAN\s*=\s*CPC\.SUBEMPRESAALBARAN/i);
      expect(sql).toMatch(/TRIM\(DS\.CODIGOCLIENTEALBARAN\)\s*=\s*TRIM\(CPC\.CODIGOCLIENTEALBARAN\)/i);
      expect(sql).toMatch(/GROUP BY[\s\S]*CPC\.SUBEMPRESAALBARAN[\s\S]*CPC\.EJERCICIOALBARAN[\s\S]*TRIM\(CPC\.SERIEALBARAN\)[\s\S]*CPC\.TERMINALALBARAN[\s\S]*CPC\.NUMEROALBARAN[\s\S]*TRIM\(CPC\.CODIGOCLIENTEALBARAN\)/i);
      return [{
        DIA: 3,
        TOTAL_ALBARANES: 2,
        ENTREGADOS: 1,
        NO_ENTREGADOS: 1,
        PARCIALES: 0,
        IMPORTE_TOTAL: 30,
      }];
    });

    const response = await get('/history/delivery-summary/05').query({ year: 2025, month: 4 });

    expect(response.status).toBe(200);
    expect(response.body.summary).toMatchObject({
      totalAlbaranes: 2,
      entregados: 1,
      noEntregados: 1,
      parciales: 0,
      pendientes: 0,
      importeTotal: 30,
    });
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);
  });

  test('fails closed if database categories violate the exclusive-state invariant', async () => {
    mockQueryWithParams.mockResolvedValue([{
      DIA: 3, TOTAL_ALBARANES: 1, ENTREGADOS: 1, NO_ENTREGADOS: 1, PARCIALES: 0, IMPORTE_TOTAL: 10,
    }]);

    const response = await get('/history/delivery-summary/05').query({ year: 2025, month: 4 });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('REPARTIDOR_DELIVERY_SUMMARY_FAILED');
  });
});
