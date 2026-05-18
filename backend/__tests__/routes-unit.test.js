/**
 * Unit Tests - Routes
 * ==================
 * Tests for Express router exports
 * NOTE: Health/Dashboard/Clients require DB - tested separately
 */

'use strict';

jest.mock('../config/db', () => ({
    query: jest.fn().mockResolvedValue([]),
    queryWithParams: jest.fn().mockResolvedValue([])
}));

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

describe('Route Exports', () => {
    test('Auth Routes export router', () => {
        const authRoutes = require('../routes/auth');
        expect(authRoutes).toBeDefined();
    });

    test('Dashboard Routes export router', () => {
        const dashboardRoutes = require('../routes/dashboard');
        expect(dashboardRoutes).toBeDefined();
    });

    test('Clients Routes export router', () => {
        const clientsRoutes = require('../routes/clients');
        expect(clientsRoutes).toBeDefined();
    });

    test('Pedidos Routes export router', () => {
        const pedidosRoutes = require('../routes/pedidos');
        expect(pedidosRoutes).toBeDefined();
    });

    test('Master Routes export router', () => {
        const masterRoutes = require('../routes/master');
        expect(masterRoutes).toBeDefined();
    });

    test('Warehouse Routes export router', () => {
        const warehouseRoutes = require('../routes/warehouse');
        expect(warehouseRoutes).toBeDefined();
    });

    test('Warehouse Routes have circuit breaker', () => {
        const warehouseRoutes = require('../routes/warehouse');
        expect(warehouseRoutes.warehouseBreaker).toBeDefined();
    });

    test('Repartidor Routes export router', () => {
        const repartidorRoutes = require('../routes/repartidor');
        expect(repartidorRoutes).toBeDefined();
    });

    test('Repartidor Routes have circuit breaker', () => {
        const repartidorRoutes = require('../routes/repartidor');
        expect(repartidorRoutes.repartidorBreaker).toBeDefined();
    });
});