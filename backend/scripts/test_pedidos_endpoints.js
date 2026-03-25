#!/usr/bin/env node
/**
 * PEDIDOS ENDPOINTS TEST SCRIPT
 * ==============================
 * Tests all /api/pedidos/* endpoints end-to-end.
 * Usage: node backend/scripts/test_pedidos_endpoints.js
 *
 * Credentials: DIEGO / 9322
 */

const http = require('http');
const https = require('https');

const BASE = process.env.API_URL || 'http://localhost:3197';
const USER = 'DIEGO';
const PASS = '9322';

let TOKEN = '';
let VENDOR_CODE = '';
let TEST_ORDER_ID = null;
let TEST_LINE_ID = null;
let FIRST_PRODUCT_CODE = '';
let FIRST_CLIENT_CODE = '';

const results = [];
let passed = 0;
let failed = 0;

// ─── HTTP helper ────────────────────────────────────────────────
function request(method, path, body = null, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;

        const headers = {
            'Content-Type': 'application/json',
            ...extraHeaders,
        };
        if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;

        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method,
            headers,
            timeout: 15000,
        };

        const req = lib.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function log(testName, ok, detail = '') {
    const icon = ok ? '✅' : '❌';
    console.log(`  ${icon} ${testName}${detail ? ' — ' + detail : ''}`);
    results.push({ test: testName, ok, detail });
    if (ok) passed++; else failed++;
}

// ─── TESTS ──────────────────────────────────────────────────────

async function testLogin() {
    console.log('\n🔐 AUTH');
    try {
        const res = await request('POST', '/api/auth/login', { username: USER, password: PASS });
        const ok = res.status === 200 && res.body.token;
        TOKEN = res.body.token || '';
        VENDOR_CODE = res.body.user?.vendedorCode || res.body.user?.employeeCode || '';
        log('POST /api/auth/login', ok, ok ? `token=${TOKEN.substring(0, 20)}... vendor=${VENDOR_CODE}` : `status=${res.status}`);
    } catch (e) {
        log('POST /api/auth/login', false, e.message);
    }
}

async function testProducts() {
    console.log('\n📦 PRODUCTS');
    try {
        const res = await request('GET', `/api/pedidos/products?vendedorCodes=${VENDOR_CODE}&limit=5`);
        const ok = res.status === 200 && res.body.success && Array.isArray(res.body.products);
        const count = res.body.products?.length || 0;
        if (ok && count > 0) {
            FIRST_PRODUCT_CODE = res.body.products[0].code;
            // Verify field mapping
            const p = res.body.products[0];
            const hasFields = p.code && p.name !== undefined && p.stockEnvases !== undefined && p.precioTarifa1 !== undefined;
            log('GET /products', hasFields, `${count} products, first=${FIRST_PRODUCT_CODE}, price=${p.precioTarifa1}, stock=${p.stockEnvases}c/${p.stockUnidades}u`);
        } else {
            log('GET /products', ok, `${count} products returned`);
        }
    } catch (e) {
        log('GET /products', false, e.message);
    }

    // Search
    try {
        const res = await request('GET', `/api/pedidos/products?vendedorCodes=${VENDOR_CODE}&search=pollo&limit=5`);
        const ok = res.status === 200 && res.body.success;
        log('GET /products?search=pollo', ok, `${res.body.products?.length || 0} results`);
    } catch (e) {
        log('GET /products?search=pollo', false, e.message);
    }
}

async function testProductDetail() {
    if (!FIRST_PRODUCT_CODE) { log('GET /products/:code', false, 'No product code'); return; }
    console.log('\n🔍 PRODUCT DETAIL');
    try {
        const res = await request('GET', `/api/pedidos/products/${FIRST_PRODUCT_CODE}`);
        const ok = res.status === 200 && res.body.success && res.body.product;
        const p = res.body.product || {};
        log('GET /products/:code', ok, `name=${p.name}, tariffs=${p.tariffs?.length || 0}, stock=${p.stock?.length || 0}`);
    } catch (e) {
        log('GET /products/:code', false, e.message);
    }
}

async function testProductStock() {
    if (!FIRST_PRODUCT_CODE) { log('GET /products/:code/stock', false, 'No product code'); return; }
    try {
        const res = await request('GET', `/api/pedidos/products/${FIRST_PRODUCT_CODE}/stock`);
        const ok = res.status === 200 && res.body.success;
        log('GET /products/:code/stock', ok, `envases=${res.body.stock?.envases}, unidades=${res.body.stock?.unidades}`);
    } catch (e) {
        log('GET /products/:code/stock', false, e.message);
    }
}

async function testFilters() {
    console.log('\n🏷️  FILTERS');
    try {
        const [fam, brands] = await Promise.all([
            request('GET', '/api/pedidos/families'),
            request('GET', '/api/pedidos/brands'),
        ]);
        log('GET /families', fam.status === 200 && fam.body.success, `${fam.body.families?.length || 0} families`);
        log('GET /brands', brands.status === 200 && brands.body.success, `${brands.body.brands?.length || 0} brands`);
    } catch (e) {
        log('GET /families + /brands', false, e.message);
    }
}

async function testPromotions() {
    console.log('\n🎁 PROMOTIONS');
    try {
        const res = await request('GET', '/api/pedidos/promotions');
        const ok = res.status === 200 && res.body.success;
        log('GET /promotions', ok, `${res.body.promotions?.length || 0} promotions`);
    } catch (e) {
        log('GET /promotions', false, e.message);
    }
}

async function testClientPrices() {
    console.log('\n💰 CLIENT PRICES');
    // Use a known client code — get one from recommendations or orders
    const testClient = FIRST_CLIENT_CODE || '0001';
    try {
        const res = await request('GET', `/api/pedidos/client-prices/${testClient}`);
        // Even 200 with null pricing is acceptable
        log('GET /client-prices/:code', res.status === 200 && res.body.success, JSON.stringify(res.body.pricing || 'null').substring(0, 80));
    } catch (e) {
        log('GET /client-prices/:code', false, e.message);
    }
}

async function testClientBalance() {
    const testClient = FIRST_CLIENT_CODE || '0001';
    try {
        const res = await request('GET', `/api/pedidos/client-balance/${testClient}`);
        log('GET /client-balance/:code', res.status === 200 && res.body.success, JSON.stringify(res.body.balance || {}).substring(0, 80));
    } catch (e) {
        log('GET /client-balance/:code', false, e.message);
    }
}

async function testRecommendations() {
    console.log('\n🤖 RECOMMENDATIONS');
    const testClient = FIRST_CLIENT_CODE || '0001';
    try {
        const res = await request('GET', `/api/pedidos/recommendations/${testClient}?vendedorCode=${VENDOR_CODE}`);
        const ok = res.status === 200 && res.body.success;
        log('GET /recommendations/:client', ok, `history=${res.body.clientHistory?.length || 0}, similar=${res.body.similarClients?.length || 0}`);
    } catch (e) {
        log('GET /recommendations/:client', false, e.message);
    }
}

async function testAnalytics() {
    console.log('\n📊 ANALYTICS');
    try {
        const res = await request('GET', `/api/pedidos/analytics?vendedorCodes=${VENDOR_CODE}`);
        log('GET /analytics', res.status === 200 && res.body.success, JSON.stringify(res.body.analytics || {}).substring(0, 100));
    } catch (e) {
        log('GET /analytics', false, e.message);
    }
}

async function testComplementary() {
    if (!FIRST_PRODUCT_CODE) return;
    console.log('\n🔗 COMPLEMENTARY');
    try {
        const res = await request('POST', '/api/pedidos/complementary', { productCodes: [FIRST_PRODUCT_CODE] });
        log('POST /complementary', res.status === 200 && res.body.success, `${res.body.products?.length || 0} complementary products`);
    } catch (e) {
        log('POST /complementary', false, e.message);
    }
}

async function testOrderCRUD() {
    console.log('\n📝 ORDER CRUD');

    // List orders
    try {
        const res = await request('GET', `/api/pedidos?vendedorCodes=${VENDOR_CODE}`);
        const ok = res.status === 200 && res.body.success && Array.isArray(res.body.orders);
        log('GET / (list orders)', ok, `${res.body.orders?.length || 0} orders`);
        // Try to grab a client code from existing orders
        if (res.body.orders?.length > 0 && !FIRST_CLIENT_CODE) {
            FIRST_CLIENT_CODE = res.body.orders[0].clienteId;
        }
    } catch (e) {
        log('GET / (list orders)', false, e.message);
    }

    if (!FIRST_PRODUCT_CODE) { log('POST /create', false, 'No product to use'); return; }

    // Create test order
    const clientCode = FIRST_CLIENT_CODE || '000100';
    try {
        const res = await request('POST', '/api/pedidos/create', {
            clientCode,
            clientName: 'TEST_PEDIDOS_SCRIPT',
            vendedorCode: VENDOR_CODE,
            tipoventa: 'CC',
            observaciones: 'TEST - borrar',
            lines: [{
                codigoArticulo: FIRST_PRODUCT_CODE,
                descripcion: 'Test product',
                cantidadEnvases: 1,
                cantidad: 1,
                unidadMedida: 'CAJAS',
                unidadesCaja: 1,
                precio: 1.00,
                precioCosto: 0.50,
                precioTarifa: 1.00,
            }]
        });
        const ok = res.status === 200 && res.body.success && res.body.order;
        TEST_ORDER_ID = res.body.order?.header?.id;
        log('POST /create', ok, `orderId=${TEST_ORDER_ID}, total=${res.body.order?.header?.total}`);
    } catch (e) {
        log('POST /create', false, e.message);
    }

    if (!TEST_ORDER_ID) return;

    // Get order detail
    try {
        const res = await request('GET', `/api/pedidos/${TEST_ORDER_ID}`);
        const ok = res.status === 200 && res.body.success;
        const lines = res.body.order?.lines?.length || 0;
        if (lines > 0) TEST_LINE_ID = res.body.order.lines[0].id;
        log('GET /:id (order detail)', ok, `lines=${lines}`);
    } catch (e) {
        log('GET /:id (order detail)', false, e.message);
    }

    // Add a line
    try {
        const res = await request('PUT', `/api/pedidos/${TEST_ORDER_ID}/lines`, {
            lines: [{
                codigoArticulo: FIRST_PRODUCT_CODE,
                descripcion: 'Test line 2',
                cantidadEnvases: 2,
                cantidad: 2,
                unidadMedida: 'CAJAS',
                precio: 2.00,
            }]
        });
        log('PUT /:id/lines (add line)', res.status === 200 && res.body.success, `${res.body.message || ''}`);
    } catch (e) {
        log('PUT /:id/lines (add line)', false, e.message);
    }

    // Confirm order
    try {
        const res = await request('PUT', `/api/pedidos/${TEST_ORDER_ID}/confirm`, { tipoventa: 'CC' });
        log('PUT /:id/confirm', res.status === 200 && res.body.success, `estado=${res.body.order?.header?.estado || res.body.estado || '?'}`);
    } catch (e) {
        log('PUT /:id/confirm', false, e.message);
    }

    // Clone order
    try {
        const res = await request('GET', `/api/pedidos/${TEST_ORDER_ID}/clone`);
        log('GET /:id/clone', res.status === 200 && res.body.success, `cloned order id=${res.body.order?.header?.id || '?'}`);
        // Delete the clone too
        const cloneId = res.body.order?.header?.id;
        if (cloneId) {
            await request('DELETE', `/api/pedidos/${cloneId}`);
        }
    } catch (e) {
        log('GET /:id/clone', false, e.message);
    }

    // PDF data
    try {
        const res = await request('GET', `/api/pedidos/${TEST_ORDER_ID}/pdf`);
        log('GET /:id/pdf', res.status === 200 && res.body.success, 'pdf data ok');
    } catch (e) {
        log('GET /:id/pdf', false, e.message);
    }

    // Cancel (delete) the test order
    try {
        const res = await request('DELETE', `/api/pedidos/${TEST_ORDER_ID}`);
        log('DELETE /:id (cancel order)', res.status === 200 && res.body.success, 'test order cancelled');
    } catch (e) {
        log('DELETE /:id (cancel order)', false, e.message);
    }
}

async function testProductHistory() {
    if (!FIRST_PRODUCT_CODE || !FIRST_CLIENT_CODE) {
        log('GET /product-history/:p/:c', false, 'No product/client code available');
        return;
    }
    console.log('\n📈 PRODUCT HISTORY');
    try {
        const res = await request('GET', `/api/pedidos/product-history/${FIRST_PRODUCT_CODE}/${FIRST_CLIENT_CODE}`);
        const ok = res.status === 200 && res.body.success;
        log('GET /product-history/:p/:c', ok, `years=${Object.keys(res.body.years || {}).length}, trend=${res.body.trend}`);
    } catch (e) {
        log('GET /product-history/:p/:c', false, e.message);
    }
}

// ─── MAIN ───────────────────────────────────────────────────────
async function main() {
    console.log(`\n${'='.repeat(60)}`);
    console.log('  PEDIDOS ENDPOINTS TEST');
    console.log(`  Server: ${BASE}`);
    console.log(`  User: ${USER}`);
    console.log(`${'='.repeat(60)}`);

    await testLogin();
    if (!TOKEN) {
        console.log('\n🚫 Cannot continue without auth token');
        process.exit(1);
    }

    await testProducts();
    await testProductDetail();
    await testProductStock();
    await testFilters();
    await testPromotions();
    await testClientPrices();
    await testOrderCRUD(); // This sets FIRST_CLIENT_CODE from existing orders
    await testClientBalance();
    await testRecommendations();
    await testAnalytics();
    await testComplementary();
    await testProductHistory();

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    console.log(`${'='.repeat(60)}\n`);

    if (failed > 0) {
        console.log('  Failed tests:');
        results.filter(r => !r.ok).forEach(r => console.log(`    ❌ ${r.test}: ${r.detail}`));
        console.log('');
    }

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
