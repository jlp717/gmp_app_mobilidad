'use strict';

const ORIGINAL_ENV = { ...process.env };
process.env.APP_ENV = 'test';
process.env.REPARTO_TABLE_SET = 'isolated_test';
process.env.DB2_WRITE_SCHEMA = 'JAVIER';

const mockQueryWithParams = jest.fn();

jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: mockQueryWithParams,
  getPool: jest.fn(),
  initDb: jest.fn(),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../services/query-optimizer', () => ({
  cachedQuery: jest.fn((fn, sql) => fn(sql)),
  invalidateOnMutation: jest.fn(),
  patternFor: jest.fn(),
}));

jest.mock('../services/redis-cache', () => ({
  redisCache: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn(),
    invalidatePattern: jest.fn(),
  },
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
  deleteCachePattern: jest.fn(),
}));

jest.mock('../services/precio-competitivo-service', () => ({
  createPrecioCompetitivoService: () => ({ lookupBatch: jest.fn().mockResolvedValue([]) }),
}));

const pedidosService = require('../services/pedidos/index');
const {
  mapOrderStateEventRow,
  readOrderStateTimeline,
} = require('../services/pedidos/order-state-events');

function catalogRow(code) {
  return {
    CODE: code,
    NAME: `Producto ${code}`,
    BRAND: 'M1',
    FAMILY: 'F1',
    EAN: '',
    UNITSPERBOX: 1,
    UNITSFRACTION: 0,
    UNITSRETRACTIL: 0,
    UNITMEASURE: 'UNIDADES',
    WEIGHT: 0,
    STOCKENVASES: 3,
    STOCKUNIDADES: 6,
    PRECIOTARIFA1: 60,
    PRECIOMINIMO: 45,
    CODIGOTARIFACLIENTE: 1,
    PRECIOCLIENTE: 60,
    PRECIOCOSTO: 20,
    CODIGOIVA: '2',
    FORMATO: '',
    PRODUCTOPESADO: '',
    SALESTHISYEAR: 0,
    SALESPREVYEAR: 0,
    HASPURCHASED: 1,
  };
}

function orderHeader(overrides = {}) {
  return {
    ID: 42,
    EJERCICIO: 2026,
    NUMEROPEDIDO: 42,
    SERIEPEDIDO: 'P',
    TERMINAL: 93,
    DIADOCUMENTO: 2,
    MESDOCUMENTO: 11,
    ANODOCUMENTO: 2026,
    HORADOCUMENTO: 101500,
    CODIGOCLIENTE: '4300032888',
    NOMBRECLIENTE: 'Cliente demo',
    CODIGOVENDEDOR: '73',
    CODIGOFORMAPAGO: '01',
    CODIGOTARIFA: 1,
    CODIGOALMACEN: 1,
    TIPOVENTA: 'VD',
    ESTADO: 'BORRADOR',
    IMPORTETOTAL: 49.572,
    IMPORTEBASE: 49.572,
    IMPORTEIVA: 0,
    IMPORTECOSTO: 0,
    IMPORTEMARGEN: 0,
    OBSERVACIONES: '',
    CREATED_AT: '2026-11-02 10:00:00.000000',
    UPDATED_AT: '2026-11-02 10:00:00.000000',
    ...overrides,
  };
}

function orderLine() {
  return {
    ID: 7,
    PEDIDO_ID: 42,
    SECUENCIA: 1,
    CODIGOARTICULO: '3075',
    DESCRIPCION: 'Producto 3075',
    CANTIDADENVASES: 1,
    CANTIDADUNIDADES: 0,
    UNIDADMEDIDA: 'CAJAS',
    UNIDADESCAJA: 1,
    PRECIOVENTA: 49.572,
    PRECIOCOSTO: 0,
    PRECIOTARIFA: 60,
    PRECIOTARIFACLIENTE: 60,
    PRECIOMINIMO: 45,
    IMPORTEVENTA: 49.572,
    IMPORTECOSTO: 0,
    IMPORTEMARGEN: 0,
    PORCENTAJEMARGEN: 0,
    CODIGOIVA: '2',
    TIPOLINEA: 'N',
    TIPOVENTA: 'VD',
    CLASELINEA: 'VT',
    ORDEN: 1,
    DESCUENTO_LINEA: 2.5,
    PORCENTAJEDESCUENTO: 2.5,
    CREATED_AT: '2026-11-02 10:00:00.000000',
  };
}

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NODE_ENV = 'test';
  process.env.APP_ENV = 'test';
  process.env.REPARTO_TABLE_SET = 'isolated_test';
  process.env.DB2_WRITE_SCHEMA = 'JAVIER';
});

describe('order timeline read DTO', () => {
  test('serializes BIGINT ids and exposes only sanctioned before/after commercial fields', () => {
    const event = mapOrderStateEventRow({
      ID: 9n,
      PEDIDO_ID: 42n,
      FROM_STATE: 'BORRADOR',
      TO_STATE: 'CONFIRMADO',
      ACTOR_ID: '73',
      ACTOR_ROLE: 'COMERCIAL',
      DEVICE_ID: null,
      REASON: 'Confirmado por el comercial',
      IDEMPOTENCY_KEY: 'pedido-42-confirmed',
      ORIGINAL_CLIENT_AT: '2026-11-02 08:15:00.123456',
      SERVER_OCCURRED_AT: '2026-11-02 09:15:01.654321',
      PAYLOAD_JSON: JSON.stringify({
        event: 'ORDER_CONFIRMED',
        authorization: 'secret',
        before: {
          header: { ESTADO: 'BORRADOR', DESCUENTO_GLOBAL: 5, IMPORTECOSTO: 10 },
          lines: [{ CODIGOARTICULO: '3075', CANTIDADENVASES: 1, PRECIOVENTA: 49.572, DESCUENTO_LINEA: 2.5, PRECIOCOSTO: 20 }],
        },
        after: {
          header: { ESTADO: 'CONFIRMADO', DESCUENTO_GLOBAL: 5 },
          lines: [{ CODIGOARTICULO: '3075', CANTIDADENVASES: 1, PRECIOVENTA: 49.572, DESCUENTO_LINEA: 2.5 }],
        },
      }),
    });

    expect(event).toMatchObject({
      id: '9',
      orderId: '42',
      fromState: 'BORRADOR',
      toState: 'CONFIRMADO',
      originalClientAtUtc: '2026-11-02T08:15:00.123456Z',
      serverOccurredAtLocal: '2026-11-02T09:15:01.654321',
      serverTimeZone: 'Europe/Madrid',
      payloadStatus: 'available',
    });
    expect(event.payload.before.header).toEqual({ estado: 'BORRADOR', descuentoGlobal: 5 });
    expect(event.payload.before.lines[0]).toMatchObject({
      codigoArticulo: '3075',
      cantidadEnvases: 1,
      precioVenta: 49.572,
      descuentoLinea: 2.5,
    });
    expect(JSON.stringify(event)).not.toMatch(/secret|authorization|precioCosto|importeCosto|margen|precioMinimo|idempotency/i);
  });

  test('reads metadata-only pages with a bounded BIGINT cursor and never selects the event CLOB', async () => {
    const rows = Array.from({ length: 26 }, (_, index) => ({
      ID: BigInt(100 - index),
      PEDIDO_ID: 42n,
      FROM_STATE: 'BORRADOR',
      TO_STATE: 'CONFIRMADO',
      ACTOR_ID: '73',
      ACTOR_ROLE: 'COMERCIAL',
      SERVER_OCCURRED_AT_TEXT: '2026-11-02T09:15:01.654321',
    }));
    const queryFn = jest.fn().mockResolvedValue(rows);

    const timeline = await readOrderStateTimeline(queryFn, 42, {
      limit: 25,
      cursor: '9223372036854775807',
    });

    expect(timeline.status).toBe('available');
    expect(timeline.events).toHaveLength(25);
    expect(timeline.hasMore).toBe(true);
    expect(timeline.nextCursor).toBe('76');
    expect(timeline.events[0]).not.toHaveProperty('payload');
    expect(timeline.events[0]).not.toHaveProperty('idempotencyKey');
    const [sql, params] = queryFn.mock.calls[0];
    expect(sql).toMatch(/ID < CAST\(\? AS BIGINT\)/i);
    expect(sql).toMatch(/ORDER BY ID DESC/i);
    expect(sql).not.toMatch(/PAYLOAD_JSON|PAYLOAD_HASH|IDEMPOTENCY_KEY/i);
    expect(params).toEqual([42, '9223372036854775807', 26]);
  });

  test('caps timeline pages at 100 and rejects malformed BIGINT inputs before querying', async () => {
    const queryFn = jest.fn().mockResolvedValue([]);
    const capped = await readOrderStateTimeline(queryFn, 42, { limit: 999 });
    expect(queryFn.mock.calls[0][1]).toEqual([42, 101]);
    expect(capped).toMatchObject({ status: 'available', hasMore: false, nextCursor: null });

    for (const invalid of ['-1', '12x', '9223372036854775808', 0]) {
      queryFn.mockClear();
      await expect(readOrderStateTimeline(queryFn, 42, { cursor: invalid }))
        .rejects.toMatchObject({ code: 'INVALID_TIMELINE_CURSOR', status: 400 });
      expect(queryFn).not.toHaveBeenCalled();
    }
    for (const invalid of ['no', -1, 1.5]) {
      queryFn.mockClear();
      await expect(readOrderStateTimeline(queryFn, 42, { eventId: invalid }))
        .rejects.toMatchObject({ code: 'INVALID_TIMELINE_EVENT_ID', status: 400 });
      expect(queryFn).not.toHaveBeenCalled();
    }
  });

  test('loads one order-scoped snapshot on demand and keeps corrupt payloads typed', async () => {
    const queryFn = jest.fn()
      .mockResolvedValueOnce([{ ID: 9n, PEDIDO_ID: 42n, TO_STATE: 'CONFIRMADO' }])
      .mockResolvedValueOnce([{
        ID: 9n,
        PEDIDO_ID: 42n,
        FROM_STATE: 'BORRADOR',
        TO_STATE: 'CONFIRMADO',
        IDEMPOTENCY_KEY: 'must-not-leak',
        PAYLOAD_HASH: 'must-not-leak',
        PAYLOAD_JSON: JSON.stringify({
          before: { lines: [{ CODIGOARTICULO: '3075', PRECIOVENTA: 49.572, PRECIOMINIMO: 45, PRECIOCOSTO: 20 }] },
          after: { lines: [{ CODIGOARTICULO: '3075', PRECIOVENTA: 49.572 }] },
        }),
      }]);

    const timeline = await readOrderStateTimeline(queryFn, 42, { eventId: '9' });
    expect(timeline.snapshot).toMatchObject({ id: '9', payloadStatus: 'available' });
    expect(JSON.stringify(timeline.snapshot)).not.toMatch(/precioMinimo|precioCosto|idempotency|PAYLOAD_HASH|must-not-leak/i);
    const [snapshotSql, snapshotParams] = queryFn.mock.calls[1];
    expect(snapshotSql).toMatch(/PEDIDO_ID = \?\s+AND ID = CAST\(\? AS BIGINT\)/i);
    expect(snapshotParams).toEqual([42, '9']);

    queryFn.mockReset();
    queryFn.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ID: 10n, PEDIDO_ID: 42n, PAYLOAD_JSON: '{bad' }]);
    const corrupt = await readOrderStateTimeline(queryFn, 42, { eventId: '10' });
    expect(corrupt.snapshot).toMatchObject({ id: '10', payload: null, payloadStatus: 'corrupt' });
  });

  test('marks corrupt payloads without failing the timeline and never reads TEST audit in production', async () => {
    expect(mapOrderStateEventRow({ ID: 10n, PEDIDO_ID: 42n, PAYLOAD_JSON: '{bad' }))
      .toMatchObject({ id: '10', payload: null, payloadStatus: 'corrupt' });

    process.env.APP_ENV = 'production';
    process.env.REPARTO_TABLE_SET = 'production';
    const queryFn = jest.fn();
    const timeline = await readOrderStateTimeline(queryFn, 42);
    expect(timeline).toEqual({
      status: 'unavailable',
      code: 'ORDER_TIMELINE_UNSUPPORTED_PROFILE',
      events: [],
    });
    expect(queryFn).not.toHaveBeenCalled();
  });

  test.each([
    ['production', 'isolated_test', 'JAVIER'],
    ['test', 'production', 'JAVIER'],
    [undefined, 'isolated_test', 'JAVIER'],
    ['test', undefined, 'JAVIER'],
    ['test', 'isolated_test', undefined],
    ['demo', 'isolated_test', 'OTRO'],
  ])('fails closed for incoherent timeline profile app=%s tables=%s', async (appEnv, tableSet, writeSchema) => {
    process.env.APP_ENV = appEnv;
    process.env.REPARTO_TABLE_SET = tableSet;
    process.env.DB2_WRITE_SCHEMA = writeSchema;
    const queryFn = jest.fn();
    const timeline = await readOrderStateTimeline(queryFn, 42);
    expect(timeline).toMatchObject({ status: 'unavailable', code: 'ORDER_TIMELINE_UNSUPPORTED_PROFILE' });
    expect(queryFn).not.toHaveBeenCalled();
  });

  test('accepts a coherent mixed-case isolated profile', async () => {
    process.env.APP_ENV = ' DeMo ';
    process.env.NODE_ENV = ' staging ';
    process.env.REPARTO_TABLE_SET = ' IsOlAtEd_TeSt ';
    process.env.DB2_WRITE_SCHEMA = ' JAVIER ';
    const queryFn = jest.fn().mockResolvedValue([]);
    const timeline = await readOrderStateTimeline(queryFn, 42);
    expect(timeline).toMatchObject({ status: 'available', events: [], hasMore: false });
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});

describe('catalog confirmed last-sale read model', () => {
  test('loads the page last sale in one batch, preserves 49.572 and keeps competitive fields separate', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (/WITH PH AS/i.test(sql)) return [catalogRow('3075'), catalogRow('9999')];
      if (/LAST_CONFIRMED_SALES/i.test(sql)) {
        return [{
          CODE: '3075',
          ORDER_ID: 106n,
          PRICE: 49.572,
          UNIT_MEASURE: 'CAJAS',
          SOLD_AT_LOCAL: '2026-09-28T10:40:34.910605',
        }];
      }
      return [];
    });

    const products = await pedidosService.getProducts({
      clientCode: '4300032160',
      limit: 20,
      offset: 0,
    });

    const lastSaleQueries = mockQueryWithParams.mock.calls
      .filter(([sql]) => /LAST_CONFIRMED_SALES/i.test(sql));
    expect(lastSaleQueries).toHaveLength(1);
    expect(lastSaleQueries[0][0]).toMatch(/TRIM\(C\.ESTADO\) = 'CONFIRMADO'/i);
    expect(products[0]).toMatchObject({
      lastSaleStatus: 'available',
      lastSalePrice: 49.572,
      lastSaleOrderId: '106',
      lastSaleUnitMeasure: 'CAJAS',
      lastSaleAtLocal: '2026-09-28T10:40:34.910605',
      lastSaleTimeZone: 'Europe/Madrid',
      lastSaleSource: 'CONFIRMED_ORDER',
    });
    expect(products[1]).toMatchObject({
      lastSaleStatus: 'not_found',
      lastSalePrice: null,
      lastSaleSource: null,
    });
    expect(products[0].precioCliente).toBe(60);
  });

  test('returns typed unavailable metadata when the optional last-sale batch fails', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (/WITH PH AS/i.test(sql)) return [catalogRow('3075')];
      if (/LAST_CONFIRMED_SALES/i.test(sql)) throw Object.assign(new Error('hidden DB detail'), { code: '42S02' });
      return [];
    });

    const [product] = await pedidosService.getProducts({
      clientCode: '4300032160',
      limit: 20,
      offset: 0,
    });

    expect(product).toMatchObject({
      lastSaleStatus: 'unavailable',
      lastSalePrice: null,
      lastSaleSource: null,
    });
  });
});

describe('order detail optional read model', () => {
  test('returns timeline, 24-hour reservation and stock while distinguishing an unavailable bolsa trace', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (/FROM\s+JAVIER\.TEST_PEDIDOS_CAB\s+WHERE\s+ID/i.test(sql)) return [orderHeader({ CODIGOALMACEN: 2 })];
      if (/FROM\s+JAVIER\.TEST_PEDIDOS_LIN\s+WHERE\s+PEDIDO_ID/i.test(sql)) return [orderLine()];
      if (/FROM\s+JAVIER\.TEST_MOVIMIENTOS_BOLSA/i.test(sql)) throw Object.assign(new Error('hidden'), { code: '42S02' });
      if (/FROM\s+JAVIER\.TEST_PEDIDO_STATE_EVENTS/i.test(sql)) {
        return [{
          ID: 9n,
          PEDIDO_ID: 42n,
          FROM_STATE: null,
          TO_STATE: 'BORRADOR',
          ACTOR_ID: '73',
          ACTOR_ROLE: 'COMERCIAL',
          DEVICE_ID: null,
          IDEMPOTENCY_KEY: 'pedido-42-created',
          PAYLOAD_JSON: '{bad',
          ORIGINAL_CLIENT_AT: '2026-11-02 08:00:00.000000',
          SERVER_OCCURRED_AT: '2026-11-02 09:00:00.000000',
        }];
      }
      if (/ORDER_DETAIL_RESERVATION/i.test(sql)) {
        return [{
          STATUS: 'ACTIVE',
          SERVER_NOW_LOCAL: '2026-11-02T10:30:00.000000',
          RESERVED_UNTIL_LOCAL: '2026-11-03T10:00:00.000000',
          CODE: '3075',
          RESERVED_ENVASES: 1,
          RESERVED_UNITS: 0,
        }];
      }
      if (/FROM\s+DSEDAC\.ARO/i.test(sql)) return [{ CODE: '3075', ENVASES: 10, UNIDADES: 0 }];
      return [];
    });

    const detail = await pedidosService.getOrderDetail(42, { includeReadModel: true });

    expect(detail.bolsaRead).toEqual({
      status: 'unavailable',
      code: 'BOLSA_TRACE_UNAVAILABLE',
    });
    expect(detail.timeline).toMatchObject({
      status: 'available',
      events: [expect.objectContaining({ id: '9' })],
      hasMore: false,
      nextCursor: null,
    });
    expect(detail.timeline.events[0]).not.toHaveProperty('payload');
    expect(detail.inventoryRead).toMatchObject({
      status: 'available',
      serverTimeZone: 'Europe/Madrid',
      reservation: {
        status: 'ACTIVE',
        reservedUntilLocal: '2026-11-03T10:00:00.000000',
      },
    });
    expect(detail.lines[0]).toMatchObject({
      stockAvailable: { envases: 10, unidades: 0 },
      reservation: { status: 'ACTIVE', envases: 1, unidades: 0 },
    });

    const reservationSql = mockQueryWithParams.mock.calls
      .map(([sql]) => sql)
      .find((sql) => /ORDER_DETAIL_RESERVATION/i.test(sql));
    expect(reservationSql).toMatch(/C\.CREATED_AT \+ 24 HOURS/i);
    expect(reservationSql).toMatch(/CURRENT\s+TIMESTAMP/i);
    expect(reservationSql).toMatch(/CONFIRMADO[\s\S]*CAST\(NULL AS VARCHAR\(26\)\)/i);
    const stockCall = mockQueryWithParams.mock.calls.find(([sql]) => /FROM\s+DSEDAC\.ARO/i.test(sql));
    expect(stockCall[1]).toEqual([2, '3075', '3075']);
  });

  test.each([
    ['CONFIRMADO', 'CONFIRMED'],
    ['CANCELADO', 'RELEASED'],
    ['CANCELANDO', 'RELEASED'],
  ])('does not advertise a reservation expiry for %s orders', async (storedState, readStatus) => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (/FROM\s+JAVIER\.TEST_PEDIDOS_CAB\s+WHERE\s+ID/i.test(sql)) {
        return [orderHeader({ ESTADO: storedState, CODIGOALMACEN: 2 })];
      }
      if (/FROM\s+JAVIER\.TEST_PEDIDOS_LIN\s+WHERE\s+PEDIDO_ID/i.test(sql)) return [orderLine()];
      if (/FROM\s+JAVIER\.TEST_MOVIMIENTOS_BOLSA/i.test(sql)) return [];
      if (/FROM\s+JAVIER\.TEST_PEDIDO_STATE_EVENTS/i.test(sql)) return [];
      if (/ORDER_DETAIL_RESERVATION/i.test(sql)) {
        return [{
          STATUS: readStatus,
          SERVER_NOW_LOCAL: '2026-11-02T10:30:00.000000',
          RESERVED_UNTIL_LOCAL: null,
          CODE: null,
          RESERVED_ENVASES: 0,
          RESERVED_UNITS: 0,
        }];
      }
      if (/FROM\s+DSEDAC\.ARO/i.test(sql)) return [{ CODE: '3075', ENVASES: 10, UNIDADES: 0 }];
      return [];
    });

    const detail = await pedidosService.getOrderDetail(42, { includeReadModel: true });
    expect(detail.inventoryRead.reservation).toMatchObject({
      status: readStatus,
      reservedUntilLocal: null,
    });
  });

  test('uses DB2 boundary status for an expired reservation and leaves the base detail usable', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (/FROM\s+JAVIER\.TEST_PEDIDOS_CAB\s+WHERE\s+ID/i.test(sql)) return [orderHeader()];
      if (/FROM\s+JAVIER\.TEST_PEDIDOS_LIN\s+WHERE\s+PEDIDO_ID/i.test(sql)) return [orderLine()];
      if (/FROM\s+JAVIER\.TEST_MOVIMIENTOS_BOLSA/i.test(sql)) return [];
      if (/FROM\s+JAVIER\.TEST_PEDIDO_STATE_EVENTS/i.test(sql)) return [];
      if (/ORDER_DETAIL_RESERVATION/i.test(sql)) {
        return [{
          STATUS: 'EXPIRED',
          SERVER_NOW_LOCAL: '2026-11-03T10:00:00.000000',
          RESERVED_UNTIL_LOCAL: '2026-11-03T10:00:00.000000',
          CODE: null,
          RESERVED_ENVASES: 0,
          RESERVED_UNITS: 0,
        }];
      }
      if (/FROM\s+DSEDAC\.ARO/i.test(sql)) return [{ CODE: '3075', ENVASES: 10, UNIDADES: 0 }];
      return [];
    });

    const detail = await pedidosService.getOrderDetail(42, { includeReadModel: true });
    expect(detail.header.id).toBe(42);
    expect(detail.inventoryRead.reservation.status).toBe('EXPIRED');
  });
});
