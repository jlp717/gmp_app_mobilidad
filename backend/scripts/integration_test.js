/**
 * 🧪 RUTERO INTEGRATION TEST SCRIPT v2
 * 
 * Este script verifica:
 * 1. Que los contadores coincidan con los clientes devueltos
 * 2. Que "Ruta Original" vs "Orden Personalizado" funcione
 * 3. Que los movimientos de clientes funcionen (mismo día y distinto día)
 * 
 * ⚠️ TODOS LOS CAMBIOS SE REVIERTEN AL FINALIZAR
 * 
 * Ejecutar: node backend/scripts/integration_test.js
 */

const { query, initDb } = require('../config/db');
const {
    loadLaclaeCache,
    getClientsForDay,
    getWeekCountsFromCache,
    reloadRuteroConfig,
    getClientCurrentDay
} = require('../services/laclae');

// Test configuration
const TEST_VENDORS = ['33']; // Focus on vendor 33 which has known overrides
const DAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

// Track all changes for rollback
let changesLog = [];
let testResults = { passed: 0, failed: 0, tests: [] };

// ============================================================================
// UTILITY FUNCTIONS
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

function logInfo(testName, details = '') {
    console.log(`   ℹ️ INFO: ${testName}${details ? ' - ' + details : ''}`);
}

async function insertConfig(vendedor, cliente, dia, orden) {
    await query(`
        INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, CLIENTE, DIA, ORDEN)
        VALUES ('${vendedor}', '${cliente}', '${dia}', ${orden})
    `);
    changesLog.push({ type: 'insert', vendedor, cliente, dia });
}

async function deleteConfig(vendedor, cliente, dia = null) {
    let sql = `DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${vendedor}' AND CLIENTE = '${cliente}'`;
    if (dia) sql += ` AND DIA = '${dia}'`;
    await query(sql);
}

async function getExistingConfig(vendedor, cliente) {
    const rows = await query(`
        SELECT TRIM(DIA) as DIA, ORDEN 
        FROM JAVIER.RUTERO_CONFIG 
        WHERE VENDEDOR = '${vendedor}' AND TRIM(CLIENTE) = '${cliente}'
    `);
    return rows;
}

async function rollbackAllChanges() {
    log('🔄', 'Revirtiendo todos los cambios...');

    // First, delete all inserts we made
    for (const change of changesLog) {
        try {
            if (change.type === 'insert') {
                await deleteConfig(change.vendedor, change.cliente, change.dia);
            }
        } catch (e) {
            // Ignore errors during rollback of inserts
        }
    }

    // Then, restore any deleted items
    for (const change of changesLog) {
        try {
            if (change.type === 'delete' && change.originalData) {
                await insertConfig(change.vendedor, change.cliente, change.originalData.dia, change.originalData.orden);
            }
        } catch (e) {
            // May already exist, ignore
        }
    }

    changesLog = [];
    log('✅', 'Rollback completado');
}

// ============================================================================
// TEST 1: COUNT MATCHES ROWS
// ============================================================================

async function testCountMatchesRows() {
    log('\n📊', 'TEST 1: Contadores coinciden con filas');
    log('─', '─'.repeat(50));

    for (const vendor of TEST_VENDORS) {
        const counts = getWeekCountsFromCache(vendor, 'comercial');
        if (!counts) {
            logResult(`Vendor ${vendor} counts`, false, 'No counts returned');
            continue;
        }

        let allMatch = true;
        for (const day of DAYS) {
            const expectedCount = counts[day] || 0;
            const clients = getClientsForDay(vendor, day, 'comercial', false);
            const actualCount = clients?.length || 0;

            if (expectedCount !== actualCount) {
                allMatch = false;
                logResult(`Vendor ${vendor} ${day}`, false, `Badge=${expectedCount}, Rows=${actualCount}`);
            }
        }

        if (allMatch) {
            logResult(`Vendor ${vendor} todos los días`, true, 'Contadores coinciden');
        }
    }
}

// ============================================================================
// TEST 2: ORIGINAL VS CUSTOM - Focus on Vendor 33 Miércoles (known to have !blocks)
// ============================================================================

async function testOriginalVsCustom() {
    log('\n🔀', 'TEST 2: Ruta Original vs Orden Personalizado');
    log('─', '─'.repeat(50));

    // Test vendor 33 miércoles - we know there are 21 !miercoles blocks
    const vendor = '33';
    const day = 'miercoles';

    const customClients = getClientsForDay(vendor, day, 'comercial', false) || [];
    const originalClients = getClientsForDay(vendor, day, 'comercial', true) || [];

    const difference = originalClients.length - customClients.length;

    logResult(
        `Vendor ${vendor} ${day} tiene diferencia`,
        difference > 0,
        `Custom=${customClients.length}, Original=${originalClients.length}, Diff=${difference}`
    );

    // Check that the difference is approximately the number of !blocks
    const blocksCount = await query(`
        SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG 
        WHERE VENDEDOR = '${vendor}' AND DIA = '!${day}'
    `);
    const expectedBlocks = blocksCount[0]?.CNT || 0;

    logResult(
        `Bloques !${day} aplicados`,
        difference === expectedBlocks,
        `Bloques=${expectedBlocks}, Diferencia real=${difference}`
    );

    // Also test saturday (where we moved a client TO)
    const satCustom = getClientsForDay(vendor, 'sabado', 'comercial', false) || [];
    const satOriginal = getClientsForDay(vendor, 'sabado', 'comercial', true) || [];

    logResult(
        `Vendor ${vendor} sabado Original vs Custom`,
        satCustom.length > satOriginal.length,
        `Custom=${satCustom.length}, Original=${satOriginal.length}`
    );
}

// ============================================================================
// TEST 3: CONFIG IS PROPERLY STORED AND LOADED
// ============================================================================

async function testConfigStorage() {
    log('\n�', 'TEST 3: Almacenamiento de configuración');
    log('─', '─'.repeat(50));

    const vendor = '33';
    const testClient = '4300000999'; // Use a test client code
    const testDay = 'domingo';

    try {
        // Check if test client already exists
        const existing = await getExistingConfig(vendor, testClient);
        if (existing.length > 0) {
            logInfo('Test client exists', 'Saltando para no modificar datos reales');
            return;
        }

        // Insert test config
        await insertConfig(vendor, testClient, testDay, 123);

        // Reload cache
        await reloadRuteroConfig();

        // Verify it was stored
        const stored = await getExistingConfig(vendor, testClient);
        const found = stored.some(r => r.DIA.toLowerCase() === testDay && r.ORDEN === 123);

        logResult('Config almacenada correctamente', found, `${testClient} -> ${testDay}:123`);

    } finally {
        // Cleanup will happen in rollback
    }
}

// ============================================================================
// TEST 4: CLIENT MOVEMENT - DIFFERENT DAY (Move + Block)
// ============================================================================

async function testMoveDifferentDay() {
    log('\n📆', 'TEST 4: Mover cliente a otro día');
    log('─', '─'.repeat(50));

    const vendor = '33';
    const sourceDay = 'lunes';
    const targetDay = 'viernes';

    // Get a client that is on Monday originally
    const mondayOriginal = getClientsForDay(vendor, sourceDay, 'comercial', true) || [];
    const fridayOriginal = getClientsForDay(vendor, targetDay, 'comercial', true) || [];

    // Find a client only on Monday (not on Friday naturally)
    const testClient = mondayOriginal.find(c => !fridayOriginal.includes(c));

    if (!testClient) {
        logInfo('Move different day', 'No suitable test client found');
        return;
    }

    try {
        // Check if client already has configs
        const existing = await getExistingConfig(vendor, testClient);
        for (const e of existing) {
            changesLog.push({ type: 'delete', vendedor: vendor, cliente: testClient, originalData: { dia: e.DIA, orden: e.ORDEN } });
        }
        await deleteConfig(vendor, testClient);

        // Move to Friday + Block from Monday
        await insertConfig(vendor, testClient, targetDay, 1);
        await insertConfig(vendor, testClient, '!' + sourceDay, 0);

        // Reload
        await reloadRuteroConfig();

        // Check Custom mode: Client should be on Friday, NOT on Monday
        const fridayAfter = getClientsForDay(vendor, targetDay, 'comercial', false) || [];
        const mondayAfterCustom = getClientsForDay(vendor, sourceDay, 'comercial', false) || [];

        logResult('Cliente aparece en día destino (Custom)', fridayAfter.includes(testClient), `${testClient} en ${targetDay}`);
        logResult('Cliente oculto en día origen (Custom)', !mondayAfterCustom.includes(testClient), `${testClient} NO en ${sourceDay}`);

        // Check Original mode: Client should still be on Monday
        const mondayAfterOriginal = getClientsForDay(vendor, sourceDay, 'comercial', true) || [];
        logResult('Cliente visible en Original', mondayAfterOriginal.includes(testClient), `${testClient} visible en Original ${sourceDay}`);

    } finally {
        // Cleanup happens in rollback
    }
}

// ============================================================================
// TEST 5: BLOCKING CLIENTS (!day)
// ============================================================================

async function testBlockingClients() {
    log('\n🚫', 'TEST 5: Bloqueo de clientes (!día)');
    log('─', '─'.repeat(50));

    const vendor = '33';
    const day = 'martes';

    // Get a client naturally on Tuesday
    const originalClients = getClientsForDay(vendor, day, 'comercial', true) || [];

    if (originalClients.length === 0) {
        logInfo('Block client', 'No clients on this day');
        return;
    }

    // Find a client without existing config to avoid conflicts
    let testClient = null;
    for (const c of originalClients) {
        const existing = await getExistingConfig(vendor, c);
        if (existing.length === 0) {
            testClient = c;
            break;
        }
    }

    if (!testClient) {
        logInfo('Block client', 'All clients have existing configs');
        return;
    }

    try {
        // Add block
        await insertConfig(vendor, testClient, '!' + day, 0);

        // Reload
        await reloadRuteroConfig();

        // Custom should NOT show, Original SHOULD show
        const customAfter = getClientsForDay(vendor, day, 'comercial', false) || [];
        const originalAfter = getClientsForDay(vendor, day, 'comercial', true) || [];

        logResult('Bloqueado en Custom', !customAfter.includes(testClient), `${testClient} oculto`);
        logResult('Visible en Original', originalAfter.includes(testClient), `${testClient} visible`);

    } finally {
        // Cleanup
    }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function runAllTests() {
    try {
        await initDb();
        log('🚀', 'INICIANDO TESTS DE INTEGRACIÓN DEL RUTERO v2');
        log('═', '═'.repeat(60));

        log('📥', 'Cargando caché...');
        await loadLaclaeCache();

        // Run all tests
        await testCountMatchesRows();
        await testOriginalVsCustom();
        await testConfigStorage();
        await testMoveDifferentDay();
        await testBlockingClients();

    } catch (e) {
        log('❌', `Error fatal: ${e.message}`);
        console.error(e);
    } finally {
        // ALWAYS rollback
        await rollbackAllChanges();

        // Reload config to clear test data from cache
        try {
            await reloadRuteroConfig();
        } catch (e) { }

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

        const exitCode = testResults.failed > 0 ? 1 : 0;
        process.exit(exitCode);
    }
}

runAllTests();
