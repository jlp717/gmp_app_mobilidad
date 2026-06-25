'use strict';

const mockQueryWithParams = jest.fn();

jest.mock('../config/db', () => ({
    query: jest.fn(),
    queryWithParams: (...args) => mockQueryWithParams(...args),
    getPool: jest.fn(() => null),
    initDb: jest.fn(),
}));

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

jest.mock('../services/query-optimizer', () => ({
    cachedQuery: async (queryFn, sql) => queryFn(sql),
    invalidateOnMutation: jest.fn(),
}));

jest.mock('../services/redis-cache', () => ({
    redisCache: { get: jest.fn(), set: jest.fn() },
    TTL: { SHORT: 60 },
}));

const { Db2WarehouseRepository } = require('../src/modules/warehouse/infrastructure/db2-warehouse-repository');
const { GetLowStockUseCase } = require('../src/modules/warehouse/application/get-low-stock-usecase');
const { Db2DashboardRepository } = require('../src/modules/dashboard/infrastructure/db2-dashboard-repository');

describe('perf low-risk contracts', () => {
    describe('Db2WarehouseRepository.getLowStock', () => {
        let repo;
        let mockDb;

        beforeEach(() => {
            mockDb = { executeParams: jest.fn().mockResolvedValue([]) };
            repo = new Db2WarehouseRepository(mockDb);
        });

        test('passes clamped limit/offset and deterministic ORDER BY + OFFSET/FETCH', async () => {
            await repo.getLowStock(8, 9999, -5);

            expect(mockDb.executeParams).toHaveBeenCalledTimes(1);
            const [sql, params] = mockDb.executeParams.mock.calls[0];
            expect(sql).toMatch(/OFFSET \? ROWS FETCH FIRST \? ROWS ONLY/);
            expect(sql).toMatch(/ORDER BY STOCK ASC, ART\.DESCRIPCIONARTICULO ASC, ARO\.CODIGOARTICULO ASC, ARO\.CODIGOALMACEN ASC/);
            expect(params).toEqual([8, 0, 500]);
        });
    });

    describe('GetLowStockUseCase', () => {
        test('forwards threshold, limit and offset to repository', async () => {
            const repository = { getLowStock: jest.fn().mockResolvedValue([]) };
            const useCase = new GetLowStockUseCase(repository);

            await useCase.execute({ threshold: 3, limit: 25, offset: 10 });

            expect(repository.getLowStock).toHaveBeenCalledWith(3, 25, 10);
        });
    });

    describe('pedidos.service getOrders', () => {
        beforeEach(() => {
            jest.resetModules();
            mockQueryWithParams.mockReset();
            mockQueryWithParams.mockResolvedValue([]);
        });

        test('clamps limit 9999 to 500 and negative offset to 0 in SQL', async () => {
            const pedidosService = require('../services/pedidos.service');
            await pedidosService.getOrders({
                vendedorCodes: '93',
                year: 2026,
                limit: 9999,
                offset: -10,
            });

            expect(mockQueryWithParams).toHaveBeenCalledTimes(1);
            const [sql] = mockQueryWithParams.mock.calls[0];
            expect(sql).toMatch(/OFFSET 0 ROWS FETCH FIRST 500 ROWS ONLY/);
        });
    });

    describe('pedidos.service getOrderStats', () => {
        beforeEach(() => {
            jest.resetModules();
            mockQueryWithParams.mockReset();
            mockQueryWithParams.mockResolvedValue([]);
        });

        test('defaults to current year when no date bounds', async () => {
            const pedidosService = require('../services/pedidos.service');
            const currentYear = new Date().getFullYear();

            await pedidosService.getOrderStats('93');

            expect(mockQueryWithParams).toHaveBeenCalled();
            const statsCall = mockQueryWithParams.mock.calls.find(([sql]) => sql.includes('TOTALORDERS'));
            expect(statsCall).toBeDefined();
            const [statsSql, statsParams] = statsCall;
            expect(statsSql).toMatch(/ANODOCUMENTO = \?/);
            expect(statsParams).toContain(currentYear);

            const statusCall = mockQueryWithParams.mock.calls.find(([sql]) => sql.includes('GROUP BY ESTADO'));
            expect(statusCall[0]).toMatch(/ORDER BY ESTADO/);
        });
    });

    describe('pedidos.service createOrder line insert concurrency contract', () => {
        test('source uses mapWithConcurrency instead of sequential await per line', () => {
            const fs = require('fs');
            const path = require('path');
            const source = fs.readFileSync(path.join(__dirname, '../services/pedidos.service.js'), 'utf8');
            const start = source.indexOf('async function createOrder');
            const end = source.indexOf('async function getOrders', start);
            expect(start).toBeGreaterThanOrEqual(0);
            expect(end).toBeGreaterThan(start);
            const block = source.slice(start, end);
            expect(block).toMatch(/mapWithConcurrency\(lineContexts,\s*CREATE_ORDER_LINE_CONCURRENCY/i);
            expect(block).not.toMatch(/for \(let i = 0; i < lines\.length; i\+\+\)[\s\S]*await queryWithParams\(lineInsert\.sql/);
        });

        test('micro-benchmark: parallel mock inserts finish faster than sequential baseline', async () => {
            const lineCount = 12;
            const delayMs = 15;
            const concurrency = 4;

            async function runSequential() {
                const start = Date.now();
                for (let i = 0; i < lineCount; i += 1) {
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                }
                return Date.now() - start;
            }

            async function mapWithConcurrency(items, limit, mapper) {
                const results = new Array(items.length);
                let next = 0;
                const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
                    while (next < items.length) {
                        const index = next++;
                        results[index] = await mapper(items[index], index);
                    }
                });
                await Promise.all(workers);
                return results;
            }

            async function runParallel() {
                const start = Date.now();
                await mapWithConcurrency(Array.from({ length: lineCount }), concurrency, async () => {
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                });
                return Date.now() - start;
            }

            const sequentialMs = await runSequential();
            const parallelMs = await runParallel();
            expect(sequentialMs).toBeGreaterThanOrEqual(lineCount * delayMs - 25);
            expect(parallelMs).toBeLessThan(sequentialMs);
            expect(parallelMs).toBeLessThan(lineCount * delayMs);
        });
    });

    describe('Db2DashboardRepository', () => {
        let repo;
        let mockDb;

        beforeEach(() => {
            mockDb = { executeParams: jest.fn().mockResolvedValue([]) };
            repo = new Db2DashboardRepository(mockDb);
        });

        test('getMetrics uses LCAADC for year filter not LCMMDC', async () => {
            await repo.getMetrics('93', 2026, null);

            const [sql] = mockDb.executeParams.mock.calls[0];
            expect(sql).toMatch(/AND L\.LCAADC = \?/);
            expect(sql).not.toMatch(/year.*LCMMDC/i);
            expect(sql).not.toMatch(/AND LCMMDC = \?.*year/i);
        });

        test('getTopClients clamps limit to 100', async () => {
            await repo.getTopClients('93', 2026, null, 500);

            const [, params] = mockDb.executeParams.mock.calls[0];
            expect(params[params.length - 1]).toBe(100);
        });

        test('getSalesEvolution clamps months to 36', async () => {
            await repo.getSalesEvolution('93', 2026, 99);

            const [sql] = mockDb.executeParams.mock.calls[0];
            expect(sql).toMatch(/FETCH FIRST 36 ROWS ONLY/);
        });
    });
});
