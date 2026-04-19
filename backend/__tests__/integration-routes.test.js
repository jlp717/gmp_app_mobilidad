/**
 * Integration Tests - Critical API Endpoints
 * ============================================
 * Tests for authentication, dashboard, clients, and orders
 */

'use strict';

jest.mock('../config/db', () => ({
    query: jest.fn(),
    queryWithParams: jest.fn(),
    getPool: jest.fn()
}));

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

const request = require('supertest');
const express = require('express');

describe('API Integration Tests', () => {
    
    describe('Authentication Endpoints', () => {
        test('POST /api/auth/login should return token', async () => {
            const app = express();
            app.use(express.json());
            
            const authRoutes = require('../routes/auth');
            app.use('/api/auth', authRoutes);
            
            const res = await request(app)
                .post('/api/auth/login')
                .send({ username: 'DIEGO', password: '9173' });
            
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('token');
        }, 10000);
        
        test('POST /api/auth/login with invalid credentials should return 401', async () => {
            const app = express();
            app.use(express.json());
            
            const authRoutes = require('../routes/auth');
            app.use('/api/auth', authRoutes);
            
            const res = await request(app)
                .post('/api/auth/login')
                .send({ username: 'INVALID', password: 'WRONG' });
            
            expect(res.status).toBe(401);
        }, 10000);
    });
    
    describe('Dashboard Endpoints', () => {
        test('GET /api/dashboard/metrics should return metrics data', async () => {
            const app = express();
            
            const dashboardRoutes = require('../routes/dashboard');
            app.use('/api/dashboard', dashboardRoutes);
            
            const res = await request(app)
                .get('/api/dashboard/metrics?vendedorCode=ALL&year=2026');
            
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('success');
        }, 15000);
    });
    
    describe('Clients Endpoints', () => {
        test('GET /api/clients should return client list', async () => {
            const app = express();
            
            const clientsRoutes = require('../routes/clients');
            app.use('/api/clients', clientsRoutes);
            
            const res = await request(app)
                .get('/api/clients?limit=10');
            
            expect(res.status).toBe(200);
        }, 15000);
        
        test('GET /api/clients/:code should return client details', async () => {
            const app = express();
            
            const clientsRoutes = require('../routes/clients');
            app.use('/api/clients', clientsRoutes);
            
            const res = await request(app)
                .get('/api/clients/0001');
            
            expect(res.status).toBe(200);
        }, 15000);
    });
    
    describe('Orders Endpoints', () => {
        test('GET /api/pedidos/products should return products', async () => {
            const app = express();
            
            const pedidosRoutes = require('../routes/pedidos');
            app.use('/api/pedidos', pedidosRoutes);
            
            const res = await request(app)
                .get('/api/pedidos/products?limit=10');
            
            expect(res.status).toBe(200);
        }, 15000);
    });
    
    describe('Rate Limiting', () => {
        test('should return 429 after exceeding rate limit', async () => {
            const app = express();
            const { globalLimiter } = require('../middleware/security');
            
            app.use(globalLimiter);
            app.get('/api/test', (req, res) => res.json({ ok: true }));
            
            const requests = Array(35).fill(null).map(() => 
                request(app).get('/api/test')
            );
            
            const responses = await Promise.all(requests);
            const has429 = responses.some(r => r.status === 429);
            
            expect(has429).toBe(true);
        }, 30000);
    });
    
    describe('Circuit Breaker', () => {
        test('should fallback when service fails', async () => {
            const { CircuitBreaker } = require('../services/circuit-breaker');
            
            const breaker = new CircuitBreaker({
                name: 'test',
                failureThreshold: 2,
                timeout: 1000
            });
            
            let fails = 0;
            for (let i = 0; i < 3; i++) {
                await breaker.execute(
                    () => { throw new Error('Service down'); },
                    () => 'fallback'
                );
            }
            
            const fallbackResult = await breaker.execute(
                () => { throw new Error('Still down'); },
                () => 'fallback'
            );
            
            expect(fallbackResult).toBe('fallback');
        }, 10000);
    });
});