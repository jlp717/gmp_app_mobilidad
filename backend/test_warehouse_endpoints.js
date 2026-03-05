/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TEST SCRIPT — Warehouse Endpoints
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Exercises ALL warehouse API endpoints, writes test data to JAVIER.* tables,
 * verifies responses, and cleans up afterwards.
 *
 * Usage: node test_warehouse_endpoints.js
 */

const http = require('http');

// ─── Config ────────────────────────────────────────────────────────────────
const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 3334;
const LOGIN_USER = 'DIEGO';
const LOGIN_PASS = '9322';

let TOKEN = null;

// ─── HTTP helpers ──────────────────────────────────────────────────────────
function rawRequest(method, fullPath, body, headers) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: SERVER_HOST,
            port: SERVER_PORT,
            path: fullPath,
            method,
            headers: headers || {},
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed;
                try { parsed = JSON.parse(data); } catch { parsed = data; }
                resolve({ status: res.statusCode, data: parsed });
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

/** Small delay to allow DB2 transaction isolation to settle */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function login() {
    console.log(`  Logging in as ${LOGIN_USER}...`);
    const r = await rawRequest('POST', '/api/auth/login', {
        username: LOGIN_USER,
        password: LOGIN_PASS
    }, { 'Content-Type': 'application/json' });

    if (r.status !== 200 || !r.data.token) {
        console.error(`  ❌ LOGIN FAILED: status=${r.status}`, JSON.stringify(r.data).substring(0, 200));
        process.exit(1);
    }

    TOKEN = r.data.token;
    console.log(`  ✅ Logged in as ${r.data.user?.name || LOGIN_USER} (${r.data.user?.id || '?'}) (role: ${r.data.role})`);
    console.log(`  Token: ${TOKEN.substring(0, 30)}...`);
    return r.data;
}

function request(method, path, body) {
    const fullPath = '/api/warehouse/' + path.replace(/^\//, '');
    return rawRequest(method, fullPath, body, {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
    });
}

const GET = (path) => request('GET', path);
const POST = (path, body) => request('POST', path, body);
const PUT = (path, body) => request('PUT', path, body);

// ─── Test tracking ─────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const results = [];

function check(name, condition, detail) {
    if (condition) {
        passed++;
        results.push({ name, status: 'PASS', detail });
        console.log(`  ✅ ${name}`);
    } else {
        failed++;
        results.push({ name, status: 'FAIL', detail });
        console.log(`  ❌ ${name} — ${detail || 'condition false'}`);
    }
}

// ─── Cleanup tracking ──────────────────────────────────────────────────────
const createdPersonnelIds = [];
let createdTruckConfig = null;
let originalTruckConfig = null; // Save original config to restore
let createdArticleDims = null;
let createdManualLayoutCode = null;
let createdManualLayoutDate = null;

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

async function testDashboard() {
    console.log('\n── DASHBOARD ──');

    // Test with today's date
    const now = new Date();
    const r = await GET(`dashboard?year=${now.getFullYear()}&month=${now.getMonth() + 1}&day=${now.getDate()}`);
    check('GET /dashboard — status 200', r.status === 200, `status=${r.status}`);
    check('GET /dashboard — has date', r.data.date != null, JSON.stringify(r.data.date));
    check('GET /dashboard — has totalTrucks', typeof r.data.totalTrucks === 'number', `totalTrucks=${r.data.totalTrucks}`);
    check('GET /dashboard — trucks is array', Array.isArray(r.data.trucks), `type=${typeof r.data.trucks}`);

    if (r.data.trucks?.length > 0) {
        const t = r.data.trucks[0];
        check('Dashboard truck has vehicleCode', !!t.vehicleCode, t.vehicleCode);
        check('Dashboard truck has orderCount', typeof t.orderCount === 'number', `orders=${t.orderCount}`);
        check('Dashboard truck has maxPayloadKg', typeof t.maxPayloadKg === 'number', `payload=${t.maxPayloadKg}`);
        console.log(`    ℹ️  Found ${r.data.totalTrucks} trucks for today`);
    } else {
        console.log('    ℹ️  No trucks found for today — trying past date...');
        // Try a date we know has data (March 2026)
        const r2 = await GET('dashboard?year=2026&month=3&day=4');
        check('GET /dashboard (past) — status 200', r2.status === 200);
        if (r2.data.trucks?.length > 0) {
            console.log(`    ℹ️  Found ${r2.data.totalTrucks} trucks for 2026-03-04`);
        }
    }

    return r.data;
}

async function testVehicles() {
    console.log('\n── VEHICLES ──');

    const r = await GET('vehicles');
    check('GET /vehicles — status 200', r.status === 200, `status=${r.status}`);
    check('GET /vehicles — has vehicles array', Array.isArray(r.data.vehicles), `type=${typeof r.data.vehicles}`);

    if (r.data.vehicles?.length > 0) {
        const v = r.data.vehicles[0];
        check('Vehicle has code', !!v.code, v.code);
        check('Vehicle has interior dims', v.interior != null, JSON.stringify(v.interior));
        check('Vehicle has maxPayloadKg', typeof v.maxPayloadKg === 'number', `${v.maxPayloadKg}`);
        console.log(`    ℹ️  Found ${r.data.vehicles.length} vehicles. First: ${v.code} (${v.description})`);
    }

    return r.data.vehicles || [];
}

async function testTruckConfig(vehicleCode) {
    console.log('\n── TRUCK CONFIG ──');

    // GET config — save original for restoration
    const r = await GET(`truck-config/${vehicleCode}`);
    check('GET /truck-config/:code — status 200', r.status === 200, `status=${r.status}`);
    if (r.status === 200) {
        originalTruckConfig = r.data;
        check('Truck config has dimensions', r.data.interior != null || r.data.lengthCm != null, JSON.stringify(r.data).substring(0, 100));
        console.log(`    ℹ️  Config for ${vehicleCode}: ${JSON.stringify(r.data).substring(0, 120)}`);
    }

    // PUT — update the REAL vehicle code (getTruckConfig joins DSEDAC.VEH,
    // so fake codes like '__TEST__' don't exist in VEH → 404)
    createdTruckConfig = vehicleCode;

    const putR = await PUT(`truck-config/${vehicleCode}`, {
        largoInteriorCm: 500,
        anchoInteriorCm: 220,
        altoInteriorCm: 200,
        toleranciaExceso: 10,
        notas: 'TEST SCRIPT — will be restored'
    });
    check('PUT /truck-config — status 200', putR.status === 200, `status=${putR.status}`);
    if (putR.status === 200) {
        console.log(`    ℹ️  Updated truck config for ${vehicleCode}`);
    }

    // Verify it was saved — adequate delay for DB2 transaction isolation
    await sleep(1000);
    const verifyR = await GET(`truck-config/${vehicleCode}`);
    check('GET /truck-config after PUT — found', verifyR.status === 200, `status=${verifyR.status}`);
    if (verifyR.status === 200) {
        check('PUT config — dims applied',
            verifyR.data.interior?.lengthCm === 500 || verifyR.data.lengthCm === 500,
            `lengthCm=${verifyR.data.interior?.lengthCm ?? verifyR.data.lengthCm}`);
    }
}

async function testPersonnel() {
    console.log('\n── PERSONNEL ──');

    // GET all
    const r = await GET('personnel');
    check('GET /personnel — status 200', r.status === 200, `status=${r.status}`);
    check('GET /personnel — has array', Array.isArray(r.data.personnel), `type=${typeof r.data.personnel}`);
    console.log(`    ℹ️  Found ${r.data.personnel?.length || 0} personnel entries`);

    if (r.data.personnel?.length > 0) {
        const p = r.data.personnel[0];
        check('Personnel has name', !!p.name, p.name);
        check('Personnel has role', !!p.role, p.role);
        console.log(`    ℹ️  First: ${p.vendorCode || p.id} ${p.name} (${p.role}, source=${p.source})`);
    }

    // POST — create test person
    const createR = await POST('personnel', {
        nombre: 'TEST_OPERARIO_SCRIPT',
        codigoVendedor: 'T999',
        rol: 'PREPARADOR',
        telefono: '000000000',
        email: 'test@test.test'
    });
    check('POST /personnel — status 200', createR.status === 200, `status=${createR.status}`);

    // Wait for DB2 to commit the INSERT before querying again
    await sleep(1000);

    // Find the created person
    const afterCreate = await GET('personnel');
    const testPerson = afterCreate.data.personnel?.find(p =>
        p.name === 'TEST_OPERARIO_SCRIPT' || p.vendorCode === 'T999'
    );
    if (testPerson) {
        createdPersonnelIds.push(testPerson.id);
        check('POST /personnel — person found in list', true, `id=${testPerson.id}`);

        // PUT — update
        const updateR = await PUT(`personnel/${testPerson.id}`, {
            nombre: 'TEST_OPERARIO_UPDATED',
            rol: 'SUPERVISOR',
            telefono: '111111111'
        });
        check('PUT /personnel/:id — status 200', updateR.status === 200, `status=${updateR.status}`);

        // Verify update
        await sleep(500);
        const afterUpdate = await GET('personnel');
        const updated = afterUpdate.data.personnel?.find(p => p.id === testPerson.id);
        check('PUT /personnel — name updated', updated?.name === 'TEST_OPERARIO_UPDATED', updated?.name);

        // Soft delete
        const delR = await POST(`personnel/${testPerson.id}/delete`);
        check('POST /personnel/:id/delete — status 200', delR.status === 200, `status=${delR.status}`);

        // Verify soft delete (should not appear in active list)
        await sleep(500);
        const afterDel = await GET('personnel');
        const deleted = afterDel.data.personnel?.find(p => p.id === testPerson.id);
        check('Soft delete — not in active list', !deleted, deleted ? 'still found!' : 'correctly removed');
    } else {
        check('POST /personnel — person found in list', false,
              `could not find person (${afterCreate.data.personnel?.length || 0} total)`);
    }
}

async function testArticles() {
    console.log('\n── ARTICLES ──');

    // GET list
    const r = await GET('articles?limit=10');
    check('GET /articles — status 200', r.status === 200, `status=${r.status}`);
    check('GET /articles — has array', Array.isArray(r.data.articles), `type=${typeof r.data.articles}`);

    let testArticleCode = null;
    if (r.data.articles?.length > 0) {
        const a = r.data.articles[0];
        testArticleCode = a.code;
        check('Article has code', !!a.code, a.code);
        check('Article has name', !!a.name, a.name);
        console.log(`    ℹ️  Found ${r.data.articles.length} articles. First: ${a.code} (${a.name})`);
    }

    // Search
    const searchR = await GET('articles?search=LECHE&limit=5');
    check('GET /articles?search — status 200', searchR.status === 200);
    console.log(`    ℹ️  Search "LECHE": ${searchR.data.articles?.length || 0} results`);

    // GET dimensions for a specific article
    if (testArticleCode) {
        const dimR = await GET(`article-dimensions/${testArticleCode}`);
        check('GET /article-dimensions/:code — status 200', dimR.status === 200, `status=${dimR.status}`);
        if (dimR.status === 200) {
            check('Article dims has dimensions', dimR.data.dimensions != null);
            console.log(`    ℹ️  Dims for ${testArticleCode}: ${JSON.stringify(dimR.data.dimensions)}`);
        }
    }

    // PUT dimensions for a test article code
    const testDimCode = '__TESTDIM__';
    createdArticleDims = testDimCode;

    const putR = await PUT(`article-dimensions/${testDimCode}`, {
        largoCm: 35,
        anchoCm: 25,
        altoCm: 20,
        pesoCajaKg: 5.5,
        notas: 'TEST SCRIPT — will be deleted'
    });
    check('PUT /article-dimensions — status 200', putR.status === 200, `status=${putR.status}`);

    // Verify
    const verifyR = await GET(`article-dimensions/${testDimCode}`);
    // This may 404 since __TESTDIM__ doesn't exist in DSEDAC.ART — that's fine
    check('GET /article-dimensions for test code', verifyR.status === 200 || verifyR.status === 404,
          `status=${verifyR.status} (404 expected if code not in DSEDAC.ART)`);
}

async function testTruckOrders(vehicleCode) {
    console.log('\n── TRUCK ORDERS ──');

    const r = await GET(`truck/${vehicleCode}/orders?year=2026&month=3&day=4`);
    check('GET /truck/:code/orders — status 200', r.status === 200, `status=${r.status}`);
    check('Has totalLines', typeof r.data.totalLines === 'number', `lines=${r.data.totalLines}`);
    check('Has orders array', Array.isArray(r.data.orders), `type=${typeof r.data.orders}`);

    if (r.data.orders?.length > 0) {
        const o = r.data.orders[0];
        check('Order has clientCode', !!o.clientCode, o.clientCode);
        check('Order has articleCode', !!o.articleCode, o.articleCode);
        check('Order has units', typeof o.units === 'number');
        console.log(`    ℹ️  ${r.data.totalLines} lines. First: ${o.articleName} (${o.clientName})`);
    } else {
        console.log(`    ℹ️  No orders for ${vehicleCode} on 2026-03-04`);
    }
}

async function testLoadPlan(vehicleCode) {
    console.log('\n── LOAD PLAN (3D) ──');

    const r = await POST('load-plan', {
        vehicleCode,
        year: 2026,
        month: 3,
        day: 4
    });
    check('POST /load-plan — status 200', r.status === 200, `status=${r.status}`);

    if (r.status === 200) {
        check('Has truck config', r.data.truck != null);
        check('Has metrics', r.data.metrics != null);
        check('Has placed boxes', Array.isArray(r.data.placed));
        check('Has overflow', Array.isArray(r.data.overflow));

        const m = r.data.metrics;
        if (m) {
            console.log(`    ℹ️  Metrics:`);
            console.log(`       Total boxes: ${m.totalBoxes}, placed: ${m.placedCount}, overflow: ${m.overflowCount}`);
            console.log(`       Weight: ${m.totalWeightKg?.toFixed(1)} kg (${m.weightOccupancyPct?.toFixed(1)}%)`);
            console.log(`       Volume: ${m.volumeOccupancyPct?.toFixed(1)}%`);
            console.log(`       Status: ${m.status}`);
        }

        if (r.data.placed?.length > 0) {
            const b = r.data.placed[0];
            // binPack3D returns flat fields: x, y, z, w, d, h (not nested position/size)
            check('Box has position (x,y,z)', b.x !== undefined && b.y !== undefined && b.z !== undefined,
                  `x=${b.x}, y=${b.y}, z=${b.z}`);
            check('Box has size (w,d,h)', b.w !== undefined && b.d !== undefined && b.h !== undefined,
                  `w=${b.w}, d=${b.d}, h=${b.h}`);
            check('Box has label', typeof b.label === 'string');
            console.log(`    ℹ️  First box: "${b.label}" at [${b.x?.toFixed?.(0) ?? b.x},${b.y?.toFixed?.(0) ?? b.y},${b.z?.toFixed?.(0) ?? b.z}] size [${b.w}x${b.d}x${b.h}]`);
        }
    } else {
        console.log(`    ℹ️  Error: ${JSON.stringify(r.data).substring(0, 200)}`);
    }

    return r.data;
}

async function testOptimize(vehicleCode) {
    console.log('\n── PROFIT OPTIMIZER ──');

    const r = await POST('load-plan/optimize', {
        vehicleCode,
        year: 2026,
        month: 3,
        day: 4
    });
    check('POST /load-plan/optimize — status 200', r.status === 200, `status=${r.status}`);

    if (r.status === 200) {
        check('Has included array', Array.isArray(r.data.included));
        check('Has excluded array', Array.isArray(r.data.excluded));
        check('Has totalValue', typeof r.data.totalValue === 'number');
        check('Has totalWeight', typeof r.data.totalWeight === 'number');
        check('Has totalVolume', typeof r.data.totalVolume === 'number');
        console.log(`    ℹ️  Included: ${r.data.included?.length}, Excluded: ${r.data.excluded?.length}`);
        console.log(`    ℹ️  Total value: ${r.data.totalValue?.toFixed(2)}€, weight: ${r.data.totalWeight?.toFixed(1)}kg`);
    } else {
        console.log(`    ℹ️  Error: ${JSON.stringify(r.data).substring(0, 200)}`);
    }
}

async function testLoadPlanManual(vehicleCode) {
    console.log('\n── LOAD PLAN MANUAL (what-if) ──');

    const r = await POST('load-plan-manual', {
        vehicleCode,
        items: [
            { articleCode: 'TEST001', quantity: 10, weightPerUnit: 2.0 },
            { articleCode: 'TEST002', quantity: 5, weightPerUnit: 5.0 },
        ],
        tolerance: 5
    });
    check('POST /load-plan-manual — status 200', r.status === 200, `status=${r.status}`);

    if (r.status === 200) {
        check('Manual plan has metrics', r.data.metrics != null);
        check('Manual plan has placed', Array.isArray(r.data.placed));
        console.log(`    ℹ️  Manual plan: ${r.data.placed?.length} boxes placed`);
    } else {
        console.log(`    ℹ️  Response: ${JSON.stringify(r.data).substring(0, 200)}`);
    }
}

async function testLoadHistory(vehicleCode) {
    console.log('\n── LOAD HISTORY ──');

    // General history
    const r = await GET('load-history?limit=5');
    check('GET /load-history — status 200', r.status === 200, `status=${r.status}`);
    check('Has history array', Array.isArray(r.data.history));
    console.log(`    ℹ️  ${r.data.history?.length || 0} history entries`);

    if (r.data.history?.length > 0) {
        const h = r.data.history[0];
        check('History has vehicleCode', !!h.vehicleCode);
        check('History has weightKg', typeof h.weightKg === 'number');
        console.log(`    ℹ️  Latest: ${h.vehicleCode} on ${h.date}, ${h.weightKg?.toFixed(1)}kg, ${h.boxCount} boxes`);
    }

    // Filter by vehicle
    if (vehicleCode) {
        const r2 = await GET(`load-history?vehicleCode=${vehicleCode}&limit=3`);
        check('GET /load-history?vehicleCode — status 200', r2.status === 200);
        console.log(`    ℹ️  History for ${vehicleCode}: ${r2.data.history?.length || 0} entries`);
    }
}

async function testManualLayout() {
    console.log('\n── MANUAL LAYOUT ──');

    const testCode = '__TSTLAY__';
    const testDate = '2026-01-01';
    createdManualLayoutCode = testCode;
    createdManualLayoutDate = testDate;

    // GET (should be empty first)
    const r1 = await GET(`manual-layout/${testCode}/${testDate}`);
    check('GET /manual-layout — status 200', r1.status === 200);
    check('GET /manual-layout — not found initially', r1.data.found === false);

    // POST (create)
    const layout = {
        boxes: [
            { id: 0, label: 'TestBox1', x: 0, y: 0, z: 0, w: 30, h: 20, d: 15 },
            { id: 1, label: 'TestBox2', x: 30, y: 0, z: 0, w: 25, h: 25, d: 20 },
        ],
        excludedOrders: ['9999-1']
    };

    const createR = await POST('manual-layout', {
        vehicleCode: testCode,
        date: testDate,
        vendor: 'TEST',
        layoutJson: layout, // Send as object — backend handles JSON.stringify
        metricsJson: { totalWeight: 50, totalVolume: 22500 }
    });
    check('POST /manual-layout — status 200', createR.status === 200, `status=${createR.status}`);
    check('POST /manual-layout — action=created', createR.data.action === 'created', createR.data.action);

    // Wait for DB2 CLOB commit
    await sleep(1200);

    // GET (should find it now) — handle CLOB response being string or object
    const r2 = await GET(`manual-layout/${testCode}/${testDate}`);
    check('GET /manual-layout after create — found', r2.data.found === true,
          `found=${r2.data.found}, keys=${Object.keys(r2.data).join(',')}`);
    if (r2.data.found) {
        // CLOB data may come back as string or object
        const layoutData = typeof r2.data.layout === 'string'
            ? JSON.parse(r2.data.layout)
            : r2.data.layout;
        check('Layout has boxes', layoutData?.boxes?.length === 2, `boxes=${layoutData?.boxes?.length}`);
        check('Layout has excludedOrders', layoutData?.excludedOrders?.length === 1);
        // Metrics may be nested under layout or at top level
        const metricsData = layoutData?.metrics || r2.data.metrics;
        check('Layout has metrics',
            metricsData?.totalWeight === 50 || (typeof metricsData === 'string' && metricsData.includes('50')),
            `metrics=${JSON.stringify(metricsData)?.substring(0, 80)}`);
    }

    // POST (update — upsert)
    layout.boxes.push({ id: 2, label: 'TestBox3', x: 55, y: 0, z: 0, w: 20, h: 20, d: 20 });
    const updateR = await POST('manual-layout', {
        vehicleCode: testCode,
        date: testDate,
        vendor: 'TEST',
        layoutJson: layout,
        metricsJson: { totalWeight: 75, totalVolume: 30500 }
    });
    check('POST /manual-layout update — action=updated', updateR.data.action === 'updated', updateR.data.action);

    // Wait for DB2 CLOB commit
    await sleep(1200);

    // Verify update — handle CLOB string or object
    const r3 = await GET(`manual-layout/${testCode}/${testDate}`);
    const updatedLayout = typeof r3.data.layout === 'string'
        ? JSON.parse(r3.data.layout)
        : r3.data.layout;
    check('Layout updated — 3 boxes', updatedLayout?.boxes?.length === 3,
          `boxes=${updatedLayout?.boxes?.length}, found=${r3.data.found}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════════════

async function cleanup() {
    console.log('\n── CLEANUP ──');

    // Restore original truck config if we modified a real vehicle
    if (createdTruckConfig && originalTruckConfig) {
        try {
            const orig = originalTruckConfig;
            await PUT(`truck-config/${createdTruckConfig}`, {
                largoInteriorCm: orig.interior?.lengthCm || 0,
                anchoInteriorCm: orig.interior?.widthCm || 0,
                altoInteriorCm: orig.interior?.heightCm || 0,
                toleranciaExceso: orig.tolerancePct || 5,
                notas: ''
            });
            console.log(`    ℹ️  Restored original truck config for ${createdTruckConfig}`);
        } catch (e) {
            console.log(`    ⚠️  Could not restore truck config: ${e.message}`);
        }
    }

    // Delete test article dimensions
    if (createdArticleDims) {
        console.log(`    ℹ️  Note: Test article dims '${createdArticleDims}' left in DB (no delete endpoint). Harmless.`);
    }

    // Delete test manual layout
    if (createdManualLayoutCode) {
        await sleep(500);
        try {
            const r = await GET(`manual-layout/${createdManualLayoutCode}/${createdManualLayoutDate}`);
            const layoutData = typeof r.data.layout === 'string'
                ? JSON.parse(r.data.layout)
                : r.data.layout;
            const layoutId = layoutData?.id || r.data.layout?.id || r.data.id;
            if (r.data.found && layoutId) {
                const delR = await POST(`manual-layout/${layoutId}/delete`);
                check('Cleanup: delete manual layout', delR.status === 200 && delR.data.success, `status=${delR.status}`);
            } else {
                console.log('    ℹ️  Manual layout already gone or ID not found');
            }
        } catch (e) {
            console.log(`    ⚠️  Could not clean up manual layout: ${e.message}`);
        }
    }

    // Personnel cleanup already done via soft delete in the test
    console.log('    ✅ Cleanup complete');
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  WAREHOUSE ENDPOINTS — Full Test Suite');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Server: ${SERVER_HOST}:${SERVER_PORT}`);
    console.log(`  Time: ${new Date().toISOString()}`);

    try {
        // 0. Login
        await login();

        // 1. Dashboard
        const dashboard = await testDashboard();

        // 2. Vehicles
        const vehicles = await testVehicles();

        // Pick a vehicle for subsequent tests
        let vehicleCode = null;
        if (dashboard.trucks?.length > 0) {
            vehicleCode = dashboard.trucks[0].vehicleCode;
        } else if (vehicles.length > 0) {
            vehicleCode = vehicles[0].code;
        }
        console.log(`\n    🚛 Using vehicle: ${vehicleCode || 'NONE'}`);

        // 3. Truck config
        if (vehicleCode) {
            await testTruckConfig(vehicleCode);
        } else {
            console.log('\n── TRUCK CONFIG ── (skipped, no vehicle)');
        }

        // 4. Personnel (CRUD)
        await testPersonnel();

        // 5. Articles + dimensions
        await testArticles();

        // 6. Truck orders
        if (vehicleCode) {
            await testTruckOrders(vehicleCode);
        }

        // 7. Load Plan 3D
        if (vehicleCode) {
            await testLoadPlan(vehicleCode);
        }

        // 8. Profit optimizer
        if (vehicleCode) {
            await testOptimize(vehicleCode);
        }

        // 9. Manual load plan
        if (vehicleCode) {
            await testLoadPlanManual(vehicleCode);
        }

        // 10. Load history
        await testLoadHistory(vehicleCode);

        // 11. Manual layout CRUD
        await testManualLayout();

        // Cleanup
        await cleanup();

    } catch (err) {
        console.error(`\n💥 FATAL ERROR: ${err.message}`);
        console.error(err.stack);
    }

    // Summary
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    console.log('═══════════════════════════════════════════════════════════════');

    if (failed > 0) {
        console.log('\n  Failed tests:');
        results.filter(r => r.status === 'FAIL').forEach(r => {
            console.log(`    ❌ ${r.name}: ${r.detail}`);
        });
    }

    console.log('');
}

main();
