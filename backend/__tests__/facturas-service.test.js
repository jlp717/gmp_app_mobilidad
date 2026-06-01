'use strict';

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();

jest.mock('../config/db', () => ({
  query: (...args) => mockQuery(...args),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));

jest.mock('../services/redis-cache', () => ({
  redisCache: {
    get: (...args) => mockRedisGet(...args),
    set: (...args) => mockRedisSet(...args),
  },
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const facturasService = require('../services/facturas.service');

const f4306Header = {
  SERIEFACTURA: 'F',
  NUMEROFACTURA: 4306,
  EJERCICIOFACTURA: 2026,
  DIAFACTURA: 30,
  MESFACTURA: 4,
  ANOFACTURA: 2026,
  CODIGOCLIENTE: '4300010400',
  NOMBRECLIENTEFACTURA: 'CANITO COMIDAS',
  NOMBRECOMERCIALFACTURA: 'CANITO COMIDAS',
  NOMBREFISCALFACTURA: 'CANO MARTINEZ ALEJANDRO',
  DIRECCIONCLIENTEFACTURA: 'CL DOCTOR FLEMIN, 2 BAJO',
  POBLACIONCLIENTEFACTURA: 'AGUILAS',
  CIFCLIENTEFACTURA: '23331620Y',
  TOTALFACTURA: 3618.44,
  IMPORTEBASEIMPONIBLE1: 2987.13,
  PORCENTAJEIVA1: 10,
  IMPORTEIVA1: 298.71,
  IMPORTEBASEIMPONIBLE2: 0,
  PORCENTAJEIVA2: 21,
  IMPORTEIVA2: 0,
  IMPORTEBASEIMPONIBLE3: 229.90,
  PORCENTAJEIVA3: 4,
  IMPORTEIVA3: 9.20,
  IMPORTEBASEIMPONIBLE4: 0,
  PORCENTAJEIVA4: 0,
  IMPORTEIVA4: 0,
  IMPORTEBASEIMPONIBLE5: 85,
  PORCENTAJEIVA5: 10,
  IMPORTEIVA5: 8.50,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue(undefined);
});

describe('facturas service fiscal totals', () => {
  test('getFacturaDetail uses official CFC header with all five IVA slots', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/FROM\s+DSEDAC\.CFC\s+CFC/i.test(sql)) return [f4306Header];
      if (/FROM\s+DSEDAC\.LAC\s+LAC/i.test(sql)) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const factura = await facturasService.getFacturaDetail('F', 4306, 2026);

    expect(factura.header.total).toBe(3618.44);
    expect(factura.header.bases).toEqual([
      { base: 2987.13, pct: 10, iva: 298.71 },
      { base: 229.90, pct: 4, iva: 9.20 },
      { base: 85, pct: 10, iva: 8.50 },
    ]);

    const headerSql = mockQueryWithParams.mock.calls[0][0];
    expect(headerSql).toMatch(/FROM\s+DSEDAC\.CFC\s+CFC/i);
    expect(headerSql).toMatch(/IMPORTEBASEIMPONIBLE5/i);
    expect(headerSql).toMatch(/IMPORTEIVA5/i);
    expect(headerSql).not.toMatch(/SUM\(CAC\.IMPORTETOTAL\)/i);
  });

  test('getFacturasRaw reads list amounts from CFC aggregated fiscal columns', async () => {
    mockQueryWithParams.mockResolvedValueOnce([
      {
        SERIE: 'F',
        NUMERO: 4306,
        EJERCICIO: 2026,
        DIA: 30,
        MES: 4,
        ANO: 2026,
        CODIGO_CLIENTE: '4300010400',
        NOMBRE_CLIENTE: 'CANITO COMIDAS',
        NOMBRE_COMERCIAL: 'CANITO COMIDAS',
        NOMBRE_FISCAL: 'CANO MARTINEZ ALEJANDRO',
        TOTAL: 3618.44,
        BASE: 3302.03,
        IVA: 316.41,
      },
    ]);

    const facturas = await facturasService.getFacturasRaw({
      vendedorCodes: 'ALL',
      year: 2026,
      docSearch: '4306',
    });

    expect(facturas).toHaveLength(1);
    expect(facturas[0]).toMatchObject({
      id: 'F-4306-2026',
      total: 3618.44,
      base: 3302.03,
      iva: 316.41,
    });
    expect(mockQueryWithParams.mock.calls[0][0]).toMatch(/FROM\s+DSEDAC\.CFC\s+CFC/i);
  });

  test('getSummary totals base and IVA from CFC official totals', async () => {
    mockQueryWithParams.mockResolvedValueOnce([
      {
        NUM_FACTURAS: 1,
        TOTAL: 3618.44,
        BASE: 3302.03,
        IVA: 316.41,
      },
    ]);

    const summary = await facturasService.getSummary({
      vendedorCodes: 'ALL',
      year: 2026,
    });

    expect(summary).toEqual({
      totalFacturas: 1,
      totalImporte: 3618.44,
      totalBase: 3302.03,
      totalIva: 316.41,
    });
    expect(mockQueryWithParams.mock.calls[0][0]).toMatch(/FROM\s+DSEDAC\.CFC\s+CFC/i);
    expect(mockRedisSet.mock.calls[0][1]).toMatch(/^facturas:summary:v2:/);
  });
});
