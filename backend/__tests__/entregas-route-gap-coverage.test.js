'use strict';

const express = require('express');
const request = require('supertest');

let mockAuthenticatedUser = { id: '94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };
const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockCachedQuery = jest.fn();
const mockReceiptWriter = jest.fn();

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
  verifyToken: (req, res, next) => {
    if (req.get('authorization') !== 'Bearer route-gap-test') {
      return res.status(401).json({ success: false, code: 'AUTH_REQUIRED' });
    }
    req.user = { ...mockAuthenticatedUser };
    return next();
  },
}));
jest.mock('../utils/delivery-status-check', () => ({
  isDeliveryStatusAvailable: () => false,
  isDeliveryStatusNewSchema: () => false,
  getDeliveryStatusJoin: () => '',
}));
jest.mock('../app/services/deliveryReceiptService', () => ({
  saveReceipt: (...args) => mockReceiptWriter(...args),
}));

const router = require('../routes/entregas');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/', router);
  return instance;
}

function authorized(method, requestPath) {
  const isAlbaranDetail = requestPath.startsWith('/albaran/');
  const hasOwner = /[?&]repartidorId=/.test(requestPath);
  const separator = requestPath.includes('?') ? '&' : '?';
  const scopedPath = isAlbaranDetail && !hasOwner
    ? `${requestPath}${separator}repartidorId=94`
    : requestPath;
  return request(app())[method](scopedPath).set('Authorization', 'Bearer route-gap-test');
}

function paymentCatalog() {
  return [{
    CODIGO: 'CTR', DESCRIPCION: 'Contado', TIPO: 'CONTADO', DIAS_PAGO: 0,
    DEBE_COBRAR: 'S', PUEDE_COBRAR: 'S', COLOR: 'red',
  }];
}

function pendingRow() {
  return {
    SUBEMPRESAALBARAN: '01', EJERCICIOALBARAN: 2026, SERIEALBARAN: 'A',
    TERMINALALBARAN: 1, NUMEROALBARAN: 42, CLIENTE: 'C1',
    NOMBRE_CLIENTE: 'Cliente', FORMA_PAGO: 'CTR', IMPORTETOTAL: 12,
    IMPORTEBRUTO: 12, DIADOCUMENTO: 3, MESDOCUMENTO: 8, ANODOCUMENTO: 2026,
    CODIGO_REPARTIDOR: '94', CONFORMADO: 'N', DIALLEGADA: 0,
  };
}

function detailHeader(overrides = {}) {
  return {
    SUBEMPRESAALBARAN: '01', EJERCICIOALBARAN: 2026, SERIEALBARAN: 'A',
    TERMINALALBARAN: 1, NUMEROALBARAN: 42, CLIENTE: 'C1',
    CODIGO_REPARTIDOR: '94', IMPORTE: 12, IMPORTE_BRUTO: 12,
    FORMA_PAGO: 'CTR',
    ...overrides,
  };
}

describe('entregas route coverage gaps', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticatedUser = { id: '94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };
    mockCachedQuery.mockImplementation((fn, sql, _key, _ttl, params) => {
      if (_key === 'entregas:paymentConditions') return Promise.resolve(paymentCatalog());
      return fn(sql, params);
    });
  });

  test.each([
    ['get', '/pendientes/94?date=2026-08-03'],
    ['get', '/payment-conditions'],
    ['get', '/albaran/42/2026?serie=A&terminal=1&cliente=C1'],
    ['get', '/receipt/2026-A-1-42-C1'],
    ['post', '/uploads/photo'],
    ['post', '/uploads/signature'],
  ])('requires bearer authentication for %s %s before any data access', async (method, path) => {
    const response = await request(app())[method](path).send({ entregaId: '2026-A-1-42-C1' });

    expect(response.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockCachedQuery).not.toHaveBeenCalled();
    expect(mockReceiptWriter).not.toHaveBeenCalled();
  });

  test('rejects a different repartidor pending-list request before catalog or delivery reads', async () => {
    const response = await authorized('get', '/pendientes/95?date=2026-08-03');

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(mockCachedQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('rejects invalid pending identifiers and pagination before database access', async () => {
    const invalidId = await authorized('get', '/pendientes/not-an-id?date=2026-08-03');
    const invalidPagination = await authorized('get', '/pendientes/94?date=2026-08-03&limit=zero');

    expect(invalidId.status).toBe(422);
    expect(invalidPagination.status).toBe(400);
    expect(invalidPagination.body.code).toBe('INVALID_PAGINATION');
    expect(mockCachedQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('returns the authorized pending projection with deterministic identity and payment data', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (sql.includes('FROM DSEDAC.OPP OPP')) return Promise.resolve([pendingRow()]);
      if (sql.includes('CVC_ROW_COUNT')) return Promise.resolve([{
        SUBEMPRESA: '01', EJERCICIO: 2026, SERIE: 'A', TERMINAL: 1, NUMERO: 42, CLIENTE: 'C1',
        CVC_ROW_COUNT: 1, IMPORTEPENDIENTE: 12,
      }]);
      return Promise.resolve([]);
    });

    const response = await authorized('get', '/pendientes/94?date=2026-08-03&limit=1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      pagination: { limit: 1, offset: 0, hasMore: false, nextOffset: 1 },
      albaranes: [expect.objectContaining({
        id: '2026-A-1-42-C1', codigoRepartidor: '94', formaPago: 'CTR',
        esCTR: true, puedeCobrarse: true, importeDisponibleCobro: 12,
        cobroDocumentoEstado: 'AVAILABLE', estado: 'PENDIENTE',
        fecha: '2026-08-03', documentoTipo: 'ALBARAN',
      })],
    });
    const deliveryQuery = mockQueryWithParams.mock.calls.find(([sql]) => sql.includes('FROM DSEDAC.OPP OPP'));
    expect(deliveryQuery).toBeDefined();
    // The dataset is always fetched with fixed bounds regardless of request pagination.
    expect(deliveryQuery[1].slice(-2)).toEqual([0, 501]);
  });

  test('overlays canonical confirmation status onto the pending list', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (sql.includes('FROM DSEDAC.OPP OPP')) return Promise.resolve([pendingRow()]);
      if (sql.includes('FROM JAVIER.TEST_REPARTO_CONFIRMACIONES')) {
        return Promise.resolve([{ DOCUMENT_ID: '2026-A-1-42-C1', STATUS: 'ENTREGADO' }]);
      }
      return Promise.resolve([]);
    });

    const response = await authorized('get', '/pendientes/94?date=2026-08-03&limit=1');

    expect(response.status).toBe(200);
    expect(response.body.albaranes[0]).toMatchObject({
      id: '2026-A-1-42-C1', estado: 'ENTREGADO',
    });
    const overlaySql = mockQueryWithParams.mock.calls
      .map(([sql]) => sql)
      .find((sql) => String(sql).includes('TEST_REPARTO_CONFIRMACIONES'));
    expect(overlaySql).toContain('TRIM(C.DOCUMENT_ID) IN');
    expect(overlaySql).toContain('TRIM(C.REPARTIDOR_ID) IN');
  });

  test('keeps canonical NO_ENTREGADO distinct from an unclicked red stop', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (sql.includes('FROM DSEDAC.OPP OPP')) return Promise.resolve([pendingRow()]);
      if (sql.includes('FROM JAVIER.TEST_REPARTO_CONFIRMACIONES')) {
        return Promise.resolve([{ DOCUMENT_ID: '2026-A-1-42-C1', STATUS: 'NO_ENTREGADO' }]);
      }
      return Promise.resolve([]);
    });

    const response = await authorized('get', '/pendientes/94?date=2026-08-03&limit=1');

    expect(response.status).toBe(200);
    expect(response.body.albaranes[0]).toMatchObject({
      id: '2026-A-1-42-C1', estado: 'NO_ENTREGADO', colorEstado: 'orange',
    });
  });
  test('does not fall back to TEST state when production is explicitly selected', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousTableSet = process.env.REPARTO_TABLE_SET;
    process.env.NODE_ENV = 'test';
    process.env.REPARTO_TABLE_SET = 'production';
    mockQueryWithParams.mockImplementation((sql) => {
      if (sql.includes('FROM DSEDAC.OPP OPP')) return Promise.resolve([pendingRow()]);
      return Promise.resolve([]);
    });

    try {
      const response = await authorized('get', '/pendientes/94?date=2026-08-03&limit=1');
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('CANONICAL_DELIVERY_STATUS_UNAVAILABLE');
      expect(mockQueryWithParams.mock.calls.some(([sql]) => sql.includes('TEST_REPARTO_CONFIRMACIONES'))).toBe(false);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousTableSet === undefined) delete process.env.REPARTO_TABLE_SET;
      else process.env.REPARTO_TABLE_SET = previousTableSet;
    }
  });

  test('does not apply another repartidor canonical state to the current stop', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (sql.includes('FROM DSEDAC.OPP OPP')) return Promise.resolve([pendingRow()]);
      if (sql.includes('FROM JAVIER.TEST_REPARTO_CONFIRMACIONES')) {
        return Promise.resolve([{
          DOCUMENT_ID: '2026-A-1-42-C1', REPARTIDOR_ID: '95', STATUS: 'ENTREGADO', ID: 99,
        }]);
      }
      return Promise.resolve([]);
    });

    const response = await authorized('get', '/pendientes/94?date=2026-08-03&limit=1');

    expect(response.status).toBe(200);
    expect(response.body.albaranes[0]).toMatchObject({ estado: 'PENDIENTE', colorEstado: 'red' });
  });
  test('returns a typed redacted error when the authorized pending query fails', async () => {
    mockQueryWithParams.mockRejectedValueOnce(new Error('DB2 diagnostic must not leak'));

    const response = await authorized('get', '/pendientes/94?date=2026-08-03');

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('PENDING_DELIVERIES_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('DB2 diagnostic');
  });

  test('returns the payment catalog with the documented scalar conversions', async () => {
    // Delegate cachedQuery to the underlying query fn so the once-queued
    // catalog rows are consumed here and do not bleed into later tests.
    mockCachedQuery.mockImplementation((fn, sql, _key, _ttl, params) => fn(sql, params));
    mockQuery.mockResolvedValueOnce(paymentCatalog());

    const response = await authorized('get', '/payment-conditions');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      conditions: [{ codigo: 'CTR', descripcion: 'Contado', tipo: 'CONTADO', diasPago: 0, debeCobrar: true, puedeCobrar: true, color: 'red' }],
    });
  });

  test('returns a typed redacted payment-catalog failure', async () => {
    // The catalog flows through cachedQuery: delegate to the underlying query
    // fn so the DB-failure redaction contract is still exercised end to end.
    mockCachedQuery.mockImplementation((fn, sql, _key, _ttl, params) => fn(sql, params));
    mockQuery.mockRejectedValueOnce(new Error('driver trace must not reach client'));

    const response = await authorized('get', '/payment-conditions');

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('PAYMENT_CATALOG_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('driver trace');
  });

  test('requires complete albaran identity before querying the header', async () => {
    // Without serie/terminal there is no safe unique-client fallback.
    const response = await authorized('get', '/albaran/42/2026');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('CLIENT_REQUIRED');
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('resolves a unique client when legacy callers omit cliente but send serie+terminal', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (sql.includes('SELECT DISTINCT') && sql.includes('CODIGOCLIENTEALBARAN')) {
        return Promise.resolve([{ CLIENTE: 'C1' }]);
      }
      if (sql.includes('FROM DSEDAC.CPC CPC')) return Promise.resolve([detailHeader()]);
      if (sql.includes('FROM JAVIER.TEST_REPARTO_CONFIRMACIONES')) return Promise.resolve([]);
      if (sql.includes('FROM DSEDAC.LAC')) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const response = await authorized('get', '/albaran/42/2026?serie=A&terminal=1');
    expect(response.status).toBe(200);
    expect(response.body.albaran.codigoCliente).toBe('C1');
  });

  test('enforces the database-resolved albaran owner', async () => {
    mockQueryWithParams.mockResolvedValueOnce([detailHeader({ CODIGO_REPARTIDOR: '95' })]);

    const response = await authorized('get', '/albaran/42/2026?serie=A&terminal=1&cliente=C1');

    expect(response.status).toBe(403);
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);
  });

  test('returns the authorized albaran, including canonical confirmation quantities', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (sql.includes('FROM DSEDAC.CPC CPC')) return Promise.resolve([detailHeader()]);
      if (sql.includes('FROM JAVIER.TEST_REPARTO_CONFIRMACIONES')) return Promise.resolve([{ DOCUMENT_ID: '2026-A-1-42-C1', REPARTIDOR_ID: '94', CLIENTE_CODIGO: 'C1', ID: 'C-1', STATUS: 'PARCIAL', CONFIRMED_AT: '2026-08-03T09:00:00.000Z' }]);
      if (sql.includes('FROM JAVIER.TEST_REPARTO_LINEAS')) return Promise.resolve([{ LINEA_ID: 1, CANTIDAD_ENTREGADA: 1, CANTIDAD_RECHAZADA: 1, CANTIDAD_PENDIENTE: 0 }]);
      if (sql.includes('FROM DSEDAC.LAC')) return Promise.resolve([{ SECUENCIA: 1, CODIGOARTICULO: 'P1', DESCRIPCION: 'Producto', CANTIDADUNIDADES: 2, CANTIDADENVASES: 1, IMPORTEVENTA: 12, UNIDADMEDIDA: 'UN' }]);
      return Promise.resolve([]);
    });

    const response = await authorized('get', '/albaran/42/2026?serie=A&terminal=1&cliente=C1');

    expect(response.status).toBe(200);
    expect(response.body.albaran).toMatchObject({
      id: '2026-A-1-42-C1', estado: 'PARCIAL', confirmationAvailability: 'AVAILABLE',
      esCTR: true, cobroObligatorio: true, formaPagoDesc: 'Contado', tipoPago: 'CONTADO',
      items: [expect.objectContaining({ cantidadPedida: 2, cantidadEntregada: 1, cantidadRechazada: 1, cantidadPendiente: 0 })],
    });
  });

  test('returns a typed error when the albaran header query fails', async () => {
    mockQueryWithParams.mockRejectedValueOnce(new Error('private ODBC message'));

    const response = await authorized('get', '/albaran/42/2026?serie=A&terminal=1&cliente=C1');

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('DELIVERY_DETAIL_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('private ODBC message');
  });

  test.each([
    ['get', '/receipt/2026-A-1-42-C1'],
    ['post', '/receipt/2026-A-1-42-C1'],
    ['post', '/receipt/2026-A-1-42-C1/email'],
    ['post', '/receipt/2026-A-1-42-C1/whatsapp'],
    ['post', '/uploads/photo'],
    ['post', '/uploads/signature'],
    ['post', '/update'],
  ])('retires legacy mutation/PDF/receipt route %s %s without database or receipt side effects', async (method, path) => {
    const response = await authorized(method, path).send({
      entregaId: '2026-A-1-42-C1', email: 'forged@example.invalid', total: 999,
    });

    expect(response.status).toBe(410);
    expect(response.body.success).toBe(false);
    expect(response.body.code).toMatch(/^REPARTO_CANONICAL_(RECEIPT_)?ENDPOINT_REQUIRED$/);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockReceiptWriter).not.toHaveBeenCalled();
  });
  test('resolves equal canonical states identically regardless of database row order', async () => {
    const canonicalRows = [
      { DOCUMENT_ID: '2026-A-1-42-C1', REPARTIDOR_ID: '94', STATUS: 'ENTREGADO', ID: 20 },
      { DOCUMENT_ID: '2026-A-1-42-C1', REPARTIDOR_ID: '94', STATUS: 'ENTREGADO', ID: 10 },
    ];

    for (const rows of [canonicalRows, canonicalRows.slice().reverse()]) {
      mockQueryWithParams.mockReset();
      mockQueryWithParams.mockImplementation((sql) => {
        if (sql.includes('FROM DSEDAC.OPP OPP')) return Promise.resolve([pendingRow()]);
        if (sql.includes('FROM JAVIER.TEST_REPARTO_CONFIRMACIONES')) return Promise.resolve(rows);
        return Promise.resolve([]);
      });

      const response = await authorized('get', '/pendientes/94?date=2026-08-03&limit=1');

      expect(response.status).toBe(200);
      expect(response.body.albaranes[0].estado).toBe('ENTREGADO');
    }
  });

  test('rejects contradictory canonical states instead of choosing by row order', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (sql.includes('FROM DSEDAC.OPP OPP')) return Promise.resolve([pendingRow()]);
      if (sql.includes('FROM JAVIER.TEST_REPARTO_CONFIRMACIONES')) {
        return Promise.resolve([
          { DOCUMENT_ID: '2026-A-1-42-C1', REPARTIDOR_ID: '94', STATUS: 'ENTREGADO', ID: 10 },
          { DOCUMENT_ID: '2026-A-1-42-C1', REPARTIDOR_ID: '94', STATUS: 'NO_ENTREGADO', ID: 20 },
        ]);
      }
      return Promise.resolve([]);
    });

    const response = await authorized('get', '/pendientes/94?date=2026-08-03&limit=1');

    expect(response.status).toBe(409);
    expect(response.body).toEqual(expect.objectContaining({
      success: false,
      code: 'CONFLICTING_CANONICAL_DELIVERY_STATUS',
    }));
    expect(JSON.stringify(response.body)).not.toContain('2026-A-1-42-C1');
  });

  test('fails closed when the canonical status source cannot be read', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (sql.includes('FROM DSEDAC.OPP OPP')) return Promise.resolve([pendingRow()]);
      if (sql.includes('FROM JAVIER.TEST_REPARTO_CONFIRMACIONES')) {
        return Promise.reject(new Error('private DB2 diagnostic'));
      }
      return Promise.resolve([]);
    });

    const response = await authorized('get', '/pendientes/94?date=2026-08-03&limit=1');

    expect(response.status).toBe(503);
    expect(response.body).toEqual(expect.objectContaining({
      success: false,
      code: 'CANONICAL_DELIVERY_STATUS_UNAVAILABLE',
    }));
    expect(JSON.stringify(response.body)).not.toContain('private DB2 diagnostic');
  });

});
