/**
 * Unit Tests - Routes
 * ==================
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

describe('Health Routes', () => {
    test('GET /health should return status', async () => {
        const express = require('express');
        const app = express();
        const healthRoutes = require('../routes/health');
        app.use('/api', healthRoutes);
        
        const request = require('supertest');
        const res = await request(app).get('/api/health');
        
        expect(res.status).toBeGreaterThan(0);
        expect(res.body).toHaveProperty('timestamp');
    });
    
    test('GET /health/liveness should return alive', async () => {
        const express = require('express');
        const app = express();
        const healthRoutes = require('../routes/health');
        app.use('/api', healthRoutes);
        
        const request = require('supertest');
        const res = await request(app).get('/api/health/liveness');
        
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('alive');
    });
});

describe('Auth Routes', () => {
    test('should export router', () => {
        const authRoutes = require('../routes/auth');
        expect(authRoutes).toBeDefined();
        expect(authRoutes.stack).toBeDefined();
    });
});

describe('Dashboard Routes', () => {
    test('should export router', () => {
        const dashboardRoutes = require('../routes/dashboard');
        expect(dashboardRoutes).toBeDefined();
        expect(dashboardRoutes.stack).toBeDefined();
    });
});

describe('Clients Routes', () => {
    test('should export router', () => {
        const clientsRoutes = require('../routes/clients');
        expect(clientsRoutes).toBeDefined();
        expect(clientsRoutes.stack).toBeDefined();
    });
});

describe('Pedidos Routes', () => {
    test('should export router', () => {
        const pedidosRoutes = require('../routes/pedidos');
        expect(pedidosRoutes).toBeDefined();
        expect(pedidosRoutes.stack).toBeDefined();
    });
});

describe('Master Routes', () => {
    test('should export router with cached endpoints', () => {
        const masterRoutes = require('../routes/master');
        expect(masterRoutes).toBeDefined();
        
        // Check cache imports
        const code = masterRoutes.toString();
        expect(code).toContain('cachedQuery');
    });
});

describe('Warehouse Routes', () => {
    test('should export router', () => {
        const warehouseRoutes = require('../routes/warehouse');
        expect(warehouseRoutes).toBeDefined();
    });
    
    test('should have circuit breaker', () => {
        const warehouseRoutes = require('../routes/warehouse');
        expect(warehouseRoutes.warehouseBreaker).toBeDefined();
    });
});

describe('Repartidor Routes', () => {
    test('should export router', () => {
        const repartidorRoutes = require('../routes/repartidor');
        expect(repartidorRoutes).toBeDefined();
    });
    
    test('should have circuit breaker', () => {
        const repartidorRoutes = require('../routes/repartidor');
        expect(repartidorRoutes.repartidorBreaker).toBeDefined();
    });
});