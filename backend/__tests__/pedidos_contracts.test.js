'use strict';

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

describe('pedidos product catalog contract', () => {
  test('getProducts uses LACLAE purchase history and orders least purchased first', async () => {
    let capturedSql = '';
    let capturedParams = [];
    mockQueryWithParams.mockImplementation(async (sql, params) => {
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
    expect(sql).toMatch(/TRIM\(CODIGOARTICULO\) IN \(\?,\?\)/i);
    expect(sql).toMatch(/TRIM\(SR\.CODIGOARTICULO\) IN \(\?,\?\)/i);
    expect(params).toEqual([1, 'ART001', 'ART002', 'ART001', 'ART002']);
    expect(result.get('ART001')).toEqual({ envases: 12, unidades: 24 });
    expect(result.get('ART002')).toEqual({ envases: 3, unidades: 6 });
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
        ORDEN: 1,
      },
    };
  }

  function mockCreateOrderFlow({ failTotalsUpdate = false } = {}) {
    const rows = mockCreatedOrderReads();
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/UPDATE\s+JAVIER\.PEDIDOS_SEQ\s+SET\s+ULTIMO_NUMERO/i.test(sql)) return [];
      if (/SELECT\s+ULTIMO_NUMERO\s+FROM\s+JAVIER\.PEDIDOS_SEQ/i.test(sql)) return [{ ULTIMO_NUMERO: 100 }];
      if (/INSERT\s+INTO\s+JAVIER\.PEDIDOS_CAB/i.test(sql)) return [];
      if (/SELECT\s+ID\s+FROM\s+JAVIER\.PEDIDOS_CAB/i.test(sql)) return [{ ID: 42 }];
      if (/INSERT\s+INTO\s+JAVIER\.PEDIDOS_LIN/i.test(sql)) return [];
      if (/SELECT\s+COALESCE\(SUM\(L\.IMPORTEVENTA\)/i.test(sql)) {
        return [{ RAW_BASE: 30, RAW_COSTO: 12, DESCUENTO_GLOBAL: 10 }];
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
    expect(updateCall[1]).toEqual([30, 12, 27, 15, 42]);
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
    expect(lineCall[1][8]).toBe(9);
    expect(lineCall[1][13]).toBe(18);
    expect(lineCall[1][17]).toBe(10);
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
    expect(source).toContain('PEDIDOS_DSEDAC_STORAGE_APPROVED');
    expect(source).toMatch(/requested\s*===\s*'DSEDAC'\s*&&\s*!isDsedacWriteApproved\(\)/);
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
    expect(pedidosService.isOrderTransitionAllowed('BORRADOR', 'PENDIENTE_APROBACION')).toBe(true);
    expect(pedidosService.isOrderTransitionAllowed('BORRADOR', 'PEND_APROB')).toBe(true);
    expect(pedidosService.isOrderTransitionAllowed('PENDIENTE_APROBACION', 'CONFIRMADO')).toBe(true);
    expect(pedidosService.isOrderTransitionAllowed('PEND_APROB', 'CONFIRMADO')).toBe(true);
    expect(pedidosService.isOrderTransitionAllowed('CONFIRMANDO', 'CONFIRMADO')).toBe(true);
    expect(pedidosService.isOrderTransitionAllowed('CONFIRMANDO', 'BORRADOR')).toBe(true);
    expect(pedidosService.isOrderTransitionAllowed('CONFIRMADO', 'ENVIADO')).toBe(true);
    expect(pedidosService.isOrderTransitionAllowed('CONFIRMADO', 'BORRADOR')).toBe(false);
    expect(pedidosService.isOrderTransitionAllowed('ENVIADO', 'ANULADO')).toBe(false);
    expect(pedidosService.isOrderTransitionAllowed('ANULADO', 'CONFIRMADO')).toBe(false);
  });

  test('stores approval status with DB2-safe length and exposes canonical API state', () => {
    expect(pedidosService.storedOrderStatus('PENDIENTE_APROBACION')).toBe('PEND_APROB');
    expect(pedidosService.canonicalOrderStatus('PEND_APROB')).toBe('PENDIENTE_APROBACION');
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

  test('updateOrderStatus rejects forbidden transitions', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/SELECT\s+TRIM\(ESTADO\)\s+AS\s+ESTADO\s+FROM\s+JAVIER\.PEDIDOS_CAB/i.test(sql)) {
        return [{ ESTADO: 'CONFIRMADO' }];
      }
      return [];
    });

    await expect(
      pedidosService.updateOrderStatus(42, 'BORRADOR', { userId: '01' }),
    ).rejects.toMatchObject({ code: 'INVALID_ORDER_TRANSITION' });

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

  test('cancelOrder uses CAS conditional update and reports terminal-state conflict', async () => {
    let stateReadCount = 0;
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/SELECT\s+ESTADO,\s+CODIGOCLIENTE,\s+IMPORTETOTAL\s+FROM\s+JAVIER\.PEDIDOS_CAB\s+WHERE\s+ID\s+=\s+\?/i.test(sql)) {
        stateReadCount += 1;
        return stateReadCount === 1
          ? [{ ESTADO: 'BORRADOR', CODIGOCLIENTE: 'C001', IMPORTETOTAL: '100.00' }]
          : [{ ESTADO: 'CONFIRMADO', CODIGOCLIENTE: 'C001', IMPORTETOTAL: '100.00' }];
      }
      if (/UPDATE\s+JAVIER\.PEDIDOS_CAB\s+SET\s+ESTADO\s+=\s+'ANULADO'/i.test(sql)) {
        return { count: 0 };
      }
      return [];
    });

    await expect(pedidosService.cancelOrder(42)).rejects.toMatchObject({
      code: 'PEDIDO_STATE_CONFLICT',
      status: 409,
    });

    const updateCall = mockQueryWithParams.mock.calls.find(([sql]) => /UPDATE\s+JAVIER\.PEDIDOS_CAB\s+SET\s+ESTADO\s+=\s+'ANULADO'/i.test(sql));
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toMatch(/WHERE\s+ID\s+=\s+\?\s+AND\s+ESTADO\s+IN\s+\('BORRADOR',\s*'CONFIRMADO'\)/i);
    expect(updateCall[1]).toEqual([42]);
  });

  test('cancelOrder returns typed errors for already ANULADO and ENVIADO states', async () => {
    mockQueryWithParams.mockResolvedValueOnce([{ ESTADO: 'ANULADO' }]);
    await expect(pedidosService.cancelOrder(42)).rejects.toMatchObject({ code: 'PEDIDO_ALREADY_ANULADO', status: 409 });

    mockQueryWithParams.mockReset();
    mockQueryWithParams.mockResolvedValueOnce([{ ESTADO: 'ENVIADO' }]);
    await expect(pedidosService.cancelOrder(42)).rejects.toMatchObject({ code: 'PEDIDO_INVALID_STATE', status: 409 });
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


describe('pedidos mutation route ownership contract', function() {
  function makeMutationApp({ user = { code: '01', role: 'COMERCIAL' }, orderVendor = '01' } = {}) {
    jest.resetModules();
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
    const monthlyStart = block.indexOf('// 5) Mensual por año', lastYearStart);
    expect(lastYearStart).toBeGreaterThanOrEqual(0);
    expect(monthlyStart).toBeGreaterThan(lastYearStart);

    const lastYearSection = block.slice(lastYearStart, monthlyStart);

    expect(lastYearSection).toMatch(/whereSql|TRIM\(L\.LCCDVD\)|lastYearWhere/i);
    expect(lastYearSection).toMatch(/lastYearParams[\s\S]*(?:\.\.\.params|params\.slice|vendor|vendors|lastYearWhereParams)/i);
  });
});
