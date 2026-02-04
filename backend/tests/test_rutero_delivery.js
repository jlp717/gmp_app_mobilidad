/**
 * Test Script: Rutero Delivery Endpoints
 * Tests the delivery confirmation flow with duplicate prevention
 * 
 * Run: node tests/test_rutero_delivery.js
 */

const http = require('http');

const API_BASE = 'http://192.168.1.230:3000/api';
const TEST_USER = 'GOYO';
const TEST_PASSWORD = '9584';

// Helper: Make HTTP request
function makeRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(API_BASE + path);
        const options = {
            hostname: url.hostname,
            port: url.port || 3000,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ status: res.statusCode, body: json });
                } catch (e) {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });

        req.on('error', reject);

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

// Test 1: Authenticate and get token
async function testLogin() {
    console.log('\n🔐 TEST 1: Login as GOYO...');
    try {
        const res = await makeRequest('POST', '/auth/login', {
            username: TEST_USER,
            password: TEST_PASSWORD
        });
        console.log(`   Status: ${res.status}`);
        console.log(`   Success: ${res.body.success}`);
        if (res.body.success) {
            console.log(`   ✅ Login successful - Role: ${res.body.user?.role || res.body.user?.cargo}`);
            return res.body.token || res.body.user?.token;
        } else {
            console.log(`   ❌ Login failed: ${res.body.error}`);
            return null;
        }
    } catch (e) {
        console.log(`   ❌ Error: ${e.message}`);
        return null;
    }
}

// Test 2: Get pending deliveries
async function testGetPendientes(repartidorId) {
    console.log(`\n📦 TEST 2: Get pending deliveries for repartidor ${repartidorId}...`);
    const today = new Date().toISOString().split('T')[0];
    try {
        const res = await makeRequest('GET', `/entregas/pendientes/${repartidorId}?date=${today}`);
        console.log(`   Status: ${res.status}`);
        console.log(`   Success: ${res.body.success}`);
        console.log(`   Total albaranes: ${res.body.total || 0}`);
        console.log(`   Resumen:`);
        console.log(`     - completedCount: ${res.body.resumen?.completedCount || 0}`);
        console.log(`     - totalACobrar: ${res.body.resumen?.totalACobrar || 0}€`);
        console.log(`     - totalOpcional: ${res.body.resumen?.totalOpcional || 0}€`);

        if (res.body.albaranes && res.body.albaranes.length > 0) {
            console.log(`\n   Sample albaranes:`);
            res.body.albaranes.slice(0, 3).forEach((alb, i) => {
                console.log(`     [${i + 1}] ID: ${alb.id}, Cliente: ${alb.nombreCliente}, Estado: ${alb.estado}, Repartidor: ${alb.codigoRepartidor || 'N/A'}`);
            });
            return res.body.albaranes[0]; // Return first for testing
        }
        return null;
    } catch (e) {
        console.log(`   ❌ Error: ${e.message}`);
        return null;
    }
}

// Test 3: Confirm delivery (first time)
async function testConfirmDelivery(albaran, repartidorId) {
    if (!albaran) {
        console.log('\n⏭️ TEST 3: Skipped (no albaran to test)');
        return false;
    }
    console.log(`\n✅ TEST 3: Confirm delivery ${albaran.id}...`);
    try {
        const res = await makeRequest('POST', '/entregas/update', {
            itemId: albaran.id,
            status: 'ENTREGADO',
            repartidorId: repartidorId,
            observaciones: 'Test de entrega - Script automatizado',
            latitud: 40.416775,
            longitud: -3.703790
        });
        console.log(`   Status: ${res.status}`);
        console.log(`   Success: ${res.body.success}`);
        console.log(`   Message: ${res.body.message || res.body.error}`);
        return res.body.success;
    } catch (e) {
        console.log(`   ❌ Error: ${e.message}`);
        return false;
    }
}

// Test 4: Try duplicate confirmation (should fail with 409)
async function testDuplicateConfirmation(albaran, repartidorId) {
    if (!albaran) {
        console.log('\n⏭️ TEST 4: Skipped (no albaran to test)');
        return;
    }
    console.log(`\n🔁 TEST 4: Try DUPLICATE confirmation for ${albaran.id}...`);
    try {
        const res = await makeRequest('POST', '/entregas/update', {
            itemId: albaran.id,
            status: 'ENTREGADO',
            repartidorId: repartidorId,
            observaciones: 'DUPLICADO - Esto NO debería funcionar'
        });
        console.log(`   Status: ${res.status}`);
        console.log(`   Success: ${res.body.success}`);
        console.log(`   AlreadyDelivered: ${res.body.alreadyDelivered || false}`);
        console.log(`   Message: ${res.body.message || res.body.error}`);

        if (res.status === 409 && res.body.alreadyDelivered) {
            console.log(`   ✅ CORRECT! Duplicate was rejected.`);
        } else {
            console.log(`   ⚠️ WARNING: Duplicate was allowed (forceUpdate may be needed to block)`);
        }
    } catch (e) {
        console.log(`   ❌ Error: ${e.message}`);
    }
}

// Test 5: Force update (should work)
async function testForceUpdate(albaran, repartidorId) {
    if (!albaran) {
        console.log('\n⏭️ TEST 5: Skipped (no albaran to test)');
        return;
    }
    console.log(`\n🔄 TEST 5: Force update for ${albaran.id}...`);
    try {
        const res = await makeRequest('POST', '/entregas/update', {
            itemId: albaran.id,
            status: 'ENTREGADO',
            repartidorId: repartidorId,
            observaciones: 'Actualización forzada - Script',
            forceUpdate: true
        });
        console.log(`   Status: ${res.status}`);
        console.log(`   Success: ${res.body.success}`);
        console.log(`   Message: ${res.body.message || res.body.error}`);

        if (res.body.success) {
            console.log(`   ✅ CORRECT! Force update works.`);
        }
    } catch (e) {
        console.log(`   ❌ Error: ${e.message}`);
    }
}

// Test 6: Verify KPI update after delivery
async function testKpiAfterDelivery(repartidorId) {
    console.log(`\n📊 TEST 6: Verify KPIs updated after delivery...`);
    const today = new Date().toISOString().split('T')[0];
    try {
        const res = await makeRequest('GET', `/entregas/pendientes/${repartidorId}?date=${today}`);
        console.log(`   Status: ${res.status}`);
        console.log(`   Resumen after delivery:`);
        console.log(`     - completedCount: ${res.body.resumen?.completedCount || 0}`);
        console.log(`     - totalACobrar: ${res.body.resumen?.totalACobrar || 0}€`);
        console.log(`     - totalOpcional: ${res.body.resumen?.totalOpcional || 0}€`);

        // Check if any have ENTREGADO status
        const delivered = (res.body.albaranes || []).filter(a => a.estado === 'ENTREGADO');
        console.log(`   Delivered count: ${delivered.length}`);

        if (res.body.resumen?.completedCount > 0) {
            console.log(`   ✅ KPI counter is working!`);
        } else {
            console.log(`   ⚠️ KPI counter still 0 - may need to check ID format`);
        }
    } catch (e) {
        console.log(`   ❌ Error: ${e.message}`);
    }
}

// Main
async function runTests() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('        RUTERO DELIVERY ENDPOINTS TEST SUITE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Server: ${API_BASE}`);
    console.log(`Time: ${new Date().toISOString()}`);

    // Get repartidor ID from login or use test value
    let repartidorId = '15'; // Default test value for GOYO

    const token = await testLogin();

    const firstAlbaran = await testGetPendientes(repartidorId);

    // NOTE: Comment these out if you don't want to actually modify data
    /*
    const confirmed = await testConfirmDelivery(firstAlbaran, repartidorId);
    if (confirmed) {
        await testDuplicateConfirmation(firstAlbaran, repartidorId);
        await testForceUpdate(firstAlbaran, repartidorId);
    }
    */

    await testKpiAfterDelivery(repartidorId);

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('                    TESTS COMPLETED');
    console.log('═══════════════════════════════════════════════════════════');
}

runTests().catch(console.error);
