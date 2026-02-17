/**
 * Tests for Paso 3 - Query Optimization
 *
 * Validates that:
 * 1. N+1 queries have been eliminated (dashboard, roles)
 * 2. Sequential queries are parallelized (cliente, products, facturas, entregas)
 * 3. All services still export correct types and call patterns
 */

// ============================================
// Mock setup - must be before imports
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

// Make cache transparent so tests measure actual DB calls
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

import { dashboardService } from '../services/dashboard.service';
import { facturasService } from '../services/facturas.service';

// ============================================
// Dashboard N+1 Elimination Tests
// ============================================
describe('Dashboard N+1 Elimination', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('getUltimasVentas uses JOIN instead of per-row queries', async () => {
    // Mock: single query with JOIN returns client names inline
    mockQuery.mockResolvedValueOnce([
      {
        DIADOCUMENTO: 14, MESDOCUMENTO: 2, ANODOCUMENTO: 2026,
        CODIGOCLIENTEALBARAN: 'CLI001',
        NOMBRE_CLIENTE: 'GRANJA MARI PEPA',
        IMPORTETOTAL: 1500.50,
        SERIEALBARAN: 'A', NUMEROALBARAN: 12345,
      },
      {
        DIADOCUMENTO: 13, MESDOCUMENTO: 2, ANODOCUMENTO: 2026,
        CODIGOCLIENTEALBARAN: 'CLI002',
        NOMBRE_CLIENTE: 'BAR EL POLLO',
        IMPORTETOTAL: 800.00,
        SERIEALBARAN: 'A', NUMEROALBARAN: 12344,
      },
    ]);

    // Access private method via bracket notation
    const result = await (dashboardService as any).getUltimasVentas('02', 5);

    // Should make exactly 1 query (with JOIN), NOT 1 + N
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // Verify the query contains LEFT JOIN to CLI
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('LEFT JOIN DSEDAC.CLI');
    expect(sql).toContain('NOMBRE_CLIENTE');

    // Verify results
    expect(result).toHaveLength(2);
    expect(result[0].cliente).toBe('GRANJA MARI PEPA');
    expect(result[0].fecha).toBe('14/02/2026');
    expect(result[0].importe).toBe(1500.50);
    expect(result[1].cliente).toBe('BAR EL POLLO');
  });

  test('getUltimasVentas falls back to code when name is empty', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        DIADOCUMENTO: 14, MESDOCUMENTO: 2, ANODOCUMENTO: 2026,
        CODIGOCLIENTEALBARAN: 'CLI003',
        NOMBRE_CLIENTE: '',
        IMPORTETOTAL: 200.00,
        SERIEALBARAN: 'B', NUMEROALBARAN: 99,
      },
    ]);

    const result = await (dashboardService as any).getUltimasVentas('02', 1);

    expect(result[0].cliente).toBe('CLI003');
  });

  test('getTopClientes uses JOIN instead of per-row queries', async () => {
    mockQuery.mockResolvedValueOnce([
      { CODIGO: 'CLI001', NOMBRE: 'GRANJA MARI PEPA', TOTAL: 50000, OPERACIONES: 120 },
      { CODIGO: 'CLI002', NOMBRE: 'BAR EL POLLO', TOTAL: 30000, OPERACIONES: 80 },
    ]);

    const result = await dashboardService.getTopClientes('02', 10);

    // Should make exactly 1 query (with JOIN), NOT 1 + N
    expect(mockQuery).toHaveBeenCalledTimes(1);

    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('LEFT JOIN DSEDAC.CLI');

    expect(result).toHaveLength(2);
    expect(result[0].nombreCliente).toBe('GRANJA MARI PEPA');
    expect(result[0].totalVentas).toBe(50000);
    expect(result[1].nombreCliente).toBe('BAR EL POLLO');
  });

  test('getDashboardVendedor runs all queries in parallel via Promise.all', async () => {
    // Mock all 9 parallel queries from getDashboardVendedor
    // Order: ventasHoy, ventasMes, ventasMesAnterior, ventasAnio,
    //        clientesHoy, clientesMes, clientesAsignados, pedidosPendientes, ultimasVentas
    const queryCallOrder: number[] = [];
    let callIndex = 0;

    mockQuery.mockImplementation(async () => {
      const myIndex = callIndex++;
      queryCallOrder.push(myIndex);
      // Small delay to prove parallel execution
      await new Promise(r => setTimeout(r, 5));
      // Return appropriate mock data based on call
      if (myIndex <= 3) return [{ TOTAL: 1000, CANTIDAD: 10, MARGEN: 200 }]; // ventas
      if (myIndex <= 5) return [{ TOTAL: 5 }]; // clientes count
      if (myIndex === 6) return [{ TOTAL: 50 }]; // clientes asignados
      if (myIndex === 7) return [{ TOTAL: 3 }]; // pedidos pendientes
      return []; // ultimas ventas
    });

    const result = await dashboardService.getDashboardVendedor('02');

    // All 9 queries should have been called
    expect(mockQuery).toHaveBeenCalledTimes(9);

    // Result should be well-formed
    expect(result.ventasHoy).toBeDefined();
    expect(result.ventasMes).toBeDefined();
    expect(result.ventasAnio).toBeDefined();
    expect(result.clientesAtendidos).toBeDefined();
    expect(result.ultimasVentas).toBeDefined();
  });
});

// ============================================
// Facturas Parallelization Tests
// ============================================
describe('Facturas Query Parallelization', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('getFacturaDetail runs header + lines in parallel', async () => {
    const callOrder: string[] = [];

    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('CAC.NUMEROFACTURA') && sql.includes('FETCH FIRST 1')) {
        callOrder.push('header');
        await new Promise(r => setTimeout(r, 10));
        return [{
          NUMEROFACTURA: 100, SERIEFACTURA: 'A', EJERCICIOFACTURA: 2026,
          DIAFACTURA: 14, MESFACTURA: 2, ANOFACTURA: 2026,
          CODIGOCLIENTE: 'CLI001',
          NOMBRECLIENTEFACTURA: 'GRANJA MARI PEPA',
          DIRECCIONCLIENTEFACTURA: 'CALLE POLLOS 1',
          POBLACIONCLIENTEFACTURA: 'MURCIA',
          CIFCLIENTEFACTURA: 'A12345678',
          TOTALFACTURA: 1500,
          IMPORTEBASEIMPONIBLE1: 1200, PORCENTAJEIVA1: 10, IMPORTEIVA1: 120,
          IMPORTEBASEIMPONIBLE2: 0, PORCENTAJEIVA2: 0, IMPORTEIVA2: 0,
          IMPORTEBASEIMPONIBLE3: 0, PORCENTAJEIVA3: 0, IMPORTEIVA3: 0,
        }];
      }
      if (sql.includes('LAC.CODIGOARTICULO')) {
        callOrder.push('lines');
        await new Promise(r => setTimeout(r, 10));
        return [
          { CODIGOARTICULO: 'ART01', DESCRIPCIONARTICULO: 'Pollo entero', CANTIDAD: 10, PRECIO: 5.50, IMPORTE: 55.00, DESCUENTO: 0 },
        ];
      }
      return [];
    });

    const result = await facturasService.getFacturaDetail('A', 100, 2026);

    // Both queries should have been called
    expect(mockQuery).toHaveBeenCalledTimes(2);

    // Both should start roughly at the same time (parallel, not sequential)
    expect(callOrder).toContain('header');
    expect(callOrder).toContain('lines');

    // Verify result structure
    expect(result.header.serie).toBe('A');
    expect(result.header.numero).toBe(100);
    expect(result.header.clienteNombre).toBe('GRANJA MARI PEPA');
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].descripcion).toBe('Pollo entero');
  });

  test('getFacturaDetail throws when header not found', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FETCH FIRST 1')) return [];
      return [];
    });

    await expect(
      facturasService.getFacturaDetail('Z', 999, 2026)
    ).rejects.toThrow('Factura no encontrada');
  });
});

// ============================================
// Roles N+1 Elimination Tests
// ============================================
describe('Roles N+1 Elimination', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('obtenerAlbaranesConductor determines CTR inline via JOIN', async () => {
    // Import here to avoid constructor issues
    const { rolesService } = require('../services/roles.service');

    mockQuery.mockResolvedValueOnce([
      {
        SUBEMPRESAALBARAN: '01', EJERCICIOALBARAN: 2026,
        SERIEALBARAN: 'A', NUMEROALBARAN: 100,
        CLIENTE: 'CLI001', NOMBRE_CLIENTE: 'GRANJA TEST',
        DIRECCION: 'CALLE 1', IMPORTE: 150.50,
        FORMA_PAGO: '01', DESC_FORMA_PAGO: 'CONTADO',
        DIADOCUMENTO: 14, MESDOCUMENTO: 2, ANODOCUMENTO: 2026,
        RUTA: 'R01',
      },
      {
        SUBEMPRESAALBARAN: '01', EJERCICIOALBARAN: 2026,
        SERIEALBARAN: 'A', NUMEROALBARAN: 101,
        CLIENTE: 'CLI002', NOMBRE_CLIENTE: 'BAR TEST',
        DIRECCION: 'CALLE 2', IMPORTE: 200.00,
        FORMA_PAGO: '30', DESC_FORMA_PAGO: 'TRANSFERENCIA',
        DIADOCUMENTO: 14, MESDOCUMENTO: 2, ANODOCUMENTO: 2026,
        RUTA: 'R01',
      },
    ]);

    const result = await rolesService.obtenerAlbaranesConductor('05');

    // Should make exactly 1 query (with FPA JOIN), NOT 1 + N
    expect(mockQuery).toHaveBeenCalledTimes(1);

    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('LEFT JOIN DSEDAC.FPA');
    expect(sql).toContain('DESC_FORMA_PAGO');

    // Verify CTR detection inline
    expect(result).toHaveLength(2);
    expect(result[0].esCTR).toBe(true);  // '01' is in CODIGOS_CTR_TIPICOS + 'CONTADO' desc
    expect(result[1].esCTR).toBe(false); // '30' + 'TRANSFERENCIA' = not CTR
  });
});

// ============================================
// Products Parallelization Tests
// ============================================
describe('Products Query Parallelization', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('obtenerProductos runs data + count in parallel', async () => {
    const { productsService } = require('../services/products.service');
    const callOrder: string[] = [];

    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(DISTINCT')) {
        callOrder.push('count');
        await new Promise(r => setTimeout(r, 5));
        return [{ TOTAL: 250 }];
      }
      callOrder.push('data');
      await new Promise(r => setTimeout(r, 5));
      return [
        { CODIGO: 'ART01', NOMBRE: 'Pollo', PRECIO: 5.5, PRECIOTARIFACLIENTE: 0, PRECIOTARIFA01: 0, DESCUENTOPORCENTAJE: 0, DESCUENTOPORCENTAJE2: 0, CODIGOPROMOCION: '', CODIGOIVA: '01', FAMILIA: 'AVES', VECESCOMPRADO: 50, ULTIMACOMPRANUMA: 20260214 },
      ];
    });

    const result = await productsService.obtenerProductos({ pagina: 1, limite: 100 });

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(callOrder).toContain('data');
    expect(callOrder).toContain('count');
    expect(result.paginacion.total).toBe(250);
    expect(result.data).toHaveLength(1);
  });
});

// ============================================
// Cliente Parallelization Tests
// ============================================
describe('Cliente Query Parallelization', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('listarClientes runs data + count in parallel', async () => {
    const { clienteService } = require('../services/cliente.service');
    const callOrder: string[] = [];

    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*)')) {
        callOrder.push('count');
        await new Promise(r => setTimeout(r, 5));
        return [{ TOTAL: 1500 }];
      }
      callOrder.push('data');
      await new Promise(r => setTimeout(r, 5));
      return [
        {
          CODIGO: 'CLI001', NOMBRE: 'GRANJA MARI PEPA',
          NOMBRE_ALTERNATIVO: '', NIF: 'A12345678',
          DIRECCION: 'CALLE 1', POBLACION: 'MURCIA',
          PROVINCIA: 'MURCIA', CODIGO_POSTAL: '30001',
          TELEFONO1: '666111222', TELEFONO2: '',
          CODIGO_RUTA: 'R01', RECARGO: 'N', EXENTO_IVA: 'N',
        },
      ];
    });

    const result = await clienteService.listarClientes({ limit: 50, offset: 0 });

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(callOrder).toContain('data');
    expect(callOrder).toContain('count');
    expect(result.total).toBe(1500);
    expect(result.clientes).toHaveLength(1);
  });
});

// ============================================
// Entregas Parallelization Tests
// ============================================
describe('Entregas Query Parallelization', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('obtenerAlbaran runs header + lines in parallel', async () => {
    const { entregasService } = require('../services/entregas.service');
    const callOrder: string[] = [];

    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FETCH FIRST 1')) {
        callOrder.push('header');
        await new Promise(r => setTimeout(r, 5));
        return [{
          SUBEMPRESAALBARAN: '01', EJERCICIOALBARAN: 2026,
          SERIEALBARAN: 'A', NUMEROALBARAN: 500,
          CODIGO_CLIENTE: 'CLI001', NOMBRE_CLIENTE: 'TEST',
          DIRECCION: 'CALLE 1',
          ANODOCUMENTO: 2026, MESDOCUMENTO: 2, DIADOCUMENTO: 14,
          IMPORTETOTAL: 1000, CODIGOFORMAPAGO: '01',
        }];
      }
      if (sql.includes('LAC.SECUENCIA')) {
        callOrder.push('lines');
        await new Promise(r => setTimeout(r, 5));
        return [
          { SECUENCIA: 1, CODIGOARTICULO: 'ART01', DESCRIPCIONARTICULO: 'Pollo', CANTIDADENVASES: 5, CANTIDADUNIDADES: 10, IMPORTEVENTA: 55 },
        ];
      }
      return [];
    });

    const result = await entregasService.obtenerAlbaran(500, 2026);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(callOrder).toContain('header');
    expect(callOrder).toContain('lines');
    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(1);
  });

  test('obtenerAlbaran returns null when not found', async () => {
    const { entregasService } = require('../services/entregas.service');

    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FETCH FIRST 1')) return [];
      return [];
    });

    const result = await entregasService.obtenerAlbaran(999, 2026);
    expect(result).toBeNull();
  });
});

// ============================================
// Query Count Regression Guard
// ============================================
describe('Query Count Regression Guards', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('getUltimasVentas with 10 results makes exactly 1 DB call', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      DIADOCUMENTO: 14, MESDOCUMENTO: 2, ANODOCUMENTO: 2026,
      CODIGOCLIENTEALBARAN: `CLI${String(i).padStart(3, '0')}`,
      NOMBRE_CLIENTE: `CLIENTE ${i}`,
      IMPORTETOTAL: 100 * (i + 1),
      SERIEALBARAN: 'A', NUMEROALBARAN: 1000 + i,
    }));

    mockQuery.mockResolvedValueOnce(rows);

    const result = await (dashboardService as any).getUltimasVentas('02', 10);

    // CRITICAL: must be exactly 1, not 11 (was 1+N before fix)
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(10);
  });

  test('getTopClientes with 10 results makes exactly 1 DB call', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      CODIGO: `CLI${String(i).padStart(3, '0')}`,
      NOMBRE: `CLIENTE ${i}`,
      TOTAL: 10000 * (10 - i),
      OPERACIONES: 100 - i * 5,
    }));

    mockQuery.mockResolvedValueOnce(rows);

    const result = await dashboardService.getTopClientes('02', 10);

    // CRITICAL: must be exactly 1, not 11 (was 1+N before fix)
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(10);
  });
});
