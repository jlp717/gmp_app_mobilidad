'use strict';

function expectDb2SafeBind(sql, bind, maxLen) {
  const text = bind == null ? '' : String(bind);
  const normalized = text.length <= maxLen;
  const casted = new RegExp(`CAST\\(\\?\\s+AS\\s+VARCHAR\\(${maxLen}\\)\\)`, 'i').test(String(sql || ''));
  expect(normalized || casted).toBe(true);
}

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockPoolConnect = jest.fn();
const mockConnQuery = jest.fn();
const mockConnClose = jest.fn();

jest.mock('../config/db', () => ({
  query: mockQuery,
  queryWithParams: mockQueryWithParams,
  getPool: () => ({ connect: mockPoolConnect }),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../services/query-optimizer', () => ({
  cachedQuery: jest.fn((fn, sql) => fn(sql)),
}));

jest.mock('../services/redis-cache', () => ({
  redisCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), invalidatePattern: jest.fn() },
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
}));

const pedidosService = require('../services/pedidos.service');

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockReset();
  mockQueryWithParams.mockReset();
  mockConnQuery.mockReset();
  mockConnClose.mockReset();
  mockPoolConnect.mockReset();
  mockPoolConnect.mockResolvedValue({
    query: mockConnQuery,
    close: mockConnClose,
  });
});

describe('pedidos IVA price view', () => {
  test('effectiveMinPriceFromRow keeps locked floor above cost margin floor', () => {
    expect(pedidosService.effectiveMinPriceFromRow({
      PRECIO_MINIMO: 1,
      COSTE_FABRICACION: 0.6,
      MARGEN_OBJETIVO_PCT: 20,
    })).toBe(1);

    expect(pedidosService.effectiveMinPriceFromRow({
      PRECIO_MINIMO: 1,
      COSTE_FABRICACION: 0.9,
      MARGEN_OBJETIVO_PCT: 20,
    })).toBe(1.08);
  });

  test('applyProductPriceView returns base and IVA prices and switches display fields', () => {
    const base = {
      code: 'ART001',
      codigoIva: '2',
      ivaRate: 0.21,
      precioTarifa1: 10,
      precioCliente: 9.5,
      precioMinimo: 8,
      precioTarifaCliente: 9.5,
      precioCosto: 4,
      tariffs: [{ code: 1, price: 10, precioUnitario: 2.5 }],
    };

    const withoutIva = pedidosService.applyProductPriceView(base, false);
    expect(withoutIva.includeIva).toBe(false);
    expect(withoutIva.precioTarifa1).toBe(10);
    expect(withoutIva.precioTarifa1ConIva).toBe(12.1);
    expect(withoutIva.precioClienteConIva).toBe(11.495);
    expect(withoutIva.precioCosto).toBe(4);

    const withIva = pedidosService.applyProductPriceView(base, true);
    expect(withIva.includeIva).toBe(true);
    expect(withIva.precioTarifa1).toBe(12.1);
    expect(withIva.precioCliente).toBe(11.495);
    expect(withIva.precioTarifa1SinIva).toBe(10);
    expect(withIva.tariffs[0].price).toBe(12.1);
    expect(withIva.tariffs[0].precioUnitario).toBe(3.025);
    expect(base.precioTarifa1).toBe(10);
  });
});

describe('pedidos product catalog contract', () => {
  test('configured pricing reads client special prices from ERP PES table, not a custom table or view', async () => {
    const seenSql = [];
    mockQueryWithParams.mockImplementation(async (sql) => {
      seenSql.push(sql);
      if (/JAVIER\.BOLSA_PRODUCTO_PRECIO/i.test(sql)) return [];
      if (/DSEDAC\.PES/i.test(sql)) {
        return [{
          CODIGOARTICULO: 'ART001',
          PRECIO_ESPECIAL: 9,
          IS_SPECIAL_PRICE: 'S',
          PERMITE_BAJO_MINIMO: 'S',
          MOTIVO: 'Precio especial/promocion ERP',
          SOURCE: 'DSEDAC.PES',
        }];
      }
      return [];
    });

    const result = await pedidosService.applyConfiguredPricingToProducts([{
      code: 'ART001',
      precioTarifa1: 12,
      precioTarifaCliente: 12,
      precioCliente: 0,
      precioMinimo: 10,
    }], '4300001091');

    expect(result[0]).toMatchObject({
      precioCliente: 9,
      precioTarifaCliente: 9,
      precioEspecialCliente: true,
      permiteBajoMinimo: true,
      precioClienteSource: 'DSEDAC.PES',
    });
    expect(seenSql.join('\n')).toContain('DSEDAC.PES');
    expect(seenSql.join('\n')).toContain('DSEDAC.CLP');
    expect(seenSql.join('\n')).not.toContain('CLIENTE_PRECIO_ESPECIAL');
    expect(seenSql.join('\n')).not.toContain('V_PROMO_PRECIOS_CLIENTE');
  });

  test('getComplementaryProducts applies client promo pricing to cross-sell items', async () => {
    const seenSql = [];
    mockQueryWithParams.mockImplementation(async (sql) => {
      seenSql.push(sql);
      if (/JOIN\s+DSEDAC\.LINDTO\s+L2/i.test(sql)) {
        return [{
          CODE: 'ART002',
          NAME: 'Complementario',
          COOCCURRENCES: 4,
          PRICE: 12,
          UNITSPERBOX: 1,
          STOCKENVASES: 8,
          STOCKUNIDADES: 0,
        }];
      }
      if (/JAVIER\.BOLSA_PRODUCTO_PRECIO/i.test(sql)) return [];
      if (/DSEDAC\.PES/i.test(sql)) {
        return [{
          CODIGOARTICULO: 'ART002',
          PRECIO_ESPECIAL: 7.5,
          IS_SPECIAL_PRICE: 'S',
          PERMITE_BAJO_MINIMO: 'S',
          SOURCE: 'DSEDAC.PES',
        }];
      }
      return [];
    });

    const result = await pedidosService.getComplementaryProducts(['ART001'], '4300001091');

    expect(result[0]).toMatchObject({
      code: 'ART002',
      price: 7.5,
      precioTarifaCliente: 7.5,
      precioEspecialCliente: true,
      precioClienteSource: 'DSEDAC.PES',
    });
    expect(seenSql.join('\n')).toContain('DSEDAC.CLP');
    expect(seenSql.join('\n')).not.toContain('V_PROMO_PRECIOS_CLIENTE');
  });

  test('getProducts uses LACLAE purchase history and orders least purchased first', async () => {
    let capturedSql = '';
    let capturedParams = [];
    mockQueryWithParams.mockImplementation(async (sql, params) => {
      if (/JAVIER\.BOLSA_PRODUCTO_PRECIO/i.test(sql) || /DSEDAC\.PES/i.test(sql) || /FROM\s+DSEDAC\.LINDTO/i.test(sql)) {
        return [];
      }
      capturedSql = sql;
      capturedParams = params;
      return [
        {
          CODE: 'P001',
          NAME: 'Producto 1',
          BRAND: 'M1',
          FAMILY: 'F1',
          EAN: '',
          UNITSPERBOX: 12,
          UNITSFRACTION: 1,
          UNITSRETRACTIL: 0,
          UNITMEASURE: '',
          WEIGHT: 0,
          STOCKENVASES: 5,
          STOCKUNIDADES: 24,
          PRECIOTARIFA1: 10,
          PRECIOMINIMO: 8,
          PRECIOCLIENTE: 9,
          FORMATO: '',
          PRODUCTOPESADO: '',
          SALESTHISYEAR: 0,
          SALESPREVYEAR: 3,
          HASPURCHASED: 1,
        },
      ];
    });

    const result = await pedidosService.getProducts({
      clientCode: ' C001 ',
      limit: 20,
      offset: 0,
    });

    expect(capturedSql).toContain('DSED.LACLAE');
    expect(capturedSql).toContain('L.LCCDRF');
    expect(capturedSql).toContain('L.LCCDCL');
    expect(capturedSql).not.toContain('DSEDAC.LAC LC');
    expect(capturedSql).toContain('ORDER BY');
    expect(capturedSql).toMatch(/COALESCE\(PH\.SALES_THIS_YEAR,\s*0\)\s+ASC/i);
    expect(capturedParams).toContain('C001');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'P001',
      salesThisYear: 0,
      salesPrevYear: 3,
      hasPurchased: true,
    });
  });

  test('getProducts truncates long clientCode in LACLAE bind params', async () => {
    const longClient = '4300001091_OVERFLOW_EXTRA_CHARS';
    let capturedSql = '';
    let capturedParams = [];
    mockQueryWithParams.mockImplementation(async (sql, params) => {
      if (/JAVIER\.BOLSA_PRODUCTO_PRECIO/i.test(sql) || /DSEDAC\.PES/i.test(sql) || /FROM\s+DSEDAC\.LINDTO/i.test(sql)) {
        return [];
      }
      capturedSql = sql;
      capturedParams = params;
      return [];
    });

    await pedidosService.getProducts({
      clientCode: longClient,
      limit: 5,
      offset: 0,
    });

    const clientBind = capturedParams.find((p) => p === '4300001091' || p === longClient);
    expect(clientBind).toBe('4300001091');
    expect(String(clientBind).length).toBeLessThanOrEqual(10);
    expect(capturedParams).not.toContain(longClient);
    expectDb2SafeBind(capturedSql, clientBind, 10);
  });

  test('getProducts exposes client tariff code and price from CLC/ARA', async () => {
    let capturedSql = '';
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/JAVIER\.BOLSA_PRODUCTO_PRECIO/i.test(sql) || /DSEDAC\.PES/i.test(sql) || /FROM\s+DSEDAC\.LINDTO/i.test(sql)) {
        return [];
      }
      capturedSql = sql;
      return [
        {
          CODE: '0104',
          NAME: 'Producto tarifa cliente',
          BRAND: '',
          FAMILY: '',
          EAN: '',
          UNITSPERBOX: 1,
          UNITSFRACTION: 0,
          UNITSRETRACTIL: 0,
          UNITMEASURE: '',
          WEIGHT: 0,
          STOCKENVASES: 1,
          STOCKUNIDADES: 0,
          PRECIOTARIFA1: 16.478,
          PRECIOMINIMO: 14.618,
          CODIGOTARIFACLIENTE: 2,
          PRECIOCLIENTE: 14.618,
          PRECIOCOSTO: 10,
          CODIGOIVA: '2',
          FORMATO: '',
          PRODUCTOPESADO: '',
          SALESTHISYEAR: 0,
          SALESPREVYEAR: 0,
          HASPURCHASED: 0,
        },
      ];
    });

    const result = await pedidosService.getProducts({ clientCode: '4300001035', search: '0104', limit: 20, offset: 0 });

    expect(capturedSql).toContain('COALESCE(CT.CODIGOTARIFA, 1) AS codigoTarifaCliente');
    expect(capturedSql).toContain('TC.CODIGOTARIFA = CT.CODIGOTARIFA');
    expect(result[0]).toMatchObject({
      code: '0104',
      precioTarifa1: 16.478,
      codigoTarifaCliente: 2,
      precioCliente: 14.618,
      precioTarifaCliente: 14.618,
    });
  });
});

describe('pedidos stock performance contract', () => {
  test('getStockBatch fetches multiple products in one query chunk', async () => {
    mockQueryWithParams.mockResolvedValueOnce([
      { CODE: 'ART001', ENVASES: '12', UNIDADES: '24' },
      { CODE: 'ART002', ENVASES: '3', UNIDADES: '6' },
    ]);

    const result = await pedidosService.getStockBatch(['ART001', 'ART002']);

    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toContain('TRIM(CODIGOARTICULO) IN (CAST(? AS VARCHAR(10)),CAST(? AS VARCHAR(10)))');
    expect(sql).toContain('TRIM(SR.CODIGOARTICULO) IN (CAST(? AS VARCHAR(10)),CAST(? AS VARCHAR(10)))');
    expect(sql).toContain("TRIM(C.ESTADO) = 'CONFIRMADO'");
    expect(sql).toContain("TRIM(C.ESTADO) IN ('BORRADOR', 'PENDIENTE', 'PEND_APROB', 'PENDIENTE_APROBACION', 'CONFIRMANDO')");
    expect(sql).toContain('SR.CREATED_AT >= CURRENT TIMESTAMP - 24 HOURS');
    expect(params).toEqual([1, 'ART001', 'ART002', 'ART001', 'ART002']);
    expect(result.get('ART001')).toEqual({ envases: 12, unidades: 24 });
    expect(result.get('ART002')).toEqual({ envases: 3, unidades: 6 });
  });

  test('getStockBatch can exclude the current draft reservation for confirmation checks', async () => {
    mockQueryWithParams.mockResolvedValueOnce([{ CODE: 'ART001', ENVASES: '12', UNIDADES: '24' }]);

    await pedidosService.getStockBatch(['ART001'], 1, { excludePedidoId: 42 });

    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toContain('AND SR.PEDIDO_ID <> ?');
    expect(params).toEqual([1, 'ART001', 'ART001', 42]);
  });

  test('getStockBatch truncates article codes to 10 before IN binds', async () => {
    const longArticle = 'ART00123456_EXTRA_CHARS';
    const expectedArticle = 'ART0012345';
    mockQueryWithParams.mockResolvedValueOnce([]);

    await pedidosService.getStockBatch([longArticle]);

    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    const binds = params.slice(1);
    const chunkSize = binds.length / 2;
    const articleBinds = binds.slice(0, chunkSize);
    expect(articleBinds).toEqual([expectedArticle]);
    articleBinds.forEach((code) => expectDb2SafeBind(sql, code, 10));
  });
});

describe('pedidos create order persistence contract', () => {
  function mockCreatedOrderReads() {
    return {
      cab: {
        ID: 42,
        EJERCICIO: 2026,
        NUMEROPEDIDO: 100,
        SERIEPEDIDO: 'M',
        TERMINAL: 1,
        DIADOCUMENTO: 2,
        MESDOCUMENTO: 6,
        ANODOCUMENTO: 2026,
        HORADOCUMENTO: 113000,
        CODIGOCLIENTE: 'C001',
        NOMBRECLIENTE: 'Cliente',
        CODIGOVENDEDOR: '01',
        CODIGOFORMAPAGO: '02',
        CODIGOTARIFA: 1,
        CODIGOALMACEN: 1,
        TIPOVENTA: 'CC',
        ESTADO: 'BORRADOR',
        IMPORTETOTAL: 27,
        IMPORTEBASE: 30,
        IMPORTEIVA: 0,
        IMPORTECOSTO: 12,
        IMPORTEMARGEN: 15,
        OBSERVACIONES: '',
      },
      lin: {
        ID: 1,
        PEDIDO_ID: 42,
        SECUENCIA: 1,
        CODIGOARTICULO: 'ART001',
        DESCRIPCION: 'Producto',
        CANTIDADENVASES: 3,
        CANTIDADUNIDADES: 0,
        UNIDADMEDIDA: 'CAJAS',
        UNIDADESCAJA: 1,
        PRECIOVENTA: 10,
        PRECIOCOSTO: 4,
        PRECIOTARIFA: 10,
        PRECIOTARIFACLIENTE: 10,
        PRECIOMINIMO: 0,
        IMPORTEVENTA: 30,
        IMPORTECOSTO: 12,
        IMPORTEMARGEN: 18,
        PORCENTAJEMARGEN: 60,
        TIPOLINEA: 'R',
        TIPOVENTA: 'CC',
        CLASELINEA: 'VT',
        CODIGOIVA: '2',
        ORDEN: 1,
      },
    };
  }

  function mockCreateOrderFlow({ failTotalsUpdate = false } = {}) {
    const rows = mockCreatedOrderReads();
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/DSEDAC\.CLC/i.test(sql) && /DSEDAC\.ARA/i.test(sql)) {
        return [{ CODIGOARTICULO: 'ART001', PRECIOTARIFA: 10 }];
      }
      if (/UPDATE\s+JAVIER\.PEDIDOS_SEQ\s+SET\s+ULTIMO_NUMERO/i.test(sql)) return [];
      if (/SELECT\s+ULTIMO_NUMERO\s+FROM\s+JAVIER\.PEDIDOS_SEQ/i.test(sql)) return [{ ULTIMO_NUMERO: 100 }];
      if (/INSERT\s+INTO\s+JAVIER\.PEDIDOS_CAB/i.test(sql)) return [];
      if (/SELECT\s+ID\s+FROM\s+JAVIER\.PEDIDOS_CAB/i.test(sql)) return [{ ID: 42 }];
      if (/INSERT\s+INTO\s+JAVIER\.PEDIDOS_LIN/i.test(sql)) return [];
      if (/SELECT\s+COALESCE\(SUM\(L\.IMPORTEVENTA\)/i.test(sql)) {
        return [{ RAW_BASE: 30, RAW_COSTO: 12, RAW_IVA: 6.3, DESCUENTO_GLOBAL: 10 }];
      }
      if (/UPDATE\s+JAVIER\.PEDIDOS_CAB\s+SET\s+IMPORTEBASE/i.test(sql)) {
        if (failTotalsUpdate) throw new Error('numeric overflow');
        return [];
      }
      if (/DELETE\s+FROM\s+JAVIER\.PEDIDOS_LIN\s+WHERE\s+PEDIDO_ID/i.test(sql)) return [];
      if (/DELETE\s+FROM\s+JAVIER\.PEDIDOS_CAB\s+WHERE\s+ID/i.test(sql)) return [];
      if (/SELECT\s+ID,\s+EJERCICIO,\s+NUMEROPEDIDO/i.test(sql)) return [rows.cab];
      if (/SELECT\s+ID,\s+PEDIDO_ID,\s+SECUENCIA/i.test(sql)) return [rows.lin];
      return [];
    });
  }

  test('createOrder calculates discounted totals before DB2 update', async () => {
    mockCreateOrderFlow();

    await pedidosService.createOrder({
      clientCode: 'C001',
      clientName: 'Cliente',
      vendedorCode: '01',
      lines: [{ codigoArticulo: 'ART001', descripcion: 'Producto', cantidadEnvases: 3, precio: 10, precioCosto: 4 }],
    });

    const updateCall = mockQueryWithParams.mock.calls.find(([sql]) =>
      /UPDATE\s+JAVIER\.PEDIDOS_CAB\s+SET\s+IMPORTEBASE/i.test(sql),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).not.toMatch(/ROUND\(/i);
    expect(updateCall[1]).toEqual([27, 12, 32.67, 15, 5.67, 42]);
  });

  test('createOrder reserves draft stock after persisting complete order lines', async () => {
    mockCreateOrderFlow();

    await pedidosService.createOrder({
      clientCode: 'C001',
      clientName: 'Cliente',
      vendedorCode: '01',
      lines: [{ codigoArticulo: 'ART001', descripcion: 'Producto', cantidadEnvases: 3, precio: 10, precioCosto: 4 }],
    });

    const deleteReserveIndex = mockQueryWithParams.mock.calls.findIndex(([sql]) =>
      /DELETE\s+FROM\s+JAVIER\.PEDIDOS_STOCK_RESERVE\s+WHERE\s+PEDIDO_ID/i.test(sql),
    );
    const reserveIndex = mockQueryWithParams.mock.calls.findIndex(([sql]) =>
      /INSERT\s+INTO\s+JAVIER\.PEDIDOS_STOCK_RESERVE/i.test(sql),
    );
    expect(deleteReserveIndex).toBeGreaterThan(-1);
    expect(reserveIndex).toBeGreaterThan(deleteReserveIndex);
    expect(mockQueryWithParams.mock.calls[reserveIndex][1]).toEqual([42, 'ART001', 3, 0]);
  });

  test('createOrder attempts ERP-compatible header columns in JAVIER test schema', async () => {
    mockCreateOrderFlow();

    await pedidosService.createOrder({
      clientCode: 'C001',
      clientName: 'Cliente',
      vendedorCode: '01',
      lines: [{ codigoArticulo: 'ART001', descripcion: 'Producto', cantidadEnvases: 3, precio: 10, precioCosto: 4 }],
    });

    const headerCall = mockQueryWithParams.mock.calls.find(([sql]) =>
      /INSERT\s+INTO\s+JAVIER\.PEDIDOS_CAB/i.test(sql),
    );
    expect(headerCall).toBeDefined();
    expect(headerCall[0]).toContain('SUBEMPRESAPEDIDO');
    expect(headerCall[0]).toContain('EJERCICIOPEDIDO');
    expect(headerCall[0]).toContain('CODIGOCLIENTEALBARAN');
    expect(headerCall[0]).toContain('CODIGOVENDEDORCOBRO');
    expect(headerCall[0]).toContain('IMPORTEBASEIMPONIBLEBRUTA1');
    expect(headerCall[1]).toContain('GMP');
    expect(headerCall[1][3]).toBe('P');
    expect(headerCall[1][4]).toBe(1);
    expect(headerCall[1]).toContain('C001');
    expect(headerCall[1]).toContain('01');
  });

  test('createOrder applies line discount on initial pedido lines', async () => {
    mockCreateOrderFlow();

    await pedidosService.createOrder({
      clientCode: 'C001',
      clientName: 'Cliente',
      vendedorCode: '01',
      lines: [{
        codigoArticulo: 'ART001',
        descripcion: 'Producto',
        cantidadEnvases: 2,
        precio: 10,
        precioCosto: 4,
        descuentoLinea: 10,
      }],
    });

    const lineCall = mockQueryWithParams.mock.calls.find(([sql]) =>
      /INSERT\s+INTO\s+JAVIER\.PEDIDOS_LIN/i.test(sql),
    );
    expect(lineCall).toBeDefined();
    expect(lineCall[0]).toMatch(/DESCUENTO_LINEA/i);
    expect(lineCall[0]).toContain('SUBEMPRESAPEDIDO');
    expect(lineCall[0]).toContain('EJERCICIOPEDIDO');
    expect(lineCall[0]).toContain('SECUENCIAPEDIDO');
    expect(lineCall[0]).toContain('CODIGOCLIENTEFACTURA');
    expect(lineCall[0]).toContain('CODIGOIVA');
    expect(lineCall[1][8]).toBe(9);
    expect(lineCall[1][13]).toBe(18);
    expect(lineCall[1][17]).toBe(10);
  });

  test('createOrder persists product CODIGOIVA from DSEDAC.ART on lines', async () => {
    const rows = mockCreatedOrderReads();
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/FROM\s+DSEDAC\.CLC/i.test(sql) && /DSEDAC\.ARA/i.test(sql)) {
        return [{ CODIGOARTICULO: 'ART001', PRECIOTARIFA: 10 }];
      }
      if (/FROM\s+DSEDAC\.ART/i.test(sql) && /CODIGOIVA/i.test(sql)) {
        return [{ CODIGOARTICULO: 'ART001', CODIGOIVA: '1' }];
      }
      if (/UPDATE\s+JAVIER\.PEDIDOS_SEQ\s+SET\s+ULTIMO_NUMERO/i.test(sql)) return [];
      if (/SELECT\s+ULTIMO_NUMERO\s+FROM\s+JAVIER\.PEDIDOS_SEQ/i.test(sql)) return [{ ULTIMO_NUMERO: 100 }];
      if (/INSERT\s+INTO\s+JAVIER\.PEDIDOS_CAB/i.test(sql)) return [];
      if (/SELECT\s+ID\s+FROM\s+JAVIER\.PEDIDOS_CAB/i.test(sql)) return [{ ID: 42 }];
      if (/INSERT\s+INTO\s+JAVIER\.PEDIDOS_LIN/i.test(sql)) return [];
      if (/SELECT\s+COALESCE\(SUM\(L\.IMPORTEVENTA\)/i.test(sql)) {
        return [{ RAW_BASE: 30, RAW_COSTO: 12, RAW_IVA: 3, DESCUENTO_GLOBAL: 0 }];
      }
      if (/UPDATE\s+JAVIER\.PEDIDOS_CAB\s+SET\s+IMPORTEBASE/i.test(sql)) return [];
      if (/SELECT\s+ID,\s+EJERCICIO,\s+NUMEROPEDIDO/i.test(sql)) return [rows.cab];
      if (/SELECT\s+ID,\s+PEDIDO_ID,\s+SECUENCIA/i.test(sql)) return [{ ...rows.lin, CODIGOIVA: '1' }];
      return [];
    });

    await pedidosService.createOrder({
      clientCode: 'C001',
      clientName: 'Cliente',
      vendedorCode: '01',
      lines: [{
        codigoArticulo: 'ART001',
        descripcion: 'Producto',
        cantidadEnvases: 3,
        precio: 10,
        precioCosto: 4,
        ivaRate: 0.21,
      }],
    });

    const lineCall = mockQueryWithParams.mock.calls.find(([sql]) =>
      /INSERT\s+INTO\s+JAVIER\.PEDIDOS_LIN/i.test(sql),
    );
    expect(lineCall).toBeDefined();
    expect(lineCall[0]).toContain('CODIGOIVA');
    expect(lineCall[1][22]).toBe('1');
  });

  test('createOrder keeps envase input with cajas quantity from inserting zero line totals', async () => {
    mockCreateOrderFlow();

    await pedidosService.createOrder({
      clientCode: 'C001',
      clientName: 'Cliente',
      vendedorCode: '01',
      lines: [{
        codigoArticulo: '4311',
        descripcion: 'Producto 4311',
        cantidadEnvases: 1,
        cantidadUnidades: 0,
        unidadMedida: 'envase',
        precioVenta: 49.572,
        precioCosto: 0,
      }],
    });

    const lineCall = mockQueryWithParams.mock.calls.find(function (call) {
      return /INSERT\s+INTO\s+JAVIER\.PEDIDOS_LIN/i.test(call[0]);
    });
    expect(lineCall).toBeDefined();
    expect(lineCall[1][4]).toBe(1);
    expect(lineCall[1][5]).toBe(0);
    expect(lineCall[1][8]).toBe(49.572);
    expect(lineCall[1][13]).toBe(49.57);
    expect(lineCall[1][13]).toBeGreaterThan(0);
  });

  test('getOrderDetail returns bolsa trace grouped by order line', async () => {
    const rows = mockCreatedOrderReads();
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/FROM\s+JAVIER\.PEDIDOS_CAB\s+WHERE\s+ID/i.test(sql)) return [rows.cab];
      if (/FROM\s+JAVIER\.PEDIDOS_LIN\s+WHERE\s+PEDIDO_ID/i.test(sql)) return [rows.lin];
      if (/FROM\s+JAVIER\.MOVIMIENTOS_BOLSA/i.test(sql)) {
        return [{
          ID: 99,
          TIPO: 'ACUMULACION',
          IMPORTE: 6,
          SALDO_ANTERIOR: 300,
          SALDO_POSTERIOR: 306,
          CODIGO_ARTICULO: 'ART001',
          DESCRIPCION: 'Producto',
          PEDIDO_ID: 42,
          LINEA_ID: 1,
          PRECIO_MINIMO_CONGELADO: 8,
          PRECIO_VENTA: 10,
          CANTIDAD: 3,
          UNIDAD_MEDIDA: 'CAJAS',
          IDEMPOTENCY_KEY: 'pedido-42-line-1-over-min',
          CREATED_AT: '2026-06-10T08:30:00.000Z',
        }];
      }
      return [];
    });

    const detail = await pedidosService.getOrderDetail(42);

    expect(detail.bolsaSummary).toMatchObject({
      acumulacion: 6,
      consumo: 0,
      neto: 6,
      movementCount: 1,
    });
    expect(detail.lines[0].bolsaImpact).toMatchObject({
      acumulacion: 6,
      consumo: 0,
      neto: 6,
      hasImpact: true,
    });
    expect(detail.lines[0].bolsaMovements).toEqual([
      expect.objectContaining({
        id: 99,
        tipo: 'ACUMULACION',
        pedidoId: 42,
        lineId: 1,
        precioMinimoCongelado: 8,
        precioVenta: 10,
        cantidad: 3,
        unidadMedida: 'CAJAS',
        idempotencyKey: 'pedido-42-line-1-over-min',
      }),
    ]);
  });

  test('getOrderDetail exposes only public order statuses', async () => {
    const rows = mockCreatedOrderReads();
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/FROM\s+JAVIER\.PEDIDOS_CAB\s+WHERE\s+ID/i.test(sql)) return [{ ...rows.cab, ESTADO: 'ENVIADO' }];
      if (/FROM\s+JAVIER\.PEDIDOS_LIN\s+WHERE\s+PEDIDO_ID/i.test(sql)) return [rows.lin];
      if (/FROM\s+JAVIER\.MOVIMIENTOS_BOLSA/i.test(sql)) return [];
      return [];
    });

    const detail = await pedidosService.getOrderDetail(42);

    expect(detail.header.estado).toBe('CONFIRMADO');
  });

  test('createOrder final detail preserves empty bolsa shape without MOVIMIENTOS_BOLSA read', async () => {
    mockCreateOrderFlow();

    const detail = await pedidosService.createOrder({
      clientCode: 'C001',
      clientName: 'Cliente',
      vendedorCode: '01',
      lines: [{ codigoArticulo: 'ART001', descripcion: 'Producto', cantidadEnvases: 3, precio: 10, precioCosto: 4 }],
    });

    const bolsaReads = mockQueryWithParams.mock.calls.filter(([sql]) => /FROM\s+JAVIER\.MOVIMIENTOS_BOLSA/i.test(sql));
    expect(bolsaReads).toHaveLength(0);
    expect(detail.bolsaMovements).toEqual([]);
    expect(detail.bolsaSummary).toEqual({ acumulacion: 0, consumo: 0, neto: 0, movementCount: 0 });
    expect(detail.lines[0].bolsaMovements).toEqual([]);
    expect(detail.lines[0].bolsaImpact).toEqual({ acumulacion: 0, consumo: 0, neto: 0, movementCount: 0, hasImpact: false });
  });

  test('createOrder rolls back header and lines if totals update fails', async () => {
    mockCreateOrderFlow({ failTotalsUpdate: true });

    await expect(pedidosService.createOrder({
      clientCode: 'C001',
      clientName: 'Cliente',
      vendedorCode: '01',
      lines: [{ codigoArticulo: 'ART001', descripcion: 'Producto', cantidadEnvases: 3, precio: 10, precioCosto: 4 }],
    })).rejects.toThrow('numeric overflow');

    expect(mockQueryWithParams.mock.calls.some(([sql]) =>
      /DELETE\s+FROM\s+JAVIER\.PEDIDOS_LIN\s+WHERE\s+PEDIDO_ID/i.test(sql),
    )).toBe(true);
    expect(mockQueryWithParams.mock.calls.some(([sql]) =>
      /DELETE\s+FROM\s+JAVIER\.PEDIDOS_CAB\s+WHERE\s+ID/i.test(sql),
    )).toBe(true);
  });

  test('createOrder inserts order lines with a chunked bulk DB write', async () => {
    const rows = mockCreatedOrderReads();
    const lineInsertSql = [];

    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/FROM\s+DSEDAC\.CLC/i.test(sql) && /DSEDAC\.ARA/i.test(sql)) {
        return [
          { CODIGOARTICULO: 'ART001', PRECIOTARIFA: 10 },
          { CODIGOARTICULO: 'ART002', PRECIOTARIFA: 10 },
          { CODIGOARTICULO: 'ART003', PRECIOTARIFA: 10 },
        ];
      }
      if (/UPDATE\s+JAVIER\.PEDIDOS_SEQ\s+SET\s+ULTIMO_NUMERO/i.test(sql)) return [];
      if (/SELECT\s+ULTIMO_NUMERO\s+FROM\s+JAVIER\.PEDIDOS_SEQ/i.test(sql)) return [{ ULTIMO_NUMERO: 100 }];
      if (/INSERT\s+INTO\s+JAVIER\.PEDIDOS_CAB/i.test(sql)) return [];
      if (/SELECT\s+ID\s+FROM\s+JAVIER\.PEDIDOS_CAB/i.test(sql)) return [{ ID: 42 }];
      if (/INSERT\s+INTO\s+JAVIER\.PEDIDOS_LIN/i.test(sql)) {
        lineInsertSql.push(sql);
        return [];
      }
      if (/SELECT\s+COALESCE\(SUM\(L\.IMPORTEVENTA\)/i.test(sql)) {
        return [{ RAW_BASE: 50, RAW_COSTO: 20, DESCUENTO_GLOBAL: 0 }];
      }
      if (/UPDATE\s+JAVIER\.PEDIDOS_CAB\s+SET\s+IMPORTEBASE/i.test(sql)) return [];
      if (/SELECT\s+ID,\s+EJERCICIO,\s+NUMEROPEDIDO/i.test(sql)) return [rows.cab];
      if (/SELECT\s+ID,\s+PEDIDO_ID,\s+SECUENCIA/i.test(sql)) return [rows.lin];
      return [];
    });

    await pedidosService.createOrder({
      clientCode: 'C001',
      clientName: 'Cliente',
      vendedorCode: '01',
      lines: [
        { codigoArticulo: 'ART001', descripcion: 'Producto 1', cantidadEnvases: 1, precio: 10, precioCosto: 4 },
        { codigoArticulo: 'ART002', descripcion: 'Producto 2', cantidadEnvases: 1, precio: 10, precioCosto: 4 },
        { codigoArticulo: 'ART003', descripcion: 'Producto 3', cantidadEnvases: 1, precio: 10, precioCosto: 4 },
      ],
    });

    expect(lineInsertSql).toHaveLength(1);
    expect((lineInsertSql[0].match(/\),\s*\(/g) || [])).toHaveLength(2);
  });

  test('createOrder prefetches client tariff prices in one batch query for multiple lines', async () => {
    const rows = mockCreatedOrderReads();
    const tariffQueries = [];
    mockQueryWithParams.mockImplementation(async (sql, params) => {
      if (/FROM\s+DSEDAC\.CLC/i.test(sql) && /DSEDAC\.ARA/i.test(sql)) {
        tariffQueries.push({ sql, params });
        return [
          { CODIGOARTICULO: 'ART001', PRECIOTARIFA: 10 },
          { CODIGOARTICULO: 'ART002', PRECIOTARIFA: 20 },
        ];
      }
      if (/UPDATE\s+JAVIER\.PEDIDOS_SEQ\s+SET\s+ULTIMO_NUMERO/i.test(sql)) return [];
      if (/SELECT\s+ULTIMO_NUMERO\s+FROM\s+JAVIER\.PEDIDOS_SEQ/i.test(sql)) return [{ ULTIMO_NUMERO: 100 }];
      if (/INSERT\s+INTO\s+JAVIER\.PEDIDOS_CAB/i.test(sql)) return [];
      if (/SELECT\s+ID\s+FROM\s+JAVIER\.PEDIDOS_CAB/i.test(sql)) return [{ ID: 42 }];
      if (/INSERT\s+INTO\s+JAVIER\.PEDIDOS_LIN/i.test(sql)) return [];
      if (/SELECT\s+COALESCE\(SUM\(L\.IMPORTEVENTA\)/i.test(sql)) {
        return [{ RAW_BASE: 50, RAW_COSTO: 20, DESCUENTO_GLOBAL: 0 }];
      }
      if (/UPDATE\s+JAVIER\.PEDIDOS_CAB\s+SET\s+IMPORTEBASE/i.test(sql)) return [];
      if (/SELECT\s+ID,\s+EJERCICIO,\s+NUMEROPEDIDO/i.test(sql)) return [rows.cab];
      if (/SELECT\s+ID,\s+PEDIDO_ID,\s+SECUENCIA/i.test(sql)) return [rows.lin];
      return [];
    });

    await pedidosService.createOrder({
      clientCode: 'C001',
      clientName: 'Cliente',
      vendedorCode: '01',
      lines: [
        { codigoArticulo: 'ART001', descripcion: 'Producto 1', cantidadEnvases: 2, precio: 10, precioCosto: 4 },
        { codigoArticulo: 'ART002', descripcion: 'Producto 2', cantidadEnvases: 3, precio: 20, precioCosto: 4 },
      ],
    });

    expect(tariffQueries).toHaveLength(1);
    expect(tariffQueries[0].sql).toMatch(/TRIM\(ARA\.CODIGOARTICULO\) IN \(\?,\?\)/i);
    expect(tariffQueries[0].params).toEqual(['C001', 'ART001', 'ART002']);
  });
});

describe('pedidos table initialization contract', () => {
  test('initPedidosTables verifies DB2 metadata with resolved schema names', async () => {
    mockConnQuery.mockImplementation(async (sql) => {
      if (/QSYS2\.SYSTABLES/i.test(sql)) return [{ TABLE_NAME: 'PEDIDOS_CAB' }];
      if (/QSYS2\.SYSCOLUMNS/i.test(sql)) return [{ COLUMN_NAME: 'ORIGEN' }];
      return [];
    });

    await pedidosService.initPedidosTables();

    const sqls = mockConnQuery.mock.calls.map(([sql]) => sql).join('\\n');
    expect(sqls).toContain('QSYS2.SYSTABLES');
    expect(sqls).toContain('QSYS2.SYSCOLUMNS');
    expect(sqls).not.toContain('${ERP_SCHEMA}');
    expect(sqls).not.toMatch(/SELECT\s+1\s+FROM\s+\$\{ERP_SCHEMA\}/i);
  });
});

describe('pedidos DSEDAC write safety contract', () => {
  afterEach(() => {
    delete process.env.DB2_WRITE_SCHEMA;
    delete process.env.PEDIDOS_CONFIRMATION_SCHEMA;
    delete process.env.PEDIDOS_EXPORT_TO_SYSTEM;
    delete process.env.PEDIDOS_DSEDAC_EXPORT_APPROVED;
    delete process.env.PEDIDOS_DSEDAC_STORAGE_APPROVED;
    delete process.env.ALLOW_DSEDAC_APP_BUFFERS;
  });

  test('export to DSEDAC system tables requires explicit approval in addition to request flag', () => {
    process.env.DB2_WRITE_SCHEMA = 'DSEDAC';
    process.env.PEDIDOS_CONFIRMATION_SCHEMA = 'DSEDAC';
    process.env.PEDIDOS_EXPORT_TO_SYSTEM = 'true';
    delete process.env.PEDIDOS_DSEDAC_EXPORT_APPROVED;

    const target = pedidosService.getPedidosConfirmationTarget();

    expect(target).toMatchObject({
      schema: 'JAVIER',
      requestedSchema: 'DSEDAC',
      storageApproved: false,
      mode: 'LOCAL',
      shouldExportToSystem: false,
      exportRequested: true,
      exportApproved: false,
    });
  });

  test('storage schema has an explicit DSEDAC approval gate', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../utils/db2-schemas.js'), 'utf8');
    expect(source).toContain('ALLOW_DSEDAC_APP_BUFFERS');
    expect(source).toMatch(/requested\s*===\s*'DSEDAC'\s*&&\s*!isDsedacAppBuffersAllowed\(\)/);
  });

  test('export flags write DSEDAC CPC/LPC while app buffers remain JAVIER', () => {
    process.env.DB2_WRITE_SCHEMA = 'DSEDAC';
    process.env.PEDIDOS_EXPORT_TO_SYSTEM = 'true';
    process.env.PEDIDOS_DSEDAC_EXPORT_APPROVED = 'true';
    process.env.PEDIDOS_DSEDAC_STORAGE_APPROVED = 'true';

    const target = pedidosService.getPedidosConfirmationTarget();

    expect(target).toMatchObject({
      schema: 'JAVIER',
      requestedSchema: 'DSEDAC',
      appBuffersAllowed: false,
      exportSchema: 'DSEDAC',
      mode: 'SYSTEM',
      shouldExportToSystem: true,
    });
    expect(target.tables.cab).toBe('DSEDAC.CPC');
    expect(target.tables.lin).toBe('DSEDAC.LPC');
    expect(target.writeSchemaDiagnostic).toMatch(/using JAVIER/);
  });
});

describe('pedidos line amount contract', () => {
  test('does not double-charge equivalent units for cajas lines', () => {
    const amount = pedidosService.calculateLineImporte({
      unidadMedida: 'CAJAS',
      cantidadEnvases: 2,
      cantidadUnidades: 24,
      unidadesCaja: 12,
      precioVenta: 10,
    });

    expect(amount).toBe(20);
  });

  test('charges loose units as a box fraction when cajas line has partial units', () => {
    const amount = pedidosService.calculateLineImporte({
      unidadMedida: 'CAJAS',
      cantidadEnvases: 2,
      cantidadUnidades: 3,
      unidadesCaja: 12,
      precioVenta: 10,
    });

    expect(amount).toBe(22.5);
  });
});

describe('pedidos state machine contract', () => {
  test('allows only explicit lifecycle transitions', () => {
    expect(pedidosService.isOrderTransitionAllowed('BORRADOR', 'CONFIRMADO')).toBe(true);
    expect(pedidosService.isOrderTransitionAllowed('BORRADOR', 'PENDIENTE_APROBACION')).toBe(false);
    expect(pedidosService.isOrderTransitionAllowed('BORRADOR', 'PEND_APROB')).toBe(false);
    expect(pedidosService.isOrderTransitionAllowed('PENDIENTE_APROBACION', 'CONFIRMADO')).toBe(true);
    expect(pedidosService.isOrderTransitionAllowed('PEND_APROB', 'CONFIRMADO')).toBe(true);
    expect(pedidosService.isOrderTransitionAllowed('CONFIRMANDO', 'CONFIRMADO')).toBe(true);
    expect(pedidosService.isOrderTransitionAllowed('CONFIRMANDO', 'BORRADOR')).toBe(true);
    expect(pedidosService.isOrderTransitionAllowed('CONFIRMADO', 'ENVIADO')).toBe(false);
    expect(pedidosService.isOrderTransitionAllowed('CONFIRMADO', 'BORRADOR')).toBe(false);
    expect(pedidosService.isOrderTransitionAllowed('ENVIADO', 'ANULADO')).toBe(false);
    expect(pedidosService.isOrderTransitionAllowed('ANULADO', 'CONFIRMADO')).toBe(false);
  });

  test('stores only app-visible statuses and collapses legacy states on read', () => {
    expect(pedidosService.storedOrderStatus('PENDIENTE_APROBACION')).toBe('BORRADOR');
    expect(pedidosService.canonicalOrderStatus('PEND_APROB')).toBe('BORRADOR');
    expect(pedidosService.canonicalOrderStatus('ENVIADO')).toBe('CONFIRMADO');
  });

  test('addOrderLine rejects orders outside BORRADOR before insert', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/SELECT\s+TRIM\(ESTADO\)\s+AS\s+ESTADO\s+FROM\s+JAVIER\.PEDIDOS_CAB/i.test(sql)) {
        return [{ ESTADO: 'CONFIRMADO' }];
      }
      return [];
    });

    await expect(pedidosService.addOrderLine(42, {
      codigoArticulo: 'ART001',
      cantidadEnvases: 1,
      precioVenta: 10,
    })).rejects.toMatchObject({ code: 'ORDER_NOT_EDITABLE' });

    expect(mockQueryWithParams.mock.calls.some(([sql]) => /INSERT\s+INTO\s+JAVIER\.PEDIDOS_LIN/i.test(sql))).toBe(false);
  });

  test('updateOrderStatus rejects non-confirmed target statuses', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/SELECT\s+TRIM\(ESTADO\)\s+AS\s+ESTADO\s+FROM\s+JAVIER\.PEDIDOS_CAB/i.test(sql)) {
        return [{ ESTADO: 'CONFIRMADO' }];
      }
      return [];
    });

    await expect(
      pedidosService.updateOrderStatus(42, 'BORRADOR', { userId: '01' }),
    ).rejects.toMatchObject({ code: 'INVALID_ORDER_STATUS' });

    expect(mockQueryWithParams.mock.calls.some(([sql]) => /UPDATE\s+JAVIER\.PEDIDOS_CAB\s+SET\s+ESTADO/i.test(sql))).toBe(false);
  });
});


describe('pedidos mutation service error contract', () => {
  test('deleteOrderLine returns typed LINE_NOT_FOUND when line was already deleted', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/SELECT\s+TRIM\(ESTADO\)\s+AS\s+ESTADO/i.test(sql)) return [{ ESTADO: 'BORRADOR' }];
      if (/SELECT\s+ID\s+FROM\s+JAVIER\.PEDIDOS_LIN\s+WHERE\s+ID\s+=\s+\?\s+AND\s+PEDIDO_ID\s+=\s+\?/i.test(sql)) return [];
      return [];
    });

    await expect(pedidosService.deleteOrderLine(7, 42)).rejects.toMatchObject({ code: 'LINE_NOT_FOUND', status: 404 });

    expect(mockQueryWithParams.mock.calls.some(([sql]) => /DELETE\s+FROM\s+JAVIER\.PEDIDOS_LIN/i.test(sql))).toBe(false);
  });

  test('cancelOrder deletes draft rows without writing a third status', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/SELECT\s+ESTADO,\s+CODIGOCLIENTE,\s+IMPORTETOTAL\s+FROM\s+JAVIER\.PEDIDOS_CAB\s+WHERE\s+ID\s+=\s+\?/i.test(sql)) {
        return [{ ESTADO: 'BORRADOR', CODIGOCLIENTE: 'C001', IMPORTETOTAL: '100.00' }];
      }
      if (/DELETE\s+FROM\s+JAVIER\.PEDIDOS_CAB/i.test(sql)) {
        return { count: 1 };
      }
      return [];
    });

    const result = await pedidosService.cancelOrder(42);

    expect(result).toMatchObject({ id: 42, deleted: true, estado: 'BORRADOR' });
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /UPDATE\s+JAVIER\.PEDIDOS_CAB\s+SET\s+ESTADO/i.test(sql))).toBe(false);
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /DELETE\s+FROM\s+JAVIER\.PEDIDOS_LIN\s+WHERE\s+PEDIDO_ID/i.test(sql))).toBe(true);
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /DELETE\s+FROM\s+JAVIER\.PEDIDOS_CAB/i.test(sql))).toBe(true);
  });

  test('cancelOrder rejects confirmed orders because ERP manages later lifecycle', async () => {
    mockQueryWithParams.mockResolvedValueOnce([{ ESTADO: 'CONFIRMADO' }]);
    await expect(pedidosService.cancelOrder(42)).rejects.toMatchObject({ code: 'PEDIDO_MANAGED_BY_ERP', status: 409 });
  });
});

describe('pedidos confirm route bolsa contract', function() {
  test('PUT /api/pedidos/:id/confirm forwards BOLSA_INSUFICIENTE payload', async function() {
    jest.resetModules();
    const request = require('supertest');
    const express = require('express');
    const service = require('../services/pedidos.service');
    jest.spyOn(service, 'getOrderVendorForAuth').mockResolvedValueOnce({ id: 42, vendedorCode: '01' });
    jest.spyOn(service, 'confirmOrder').mockResolvedValueOnce({
      blocked: true,
      reason: 'BOLSA_INSUFICIENTE',
      message: 'Bolsa comercial insuficiente. Deficit: 12.50. Saldo: 3.00',
      deficit: 12.5,
      saldoBolsa: 3,
      warnings: [{ code: 'ART001', deficit: 12.5 }],
    });
    jest.doMock('../middleware/auth', function() { return {
      verifyToken: function(req, _res, next) {
        req.user = { code: '01', role: 'COMERCIAL' };
        next();
      },
    }; });
    jest.doMock('../middleware/logger', function() { return {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }; });

    const pedidosRouter = require('../routes/pedidos');
    const app = express();
    app.use(express.json());
    app.use('/api/pedidos', pedidosRouter);

    const res = await request(app)
      .put('/api/pedidos/42/confirm')
      .send({ saleType: 'CC' });

    expect(res.status).toBe(409);
    expect(service.confirmOrder).toHaveBeenCalledWith(42, 'CC', expect.objectContaining({
      forceConfirm: false,
      userId: '01',
    }));
    expect(res.body).toMatchObject({
      success: false,
      blocked: true,
      reason: 'BOLSA_INSUFICIENTE',
      code: 'BOLSA_INSUFICIENTE',
      message: 'Bolsa comercial insuficiente. Deficit: 12.50. Saldo: 3.00',
      deficit: 12.5,
      saldoBolsa: 3,
      warnings: [{ code: 'ART001', deficit: 12.5 }],
      details: {
        deficit: 12.5,
        saldoBolsa: 3,
        warnings: [{ code: 'ART001', deficit: 12.5 }],
      },
    });
  });
});


describe('pedidos catalog route client scope contract', function() {
  function makeCatalogApp({ user = { code: '01', role: 'COMERCIAL' } } = {}) {
    jest.resetModules();
    const request = require('supertest');
    const express = require('express');
    const mockService = {
      getDeliveryOptions: jest.fn().mockResolvedValue({
        deliveryDays: ['2026-06-25'],
        defaultTruck: { code: 'CAM01' },
      }),
      getComplementaryProducts: jest.fn().mockResolvedValue([{ code: 'P002' }]),
    };
    jest.doMock('../config/db', () => ({
      query: mockQuery,
      queryWithParams: mockQueryWithParams,
      getPool: () => ({ connect: mockPoolConnect }),
    }));
    jest.doMock('../services/query-optimizer', () => ({
      cachedQuery: jest.fn((fn, sql) => fn(sql)),
    }));
    jest.doMock('../services/redis-cache', () => ({
      redisCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), invalidatePattern: jest.fn() },
      TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
    }));
    jest.doMock('../services/pedidos.service', () => mockService);
    jest.doMock('../middleware/auth', function() {
      return { verifyToken: function(req, _res, next) { req.user = user; next(); } };
    });
    jest.doMock('../middleware/logger', function() {
      return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    });
    const pedidosRouter = require('../routes/pedidos');
    const app = express();
    app.use(express.json());
    app.use('/api/pedidos', pedidosRouter);
    return { request, app, mockService };
  }

  test('GET /api/pedidos/delivery-options rejects out-of-scope client before service call', async function() {
    mockQueryWithParams.mockResolvedValueOnce([]);

    const { request, app, mockService } = makeCatalogApp();
    const res = await request(app)
      .get('/api/pedidos/delivery-options')
      .query({ clientCode: 'C999', vendedorCode: '01' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockService.getDeliveryOptions).not.toHaveBeenCalled();
    expect(mockQueryWithParams.mock.calls[0][0]).toMatch(/DSEDAC\.CLI/i);
  });

  test('GET /api/pedidos/delivery-options rejects COMERCIAL for another vendor code', async function() {
    const { request, app, mockService } = makeCatalogApp();
    const res = await request(app)
      .get('/api/pedidos/delivery-options')
      .query({ clientCode: 'C001', vendedorCode: '99' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_VENDOR');
    expect(mockService.getDeliveryOptions).not.toHaveBeenCalled();
  });

  test('POST /api/pedidos/complementary rejects client outside vendor scope when clientCode present', async function() {
    mockQueryWithParams.mockResolvedValueOnce([]);

    const { request, app, mockService } = makeCatalogApp();
    const res = await request(app)
      .post('/api/pedidos/complementary')
      .send({ productCodes: ['P001'], clientCode: 'C999', vendedorCode: '01' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockService.getComplementaryProducts).not.toHaveBeenCalled();
    expect(mockQueryWithParams.mock.calls[0][0]).toMatch(/DSEDAC\.CLI/i);
  });

  test('POST /api/pedidos/complementary rejects COMERCIAL for another vendor code when clientCode present', async function() {
    const { request, app, mockService } = makeCatalogApp();
    const res = await request(app)
      .post('/api/pedidos/complementary')
      .send({ productCodes: ['P001'], clientCode: 'C001', vendedorCode: '99' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_VENDOR');
    expect(mockService.getComplementaryProducts).not.toHaveBeenCalled();
  });

  test('GET /api/pedidos/delivery-options allows in-scope client and delegates to service', async function() {
    mockQueryWithParams.mockResolvedValueOnce([{ OK: 1 }]);

    const { request, app, mockService } = makeCatalogApp();
    const res = await request(app)
      .get('/api/pedidos/delivery-options')
      .query({ clientCode: 'C001', vendedorCode: '01', deliveryDate: '2026-06-25' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockService.getDeliveryOptions).toHaveBeenCalledWith({
      clientCode: 'C001',
      vendedorCode: '01',
      deliveryDate: '2026-06-25',
    });
  });

  test('POST /api/pedidos/complementary allows in-scope client and delegates to service', async function() {
    mockQueryWithParams.mockResolvedValueOnce([{ OK: 1 }]);

    const { request, app, mockService } = makeCatalogApp();
    const res = await request(app)
      .post('/api/pedidos/complementary')
      .send({ productCodes: ['P001'], clientCode: 'C001', vendedorCode: '01' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.products).toEqual([{ code: 'P002' }]);
    expect(mockService.getComplementaryProducts).toHaveBeenCalledWith(['P001'], 'C001');
  });

  test('POST /api/pedidos/complementary skips client scope when clientCode omitted', async function() {
    const { request, app, mockService } = makeCatalogApp();
    const res = await request(app)
      .post('/api/pedidos/complementary')
      .send({ productCodes: ['P001'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockService.getComplementaryProducts).toHaveBeenCalledWith(['P001'], undefined);
    const scopeCalls = mockQueryWithParams.mock.calls.filter(([sql]) => /DSEDAC\.CLI/i.test(sql));
    expect(scopeCalls).toHaveLength(0);
  });
});


describe('pedidos mutation route ownership contract', function() {
  jest.setTimeout(90_000);

  function makeMutationApp({ user = { code: '01', role: 'COMERCIAL' }, orderVendor = '01' } = {}) {
    jest.resetModules();
    mockQueryWithParams.mockImplementation(async () => []);
    const request = require('supertest');
    const express = require('express');
    const mockService = {
      getOrderVendorForAuth: jest.fn().mockResolvedValue(orderVendor ? { id: 42, vendedorCode: orderVendor } : null),
      createOrder: jest.fn().mockResolvedValue({ header: { id: 43, vendedor: user.code }, lines: [] }),
      getOrderDetail: jest.fn().mockResolvedValue({ header: { id: 42, vendedor: orderVendor }, lines: [] }),
      cloneOrder: jest.fn().mockResolvedValue({ clientCode: 'C001', lines: [] }),
      generateOrderPdf: jest.fn().mockResolvedValue({ header: { id: 42, vendedor: orderVendor }, lines: [] }),
      getOrderAlbaran: jest.fn().mockResolvedValue([]),
      addOrderLine: jest.fn().mockResolvedValue({ header: { id: 42, vendedor: orderVendor }, lines: [] }),
      updateOrderLine: jest.fn().mockResolvedValue({ header: { id: 42, vendedor: orderVendor }, lines: [] }),
      deleteOrderLine: jest.fn().mockResolvedValue({ header: { id: 42, vendedor: orderVendor }, lines: [] }),
      confirmOrder: jest.fn().mockResolvedValue({ header: { id: 42, vendedor: orderVendor }, lines: [] }),
      cancelOrder: jest.fn().mockResolvedValue({}),
      updateOrderStatus: jest.fn().mockResolvedValue({ header: { id: 42, vendedor: orderVendor }, lines: [] }),
    };
    jest.doMock('../services/pedidos.service', () => mockService);
    jest.doMock('../middleware/auth', function() { return { verifyToken: function(req, _res, next) { req.user = user; next(); } }; });
    jest.doMock('../middleware/logger', function() { return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }; });
    const pedidosRouter = require('../routes/pedidos');
    const app = express();
    app.use(express.json());
    app.use('/api/pedidos', pedidosRouter);
    return { request, app, mockService };
  }
  test('COMERCIAL cannot confirm another vendor order and mutation is not called', async function() {
    const { request, app, mockService } = makeMutationApp({ user: { code: '01', role: 'COMERCIAL' }, orderVendor: '02' });
    const res = await request(app).put('/api/pedidos/42/confirm').send({ saleType: 'CC' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, code: 'FORBIDDEN_VENDOR' });
    expect(mockService.getOrderVendorForAuth).toHaveBeenCalledWith(42);
    expect(mockService.confirmOrder).not.toHaveBeenCalled();
  });
  test('normal confirm path ignores forceConfirm for COMERCIAL without explicit admin gate', async function() {
    const { request, app, mockService } = makeMutationApp({ user: { code: '01', role: 'COMERCIAL' }, orderVendor: '01' });

    const res = await request(app)
      .put('/api/pedidos/42/confirm')
      .send({ saleType: 'CC', forceConfirm: true });

    expect(res.status).toBe(200);
    expect(mockService.confirmOrder).toHaveBeenCalledWith(42, 'CC', expect.objectContaining({
      forceConfirm: false,
      userId: '01',
    }));
  });

  test('JEFE_VENTAS cannot confirm order outside visible vendor scope', async function() {
    const { request, app, mockService } = makeMutationApp({
      user: { code: '80', role: 'JEFE_VENTAS', isJefeVentas: true, vendorCodes: ['01'] },
      orderVendor: '02',
    });

    const res = await request(app).put('/api/pedidos/42/confirm').send({ saleType: 'CC' });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, code: 'FORBIDDEN_VENDOR' });
    expect(mockService.confirmOrder).not.toHaveBeenCalled();
  });

  test('COMERCIAL cannot create an order for another vendor', async function() {
    const { request, app, mockService } = makeMutationApp({ user: { code: '01', role: 'COMERCIAL' }, orderVendor: '01' });
    const res = await request(app).post('/api/pedidos/create').send({
      clientCode: 'C001',
      vendedorCode: '02',
      lines: [{ codigoArticulo: 'ART001', cantidadEnvases: 1, precioVenta: 10 }],
    });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, code: 'FORBIDDEN_VENDOR' });
    expect(mockService.createOrder).not.toHaveBeenCalled();
  });
  test('COMERCIAL cannot create an order when client is outside vendor scope', async function() {
    const { request, app, mockService } = makeMutationApp({ user: { code: '01', role: 'COMERCIAL' }, orderVendor: '01' });
    mockQueryWithParams.mockResolvedValueOnce([]);
    const res = await request(app).post('/api/pedidos/create').send({
      clientCode: 'C999',
      vendedorCode: '01',
      lines: [{ codigoArticulo: 'ART001', cantidadEnvases: 1, precioVenta: 10 }],
    });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, code: 'FORBIDDEN_CLIENT_VENDOR' });
    expect(mockService.createOrder).not.toHaveBeenCalled();
    const scopeSql = mockQueryWithParams.mock.calls[0][0];
    expect(scopeSql).toMatch(/DSEDAC\.CLP/);
    expect(scopeSql).toMatch(/VENDEDORCOMERCIAL/);
    expect(scopeSql).not.toMatch(/CLI\.CODIGOVENDEDOR/);
    expect(scopeSql).not.toMatch(/CODIGOVENDEDOR/);
    expect(mockQueryWithParams.mock.calls[0][1]).toEqual(['C999', '01', '01']);
  });
  test('COMERCIAL cannot read another vendor order detail', async function() {
    const { request, app, mockService } = makeMutationApp({ user: { code: '01', role: 'COMERCIAL' }, orderVendor: '02' });
    const res = await request(app).get('/api/pedidos/42');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, code: 'FORBIDDEN_VENDOR' });
    expect(mockService.getOrderVendorForAuth).toHaveBeenCalledWith(42);
    expect(mockService.getOrderDetail).not.toHaveBeenCalled();
  });
  test('COMERCIAL cannot add lines to another vendor order', async function() {
    const { request, app, mockService } = makeMutationApp({ user: { code: '01', role: 'COMERCIAL' }, orderVendor: '02' });
    const res = await request(app).put('/api/pedidos/42/lines').send({ codigoArticulo: 'ART001', cantidadEnvases: 1, precioVenta: 10 });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, code: 'FORBIDDEN_VENDOR' });
    expect(mockService.getOrderVendorForAuth).toHaveBeenCalledWith(42);
    expect(mockService.addOrderLine).not.toHaveBeenCalled();
  });
  test('PUT /api/pedidos/:id/lines/:lineId calls updateOrderLine(lineId, payload)', async function() {
    const { request, app, mockService } = makeMutationApp({ user: { code: '01', role: 'COMERCIAL' }, orderVendor: '01' });
    const payload = {
      cantidadEnvases: 2,
      cantidadUnidades: 1,
      precioVenta: 12.5,
      unidadMedida: 'CAJAS',
      claseLinea: 'VT',
    };

    const res = await request(app).put('/api/pedidos/42/lines/7').send(payload);

    expect(res.status).toBe(200);
    expect(mockService.getOrderVendorForAuth).toHaveBeenCalledWith(42);
    expect(mockService.updateOrderLine).toHaveBeenCalledWith(7, expect.objectContaining(payload));
    expect(mockService.updateOrderLine).not.toHaveBeenCalledWith(42, 7, expect.anything());
  });
  test('DELETE /api/pedidos/:id/lines/:lineId calls deleteOrderLine(lineId, pedidoId)', async function() {
    const { request, app, mockService } = makeMutationApp({ user: { code: '01', role: 'COMERCIAL' }, orderVendor: '01' });

    const res = await request(app).delete('/api/pedidos/42/lines/7');

    expect(res.status).toBe(200);
    expect(mockService.getOrderVendorForAuth).toHaveBeenCalledWith(42);
    expect(mockService.deleteOrderLine).toHaveBeenCalledWith(7, 42);
    expect(mockService.deleteOrderLine).not.toHaveBeenCalledWith(42, 7);
  });
  test('COMERCIAL can cancel own order after ownership check', async function() {
    const { request, app, mockService } = makeMutationApp({ user: { code: '01', role: 'COMERCIAL' }, orderVendor: '01' });
    const res = await request(app).put('/api/pedidos/42/cancel').send({});
    expect(res.status).toBe(200);
    expect(mockService.getOrderVendorForAuth).toHaveBeenCalledWith(42);
    expect(mockService.cancelOrder).toHaveBeenCalledWith(42, expect.objectContaining({ userId: '01' }));
  });
  test('JEFE_VENTAS can change cross-vendor order status', async function() {
    const { request, app, mockService } = makeMutationApp({ user: { code: '80', role: 'JEFE_VENTAS', isJefeVentas: true }, orderVendor: '02' });
    const res = await request(app).put('/api/pedidos/42/status').send({ status: 'CONFIRMADO' });
    expect(res.status).toBe(200);
    expect(mockService.getOrderVendorForAuth).toHaveBeenCalledWith(42);
    expect(mockService.updateOrderStatus).toHaveBeenCalledWith(42, 'CONFIRMADO', expect.objectContaining({ userId: '80' }));
  });
});


describe('pedidos purchase-history-global route authorization contract', function() {
  const fs = require('fs');
  const path = require('path');

  function purchaseHistoryGlobalBlock() {
    const source = fs.readFileSync(path.join(__dirname, '../routes/pedidos.js'), 'utf8');
    const start = source.indexOf("router.get('/purchase-history-global'");
    const end = source.indexOf('module.exports = router', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  test('purchase-history-global reads authenticated role/code fields, not legacy userRole/codigo', function() {
    const block = purchaseHistoryGlobalBlock();

    expect(block).toMatch(/req\.user\?\.role/);
    expect(block).toMatch(/req\.user\?\.code/);
    expect(block).not.toMatch(/req\.user\?\.userRole/);
    expect(block).not.toMatch(/req\.user\?\.codigo/);
  });

  test('purchase-history-global forces non-manager filters to authenticated code', function() {
    const block = purchaseHistoryGlobalBlock();

    expect(block).toMatch(/userIsJefe/);
    expect(block).toMatch(/vendor = userVendor/);
    expect(block).toMatch(/const userIsJefe = req\.user\?\.role/);
    expect(block).toMatch(/const userVendor = String\(req\.user\?\.code/);
  });
});


describe('pedidos purchase-history-global lastYear scope contract', function() {
  const fs = require('fs');
  const path = require('path');

  function purchaseHistoryGlobalBlock() {
    const source = fs.readFileSync(path.join(__dirname, '../routes/pedidos.js'), 'utf8');
    const start = source.indexOf("router.get('/purchase-history-global'");
    const end = source.indexOf('module.exports = router', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  test('comparativaAnoAnterior lastYear query keeps COMERCIAL vendor scope', function() {
    const block = purchaseHistoryGlobalBlock();
    const lastYearStart = block.indexOf('const lastYearSql');
    const monthlyStart = block.indexOf('const monthlyByYearSql', lastYearStart);
    expect(lastYearStart).toBeGreaterThanOrEqual(0);
    expect(monthlyStart).toBeGreaterThan(lastYearStart);

    const lastYearSection = block.slice(lastYearStart, monthlyStart);

    expect(lastYearSection).toMatch(/whereSql|TRIM\(L\.LCCDVD\)|lastYearWhere/i);
    expect(lastYearSection).toMatch(/lastYearParams[\s\S]*(?:\.\.\.params|params\.slice|vendor|vendors|lastYearWhereParams)/i);
  });
});

describe('DDD pedidos purchase-history-global lastYear scope contract', function() {
  const fs = require('fs');
  const path = require('path');

  function dddPurchaseHistoryGlobalBlock() {
    const source = fs.readFileSync(path.join(__dirname, '../src/shared/routes/ddd-adapters.js'), 'utf8');
    const start = source.indexOf("router.get('/purchase-history-global'");
    const end = source.indexOf("router.post('/complementary'", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  test('lastYear total query reuses whereSql and scope params from current period', function() {
    const block = dddPurchaseHistoryGlobalBlock();
    expect(block).toMatch(/const lastYearWhereSql[\s\S]*\.\.\.where\.slice\(1\)/);
    expect(block).toMatch(/const lastYearTotalSql[\s\S]*WHERE \$\{lastYearWhereSql\}/);
    expect(block).toMatch(/const lastYearParams = \[lastYearFrom, lastYearTo, \.\.\.params\.slice\(2\)\]/);
    expect(block).not.toMatch(/lastYearTotalSql[\s\S]*\[lastYearFrom, lastYearTo\]\s*,\s*false\)/);
  });
});
