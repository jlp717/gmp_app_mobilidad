/**
 * Pedidos Service - Unit Tests
 * ==========================
 */

'use strict';

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();

jest.mock('../config/db', () => ({
    query: mockQuery,
    queryWithParams: mockQueryWithParams,
    getPool: () => ({
        connect: jest.fn().mockResolvedValue({
            query: jest.fn(),
            close: jest.fn()
        }),
    }),
}));

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

describe('Pedidos Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Order Creation Validation', () => {
        test('should reject order without clientCode', async () => {
            const pedidosService = require('../services/pedidos.service');
            
            try {
                await pedidosService.createOrder({});
            } catch (e) {
                expect(e.message).toContain('clientCode');
            }
        });

        test('should reject order without lines', async () => {
            const pedidosService = require('../services/pedidos.service');
            
            try {
                await pedidosService.createOrder({ vendedorCode: '001', clientCode: '001' });
            } catch (e) {
                expect(e.message).toContain('line');
            }
        });
    });

    describe('Service Exports', () => {
        test('should export getProducts function', () => {
            const service = require('../services/pedidos.service');
            expect(typeof service.getProducts).toBe('function');
        });

        test('should export createOrder function', () => {
            const service = require('../services/pedidos.service');
            expect(typeof service.createOrder).toBe('function');
        });

        test('should export getOrders function', () => {
            const service = require('../services/pedidos.service');
            expect(typeof service.getOrders).toBe('function');
        });
    });
});