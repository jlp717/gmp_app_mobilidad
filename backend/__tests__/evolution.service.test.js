/**
 * Unit Tests - Evolution Service
 * ===============================
 */
'use strict';

function expectDb2SafeBind(sql, bind, maxLen) {
  const text = bind == null ? '' : String(bind);
  const normalized = text.length <= maxLen;
  const casted = new RegExp(`CAST\\(\\?\\s+AS\\s+VARCHAR\\(${maxLen}\\)\\)`, 'i').test(String(sql || ''));
  expect(normalized || casted).toBe(true);
}

jest.mock('../config/db', () => ({
    queryWithParams: jest.fn()
}));

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../services/query-optimizer', () => ({
    cachedQuery: jest.fn((fn, sql, key, ttl) => fn(sql))
}));

jest.mock('../services/redis-cache', () => ({
    TTL: { MEDIUM: 300, SHORT: 60 }
}));

describe('Evolution Service', () => {
    let evolutionService;
    let mockQuery;

    beforeEach(() => {
        jest.resetModules();
        mockQuery = require('../config/db').queryWithParams;
        evolutionService = require('../services/evolution.service');
    });

    describe('getSalesEvolution', () => {
        test('should return monthly sales for single vendor', async () => {
            const now = new Date();
            const currentYear = now.getFullYear();
            mockQuery.mockResolvedValueOnce([
                { ANO: currentYear, MES: 1, NUM_CLIENTES: 5, NUM_LINEAS: 10,
                  TOTAL_VENTAS: 10000, TOTAL_COSTO: 7000, TOTAL_MARGEN: 3000 },
                { ANO: currentYear, MES: 2, NUM_CLIENTES: 3, NUM_LINEAS: 8,
                  TOTAL_VENTAS: 8000, TOTAL_COSTO: 5600, TOTAL_MARGEN: 2400 },
            ]);

            const result = await evolutionService.getSalesEvolution({
                vendedorCodes: '10',
                months: 6
            });

            expect(result.monthly).toHaveLength(2);
            expect(result.summary.ytdVentas).toBeGreaterThan(0);
            expect(result.monthly[0].totalVentas).toBe(10000);
            expect(result.monthly[0].margenPct).toBe(30);
        });

        test('should handle ALL vendors', async () => {
            const now = new Date();
            mockQuery.mockResolvedValueOnce([
                { ANO: now.getFullYear(), MES: 1, NUM_CLIENTES: 10, NUM_LINEAS: 20,
                  TOTAL_VENTAS: 50000, TOTAL_COSTO: 35000, TOTAL_MARGEN: 15000 }
            ]);

            const result = await evolutionService.getSalesEvolution({
                vendedorCodes: 'ALL',
                months: 12
            });

            expect(result.monthly).toHaveLength(1);
        });

        test('should handle multiple vendors', async () => {
            mockQuery.mockResolvedValueOnce([
                { ANO: 2026, MES: 1, NUM_CLIENTES: 8, NUM_LINEAS: 15,
                  TOTAL_VENTAS: 20000, TOTAL_COSTO: 14000, TOTAL_MARGEN: 6000 }
            ]);

            const result = await evolutionService.getSalesEvolution({
                vendedorCodes: '10,15',
                months: 3
            });

            expect(result.monthly).toHaveLength(1);
        });

        test('should filter by clientCode when provided', async () => {
            mockQuery.mockResolvedValueOnce([]);

            const result = await evolutionService.getSalesEvolution({
                vendedorCodes: '10',
                clientCode: 'CLI001',
                months: 12
            });

            expect(result.monthly).toEqual([]);
            expect(result.summary.ytdVentas).toBe(0);
        });

        test('should truncate long clientCode before DB bind', async () => {
            const longClient = '4300001091_OVERFLOW_EXTRA_CHARS';
            let capturedSql = '';

            mockQuery.mockImplementationOnce(async (sql) => {
                capturedSql = sql;
                return [];
            });

            await evolutionService.getSalesEvolution({
                vendedorCodes: '10',
                clientCode: longClient,
                months: 6,
            });

            const [, params] = mockQuery.mock.calls[0];
            const clientBind = params.find((p) => p === '4300001091' || p === longClient);
            expect(clientBind).toBe('4300001091');
            expectDb2SafeBind(capturedSql, clientBind, 10);
        });

        test('should truncate long vendor codes before DB bind', async () => {
            const longVendor = '01,9999,EXTRA';
            let capturedSql = '';

            mockQuery.mockImplementationOnce(async (sql) => {
                capturedSql = sql;
                return [];
            });

            await evolutionService.getSalesEvolution({
                vendedorCodes: longVendor,
                months: 6,
            });

            const [, params] = mockQuery.mock.calls[0];
            // [startYear, startYear, startMonth, ...vendorCodes]
            const vendorBinds = params.slice(3);
            expect(vendorBinds.length).toBeGreaterThan(0);
            vendorBinds.forEach((p) => expectDb2SafeBind(capturedSql, p, 2));
            expect(vendorBinds).not.toContain('9999');
            expect(vendorBinds).not.toContain('EXTRA');
        });
    });

    describe('getProductEvolution', () => {
        test('should return top products with growth data', async () => {
            mockQuery.mockResolvedValueOnce([
                { CODE: 'ART01', NAME: 'Producto 1', FAMILY: 'LACTEOS',
                  VENTAS_ACTUAL: 10000, VENTAS_ANTERIOR: 8000, VENTAS_TOTAL: 18000 },
                { CODE: 'ART02', NAME: 'Producto 2', FAMILY: 'FRUTAS',
                  VENTAS_ACTUAL: 5000, VENTAS_ANTERIOR: 6000, VENTAS_TOTAL: 11000 },
            ]);

            const result = await evolutionService.getProductEvolution({
                vendedorCodes: '10',
                limit: 10
            });

            expect(result).toHaveLength(2);
            expect(result[0].yoyChange).toBeGreaterThan(0); // Up 25%
            expect(result[1].yoyChange).toBeLessThan(0);    // Down ~16.7%
            expect(result[0].trend).toBe('UP');
            expect(result[1].trend).toBe('DOWN');
        });
    });

    describe('getClientEvolution', () => {
        test('should return client evolution data', async () => {
            mockQuery.mockResolvedValueOnce([
                { CODIGO_CLIENTE: 'CLI001', NOMBRE: 'Cliente 1',
                  VENTAS_ACTUAL: 15000, VENTAS_ANTERIOR: 12000, PRODUCTOS_ACTUAL: 5 },
                { CODIGO_CLIENTE: 'CLI002', NOMBRE: 'Cliente 2',
                  VENTAS_ACTUAL: 8000, VENTAS_ANTERIOR: 10000, PRODUCTOS_ACTUAL: 3 },
            ]);

            const result = await evolutionService.getClientEvolution({
                vendedorCodes: 'ALL',
                limit: 30
            });

            expect(result).toHaveLength(2);
            expect(result[0].trend).toBe('UP');
            expect(result[1].trend).toBe('DOWN');
            expect(result[0].nombre).toBe('Cliente 1');
        });
    });
});
