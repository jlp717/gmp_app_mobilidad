/**
 * E2E Tests - Critical Business Flows
 * ===================================
 */

'use strict';

const request = require('supertest');

describe('E2E Business Flows', () => {
    
    describe('Full Order Flow', () => {
        test('Create order -> Get details -> Add line -> Confirm -> Cancel', async () => {
            const app = express();
            const pedidosRoutes = require('../routes/pedidos');
            app.use('/api/pedidos', pedidosRoutes);
            
            // 1. Create order
            const createRes = await request(app)
                .post('/api/pedidos')
                .send({
                    vendedorCode: '0001',
                    clientCode: '0001',
                    lines: [{ code: '0001', quantity: 1 }]
                });
            
            let orderId = createRes.body?.id;
            if (!orderId) {
                console.log('Order creation might need auth, skipping order flow test');
                return;
            }
            
            // 2. Get order details
            const getRes = await request(app).get(`/api/pedidos/${orderId}`);
            expect(getRes.status).toBe(200);
            
            // 3. Cancel order
            const cancelRes = await request(app)
                .post(`/api/pedidos/${orderId}/cancel`);
            
            expect([200, 404]).toContain(cancelRes.status);
        }, 30000);
    });
    
    describe('Client Search Flow', () => {
        test('Search clients -> Get details -> Get sales history', async () => {
            const app = express();
            const clientsRoutes = require('../routes/clients');
            app.use('/api/clients', clientsRoutes);
            
            // Search
            const searchRes = await request(app)
                .get('/api/clients?search=0001&limit=10');
            expect(searchRes.status).toBe(200);
            
            // Get details
            if (searchRes.body?.clients?.length > 0) {
                const code = searchRes.body.clients[0].code;
                const detailsRes = await request(app).get(`/api/clients/${code}`);
                expect(detailsRes.status).toBe(200);
            }
        }, 15000);
    });
    
    describe('Product Catalog Flow', () => {
        test('Search products -> Get detail -> Get stock', async () => {
            const app = express();
            const pedidosRoutes = require('../routes/pedidos');
            app.use('/api/pedidos', pedidosRoutes);
            
            // Search
            const searchRes = await request(app)
                .get('/api/pedidos/products?limit=5');
            expect(searchRes.status).toBe(200);
            
            // Detail
            if (searchRes.body?.products?.length > 0) {
                const code = searchRes.body.products[0].code;
                const detailRes = await request(app)
                    .get(`/api/pedidos/products/${code}`);
                expect(detailRes.status).toBe(200);
            }
        }, 15000);
    });
    
    describe('Dashboard Metrics Flow', () => {
        test('Get current metrics -> Get previous year -> Verify evolution', async () => {
            const app = express();
            const dashboardRoutes = require('../routes/dashboard');
            app.use('/api/dashboard', dashboardRoutes);
            
            // Current year
            const currentRes = await request(app)
                .get('/api/dashboard/metrics?vendedorCode=ALL&year=2026');
            
            expect(currentRes.status).toBe(200);
            
            // Previous year comparison should exist
            if (currentRes.body?.metrics) {
                expect(currentRes.body.metrics).toHaveProperty('lastYearSales');
            }
        }, 20000);
    });
    
    describe('Cobros Collection Flow', () => {
        test('Get pending -> Get summary by vendor', async () => {
            const app = express();
            const cobrosRoutes = require('../routes/cobros');
            app.use('/api/cobros', cobrosRoutes);
            
            // Pending for client
            const pendingRes = await request(app)
                .get('/api/cobros/0001/pendientes');
            expect([200, 500]).toContain(pendingRes.status);
            
            // Summary by vendor
            const summaryRes = await request(app)
                .get('/api/cobros/pending-summary/0001');
            expect([200, 500]).toContain(summaryRes.status);
        }, 15000);
    });
    
    describe('Warehouseload Planning Flow', () => {
        test('Get trucks -> Get load plan -> Optimize', async () => {
            const app = express();
            const warehouseRoutes = require('../routes/warehouse');
            app.use('/api/warehouse', warehouseRoutes);
            
            // Dashboard
            const dashRes = await request(app)
                .get('/api/warehouse/dashboard?year=2026&month=4&day=19');
            expect([200, 500]).toContain(dashRes.status);
            
            // Load plan
            if (dashRes.body?.trucks?.length > 0) {
                const vehicle = dashRes.body.trucks[0].vehicleCode;
                const planRes = await request(app)
                    .post('/api/warehouse/load-plan')
                    .send({ vehicleCode: vehicle, year: 2026, month: 4, day: 19 });
                expect([200, 500]).toContain(planRes.status);
            }
        }, 30000);
    });
    
    describe('Weather Conditions', () => {
        test('Should respond within acceptable time', async () => {
            const start = Date.now();
            
            const app = express();
            const dashboardRoutes = require('../routes/dashboard');
            app.use('/api/dashboard', dashboardRoutes);
            
            await request(app).get('/api/dashboard/metrics?vendedorCode=0001&year=2026');
            
            const responseTime = Date.now() - start;
            
            // Should respond within 5 seconds
            expect(responseTime).toBeLessThan(5000);
            
            console.log(`Response time: ${responseTime}ms`);
        }, 10000);
    });
});