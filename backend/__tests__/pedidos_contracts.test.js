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
