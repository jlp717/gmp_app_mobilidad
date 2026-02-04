const http = require('http');

const API_BASE = 'http://192.168.1.230:3000/api';
// Using GOYO credentials as requested
const TEST_USER = 'GOYO';
const TEST_PASSWORD = '9584';

// ANSI Colors
const C = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    gray: "\x1b[90m",
};

// State
let AUTH_TOKEN = null;
let REPARTIDOR_ID = null; // Will be extracted from login or set manually
let TARGET_ALBARAN = null;

// Helpers
function log(msg, color = C.white) {
    console.log(`${color}${msg}${C.reset}`);
}

function request(method, path, body = null, token = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(API_BASE + path);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            }
        };

        if (token) {
            options.headers['Authorization'] = `Bearer ${token}`; // Authorization: Bearer ...
        }

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    parsed = data;
                }
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: parsed
                });
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function runTests() {
    log('═══════════════════════════════════════════════════════════', C.cyan);
    log('        RUTERO DELIVERY ENDPOINTS TEST SUITE (SCANNER)', C.cyan);
    log('═══════════════════════════════════════════════════════════', C.cyan);
    log(`Server: ${API_BASE}`, C.gray);
    log(`Time: ${new Date().toISOString()}\n`, C.gray);

    try {
        // =================================================================
        // 1. LOGIN
        // =================================================================
        log('🔐 TEST 1: Login as GOYO...', C.yellow);
        const loginRes = await request('POST', '/auth/login', {
            username: TEST_USER,
            password: TEST_PASSWORD
        });

        if (loginRes.status === 200 && loginRes.body.token) {
            AUTH_TOKEN = loginRes.body.token;
            // GOYO is 15
            REPARTIDOR_ID = loginRes.body.user.code;
            log(`   ✅ Login successful! Code: ${REPARTIDOR_ID}, Role: ${loginRes.body.role}`, C.green);
            log(`   🔑 Token: ${AUTH_TOKEN.substring(0, 20)}...`, C.gray);
        } else {
            log(`   ❌ Login failed: ${JSON.stringify(loginRes.body)}`, C.red);
            process.exit(1);
        }

        // =================================================================
        // 2. GET PENDING DELIVERIES (Smart Search)
        // =================================================================
        let targetRepartidores = [REPARTIDOR_ID];

        // If Director, use the list we fetched (or fetch it now if we don't have it)
        if (loginRes.body.role === 'JEFE_VENTAS' || loginRes.body.isJefeVentas) {
            log('   👑 User is Director. scanning for a repartidor with pending work...', C.blue);
            const repsRes = await request('GET', '/auth/repartidores', null, AUTH_TOKEN);
            if (repsRes.status === 200 && repsRes.body.length > 0) {
                // Map the list to IDs
                targetRepartidores = repsRes.body.map(r => r.code);
                log(`   📋 Scanning ${targetRepartidores.length} repartidores...`, C.gray);
            }
        }

        let foundData = false;

        for (const repId of targetRepartidores) {
            process.stdout.write(`   � Checking Repartidor ${repId}... `);
            const pendingRes = await request('GET', `/entregas/pendientes/${repId}`, null, AUTH_TOKEN);

            if (pendingRes.status === 200) {
                const albaranes = pendingRes.body.albaranes || [];
                if (albaranes.length > 0) {
                    console.log(`${C.green}FOUND!${C.reset}`);
                    REPARTIDOR_ID = repId;
                    log(`   ✅ Success. Total albaranes: ${albaranes.length}`, C.green);
                    log(`   📊 KPI Resumen: `, C.cyan);
                    log(`      - Completed: ${pendingRes.body.resumen?.completedCount}`, C.cyan);
                    log(`      - A Cobrar: ${pendingRes.body.resumen?.totalACobrar}€`, C.cyan);

                    TARGET_ALBARAN = albaranes.find(a => (!a.estado || a.estado === 'PENDIENTE'));
                    if (!TARGET_ALBARAN) {
                        TARGET_ALBARAN = albaranes[0];
                        log('   ⚠️ No PENDING deliveries found. Picking first available.', C.yellow);
                    }

                    log(`   🎯 Target Albaran: ${TARGET_ALBARAN.numeroAlbaran} (ID: ${TARGET_ALBARAN.id})`, C.magenta);
                    log(`   � Inspector: ${TARGET_ALBARAN.codigoRepartidor || 'N/A'}`, C.gray);
                    foundData = true;
                    break; // Stop looking
                } else {
                    console.log(`${C.gray}Empty${C.reset}`);
                }
            } else {
                console.log(`${C.red}Error${C.reset}`);
            }
        }

        if (!foundData) {
            log('\n   ⚠️ No pending deliveries found for ANY scanned repartidor.', C.red);
            log('   ⚠️ Cannot proceed with update tests. Please assign deliveries in ERP.', C.yellow);
            process.exit(0);
        }

        // =================================================================
        // 3. CONFIRM DELIVERY
        // =================================================================
        log(`\n🚚 TEST 3: Confirm delivery for Repartidor ${REPARTIDOR_ID}...`, C.yellow);

        const payload = {
            albaranId: TARGET_ALBARAN.id,
            latitud: 40.416775,
            longitud: -3.703790,
            firma: 'base64_signature_mock',
            observaciones: 'Test automatico scanner',
            fotos: []
        };

        const updateRes = await request('POST', '/entregas/update', payload, AUTH_TOKEN);

        if (updateRes.status === 200 && updateRes.body.success) {
            log('   ✅ Delivery confirmed successfully!', C.green);
        } else if (updateRes.status === 409) {
            log('   ⚠️ Delivery was ALREADY confirmed (Expected if we picked a delivered one).', C.yellow);
        } else {
            log(`   ❌ Failed to confirm: ${updateRes.status}`, C.red);
            log(JSON.stringify(updateRes.body), C.gray);
        }

        // =================================================================
        // 4. VERIFY DUPLICATE PREVENTION
        // =================================================================
        log('\n🔄 TEST 4: Attempt DUPLICATE confirmation...', C.yellow);
        const dupRes = await request('POST', '/entregas/update', payload, AUTH_TOKEN);

        if (dupRes.status === 409) {
            log('   ✅ PASSED! Server returned 409 Conflict.', C.green);
            if (dupRes.body.alreadyDelivered) {
                log('   ✅ "alreadyDelivered" flag is present.', C.green);
            } else {
                log('   ⚠️ "alreadyDelivered" flag missing in body.', C.yellow);
            }
        } else {
            log(`   ❌ FAILED! Expected 409, got ${dupRes.status}`, C.red);
            log(JSON.stringify(dupRes.body), C.gray);
        }

        // =================================================================
        // 5. VERIFY KPIs & TAGS
        // =================================================================
        log('\n📈 TEST 5: Verify KPIs & Tags updated...', C.yellow);
        const kpiRes = await request('GET', `/entregas/pendientes/${REPARTIDOR_ID}`, null, AUTH_TOKEN);

        if (kpiRes.status === 200) {
            const updatedList = kpiRes.body.albaranes || [];
            const myAlb = updatedList.find(a => a.id === TARGET_ALBARAN.id);

            if (myAlb) {
                log(`   🏷️ New Status: ${myAlb.estado}`, myAlb.estado === 'ENTREGADO' || myAlb.estado === 'Entregado' ? C.green : C.yellow);
                log(`   🏷️ Tags: ${JSON.stringify(myAlb.tags || [])}`, C.gray);

                const newCompleted = kpiRes.body.resumen?.completedCount;
                log(`   📊 KPI Completed Count: ${newCompleted}`, newCompleted > 0 ? C.green : C.red);
            } else {
                log('   ⚠️ Albaran disappeared from list.', C.yellow);
            }
        }

    } catch (e) {
        log(`\n❌ CRITICAL ERROR: ${e.message}`, C.red);
    }
}

runTests();
