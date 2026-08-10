'use strict';

const express = require('express');
const request = require('supertest');

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockCachedQuery = jest.fn();
const mockSaveReceipt = jest.fn();

jest.mock('../config/db', () => ({
  query: (...args) => mockQuery(...args),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));
jest.mock('../services/query-optimizer', () => ({
  cachedQuery: (...args) => mockCachedQuery(...args),
}));
jest.mock('../services/redis-cache', () => ({ TTL: { SHORT: 60, LONG: 3600 } }));
jest.mock('../middleware/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => {
    req.user = { id: '98', code: '98', role: 'ADMIN' };
    next();
  },
}));
jest.mock('../utils/delivery-status-check', () => ({
  isDeliveryStatusAvailable: () => false,
  isDeliveryStatusNewSchema: () => false,
  getDeliveryStatusJoin: () => '',
}));
jest.mock('../app/services/deliveryReceiptService', () => ({
  saveReceipt: (...args) => mockSaveReceipt(...args),
}));

const router = require('../routes/entregas');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/', router);
  return instance;
}

function paymentCatalog() {
  return [{
    CODIGO: 'CTR', DESCRIPCION: 'Contado', TIPO: 'CONTADO', DIAS_PAGO: 0,
    DEBE_COBRAR: 'S', PUEDE_COBRAR: 'S', COLOR: 'red',
  }];
}

function pendingRow(overrides = {}) {
  return {
    EJERCICIOALBARAN: 2026,
    SERIEALBARAN: 'A',
    TERMINALALBARAN: 1,
    NUMEROALBARAN: 42,
    CLIENTE: '',
    NOMBRE_CLIENTE: 'Cliente',
    FORMA_PAGO: 'CTR',
    IMPORTETOTAL: 12,
    IMPORTEBRUTO: 12,
    DIADOCUMENTO: 1,
    MESDOCUMENTO: 1,
    ANODOCUMENTO: 2020,
    CODIGO_REPARTIDOR: '98',
    CONFORMADO: 'N',
    DIALLEGADA: 0,
    ...overrides,
  };
}

describe('GET /pendientes contract', () => {
  beforeEach(() => {
    mockQueryWithParams.mockReset();
    mockQuery.mockReset();
    mockCachedQuery.mockReset();
    jest.clearAllMocks();
    mockCachedQuery.mockResolvedValue(paymentCatalog());
  });

  test('rejects non-calendar and non-ISO dates before DB access', async () => {
    for (const date of ['2026-02-30', '03/02/2026', '2026-2-03']) {
      const response = await request(app()).get(`/pendientes/98?date=${encodeURIComponent(date)}`);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_DATE');
    }
    expect(mockCachedQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('fails closed with typed 503 when the payment catalog is unavailable', async () => {
    mockCachedQuery.mockRejectedValueOnce(new Error('driver details must stay private'));
    const response = await request(app()).get('/pendientes/98?date=2026-08-03');
    expect(response.status).toBe(503);
    expect(response.body).toEqual(expect.objectContaining({
      success: false,
      code: 'PAYMENT_CATALOG_UNAVAILABLE',
    }));
    expect(JSON.stringify(response.body)).not.toContain('driver details');
  });

  test('fails closed with typed redacted 503 instead of returning an empty success', async () => {
    mockQueryWithParams.mockRejectedValueOnce(new Error('SQL and bind values'));
    const response = await request(app()).get('/pendientes/98?date=2026-08-03');
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('PENDING_DELIVERIES_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('SQL and bind values');
  });

  test('paginates ranked unique delivery identities with truthful metadata', async () => {
    mockQueryWithParams.mockResolvedValueOnce(Array.from(
      { length: 101 },
      (_, index) => pendingRow({ NUMEROALBARAN: index + 1 }),
    ));
    const response = await request(app()).get('/pendientes/98?date=2026-08-03&limit=100&offset=0');
    expect(response.status).toBe(200);
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toContain('CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA');
    expect(sql).toContain('CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION');
    expect(sql).toMatch(/ROW_NUMBER\(\) OVER\s*\(\s*PARTITION BY[\s\S]*CODIGOCLIENTEALBARAN/i);
    expect(sql).toMatch(/WHERE DELIVERY_RANK = 1[\s\S]*OFFSET \? ROWS FETCH NEXT \? ROWS ONLY/i);
    expect(sql).toContain('OFFSET ? ROWS FETCH NEXT ? ROWS ONLY');
    expect(params.slice(-2)).toEqual([0, 101]);
    expect(response.body).toEqual(expect.objectContaining({
      limit: 100, offset: 0, hasMore: true, nextOffset: 100,
      total: null, totalIsExact: false,
      pagination: {
        limit: 100, offset: 0, hasMore: true, nextOffset: 100,
        total: null, totalIsExact: false,
      },
    }));
  });

  test('advances three pages by unique identity despite 102 duplicate physical rows', async () => {
    const physicalRows = [
      ...Array.from({ length: 102 }, () => pendingRow({ NUMEROALBARAN: 42, CLIENTE: 'C1' })),
      pendingRow({ NUMEROALBARAN: 43, CLIENTE: 'C2' }),
      pendingRow({ NUMEROALBARAN: 44, CLIENTE: 'C3' }),
    ];
    const uniqueRows = [...new Map(physicalRows.map((row) => [
      `${row.EJERCICIOALBARAN}-${row.SERIEALBARAN}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}-${row.CLIENTE}`,
      row,
    ])).values()];
    const offsets = [];
    mockQueryWithParams.mockImplementation((sql, params) => {
      if (sql.includes('FROM DSEDAC.OPP OPP') && sql.includes('FETCH NEXT')) {
        const offset = params.at(-2);
        const fetch = params.at(-1);
        offsets.push(offset);
        return Promise.resolve(uniqueRows.slice(offset, offset + fetch));
      }
      return Promise.resolve([]);
    });

    const first = await request(app()).get('/pendientes/98?date=2026-08-03&limit=1&offset=0');
    const second = await request(app()).get(`/pendientes/98?date=2026-08-03&limit=1&offset=${first.body.pagination.nextOffset}`);
    const third = await request(app()).get(`/pendientes/98?date=2026-08-03&limit=1&offset=${second.body.pagination.nextOffset}`);

    expect(offsets).toEqual([0, 1, 2]);
    expect([first, second, third].map((response) => response.status)).toEqual([200, 200, 200]);
    expect([first, second, third].map((response) => response.body.albaranes[0].id)).toEqual([
      '2026-A-1-42-C1', '2026-A-1-43-C2', '2026-A-1-44-C3',
    ]);
    expect([first.body.pagination.hasMore, second.body.pagination.hasMore, third.body.pagination.hasMore]).toEqual([true, true, false]);
    expect(third.body.pagination.nextOffset).toBe(3);
  });

  test('does not infer ENTREGADO merely because the requested date is in the past', async () => {
    mockQueryWithParams.mockResolvedValueOnce([pendingRow()]);
    const response = await request(app()).get('/pendientes/98?date=2020-01-01');
    expect(response.status).toBe(200);
    expect(response.body.albaranes[0].estado).toBe('PENDIENTE');
  });
});

describe('GET /albaran exact identity and canonical quantities', () => {
  beforeEach(() => jest.clearAllMocks());

  function header() {
    return {
      EJERCICIOALBARAN: 2026, SERIEALBARAN: 'A', TERMINALALBARAN: 1,
      NUMEROALBARAN: 42, CLIENTE: 'C1', CODIGO_REPARTIDOR: '98',
      SUBEMPRESAALBARAN: '01', IMPORTE: 30, IMPORTE_BRUTO: 30,
    };
  }

  function detailMocks({ unavailable = false, duplicateConfirmationLine = false } = {}) {
    const items = [
        { SECUENCIA: 1, CODIGOARTICULO: 'DUP', DESCRIPCION: 'Primera', CANTIDADUNIDADES: 3, CANTIDADENVASES: 1, IMPORTEVENTA: 15 },
        { SECUENCIA: 2, CODIGOARTICULO: 'DUP', DESCRIPCION: 'Segunda', CANTIDADUNIDADES: 3, CANTIDADENVASES: 1, IMPORTEVENTA: 15 },
      ];
    mockQueryWithParams.mockImplementation((sql) => {
      if (sql.includes('FROM DSEDAC.CPC CPC')) return Promise.resolve([header()]);
      if (sql.includes('FROM DSEDAC.LAC')) return Promise.resolve(items);
      if (sql.includes('FROM JAVIER.TEST_REPARTO_CONFIRMACIONES')) {
        return unavailable
          ? Promise.reject(new Error('schema absent'))
          : Promise.resolve([{ ID: 77, STATUS: 'PARCIAL', CONFIRMED_AT: '2026-08-03T10:00:00Z' }]);
      }
      if (sql.includes('FROM JAVIER.TEST_REPARTO_LINEAS')) {
        return Promise.resolve(duplicateConfirmationLine ? [
          { LINEA_ID: 1, CANTIDAD_ENTREGADA: 2 },
          { LINEA_ID: 1, CANTIDAD_ENTREGADA: 1 },
        ] : [{ LINEA_ID: 1, CANTIDAD_ENTREGADA: 2, CANTIDAD_RECHAZADA: 1, CANTIDAD_PENDIENTE: 0 }]);
      }
      return Promise.resolve([]);
    });
  }

  test('accepts only the canonical cliente query name', async () => {
    const wrong = await request(app()).get('/albaran/42/2026?serie=A&terminal=1&codigoCliente=C1');
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('CLIENT_REQUIRED');
  });

  test('projects partial quantities by line identity without merging duplicate article codes', async () => {
    detailMocks();
    const response = await request(app()).get('/albaran/42/2026?serie=A&terminal=1&cliente=C1');
    expect(response.status).toBe(200);
    expect(response.body.albaran.confirmationAvailability).toBe('AVAILABLE');
    expect(response.body.albaran.items).toEqual([
      expect.objectContaining({ itemId: 1, codigoArticulo: 'DUP', cantidadEntregada: 2, confirmationState: 'CONFIRMED' }),
      expect.objectContaining({ itemId: 2, codigoArticulo: 'DUP', cantidadEntregada: null, confirmationState: 'NOT_CONFIRMED' }),
    ]);
  });

  test('distinguishes unavailable confirmation schema from a confirmed zero quantity', async () => {
    detailMocks({ unavailable: true });
    const response = await request(app()).get('/albaran/42/2026?serie=A&terminal=1&cliente=C1');
    expect(response.status).toBe(200);
    expect(response.body.albaran.confirmationAvailability).toBe('UNAVAILABLE');
    expect(response.body.albaran.items.every((line) => line.cantidadEntregada === null)).toBe(true);
  });

  test('rejects ambiguous duplicate canonical line identities', async () => {
    detailMocks({ duplicateConfirmationLine: true });
    const response = await request(app()).get('/albaran/42/2026?serie=A&terminal=1&cliente=C1');
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('AMBIGUOUS_CONFIRMATION_LINE');
  });

  test('binds full CAC and LAC identity so homonymous documents cannot mix', async () => {
    detailMocks();
    const response = await request(app()).get('/albaran/42/2026?serie=A&terminal=1&cliente=C1');

    expect(response.status).toBe(200);
    const headerCall = mockQueryWithParams.mock.calls.find(([sql]) => sql.includes('FROM DSEDAC.CPC CPC'));
    const lacCall = mockQueryWithParams.mock.calls.find(([sql]) => sql.includes('FROM DSEDAC.LAC'));
    expect(headerCall[0]).toMatch(/CAC\.SUBEMPRESAALBARAN\s*=\s*CPC\.SUBEMPRESAALBARAN/i);
    expect(headerCall[0]).toMatch(/TRIM\(CAC\.CODIGOCLIENTEALBARAN\)\s*=\s*TRIM\(CPC\.CODIGOCLIENTEALBARAN\)/i);
    expect(lacCall[0]).toMatch(/SUBEMPRESAALBARAN\s*=\s*\?[\s\S]*EJERCICIOALBARAN\s*=\s*\?[\s\S]*SERIEALBARAN\)\s*=\s*\?[\s\S]*TERMINALALBARAN\s*=\s*\?[\s\S]*NUMEROALBARAN\s*=\s*\?[\s\S]*CODIGOCLIENTEALBARAN\)\s*=\s*\?/i);
    expect(lacCall[1]).toEqual(['01', 2026, 'A', 1, 42, 'C1']);
  });

  test('keeps a legacy receipt POST fail-closed and points callers at canonical confirmation receipts', async () => {
    detailMocks();
    const detail = await request(app()).get('/albaran/42/2026?serie=A&terminal=1&cliente=C1');
    expect(detail.status).toBe(200);
    expect(detail.body.albaran.id).toBe('2026-A-1-42-C1');

    const receipt = await request(app()).post(`/receipt/${detail.body.albaran.id}`);
    expect(receipt.status).toBe(410);
    expect(receipt.body).toMatchObject({
      code: 'REPARTO_CANONICAL_RECEIPT_ENDPOINT_REQUIRED',
      canonicalEndpoint: '/api/repartidor-finanzas/rutero/confirmations/:confirmationId/receipt',
    });
    expect(mockSaveReceipt).not.toHaveBeenCalled();
  });
});

describe('GET /payment-conditions errors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReset();
  });

  test('returns a typed redacted 503 without exposing DB errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('secret SQL driver detail'));
    const response = await request(app()).get('/payment-conditions');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      code: 'PAYMENT_CATALOG_UNAVAILABLE',
      error: 'El catalogo de formas de pago no esta disponible',
    });
    expect(JSON.stringify(response.body)).not.toContain('secret SQL driver detail');
  });
});

describe('legacy receipt projection retirement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryWithParams.mockReset();
    mockSaveReceipt.mockReset();
    mockSaveReceipt.mockResolvedValue({
      buffer: Buffer.from('%PDF'), fileName: 'RECIBO_77_v1.pdf', disposition: 'inline-preview',
    });
  });

  test('does not query or render a legacy receipt projection', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce([{ CODIGO_REPARTIDOR: '98' }])
      .mockResolvedValueOnce([{
        ID: 77, CLIENTE_CODIGO: 'C1', CLIENTE_NOMBRE: 'Cliente', DOCUMENTO_SERIE: 'A',
        DOCUMENTO_TERMINAL: 1, DOCUMENTO_NUMERO: 42, CONFIRMED_AT: '2026-08-03T10:00:00Z',
        RECEPTOR_NOMBRE: 'Ana', RECEPTOR_APELLIDOS: 'Lopez', RECEPTOR_DNI: '00000000T',
        FIRMA_EVIDENCE_ID: 'sig-1',
      }])
      .mockResolvedValueOnce([
        { LINEA_ID: 1, CODIGO_ARTICULO: 'A', CANTIDAD_PEDIDA: 3, CANTIDAD_ENTREGADA: 2, CANTIDAD_RECHAZADA: 1, PRECIO_UNITARIO: 5 },
        { LINEA_ID: 2, CODIGO_ARTICULO: 'B', CANTIDAD_PEDIDA: 1, CANTIDAD_ENTREGADA: 0, CANTIDAD_RECHAZADA: 1, PRECIO_UNITARIO: 99 },
      ])
      .mockResolvedValueOnce([{ CONTENT_BLOB: Buffer.from('signature'), MIME_TYPE: 'image/png' }]);

    const response = await request(app()).post('/receipt/2026-A-1-42-C1').send({ total: 9999 });
    expect(response.status).toBe(410);
    expect(response.body.code).toBe('REPARTO_CANONICAL_RECEIPT_ENDPOINT_REQUIRED');
    expect(mockSaveReceipt).not.toHaveBeenCalled();
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });
});

