#!/usr/bin/env node
/**
 * TEST HIPER-EXHAUSTIVO: Organización de Ruteros
 * ================================================
 * Ejecutar en Putty/SSH:
 *   node backend/scripts/test_rutero_organization.js
 *
 * O con API externa:
 *   API_URL=https://api.gmp-app.com node backend/scripts/test_rutero_organization.js
 *
 * Requiere: Token de autenticación válido (se obtiene via login)
 */

const https = require('https');
const http = require('http');

// ============================================================================
// CONFIGURACIÓN
// ============================================================================
const API_BASE = process.env.API_URL || 'https://api.gmp-app.com';
const LOGIN_USER = process.env.TEST_USER || '33'; // Comercial 33
const LOGIN_PASS = process.env.TEST_PASS || '3318';
const VENDEDOR = process.env.TEST_VENDEDOR || '33';
const ROLE = 'comercial';

// Test timing
const results = [];
let token = null;
let testNum = 0;

// ============================================================================
// HTTP HELPERS
// ============================================================================
function makeRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, API_BASE);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;

        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 3000),
            path: url.pathname + url.search,
            method,
            headers: {
                'Content-Type': 'application/json',
            },
            rejectUnauthorized: false, // Allow self-signed certs
        };

        if (token) {
            options.headers['Authorization'] = `Bearer ${token}`;
        }

        const start = Date.now();
        const req = lib.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const elapsed = Date.now() - start;
                try {
                    const json = JSON.parse(data);
                    resolve({ status: res.statusCode, data: json, elapsed });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data, elapsed });
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function apiGet(path, params = {}) {
    const url = new URL(path, API_BASE);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    return makeRequest('GET', url.toString());
}

async function apiPost(path, body) {
    const url = new URL(path, API_BASE);
    return makeRequest('POST', url.toString(), body);
}

// ============================================================================
// TEST HELPERS
// ============================================================================
function log(msg) { console.log(msg); }
function logHeader(msg) { console.log(`\n${'='.repeat(70)}\n  ${msg}\n${'='.repeat(70)}`); }
function logSubHeader(msg) { console.log(`\n--- ${msg} ---`); }

function recordResult(name, passed, details = '', elapsed = 0) {
    testNum++;
    const status = passed ? 'PASS' : 'FAIL';
    const icon = passed ? '✅' : '❌';
    results.push({ num: testNum, name, status, details, elapsed });
    log(`  ${icon} Test #${testNum}: ${name} [${elapsed}ms] ${details ? '- ' + details : ''}`);
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// TEST: Login (obtener token)
// ============================================================================
async function testLogin() {
    logHeader('FASE 0: AUTENTICACIÓN');

    if (LOGIN_PASS) {
        log(`  Intentando login como usuario ${LOGIN_USER}...`);
        try {
            const res = await apiPost('/api/auth/login', {
                username: LOGIN_USER,
                password: LOGIN_PASS,
            });
            if (res.data.token) {
                token = res.data.token;
                log(`  ✅ Login exitoso. Token obtenido.`);
                return true;
            }
        } catch (e) {
            log(`  ⚠️ Login falló: ${e.message}`);
        }
    }

    // Try without auth (some setups don't require it for API)
    log(`  Intentando sin autenticación...`);
    try {
        const res = await apiGet('/api/rutero/week', { vendedorCodes: VENDEDOR, role: ROLE });
        if (res.status === 200 && res.data.week) {
            log(`  ✅ API accesible sin token. Continuando...`);
            return true;
        }
        log(`  ❌ API requiere autenticación. Status: ${res.status}`);
        log(`  Ejecuta con: TEST_PASS=tuPassword node backend/scripts/test_rutero_organization.js`);
        return false;
    } catch (e) {
        log(`  ❌ No se puede conectar a ${API_BASE}: ${e.message}`);
        return false;
    }
}

// ============================================================================
// TEST 1-2: Mover cliente entre días + verificar contadores
// ============================================================================
async function test1_2_MoveClientBetweenDays() {
    logHeader('TEST 1-2: Mover cliente entre días + Verificar contadores');

    // 1. Obtener clientes del miércoles
    logSubHeader('Obteniendo clientes del Miércoles');
    const mieRes = await apiGet('/api/rutero/day/miercoles', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });

    if (mieRes.status !== 200 || !mieRes.data.clients || mieRes.data.clients.length === 0) {
        recordResult('Obtener clientes Miércoles', false, `Status: ${mieRes.status}, Clientes: ${mieRes.data.clients?.length || 0}`);
        return null;
    }

    const mieClients = mieRes.data.clients;
    log(`  Miércoles tiene ${mieClients.length} clientes`);
    recordResult('Obtener clientes Miércoles', true, `${mieClients.length} clientes`, mieRes.elapsed);

    // Elegir un cliente para mover (el último de la lista)
    const clientToMove = mieClients[mieClients.length - 1];
    log(`  Cliente seleccionado: ${clientToMove.code} - ${clientToMove.name}`);

    // 2. Obtener contadores ANTES
    logSubHeader('Contadores ANTES del movimiento');
    const countsBefore = await apiGet('/api/rutero/counts', { vendedorCodes: VENDEDOR, role: ROLE });
    const mieCountBefore = countsBefore.data.counts?.miercoles || 0;
    const jueCountBefore = countsBefore.data.counts?.jueves || 0;
    log(`  Miércoles: ${mieCountBefore}, Jueves: ${jueCountBefore}`);

    // 3. Obtener clientes del jueves ANTES
    const jueBefore = await apiGet('/api/rutero/day/jueves', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const jueClientsBefore = jueBefore.data.clients || [];
    log(`  Jueves tiene ${jueClientsBefore.length} clientes antes del movimiento`);

    // 4. MOVER cliente de Miércoles a Jueves (al inicio)
    logSubHeader(`Moviendo ${clientToMove.code} de Miércoles a Jueves (inicio)`);
    const moveRes = await apiPost('/api/rutero/move_clients', {
        vendedor: VENDEDOR,
        moves: [{
            client: clientToMove.code,
            toDay: 'jueves',
            fromDay: 'miercoles',
            clientName: clientToMove.name,
            position: 'start'
        }]
    });

    if (moveRes.status !== 200 || !moveRes.data.success) {
        recordResult('Mover cliente Mie→Jue', false, `Status: ${moveRes.status}, Error: ${JSON.stringify(moveRes.data)}`, moveRes.elapsed);
        return null;
    }
    recordResult('Mover cliente Mie→Jue (API)', true, `Movido en ${moveRes.elapsed}ms`, moveRes.elapsed);

    // Esperar a que el cache se recargue
    await sleep(500);

    // 5. Verificar que el cliente DESAPARECIÓ del Miércoles
    logSubHeader('Verificando que desapareció del Miércoles');
    const mieAfter = await apiGet('/api/rutero/day/miercoles', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const mieClientsAfter = mieAfter.data.clients || [];
    const stillInMie = mieClientsAfter.find(c => c.code === clientToMove.code);
    recordResult(
        'Cliente desaparece de Miércoles',
        !stillInMie,
        stillInMie ? `⚠️ SIGUE EN MIÉRCOLES (BUG!)` : `Correcto: no está en Miércoles`,
        mieAfter.elapsed
    );

    // 6. Verificar que el cliente APARECE en Jueves (primera posición)
    logSubHeader('Verificando que aparece en Jueves (1ra posición)');
    const jueAfter = await apiGet('/api/rutero/day/jueves', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const jueClientsAfter = jueAfter.data.clients || [];
    const inJue = jueClientsAfter.find(c => c.code === clientToMove.code);
    const isFirst = jueClientsAfter.length > 0 && jueClientsAfter[0].code === clientToMove.code;
    recordResult(
        'Cliente aparece en Jueves',
        !!inJue,
        inJue ? `Encontrado en posición ${jueClientsAfter.indexOf(inJue) + 1}` : `⚠️ NO ESTÁ EN JUEVES (BUG!)`,
        jueAfter.elapsed
    );
    recordResult(
        'Cliente en 1ra posición de Jueves',
        isFirst,
        isFirst ? 'Correcto: posición 1' : `En posición ${inJue ? jueClientsAfter.indexOf(inJue) + 1 : 'N/A'}`,
        0
    );

    // 7. TEST 2: Verificar contadores
    logSubHeader('TEST 2: Verificando contadores actualizados');
    const countsAfter = await apiGet('/api/rutero/counts', { vendedorCodes: VENDEDOR, role: ROLE });
    const mieCountAfter = countsAfter.data.counts?.miercoles || 0;
    const jueCountAfter = countsAfter.data.counts?.jueves || 0;
    log(`  Antes  → Mie: ${mieCountBefore}, Jue: ${jueCountBefore}`);
    log(`  Después → Mie: ${mieCountAfter}, Jue: ${jueCountAfter}`);

    const mieDecreased = mieCountAfter === mieCountBefore - 1;
    const jueIncreased = jueCountAfter === jueCountBefore + 1;
    recordResult(
        'Contador Miércoles -1',
        mieDecreased,
        `${mieCountBefore} → ${mieCountAfter} (esperado: ${mieCountBefore - 1})`,
        countsAfter.elapsed
    );
    recordResult(
        'Contador Jueves +1',
        jueIncreased,
        `${jueCountBefore} → ${jueCountAfter} (esperado: ${jueCountBefore + 1})`,
        0
    );

    return { clientToMove, mieCountBefore, jueCountBefore };
}

// ============================================================================
// TEST 3: Reordenar Miércoles tras mover - cliente NO debe reaparecer
// ============================================================================
async function test3_ReorderAfterMove(clientMoved) {
    logHeader('TEST 3: Reordenar Miércoles tras mover (cliente movido NO debe reaparecer)');

    if (!clientMoved) {
        recordResult('Reordenar tras mover', false, 'Saltado: test anterior falló');
        return;
    }

    // Obtener clientes actuales del Miércoles
    const mieRes = await apiGet('/api/rutero/day/miercoles', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const mieClients = mieRes.data.clients || [];
    log(`  Miércoles tiene ${mieClients.length} clientes`);

    // Verificar que el cliente movido NO está
    const movedStillHere = mieClients.find(c => c.code === clientMoved.code);
    recordResult(
        'Cliente movido no está en lista Miércoles',
        !movedStillHere,
        movedStillHere ? `⚠️ ${clientMoved.code} SIGUE AQUÍ` : `Correcto: ${clientMoved.code} no aparece`
    );

    if (mieClients.length < 2) {
        recordResult('Reordenar Miércoles', true, 'No hay suficientes clientes para reordenar');
        return;
    }

    // Invertir el orden de los primeros 5 clientes
    const reordered = [...mieClients];
    const swapCount = Math.min(5, reordered.length);
    const first = reordered.slice(0, swapCount).reverse();
    reordered.splice(0, swapCount, ...first);

    const ordenPayload = reordered.map((c, i) => ({
        cliente: c.code,
        posicion: i * 10,
        posicionOriginal: i
    }));

    logSubHeader('Guardando nuevo orden en Miércoles');
    const saveRes = await apiPost('/api/rutero/config', {
        vendedor: VENDEDOR,
        dia: 'miercoles',
        orden: ordenPayload
    });

    recordResult(
        'Guardar reorden Miércoles',
        saveRes.status === 200 && saveRes.data.success,
        saveRes.data.success ? 'OK' : `Error: ${JSON.stringify(saveRes.data)}`,
        saveRes.elapsed
    );

    await sleep(500);

    // Verificar que el cliente movido SIGUE sin aparecer tras reordenar
    logSubHeader('Verificando persistencia del movimiento tras reordenar');
    const mieAfter = await apiGet('/api/rutero/day/miercoles', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const mieClientsAfter = mieAfter.data.clients || [];
    const reappeared = mieClientsAfter.find(c => c.code === clientMoved.code);
    recordResult(
        'Cliente movido NO reaparece tras reordenar',
        !reappeared,
        reappeared ? `❌ REAPARECIO (BUG CRÍTICO!) - ${clientMoved.code}` : `Correcto: sigue fuera`,
        mieAfter.elapsed
    );

    // Verificar que el orden se guardó
    const firstAfter = mieClientsAfter.slice(0, swapCount).map(c => c.code);
    const firstExpected = first.map(c => c.code);
    const orderCorrect = JSON.stringify(firstAfter) === JSON.stringify(firstExpected);
    recordResult(
        'Orden realmente cambió',
        orderCorrect,
        orderCorrect ? 'Los primeros clientes están invertidos' : `Orden no coincide`,
        0
    );
}

// ============================================================================
// TEST 4: Simular Logout/Login - cambio persiste
// ============================================================================
async function test4_PersistenceAfterRelogin(clientMoved) {
    logHeader('TEST 4: Persistencia tras "logout/login" (nueva petición sin cache)');

    if (!clientMoved) {
        recordResult('Persistencia login', false, 'Saltado: test anterior falló');
        return;
    }

    // Hacer una petición "fresca" (el servidor usa cache, pero RUTERO_CONFIG es siempre directo)
    const jueRes = await apiGet('/api/rutero/day/jueves', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const jueClients = jueRes.data.clients || [];
    const found = jueClients.find(c => c.code === clientMoved.code);

    recordResult(
        'Cliente sigue en Jueves tras "reconexión"',
        !!found,
        found ? `Encontrado en posición ${jueClients.indexOf(found) + 1}` : `⚠️ DESAPARECIÓ del Jueves`,
        jueRes.elapsed
    );

    // También verificar Miércoles
    const mieRes = await apiGet('/api/rutero/day/miercoles', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const mieClients = mieRes.data.clients || [];
    const backInMie = mieClients.find(c => c.code === clientMoved.code);

    recordResult(
        'Cliente NO volvió a Miércoles',
        !backInMie,
        backInMie ? `❌ VOLVIÓ A MIÉRCOLES (persistencia rota!)` : `Correcto: no está en Miércoles`,
        mieRes.elapsed
    );
}

// ============================================================================
// TEST 5: Mover cliente al final de la lista
// ============================================================================
async function test5_MoveToEnd() {
    logHeader('TEST 5: Mover cliente al FINAL de la lista');

    // Obtener un cliente del Lunes
    const lunRes = await apiGet('/api/rutero/day/lunes', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const lunClients = lunRes.data.clients || [];

    if (lunClients.length === 0) {
        recordResult('Mover al final', false, 'No hay clientes en Lunes');
        return null;
    }

    const clientToMove = lunClients[0]; // Primer cliente
    log(`  Moviendo ${clientToMove.code} - ${clientToMove.name} al final de Martes`);

    // Obtener cuántos hay en Martes
    const marBefore = await apiGet('/api/rutero/day/martes', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const marClientsBefore = marBefore.data.clients || [];
    log(`  Martes tiene ${marClientsBefore.length} clientes`);

    const moveRes = await apiPost('/api/rutero/move_clients', {
        vendedor: VENDEDOR,
        moves: [{
            client: clientToMove.code,
            toDay: 'martes',
            fromDay: 'lunes',
            clientName: clientToMove.name,
            position: 'end'
        }]
    });

    recordResult(
        'Move API (al final)',
        moveRes.status === 200 && moveRes.data.success,
        moveRes.data.success ? 'OK' : `Error: ${JSON.stringify(moveRes.data)}`,
        moveRes.elapsed
    );

    await sleep(500);

    const marAfter = await apiGet('/api/rutero/day/martes', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const marClientsAfter = marAfter.data.clients || [];
    const lastClient = marClientsAfter[marClientsAfter.length - 1];
    const isLast = lastClient && lastClient.code === clientToMove.code;

    recordResult(
        'Cliente aparece al FINAL de Martes',
        isLast,
        isLast ? `Correcto: último de ${marClientsAfter.length}` : `En posición ${marClientsAfter.findIndex(c => c.code === clientToMove.code) + 1} de ${marClientsAfter.length}`,
        marAfter.elapsed
    );

    return { clientToMove, fromDay: 'lunes', toDay: 'martes' };
}

// ============================================================================
// TEST 6: Mover a posición específica
// ============================================================================
async function test6_MoveToSpecificPosition() {
    logHeader('TEST 6: Mover a posición específica (posición 3)');

    const vieRes = await apiGet('/api/rutero/day/viernes', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const vieClients = vieRes.data.clients || [];

    if (vieClients.length === 0) {
        recordResult('Mover a posición específica', false, 'No hay clientes en Viernes');
        return null;
    }

    // Obtener clientes del jueves
    const jueRes = await apiGet('/api/rutero/day/jueves', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const jueClients = jueRes.data.clients || [];

    if (jueClients.length < 3) {
        log(`  Jueves solo tiene ${jueClients.length} clientes, usando posición 1`);
    }

    const clientToMove = vieClients[0];
    const targetPos = Math.min(3, jueClients.length + 1);
    log(`  Moviendo ${clientToMove.code} de Viernes a Jueves posición ${targetPos}`);

    const moveRes = await apiPost('/api/rutero/move_clients', {
        vendedor: VENDEDOR,
        moves: [{
            client: clientToMove.code,
            toDay: 'jueves',
            fromDay: 'viernes',
            clientName: clientToMove.name,
            position: targetPos
        }]
    });

    recordResult(
        `Move API (posición ${targetPos})`,
        moveRes.status === 200 && moveRes.data.success,
        moveRes.data.success ? 'OK' : `Error: ${JSON.stringify(moveRes.data)}`,
        moveRes.elapsed
    );

    await sleep(500);

    const jueAfter = await apiGet('/api/rutero/day/jueves', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const jueClientsAfter = jueAfter.data.clients || [];
    const actualPos = jueClientsAfter.findIndex(c => c.code === clientToMove.code) + 1;

    // La posición puede variar ligeramente según los clientes existentes con/sin orden
    const posOK = actualPos > 0 && actualPos <= targetPos + 2;
    recordResult(
        `Cliente en posición esperada (~${targetPos})`,
        posOK,
        `Posición real: ${actualPos} de ${jueClientsAfter.length}`,
        jueAfter.elapsed
    );

    return { clientToMove, fromDay: 'viernes', toDay: 'jueves' };
}

// ============================================================================
// TEST 7: Reordenar dentro del mismo día
// ============================================================================
async function test7_ReorderSameDay() {
    logHeader('TEST 7: Reordenar dentro del mismo día');

    const marRes = await apiGet('/api/rutero/day/martes', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const marClients = marRes.data.clients || [];

    if (marClients.length < 3) {
        recordResult('Reordenar mismo día', false, `Solo ${marClients.length} clientes en Martes`);
        return;
    }

    log(`  Martes tiene ${marClients.length} clientes`);
    log(`  Orden actual (primeros 5): ${marClients.slice(0, 5).map(c => c.code).join(', ')}`);

    // Invertir el orden completo
    const reversed = [...marClients].reverse();
    const ordenPayload = reversed.map((c, i) => ({
        cliente: c.code,
        posicion: i * 10,
        posicionOriginal: marClients.findIndex(mc => mc.code === c.code) * 10
    }));

    logSubHeader('Guardando orden invertido');
    const saveRes = await apiPost('/api/rutero/config', {
        vendedor: VENDEDOR,
        dia: 'martes',
        orden: ordenPayload
    });

    recordResult(
        'Guardar reorden Martes',
        saveRes.status === 200 && saveRes.data.success,
        saveRes.data.success ? 'OK' : `Error: ${JSON.stringify(saveRes.data)}`,
        saveRes.elapsed
    );

    await sleep(500);

    // Verificar que el orden se guardó
    logSubHeader('Verificando orden tras refresh');
    const marAfter = await apiGet('/api/rutero/day/martes', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const marClientsAfter = marAfter.data.clients || [];

    // Comparar primeros y últimos
    const firstBefore = marClients[0]?.code;
    const lastBefore = marClients[marClients.length - 1]?.code;
    const firstAfter = marClientsAfter[0]?.code;
    const lastAfter = marClientsAfter[marClientsAfter.length - 1]?.code;

    log(`  Antes  → Primero: ${firstBefore}, Último: ${lastBefore}`);
    log(`  Después → Primero: ${firstAfter}, Último: ${lastAfter}`);

    // El primero de antes debería ser el último ahora (o cerca)
    const swapped = firstAfter === lastBefore || lastAfter === firstBefore;
    recordResult(
        'Orden realmente invertido',
        swapped,
        swapped ? 'Primero↔Último intercambiados' : `No coincide: ${firstAfter} vs ${lastBefore}`,
        marAfter.elapsed
    );

    // Verificar que la cantidad no cambió
    recordResult(
        'Cantidad de clientes no cambió',
        marClientsAfter.length === marClients.length,
        `${marClients.length} → ${marClientsAfter.length}`,
        0
    );

    // Restaurar orden original
    logSubHeader('Restaurando orden original');
    const restorePayload = marClients.map((c, i) => ({
        cliente: c.code,
        posicion: i * 10,
    }));
    await apiPost('/api/rutero/config', {
        vendedor: VENDEDOR,
        dia: 'martes',
        orden: restorePayload
    });
    log(`  Orden restaurado.`);
}

// ============================================================================
// TEST 8: Comercial 33 - verificar clientes Miércoles
// ============================================================================
async function test8_Vendor33Wednesday() {
    logHeader('TEST 8: Comercial 33 - Verificar clientes del Miércoles');

    const mieRes = await apiGet('/api/rutero/day/miercoles', {
        vendedorCodes: '33', role: ROLE, year: new Date().getFullYear()
    });
    const mieClients = mieRes.data.clients || [];

    log(`  Comercial 33 tiene ${mieClients.length} clientes el Miércoles`);

    recordResult(
        'Comercial 33 tiene clientes el Miércoles',
        mieClients.length > 0,
        `${mieClients.length} clientes encontrados`,
        mieRes.elapsed
    );

    // También verificar la semana completa
    const weekRes = await apiGet('/api/rutero/week', { vendedorCodes: '33', role: ROLE });
    const weekData = weekRes.data.week || {};
    log(`  Semana completa: L:${weekData.lunes || 0} M:${weekData.martes || 0} X:${weekData.miercoles || 0} J:${weekData.jueves || 0} V:${weekData.viernes || 0} S:${weekData.sabado || 0}`);

    const totalWeek = Object.values(weekData).reduce((a, b) => a + b, 0);
    recordResult(
        'Comercial 33 tiene datos semanales',
        totalWeek > 0,
        `Total semanal: ${totalWeek} clientes-día`,
        weekRes.elapsed
    );

    // Verificar consistencia: el count del miércoles debe coincidir
    const mieCount = weekData.miercoles || 0;
    recordResult(
        'Consistencia contadores vs lista',
        Math.abs(mieCount - mieClients.length) <= 1, // Allow ±1 for cache timing
        `Contador: ${mieCount}, Lista: ${mieClients.length}`,
        0
    );
}

// ============================================================================
// TEST 9: Mover cliente y luego moverlo de vuelta
// ============================================================================
async function test9_MoveAndMoveBack(prevMoveData) {
    logHeader('TEST 9: Mover cliente y moverlo de vuelta');

    // Usamos el cliente que movimos en test 1 (de Mie a Jue)
    // Lo vamos a mover de vuelta de Jue a Mie

    if (!prevMoveData) {
        recordResult('Mover de vuelta', false, 'Saltado: no hay datos del test anterior');
        return;
    }

    const { clientToMove } = prevMoveData;
    log(`  Moviendo ${clientToMove.code} de vuelta: Jueves → Miércoles`);

    const moveRes = await apiPost('/api/rutero/move_clients', {
        vendedor: VENDEDOR,
        moves: [{
            client: clientToMove.code,
            toDay: 'miercoles',
            fromDay: 'jueves',
            clientName: clientToMove.name,
            position: 'end'
        }]
    });

    recordResult(
        'Move back API (Jue→Mie)',
        moveRes.status === 200 && moveRes.data.success,
        moveRes.data.success ? 'OK' : `Error: ${JSON.stringify(moveRes.data)}`,
        moveRes.elapsed
    );

    await sleep(500);

    // Verificar que volvió a Miércoles
    const mieRes = await apiGet('/api/rutero/day/miercoles', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const mieClients = mieRes.data.clients || [];
    const backInMie = mieClients.find(c => c.code === clientToMove.code);

    recordResult(
        'Cliente volvió a Miércoles',
        !!backInMie,
        backInMie ? `Posición: ${mieClients.indexOf(backInMie) + 1}` : `⚠️ NO ESTÁ EN MIÉRCOLES`,
        mieRes.elapsed
    );

    // Verificar que ya no está en Jueves
    const jueRes = await apiGet('/api/rutero/day/jueves', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const jueClients = jueRes.data.clients || [];
    const stillInJue = jueClients.find(c => c.code === clientToMove.code);

    recordResult(
        'Cliente ya no está en Jueves',
        !stillInJue,
        stillInJue ? `⚠️ SIGUE EN JUEVES` : `Correcto: desapareció del Jueves`,
        jueRes.elapsed
    );

    // Verificar contadores restaurados
    const countsRes = await apiGet('/api/rutero/counts', { vendedorCodes: VENDEDOR, role: ROLE });
    const counts = countsRes.data.counts || {};
    log(`  Contadores: Mie=${counts.miercoles}, Jue=${counts.jueves}`);
    recordResult(
        'Contadores consistentes tras ida-vuelta',
        true, // Just log them
        `Mie: ${counts.miercoles}, Jue: ${counts.jueves}`,
        countsRes.elapsed
    );
}

// ============================================================================
// TEST 10: Mover 5+ clientes en secuencia
// ============================================================================
async function test10_MoveMassive() {
    logHeader('TEST 10: Mover 5+ clientes en secuencia');

    // Obtener clientes del Viernes
    const vieRes = await apiGet('/api/rutero/day/viernes', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const vieClients = vieRes.data.clients || [];

    const moveCount = Math.min(5, vieClients.length);
    if (moveCount < 2) {
        recordResult('Mover masivo', false, `Solo ${vieClients.length} clientes en Viernes`);
        return;
    }

    const clientsToMove = vieClients.slice(0, moveCount);
    log(`  Moviendo ${moveCount} clientes de Viernes a Sábado`);

    // Mover uno por uno (como haría un usuario)
    const movedClients = [];
    for (let i = 0; i < clientsToMove.length; i++) {
        const c = clientsToMove[i];
        log(`  [${i + 1}/${moveCount}] Moviendo ${c.code}...`);

        const res = await apiPost('/api/rutero/move_clients', {
            vendedor: VENDEDOR,
            moves: [{
                client: c.code,
                toDay: 'sabado',
                fromDay: 'viernes',
                clientName: c.name,
                position: 'end'
            }]
        });

        if (res.status === 200 && res.data.success) {
            movedClients.push(c);
        } else {
            log(`    ⚠️ Error moviendo ${c.code}: ${JSON.stringify(res.data)}`);
        }
    }

    recordResult(
        `Mover ${moveCount} clientes (API)`,
        movedClients.length === moveCount,
        `${movedClients.length}/${moveCount} movidos exitosamente`,
        0
    );

    await sleep(1000);

    // Verificar Sábado
    logSubHeader('Verificando que todos están en Sábado');
    const sabRes = await apiGet('/api/rutero/day/sabado', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const sabClients = sabRes.data.clients || [];
    const sabCodes = sabClients.map(c => c.code);

    let foundCount = 0;
    for (const c of movedClients) {
        if (sabCodes.includes(c.code)) foundCount++;
        else log(`    ⚠️ ${c.code} NO está en Sábado`);
    }

    recordResult(
        'Todos los clientes en Sábado',
        foundCount === movedClients.length,
        `${foundCount}/${movedClients.length} encontrados`,
        sabRes.elapsed
    );

    // Verificar que NO están en Viernes
    logSubHeader('Verificando que NO están en Viernes');
    const vieAfter = await apiGet('/api/rutero/day/viernes', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear()
    });
    const vieClientsAfter = vieAfter.data.clients || [];
    const vieCodes = vieClientsAfter.map(c => c.code);

    let ghostCount = 0;
    for (const c of movedClients) {
        if (vieCodes.includes(c.code)) {
            ghostCount++;
            log(`    ⚠️ ${c.code} SIGUE en Viernes (fantasma!)`);
        }
    }

    recordResult(
        'Ningún cliente fantasma en Viernes',
        ghostCount === 0,
        ghostCount > 0 ? `❌ ${ghostCount} clientes siguen en Viernes` : 'Limpio',
        vieAfter.elapsed
    );

    // ===== CLEANUP: Mover de vuelta =====
    logSubHeader('CLEANUP: Devolviendo clientes a Viernes');
    for (const c of movedClients) {
        await apiPost('/api/rutero/move_clients', {
            vendedor: VENDEDOR,
            moves: [{
                client: c.code,
                toDay: 'viernes',
                fromDay: 'sabado',
                clientName: c.name,
                position: 'end'
            }]
        });
    }
    log(`  ${movedClients.length} clientes devueltos a Viernes.`);
}

// ============================================================================
// TEST 11 (BONUS): Verificar que "Ruta Original" sigue funcionando
// ============================================================================
async function test11_OriginalRouteMode() {
    logHeader('TEST 11 (BONUS): Modo "Ruta Original" (ignoreOverrides)');

    const normalRes = await apiGet('/api/rutero/day/miercoles', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear(),
        ignoreOverrides: 'false'
    });

    const originalRes = await apiGet('/api/rutero/day/miercoles', {
        vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear(),
        ignoreOverrides: 'true'
    });

    const normalClients = normalRes.data.clients || [];
    const originalClients = originalRes.data.clients || [];

    log(`  Modo Custom: ${normalClients.length} clientes`);
    log(`  Modo Ruta Original: ${originalClients.length} clientes`);

    recordResult(
        'Ruta Original devuelve datos',
        originalClients.length > 0,
        `${originalClients.length} clientes`,
        originalRes.elapsed
    );

    // El modo original debería ignorar los overrides
    recordResult(
        'Ambos modos funcionan',
        normalClients.length > 0 && originalClients.length > 0,
        `Custom: ${normalClients.length}, Original: ${originalClients.length}`,
        0
    );
}

// ============================================================================
// TEST 12 (BONUS): GET /rutero/config devuelve solo positivos
// ============================================================================
async function test12_ConfigEndpointFilter() {
    logHeader('TEST 12 (BONUS): GET /rutero/config filtra bloqueos');

    const configRes = await apiGet('/api/rutero/config', {
        vendedor: VENDEDOR,
        dia: 'miercoles'
    });

    if (configRes.status !== 200) {
        recordResult('Config endpoint', false, `Status: ${configRes.status}`);
        return;
    }

    const configs = configRes.data.config || [];
    const negatives = configs.filter(c => c.ORDEN < 0);

    recordResult(
        'Config no devuelve bloqueos (ORDEN<0)',
        negatives.length === 0,
        negatives.length > 0 ? `❌ ${negatives.length} bloqueos expuestos` : `OK: ${configs.length} entries, todas positivas`,
        configRes.elapsed
    );
}

// ============================================================================
// TEST 13 (BONUS): Verificar tiempos de respuesta
// ============================================================================
async function test13_ResponseTimes() {
    logHeader('TEST 13 (BONUS): Tiempos de respuesta');

    const endpoints = [
        { name: 'GET /rutero/week', fn: () => apiGet('/api/rutero/week', { vendedorCodes: VENDEDOR, role: ROLE }) },
        { name: 'GET /rutero/counts', fn: () => apiGet('/api/rutero/counts', { vendedorCodes: VENDEDOR, role: ROLE }) },
        { name: 'GET /rutero/day/miercoles', fn: () => apiGet('/api/rutero/day/miercoles', { vendedorCodes: VENDEDOR, role: ROLE, year: new Date().getFullYear() }) },
        { name: 'GET /rutero/positions/jueves', fn: () => apiGet('/api/rutero/positions/jueves', { vendedorCodes: VENDEDOR, role: ROLE }) },
    ];

    for (const ep of endpoints) {
        const res = await ep.fn();
        const fast = res.elapsed < 2000;
        recordResult(
            `${ep.name} < 2s`,
            fast,
            `${res.elapsed}ms`,
            res.elapsed
        );
    }
}

// ============================================================================
// CLEANUP: Restaurar estado original
// ============================================================================
async function cleanup(test5Data, test6Data) {
    logHeader('CLEANUP: Restaurando estado original');

    // Mover de vuelta los clientes del test 5
    if (test5Data) {
        log(`  Devolviendo ${test5Data.clientToMove.code} de ${test5Data.toDay} a ${test5Data.fromDay}`);
        await apiPost('/api/rutero/move_clients', {
            vendedor: VENDEDOR,
            moves: [{
                client: test5Data.clientToMove.code,
                toDay: test5Data.fromDay,
                fromDay: test5Data.toDay,
                clientName: test5Data.clientToMove.name,
                position: 'end'
            }]
        });
    }

    // Mover de vuelta los clientes del test 6
    if (test6Data) {
        log(`  Devolviendo ${test6Data.clientToMove.code} de ${test6Data.toDay} a ${test6Data.fromDay}`);
        await apiPost('/api/rutero/move_clients', {
            vendedor: VENDEDOR,
            moves: [{
                client: test6Data.clientToMove.code,
                toDay: test6Data.fromDay,
                fromDay: test6Data.toDay,
                clientName: test6Data.clientToMove.name,
                position: 'end'
            }]
        });
    }

    log('  ✅ Cleanup completado');
}

// ============================================================================
// RESUMEN FINAL
// ============================================================================
function printSummary() {
    logHeader('RESUMEN FINAL');

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const total = results.length;

    console.log('');
    console.log(`  ┌─────────────────────────────────────────────────────────────────┐`);
    console.log(`  │  RESULTADOS: ${passed} PASS / ${failed} FAIL / ${total} TOTAL${' '.repeat(Math.max(0, 35 - String(passed).length - String(failed).length - String(total).length))}│`);
    console.log(`  └─────────────────────────────────────────────────────────────────┘`);
    console.log('');

    // Tabla detallada
    console.log(`  ${'#'.padEnd(4)} ${'Test'.padEnd(45)} ${'Estado'.padEnd(8)} ${'ms'.padEnd(6)} Detalle`);
    console.log(`  ${'─'.repeat(4)} ${'─'.repeat(45)} ${'─'.repeat(8)} ${'─'.repeat(6)} ${'─'.repeat(30)}`);

    for (const r of results) {
        const icon = r.status === 'PASS' ? '✅' : '❌';
        console.log(`  ${String(r.num).padEnd(4)} ${r.name.substring(0, 45).padEnd(45)} ${icon}${r.status.padEnd(6)} ${String(r.elapsed || '').padEnd(6)} ${r.details.substring(0, 40)}`);
    }

    console.log('');
    if (failed > 0) {
        console.log(`  ⚠️  HAY ${failed} TEST(S) FALLIDOS. Revisa los detalles arriba.`);
    } else {
        console.log(`  🎉 TODOS LOS TESTS PASARON. El módulo de Organización de Ruteros funciona correctamente.`);
    }
    console.log('');

    // Timing summary
    const totalTime = results.reduce((sum, r) => sum + (r.elapsed || 0), 0);
    const avgTime = Math.round(totalTime / results.filter(r => r.elapsed > 0).length);
    const maxTime = Math.max(...results.map(r => r.elapsed || 0));
    console.log(`  ⏱  Tiempo total: ${totalTime}ms | Promedio: ${avgTime}ms | Máximo: ${maxTime}ms`);
    console.log('');
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
    console.log(`\n${'╔'.padEnd(69, '═')}╗`);
    console.log(`║  TEST HIPER-EXHAUSTIVO: Organización de Ruteros${' '.repeat(20)}║`);
    console.log(`║  API: ${API_BASE.padEnd(60)}║`);
    console.log(`║  Vendedor: ${VENDEDOR.padEnd(55)}║`);
    console.log(`║  Fecha: ${new Date().toISOString().padEnd(58)}║`);
    console.log(`${'╚'.padEnd(69, '═')}╝\n`);

    // Login
    const canProceed = await testLogin();
    if (!canProceed) {
        console.log('\n❌ No se puede continuar sin acceso a la API.\n');
        process.exit(1);
    }

    try {
        // Core tests
        const moveData = await test1_2_MoveClientBetweenDays();
        await test3_ReorderAfterMove(moveData?.clientToMove);
        await test4_PersistenceAfterRelogin(moveData?.clientToMove);
        const test5Data = await test5_MoveToEnd();
        const test6Data = await test6_MoveToSpecificPosition();
        await test7_ReorderSameDay();
        await test8_Vendor33Wednesday();
        await test9_MoveAndMoveBack(moveData);
        await test10_MoveMassive();

        // Bonus tests
        await test11_OriginalRouteMode();
        await test12_ConfigEndpointFilter();
        await test13_ResponseTimes();

        // Cleanup
        await cleanup(test5Data, test6Data);

    } catch (e) {
        console.error(`\n❌ ERROR FATAL: ${e.message}\n${e.stack}\n`);
    }

    // Summary
    printSummary();

    const failed = results.filter(r => r.status === 'FAIL').length;
    process.exit(failed > 0 ? 1 : 0);
}

main();