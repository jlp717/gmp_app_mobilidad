/**
 * 🧪 RUTERO HTTP INTEGRATION TEST
 * 
 * Este script llama a los ENDPOINTS REALES de la API para verificar:
 * 1. Que los contadores coincidan con los clientes devueltos
 * 2. Que "Ruta Original" vs "Orden Personalizado" funcione
 * 3. Que los movimientos de clientes entre días funcionen
 * 
 * ⚠️ EJECUTAR SOLO EN EL SERVIDOR (donde la API está corriendo)
 * ⚠️ TODOS LOS CAMBIOS SE REVIERTEN AL FINALIZAR
 * 
 * Ejecutar: node backend/scripts/integration_test_http.js
 */

const http = require('http');

// Configuration
const API_HOST = 'localhost';
const API_PORT = 3000;
const TEST_VENDOR = '33';

// Track changes for rollback
let changesLog = [];
let testResults = { passed: 0, failed: 0, tests: [] };

// ============================================================================
// HTTP UTILITIES
// ============================================================================

function httpGet(path, queryParams = {}) {
    return new Promise((resolve, reject) => {
        const query = new URLSearchParams(queryParams).toString();
        const fullPath = query ? `${path}?${query}` : path;

        const options = {
            hostname: API_HOST,
            port: API_PORT,
            path: fullPath,
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => reject(new Error('Timeout')));
        req.end();
    });
}

function httpPost(path, body) {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(body);

        const options = {
            hostname: API_HOST,
            port: API_PORT,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr)
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => reject(new Error('Timeout')));
        req.write(bodyStr);
        req.end();
    });
}

// ============================================================================
// LOGGING
// ============================================================================

function log(emoji, message) {
    console.log(`${emoji} ${message}`);
}

function logResult(testName, passed, details = '') {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`   ${status}: ${testName}${details ? ' - ' + details : ''}`);
    testResults.tests.push({ name: testName, passed, details });
    passed ? testResults.passed++ : testResults.failed++;
}

// ============================================================================
// ROLLBACK FUNCTION
// ============================================================================

async function rollbackAllChanges() {
    log('🔄', 'Revirtiendo todos los cambios...');

    for (const change of changesLog) {
        try {
            if (change.type === 'move') {
                // Undo the move by posting to config endpoint
                // This removes the config entry
                await httpPost('/api/rutero/config', {
                    vendedor: change.vendedor,
                    cliente: change.cliente,
                    dia: change.originalDay,
                    orden: change.originalOrder || 9999,
                    action: 'restore'
                });
            }
        } catch (e) {
            console.log(`   ⚠️ Error revirtiendo: ${e.message}`);
        }
    }

    changesLog = [];
    log('✅', 'Rollback completado');
}

// ============================================================================
// TEST 1: API HEALTH CHECK
// ============================================================================

async function testApiHealth() {
    log('\n🏥', 'TEST 1: API Health Check');
    log('─', '─'.repeat(50));

    try {
        const response = await httpGet('/api/rutero/week', { vendedorCodes: TEST_VENDOR, role: 'comercial' });

        logResult('API responde', response.status === 200, `Status: ${response.status}`);
        logResult('Datos válidos', response.data && response.data.week, 'Week data presente');

        return response.status === 200;
    } catch (e) {
        logResult('API disponible', false, e.message);
        return false;
    }
}

// ============================================================================
// TEST 2: COUNT MATCHES ROWS
// ============================================================================

async function testCountMatchesRows() {
    log('\n📊', 'TEST 2: Contadores coinciden con filas (via HTTP)');
    log('─', '─'.repeat(50));

    // Get week summary
    const weekResponse = await httpGet('/api/rutero/week', { vendedorCodes: TEST_VENDOR, role: 'comercial' });

    if (weekResponse.status !== 200) {
        logResult('Week endpoint', false, 'Error obteniendo semana');
        return;
    }

    const weekCounts = weekResponse.data.week;

    // Test a few days
    const testDays = ['lunes', 'miercoles', 'sabado'];

    for (const day of testDays) {
        const expectedCount = weekCounts[day] || 0;

        // Get day clients
        const dayResponse = await httpGet(`/api/rutero/day/${day}`, { vendedorCodes: TEST_VENDOR, role: 'comercial' });

        if (dayResponse.status !== 200) {
            logResult(`${day}: obtener clientes`, false, 'Error API');
            continue;
        }

        const actualCount = dayResponse.data.clients?.length || 0;

        logResult(
            `${day}: Badge = Filas`,
            expectedCount === actualCount,
            `Badge=${expectedCount}, Filas=${actualCount}`
        );
    }
}

// ============================================================================
// TEST 3: ORIGINAL VS CUSTOM
// ============================================================================

async function testOriginalVsCustom() {
    log('\n🔀', 'TEST 3: Ruta Original vs Orden Personalizado (via HTTP)');
    log('─', '─'.repeat(50));

    // Test miércoles - we know there are !miercoles blocks
    const day = 'miercoles';

    // Get Custom mode (default)
    const customResponse = await httpGet(`/api/rutero/day/${day}`, {
        vendedorCodes: TEST_VENDOR,
        role: 'comercial',
        ignoreOverrides: 'false'
    });

    // Get Original mode
    const originalResponse = await httpGet(`/api/rutero/day/${day}`, {
        vendedorCodes: TEST_VENDOR,
        role: 'comercial',
        ignoreOverrides: 'true'
    });

    if (customResponse.status !== 200 || originalResponse.status !== 200) {
        logResult('Endpoints responden', false, 'Error en alguna petición');
        return;
    }

    const customCount = customResponse.data.clients?.length || 0;
    const originalCount = originalResponse.data.clients?.length || 0;

    logResult(
        `${day}: Original ≠ Custom`,
        originalCount !== customCount,
        `Custom=${customCount}, Original=${originalCount}`
    );

    logResult(
        `${day}: Original > Custom (bloques activos)`,
        originalCount > customCount,
        `Diferencia: ${originalCount - customCount} clientes bloqueados`
    );

    // Test sabado - should have more in Custom (moved clients)
    const satCustom = await httpGet('/api/rutero/day/sabado', { vendedorCodes: TEST_VENDOR, role: 'comercial', ignoreOverrides: 'false' });
    const satOriginal = await httpGet('/api/rutero/day/sabado', { vendedorCodes: TEST_VENDOR, role: 'comercial', ignoreOverrides: 'true' });

    if (satCustom.status === 200 && satOriginal.status === 200) {
        const satCustomCount = satCustom.data.clients?.length || 0;
        const satOriginalCount = satOriginal.data.clients?.length || 0;

        logResult(
            'sabado: Custom ≥ Original (clientes movidos)',
            satCustomCount >= satOriginalCount,
            `Custom=${satCustomCount}, Original=${satOriginalCount}`
        );
    }
}

// ============================================================================
// TEST 4: CLIENT ORDER FIELD EXISTS AND IS DIFFERENT
// ============================================================================

async function testClientOrderField() {
    log('\n📋', 'TEST 4: Campo "order" en clientes');
    log('─', '─'.repeat(50));

    // Get custom mode - clients should have order field
    const response = await httpGet('/api/rutero/day/lunes', { vendedorCodes: TEST_VENDOR, role: 'comercial' });

    if (response.status !== 200 || !response.data.clients?.length) {
        logResult('Clientes tienen order', false, 'No hay clientes');
        return;
    }

    const clients = response.data.clients;
    const hasOrderField = clients.every(c => typeof c.order === 'number');

    logResult('Todos los clientes tienen campo "order"', hasOrderField, `${clients.length} clientes`);

    // Check if some have different orders (not all 9999)
    const orders = clients.map(c => c.order);
    const uniqueOrders = [...new Set(orders)];

    logResult(
        'Hay variación en órdenes',
        uniqueOrders.length > 1,
        `Órdenes únicos: ${uniqueOrders.length} (sample: ${uniqueOrders.slice(0, 5).join(', ')})`
    );
}

// ============================================================================
// TEST 5: VERIFY A KNOWN BLOCKED CLIENT
// ============================================================================

async function testBlockedClient() {
    log('\n🚫', 'TEST 5: Verificar cliente bloqueado conocido');
    log('─', '─'.repeat(50));

    // Get miercoles in both modes
    const customResponse = await httpGet('/api/rutero/day/miercoles', {
        vendedorCodes: TEST_VENDOR,
        role: 'comercial',
        ignoreOverrides: 'false'
    });

    const originalResponse = await httpGet('/api/rutero/day/miercoles', {
        vendedorCodes: TEST_VENDOR,
        role: 'comercial',
        ignoreOverrides: 'true'
    });

    if (customResponse.status !== 200 || originalResponse.status !== 200) {
        logResult('Obtener datos', false, 'Error API');
        return;
    }

    const customCodes = customResponse.data.clients?.map(c => c.code) || [];
    const originalCodes = originalResponse.data.clients?.map(c => c.code) || [];

    // Find a client that's in Original but not in Custom (blocked)
    const blockedClients = originalCodes.filter(c => !customCodes.includes(c));

    logResult(
        'Hay clientes bloqueados',
        blockedClients.length > 0,
        `${blockedClients.length} clientes bloqueados en miércoles`
    );

    if (blockedClients.length > 0) {
        log('ℹ️', `   Ejemplo de bloqueado: ${blockedClients[0]}`);
    }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function runAllTests() {
    log('🚀', 'INICIANDO TESTS DE INTEGRACIÓN HTTP');
    log('═', '═'.repeat(60));
    log('📍', `API Target: http://${API_HOST}:${API_PORT}`);
    log('👤', `Test Vendor: ${TEST_VENDOR}`);

    try {
        // Health check first
        const apiOk = await testApiHealth();

        if (!apiOk) {
            log('\n❌', 'API no disponible. ¿Está corriendo el servidor?');
            log('💡', 'Ejecuta: pm2 status');
            process.exit(1);
        }

        // Run all tests
        await testCountMatchesRows();
        await testOriginalVsCustom();
        await testClientOrderField();
        await testBlockedClient();

    } catch (e) {
        log('❌', `Error fatal: ${e.message}`);
        console.error(e);
    } finally {
        // Rollback any changes (none in this read-only version)
        if (changesLog.length > 0) {
            await rollbackAllChanges();
        }

        // Print summary
        log('\n═', '═'.repeat(60));
        log('📋', `RESUMEN: ${testResults.passed} pasados, ${testResults.failed} fallidos`);
        log('═', '═'.repeat(60));

        if (testResults.failed > 0) {
            log('\n❌', 'TESTS FALLIDOS:');
            testResults.tests.filter(t => !t.passed).forEach(t => {
                console.log(`   - ${t.name}: ${t.details}`);
            });
        } else {
            log('\n🎉', 'TODOS LOS TESTS PASARON');
        }

        process.exit(testResults.failed > 0 ? 1 : 0);
    }
}

runAllTests();
