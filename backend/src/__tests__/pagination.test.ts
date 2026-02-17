/**
 * Tests for Paso 5 - Pagination & Lazy Loading
 *
 * Validates:
 * 1. All list endpoints return standardized pagination metadata
 * 2. Pagination helpers (clampLimit, clampOffset, totalPages) work correctly
 * 3. Services pass limit/offset to SQL queries
 * 4. Default/max limits are enforced
 * 5. Edge cases: offset beyond total, limit=0, negative values
 */

import {
  clampLimit,
  clampOffset,
  currentPage,
  totalPages,
} from '../utils/db-helpers';

// ============================================
// Pagination Helper Tests
// ============================================
describe('Pagination Helpers', () => {
  describe('clampLimit', () => {
    test('returns default when value is undefined', () => {
      expect(clampLimit(undefined)).toBe(50);
    });

    test('returns default when value is 0', () => {
      expect(clampLimit(0)).toBe(50);
    });

    test('returns default when value is null', () => {
      expect(clampLimit(null)).toBe(50);
    });

    test('clamps to max when value exceeds max', () => {
      expect(clampLimit(1000, 50, 500)).toBe(500);
    });

    test('clamps to 1 when value is negative', () => {
      expect(clampLimit(-5)).toBe(1);
    });

    test('accepts valid values within range', () => {
      expect(clampLimit(25)).toBe(25);
      expect(clampLimit(100, 50, 200)).toBe(100);
    });

    test('custom default and max work', () => {
      expect(clampLimit(undefined, 100, 500)).toBe(100);
      expect(clampLimit(600, 100, 500)).toBe(500);
    });

    test('parses string values', () => {
      expect(clampLimit('25')).toBe(25);
      expect(clampLimit('abc')).toBe(50);
    });
  });

  describe('clampOffset', () => {
    test('returns 0 for undefined', () => {
      expect(clampOffset(undefined)).toBe(0);
    });

    test('returns 0 for negative values', () => {
      expect(clampOffset(-10)).toBe(0);
    });

    test('returns 0 for null', () => {
      expect(clampOffset(null)).toBe(0);
    });

    test('accepts valid values', () => {
      expect(clampOffset(50)).toBe(50);
      expect(clampOffset(0)).toBe(0);
    });

    test('parses string values', () => {
      expect(clampOffset('100')).toBe(100);
      expect(clampOffset('abc')).toBe(0);
    });
  });

  describe('currentPage', () => {
    test('first page when offset is 0', () => {
      expect(currentPage(0, 50)).toBe(1);
    });

    test('second page when offset equals limit', () => {
      expect(currentPage(50, 50)).toBe(2);
    });

    test('correct page for various offsets', () => {
      expect(currentPage(100, 50)).toBe(3);
      expect(currentPage(99, 50)).toBe(2);
      expect(currentPage(150, 50)).toBe(4);
    });
  });

  describe('totalPages', () => {
    test('returns 0 for 0 total', () => {
      expect(totalPages(0, 50)).toBe(0);
    });

    test('returns 1 for total less than limit', () => {
      expect(totalPages(25, 50)).toBe(1);
    });

    test('returns exact pages for even division', () => {
      expect(totalPages(100, 50)).toBe(2);
    });

    test('rounds up for remainder', () => {
      expect(totalPages(101, 50)).toBe(3);
      expect(totalPages(51, 50)).toBe(2);
    });

    test('1 item = 1 page', () => {
      expect(totalPages(1, 50)).toBe(1);
    });
  });
});

// ============================================
// Service Pagination Integration Tests
// ============================================

const mockQuery = jest.fn();

jest.mock('../config/database', () => ({
  odbcPool: {
    query: (...args: unknown[]) => mockQuery(...args),
  },
}));

jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn().mockReturnValue('[]'),
  writeFileSync: jest.fn(),
  renameSync: jest.fn(),
}));

// Make cache transparent so tests measure actual DB behavior
jest.mock('../utils/query-cache', () => ({
  queryCache: {
    getOrSet: (_key: string, fetcher: () => Promise<unknown>) => fetcher(),
    invalidate: jest.fn(),
    invalidatePattern: jest.fn(),
    getStats: jest.fn().mockReturnValue({ hits: { l1: 0, l2: 0, total: 0 }, misses: 0 }),
    init: jest.fn(),
    close: jest.fn(),
    isReady: true,
    hasRedis: false,
  },
  TTL: { REALTIME: 60, SHORT: 120, MEDIUM: 300, LONG: 1800, STATIC: 86400, DEFAULT: 3600 },
}));

describe('Facturas Service Pagination', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('getFacturas returns pagination metadata', async () => {
    const { facturasService } = require('../services/facturas.service');

    // Data query returns rows, count query returns total
    mockQuery
      .mockResolvedValueOnce([
        { SERIE: 'A', NUMERO: 100, EJERCICIO: 2026, ANO: 2026, MES: 2, DIA: 14, CODIGO_CLIENTE: 'C01', NOMBRE_CLIENTE: 'Test', TOTAL: 1500, BASE: 1200, IVA: 300 },
        { SERIE: 'A', NUMERO: 101, EJERCICIO: 2026, ANO: 2026, MES: 2, DIA: 13, CODIGO_CLIENTE: 'C02', NOMBRE_CLIENTE: 'Test2', TOTAL: 2000, BASE: 1600, IVA: 400 },
      ])
      .mockResolvedValueOnce([{ TOTAL: 150 }]);

    const result = await facturasService.getFacturas({
      vendedorCodes: '02',
      year: 2026,
      limit: 10,
      offset: 0,
    });

    expect(result.facturas).toHaveLength(2);
    expect(result.total).toBe(150);
    expect(result.paginacion).toEqual({
      pagina: 1,
      limite: 10,
      totalPaginas: 15,
    });
  });

  test('getFacturas page 2 calculates correctly', async () => {
    const { facturasService } = require('../services/facturas.service');

    mockQuery
      .mockResolvedValueOnce([
        { SERIE: 'A', NUMERO: 90, EJERCICIO: 2026, ANO: 2026, MES: 2, DIA: 10, CODIGO_CLIENTE: 'C01', NOMBRE_CLIENTE: 'Test', TOTAL: 100, BASE: 80, IVA: 20 },
      ])
      .mockResolvedValueOnce([{ TOTAL: 50 }]);

    const result = await facturasService.getFacturas({
      vendedorCodes: '02',
      year: 2026,
      limit: 10,
      offset: 10,
    });

    expect(result.paginacion.pagina).toBe(2);
    expect(result.paginacion.totalPaginas).toBe(5);
  });

  test('getFacturas defaults to limit 50 when not provided', async () => {
    const { facturasService } = require('../services/facturas.service');

    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ TOTAL: 0 }]);

    await facturasService.getFacturas({ vendedorCodes: '02' });

    // Check the data query was called with offset=0, limit=50 as last params
    const dataCallArgs = mockQuery.mock.calls[0];
    const params = dataCallArgs[1];
    // Last two params should be offset(0) and limit(50)
    expect(params[params.length - 2]).toBe(0);  // offset
    expect(params[params.length - 1]).toBe(50); // limit
  });

  test('getFacturas clamps limit to max 500', async () => {
    const { facturasService } = require('../services/facturas.service');

    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ TOTAL: 0 }]);

    await facturasService.getFacturas({ vendedorCodes: '02', limit: 9999 });

    const dataCallArgs = mockQuery.mock.calls[0];
    const params = dataCallArgs[1];
    expect(params[params.length - 1]).toBe(500); // clamped to max
  });
});

describe('Entregas Service Pagination', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('obtenerAlbaranesPendientes returns pagination metadata', async () => {
    const { entregasService } = require('../services/entregas.service');

    mockQuery
      .mockResolvedValueOnce([{
        SUBEMPRESAALBARAN: '01', EJERCICIOALBARAN: 2026, SERIEALBARAN: 'A',
        NUMEROALBARAN: 1001, CODIGO_CLIENTE: 'C01', NOMBRE_CLIENTE: 'Test',
        DIRECCION: 'Dir', ANODOCUMENTO: 2026, MESDOCUMENTO: 2, DIADOCUMENTO: 14,
        IMPORTETOTAL: 100, CODIGOFORMAPAGO: 'EF',
      }])
      .mockResolvedValueOnce([{ TOTAL: 30 }]);

    const result = await entregasService.obtenerAlbaranesPendientes('REP01', 10, 0);

    expect(result.albaranes).toHaveLength(1);
    expect(result.total).toBe(30);
    expect(result.paginacion).toEqual({
      pagina: 1,
      limite: 10,
      totalPaginas: 3,
    });
  });

  test('obtenerAlbaranesPendientes defaults to limit 50', async () => {
    const { entregasService } = require('../services/entregas.service');

    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ TOTAL: 0 }]);

    await entregasService.obtenerAlbaranesPendientes('REP01');

    const dataCallArgs = mockQuery.mock.calls[0];
    const params = dataCallArgs[1];
    expect(params[0]).toBe(0);  // offset
    expect(params[1]).toBe(50); // default limit
  });
});

describe('Cliente Service Pagination', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('obtenerFacturas returns pagination metadata', async () => {
    const { clienteService } = require('../services/cliente.service');

    mockQuery
      .mockResolvedValueOnce([{
        SUBEMPRESA: '01', EJERCICIO: 2026, SERIE: 'A', TERMINAL: 1,
        NUMERO_ALBARAN: 500, SERIEFACTURA: 'A', NUMEROFACTURA: 100,
        ANODOCUMENTO: 2026, MESDOCUMENTO: 2, DIADOCUMENTO: 14,
        TOTAL_BASE: 1000, TOTAL_IVA: 210, TOTAL_FACTURA: 1210,
        CODIGOFORMAPAGO: 'EF', IMPORTE_PENDIENTE: 0, TIPO_DOCUMENTO: 'VT',
      }])
      .mockResolvedValueOnce([{ TOTAL: 25 }]);

    const result = await clienteService.obtenerFacturas('CLI001', 10, 0);

    expect(result.facturas).toHaveLength(1);
    expect(result.total).toBe(25);
    expect(result.paginacion).toEqual({
      pagina: 1,
      limite: 10,
      totalPaginas: 3,
    });
  });

  test('obtenerFacturas defaults to limit 50', async () => {
    const { clienteService } = require('../services/cliente.service');

    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ TOTAL: 0 }]);

    await clienteService.obtenerFacturas('CLI001');

    const dataCallArgs = mockQuery.mock.calls[0];
    const params = dataCallArgs[1];
    // params: [sanitizedCode, offset, limit]
    expect(params[1]).toBe(0);  // offset
    expect(params[2]).toBe(50); // default limit
  });

  test('obtenerClientesRutero returns pagination metadata', async () => {
    const { clienteService } = require('../services/cliente.service');

    mockQuery
      .mockResolvedValueOnce([{
        CODIGO: 'C01', NOMBRE: 'Test', DIRECCION: 'Dir', POBLACION: 'Pob',
        PROVINCIA: 'Prov', CODIGO_POSTAL: '12345', TELEFONO: '600123456', RUTA: 'R1',
      }])
      .mockResolvedValueOnce([{ TOTAL: 80 }]);

    const result = await clienteService.obtenerClientesRutero(undefined, undefined, 20, 0);

    expect(result.clientes).toHaveLength(1);
    expect(result.total).toBe(80);
    expect(result.paginacion).toEqual({
      pagina: 1,
      limite: 20,
      totalPaginas: 4,
    });
  });

  test('obtenerClientesRutero defaults to limit 100', async () => {
    const { clienteService } = require('../services/cliente.service');

    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ TOTAL: 0 }]);

    await clienteService.obtenerClientesRutero();

    const dataCallArgs = mockQuery.mock.calls[0];
    const params = dataCallArgs[1];
    // params: [offset, limit]
    expect(params[0]).toBe(0);   // offset
    expect(params[1]).toBe(100); // default limit for rutero
  });
});

// ============================================
// Pagination Edge Cases
// ============================================
describe('Pagination Edge Cases', () => {
  test('offset beyond total returns empty array with correct metadata', async () => {
    const { facturasService } = require('../services/facturas.service');

    mockQuery
      .mockResolvedValueOnce([]) // no rows at offset 1000
      .mockResolvedValueOnce([{ TOTAL: 50 }]);

    const result = await facturasService.getFacturas({
      vendedorCodes: '02',
      year: 2026,
      limit: 10,
      offset: 1000,
    });

    expect(result.facturas).toHaveLength(0);
    expect(result.total).toBe(50);
    expect(result.paginacion.pagina).toBe(101); // offset 1000 / limit 10 + 1
    expect(result.paginacion.totalPaginas).toBe(5); // 50 / 10
  });

  test('negative limit is clamped to 1', () => {
    expect(clampLimit(-5)).toBe(1);
  });

  test('negative offset is clamped to 0', () => {
    expect(clampOffset(-100)).toBe(0);
  });

  test('totalPages with 1 item per page', () => {
    expect(totalPages(5, 1)).toBe(5);
  });
});
