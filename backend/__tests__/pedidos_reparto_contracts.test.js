'use strict';

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockGetClientDays = jest.fn();
const mockConnQuery = jest.fn();
const mockConnClose = jest.fn();
let mockPool = null;

jest.mock('../config/db', () => ({
  query: mockQuery,
  queryWithParams: mockQueryWithParams,
  getPool: () => mockPool,
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../services/query-optimizer', () => ({
  cachedQuery: jest.fn((fn, sql, _key, _ttl, params) => fn(sql, params)),
}));

jest.mock('../services/redis-cache', () => ({
  redisCache: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    invalidatePattern: jest.fn(),
  },
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
}));

jest.mock('../services/laclae', () => ({
  getClientDays: mockGetClientDays,
}));

const pedidosService = require('../services/pedidos.service');

function mockSuccessfulConfirmationQueries({
  vehicleCode = '02',
  driverCode = '57',
  includeLine = false,
} = {}) {
  const orderLine = {
    ID: 7,
    PEDIDO_ID: 42,
    SECUENCIA: 1,
    CODIGOARTICULO: 'ART001',
    DESCRIPCION: 'HELADO TEST',
    CANTIDADENVASES: 2,
    CANTIDADUNIDADES: 0,
    UNIDADMEDIDA: 'CAJAS',
    UNIDADESCAJA: 1,
    PRECIOVENTA: 10,
    PRECIOCOSTO: 4,
    PRECIOTARIFA: 10,
    PRECIOTARIFACLIENTE: 10,
    PRECIOMINIMO: 0,
    IMPORTEVENTA: 20,
    IMPORTECOSTO: 8,
    IMPORTEMARGEN: 12,
    PORCENTAJEMARGEN: 60,
    TIPOLINEA: 'R',
    TIPOVENTA: 'CC',
    CLASELINEA: 'VT',
    ORDEN: 1,
  };

  mockQueryWithParams.mockImplementation(async (sql) => {
    if (/SELECT\s+ESTADO/i.test(sql)) {
      return [{
        ID: 42,
        ESTADO: 'BORRADOR',
        EJERCICIO: 2026,
        NUMEROPEDIDO: 10363,
        SERIEPEDIDO: 'M',
        TERMINAL: 999,
        DIADOCUMENTO: 4,
        MESDOCUMENTO: 5,
        ANODOCUMENTO: 2026,
        HORADOCUMENTO: 100800,
        CODIGOCLIENTE: '4300010363',
        NOMBRECLIENTE: 'SUSHI LORCA, S.L.',
        CODIGOVENDEDOR: '57',
        CODIGOFORMAPAGO: '02',
        CODIGOTARIFA: 1,
        CODIGOALMACEN: 1,
        TIPOVENTA: 'CC',
        IMPORTETOTAL: 20,
        IMPORTEBASE: 20,
        IMPORTEIVA: 0,
        IMPORTECOSTO: 8,
        IMPORTEMARGEN: 12,
        OBSERVACIONES: 'OBS TEST',
      }];
    }
    if (/FROM\s+DSEDAC\.OPP/i.test(sql)) {
      return [{
        CODIGOVEHICULO: vehicleCode,
        CODIGOREPARTIDOR: driverCode,
        MATRICULA: '1234ABC',
        DESC_VEHICULO: 'IVECO',
      }];
    }
    if (/FROM\s+DSEDAC\.ARO/i.test(sql)) {
      return [{ ENVASES: 999, UNIDADES: 999 }];
    }
    if (/FROM\s+JAVIER\.PEDIDOS_LIN\s+WHERE\s+PEDIDO_ID/i.test(sql)) {
      return includeLine ? [orderLine] : [];
    }
    if (/UPDATE\s+JAVIER\.PEDIDOS_CAB\s+SET\s+ESTADO\s*=\s*'CONFIRMADO'/i.test(sql)) {
      return [];
    }
    if (/SELECT\s+ID,\s+EJERCICIO,\s+NUMEROPEDIDO/i.test(sql)) {
      return [{
        ID: 42,
        EJERCICIO: 2026,
        NUMEROPEDIDO: 10363,
        SERIEPEDIDO: 'M',
        TERMINAL: 999,
        DIADOCUMENTO: 4,
        MESDOCUMENTO: 5,
        ANODOCUMENTO: 2026,
        HORADOCUMENTO: 100800,
        CODIGOCLIENTE: '4300010363',
        NOMBRECLIENTE: 'SUSHI LORCA, S.L.',
        CODIGOVENDEDOR: '57',
        CODIGOFORMAPAGO: '02',
        CODIGOTARIFA: 1,
        CODIGOALMACEN: 1,
        TIPOVENTA: 'CC',
        ESTADO: 'CONFIRMADO',
        IMPORTETOTAL: 48.16,
        IMPORTEBASE: 48.16,
        IMPORTEIVA: 0,
        IMPORTECOSTO: 30,
        IMPORTEMARGEN: 18.16,
        OBSERVACIONES: '',
        FECHAREPARTO: '2026-05-05',
        DIAREPARTO: 5,
        MESREPARTO: 5,
        ANOREPARTO: 2026,
        CODIGOREPARTIDOR: driverCode,
        CODIGOVEHICULO: vehicleCode,
        RUTA: '',
        DIASREPARTO: 'martes,jueves',
      }];
    }
    return [];
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockReset();
  mockQueryWithParams.mockReset();
  mockGetClientDays.mockReset();
  mockConnQuery.mockReset();
  mockConnClose.mockReset();
  mockConnClose.mockResolvedValue();
  mockPool = null;
  delete process.env.PEDIDOS_CONFIRMATION_SCHEMA;
  delete process.env.PEDIDOS_EXPORT_TO_SYSTEM;
  delete process.env.PEDIDOS_SYSTEM_TERMINAL;
});

describe('pedidos reparto confirmation contract', () => {
  test('rejects delivery date outside client delivery days', async () => {
    mockGetClientDays.mockReturnValue({
      visitDays: ['lunes'],
      deliveryDays: ['martes', 'jueves'],
      deliveryDaysShort: 'MJ',
    });
    mockSuccessfulConfirmationQueries();

    await expect(
      pedidosService.confirmOrder(42, 'CC', { deliveryDate: '2026-05-06' }),
    ).rejects.toThrow(/Fecha reparto.*miercoles.*martes, jueves/i);

    const updated = mockQueryWithParams.mock.calls.some(([sql]) =>
      /UPDATE\s+JAVIER\.PEDIDOS_CAB\s+SET\s+ESTADO\s*=\s*'CONFIRMADO'/i.test(sql),
    );
    expect(updated).toBe(false);
  });

  test('stores valid delivery date and default truck assignment on confirmation', async () => {
    mockGetClientDays.mockReturnValue({
      visitDays: ['lunes'],
      deliveryDays: ['martes', 'jueves'],
      deliveryDaysShort: 'MJ',
    });
    mockSuccessfulConfirmationQueries();

    await pedidosService.confirmOrder(42, 'CC', { deliveryDate: '2026-05-05' });

    const updateCall = mockQueryWithParams.mock.calls.find(([sql]) =>
      /UPDATE\s+JAVIER\.PEDIDOS_CAB\s+SET\s+ESTADO\s*=\s*'CONFIRMADO'/i.test(sql),
    );
    expect(updateCall).toBeDefined();
    const [updateSql, params] = updateCall;
    expect(updateSql).toContain('FECHAREPARTO = ?');
    expect(updateSql).toContain('CODIGOVEHICULO = ?');
    expect(updateSql).toContain('CODIGOREPARTIDOR = ?');
    expect(params).toEqual(expect.arrayContaining(['2026-05-05', 5, 5, 2026, '02', '57']));
  });

  test('default confirmation target stays in JAVIER and does not write DSEDAC order tables', async () => {
    mockGetClientDays.mockReturnValue({
      deliveryDays: ['martes', 'jueves'],
      deliveryDaysShort: 'MJ',
    });
    mockSuccessfulConfirmationQueries({ includeLine: true });

    await pedidosService.confirmOrder(42, 'CC', { deliveryDate: '2026-05-05' });

    const sqlText = mockQueryWithParams.mock.calls.map(([sql]) => sql).join('\n');
    expect(sqlText).not.toMatch(/INSERT\s+INTO\s+DSEDAC\.(CPC|LPC|OCPC)/i);
    expect(mockConnQuery).not.toHaveBeenCalled();
  });

  test('PEDIDOS_EXPORT_TO_SYSTEM=false disables DSEDAC order export', async () => {
    process.env.PEDIDOS_CONFIRMATION_SCHEMA = 'DSEDAC';
    process.env.PEDIDOS_EXPORT_TO_SYSTEM = 'false';
    mockGetClientDays.mockReturnValue({
      deliveryDays: ['martes', 'jueves'],
      deliveryDaysShort: 'MJ',
    });
    mockSuccessfulConfirmationQueries({ includeLine: true });

    await pedidosService.confirmOrder(42, 'CC', { deliveryDate: '2026-05-05' });

    const sqlText = mockQueryWithParams.mock.calls.map(([sql]) => sql).join('\n');
    expect(sqlText).not.toMatch(/INSERT\s+INTO\s+DSEDAC\.(CPC|LPC|OCPC)/i);
    expect(mockConnQuery).not.toHaveBeenCalled();
  });

  test('DSEDAC target exports commercial order to CPC/LPC with ERP column names', async () => {
    process.env.PEDIDOS_CONFIRMATION_SCHEMA = 'DSEDAC';
    process.env.PEDIDOS_EXPORT_TO_SYSTEM = 'true';
    process.env.PEDIDOS_SYSTEM_TERMINAL = '10';
    mockGetClientDays.mockReturnValue({
      deliveryDays: ['martes', 'jueves'],
      deliveryDaysShort: 'MJ',
    });
    mockSuccessfulConfirmationQueries({ includeLine: true, vehicleCode: '11', driverCode: '57' });
    mockConnQuery.mockImplementation(async (sql) => {
      if (/MAX\(NUMEROPEDIDO\)/i.test(sql)) return [{ NEXT_NUMERO: 778 }];
      return [];
    });
    mockPool = {
      connect: jest.fn().mockResolvedValue({
        query: (...args) => mockConnQuery(...args),
        close: mockConnClose,
      }),
    };

    await pedidosService.confirmOrder(42, 'CC', { deliveryDate: '2026-05-05' });

    const cpcInsert = mockConnQuery.mock.calls.find(([sql]) =>
      /INSERT\s+INTO\s+DSEDAC\.CPC/i.test(sql),
    );
    const lpcInsert = mockConnQuery.mock.calls.find(([sql]) =>
      /INSERT\s+INTO\s+DSEDAC\.LPC/i.test(sql),
    );
    expect(cpcInsert).toBeDefined();
    expect(cpcInsert[0]).toContain('SUBEMPRESAPEDIDO');
    expect(cpcInsert[0]).toContain('EJERCICIOPEDIDO');
    expect(cpcInsert[0]).toContain('DIASERVICIO');
    expect(cpcInsert[1]).toEqual(expect.arrayContaining(['GMP', 2026, 'P', 10, 778]));

    expect(lpcInsert).toBeDefined();
    expect(lpcInsert[0]).toContain('SECUENCIAPEDIDO');
    expect(lpcInsert[0]).toContain('CODIGOARTICULO');
    expect(lpcInsert[0]).toContain('IMPORTEVENTA');
    expect(lpcInsert[1]).toEqual(expect.arrayContaining(['ART001', 2, 20]));

    const localUpdate = mockConnQuery.mock.calls.find(([sql]) =>
      /UPDATE\s+JAVIER\.PEDIDOS_CAB\s+SET\s+ESTADO\s*=\s*'CONFIRMADO'/i.test(sql),
    );
    expect(localUpdate).toBeDefined();
    expect(localUpdate[0]).toContain('TARGET_SCHEMA = ?');
    expect(localUpdate[0]).toContain('SYSTEM_NUMEROPEDIDO = ?');
    expect(localUpdate[1]).toEqual(expect.arrayContaining(['DSEDAC', 'SYNCED', 2026, 'P', 10, 778]));
    expect(mockConnQuery.mock.calls.some(([sql]) => /^BEGIN WORK$/i.test(sql))).toBe(true);
    expect(mockConnQuery.mock.calls.some(([sql]) => /^COMMIT$/i.test(sql))).toBe(true);
  });

  test('DSEDAC target carries manual vehicle assignment into CPC export', async () => {
    process.env.PEDIDOS_CONFIRMATION_SCHEMA = 'DSEDAC';
    process.env.PEDIDOS_EXPORT_TO_SYSTEM = 'true';
    process.env.PEDIDOS_SYSTEM_TERMINAL = '10';
    mockGetClientDays.mockReturnValue({
      deliveryDays: ['martes', 'jueves'],
      deliveryDaysShort: 'MJ',
    });
    mockSuccessfulConfirmationQueries({ includeLine: true, vehicleCode: '11', driverCode: '57' });
    mockConnQuery.mockImplementation(async (sql) => {
      if (/MAX\(NUMEROPEDIDO\)/i.test(sql)) return [{ NEXT_NUMERO: 779 }];
      return [];
    });
    mockPool = {
      connect: jest.fn().mockResolvedValue({
        query: (...args) => mockConnQuery(...args),
        close: mockConnClose,
      }),
    };

    await pedidosService.confirmOrder(42, 'CC', {
      deliveryDate: '2026-05-05',
      vehicleCode: '44',
      driverCode: '88',
      routeCode: 'R9',
    });

    const cpcInsert = mockConnQuery.mock.calls.find(([sql]) =>
      /INSERT\s+INTO\s+DSEDAC\.CPC/i.test(sql),
    );
    expect(cpcInsert).toBeDefined();
    expect(cpcInsert[0]).toContain('CODIGOVEHICULO');
    expect(cpcInsert[0]).toContain('CODIGOREPARTIDOR');
    expect(cpcInsert[1]).toEqual(expect.arrayContaining(['44', '88']));
  });
});
