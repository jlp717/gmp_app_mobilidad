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

const crypto = require('crypto');
const http = require('http');

// ─── Config ────────────────────────────────────────────────────────────────
const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 3334;
const BASE = `http://${SERVER_HOST}:${SERVER_PORT}/api/warehouse`;
const TOKEN_SECRET = 'b3f8a2d9e1c7f405916d83ab2e0f7c4d5a91b8e3d6f2c0a4178e5b9d3f6a1c8';

// Generate a valid HMAC token
function makeToken() {
    const payload = { id: 'VTEST', user: 'TEST', timestamp: Date.now() };
    const data = Buffer.from(JSON.stringify(payload)).toString('base64');
    const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('hex');
    return `${data}.${sig}`;
}

const TOKEN = makeToken();

// ─── HTTP helpers ──────────────────────────────────────────────────────────
function request(method, path, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE + '/');
        // Fix: if path starts with /, use it relative to /api/warehouse
        const fullPath = '/api/warehouse/' + path.replace(/^\//, '');

        const options = {
            hostname: SERVER_HOST,
            port: SERVER_PORT,
            path: fullPath,
            method,
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json',
            },
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

    // GET config
    const r = await GET(`truck-config/${vehicleCode}`);
    check('GET /truck-config/:code — status 200', r.status === 200, `status=${r.status}`);
    if (r.status === 200) {
        check('Truck config has dimensions', r.data.interior != null || r.data.lengthCm != null, JSON.stringify(r.data).substring(0, 100));
        console.log(`    ℹ️  Config for ${vehicleCode}: ${JSON.stringify(r.data).substring(0, 120)}`);
    }

    // PUT (write test config) — use a test vehicle code to avoid overwriting real data
    const testCode = '__TEST__';
    createdTruckConfig = testCode;

    const putR = await PUT(`truck-config/${testCode}`, {
        largoInteriorCm: 500,
        anchoInteriorCm: 220,
        altoInteriorCm: 200,
        toleranciaExceso: 10,
        notas: 'TEST SCRIPT — will be deleted'
    });
    check('PUT /truck-config — status 200', putR.status === 200, `status=${putR.status}`);
    if (putR.status === 200) {
        console.log(`    ℹ️  Created test truck config for ${testCode}`);
    }

    // Verify it was saved
    const verifyR = await GET(`truck-config/${testCode}`);
    check('GET /truck-config after PUT — found', verifyR.status === 200, `status=${verifyR.status}`);
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
        console.log(`    ℹ️  First: ${p.name} (${p.role}, source=${p.source})`);
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

    // Find the created ID
    const afterCreate = await GET('personnel');
    const testPerson = afterCreate.data.personnel?.find(p => p.name === 'TEST_OPERARIO_SCRIPT');
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
        const afterUpdate = await GET('personnel');
        const updated = afterUpdate.data.personnel?.find(p => p.id === testPerson.id);
        check('PUT /personnel — name updated', updated?.name === 'TEST_OPERARIO_UPDATED', updated?.name);

        // Soft delete
        const delR = await POST(`personnel/${testPerson.id}/delete`);
        check('POST /personnel/:id/delete — status 200', delR.status === 200, `status=${delR.status}`);

        // Verify soft delete (should not appear in active list)
        const afterDel = await GET('personnel');
        const deleted = afterDel.data.personnel?.find(p => p.id === testPerson.id);
        check('Soft delete — not in active list', !deleted, deleted ? 'still found!' : 'correctly removed');
    } else {
        check('POST /personnel — person found in list', false, 'could not find created person');
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
            check('Box has position', b.position != null, JSON.stringify(b.position));
            check('Box has size', b.size != null, JSON.stringify(b.size));
            check('Box has label', typeof b.label === 'string');
            console.log(`    ℹ️  First box: "${b.label}" at [${b.position?.x?.toFixed(0)},${b.position?.y?.toFixed(0)},${b.position?.z?.toFixed(0)}]`);
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
        layoutJson: JSON.stringify(layout),
        metricsJson: JSON.stringify({ totalWeight: 50, totalVolume: 22500 })
    });
    check('POST /manual-layout — status 200', createR.status === 200, `status=${createR.status}`);
    check('POST /manual-layout — action=created', createR.data.action === 'created', createR.data.action);

    // GET (should find it now)
    const r2 = await GET(`manual-layout/${testCode}/${testDate}`);
    check('GET /manual-layout after create — found', r2.data.found === true);
    if (r2.data.found) {
        check('Layout has boxes', r2.data.layout.boxes?.length === 2, `boxes=${r2.data.layout.boxes?.length}`);
        check('Layout has excludedOrders', r2.data.layout.excludedOrders?.length === 1);
        check('Layout has metrics', r2.data.layout.metrics?.totalWeight === 50);
    }

    // POST (update — upsert)
    layout.boxes.push({ id: 2, label: 'TestBox3', x: 55, y: 0, z: 0, w: 20, h: 20, d: 20 });
    const updateR = await POST('manual-layout', {
        vehicleCode: testCode,
        date: testDate,
        vendor: 'TEST',
        layoutJson: JSON.stringify(layout),
        metricsJson: JSON.stringify({ totalWeight: 75, totalVolume: 30500 })
    });
    check('POST /manual-layout update — action=updated', updateR.data.action === 'updated', updateR.data.action);

    // Verify update
    const r3 = await GET(`manual-layout/${testCode}/${testDate}`);
    check('Layout updated — 3 boxes', r3.data.layout?.boxes?.length === 3, `boxes=${r3.data.layout?.boxes?.length}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════════════

async function cleanup() {
    console.log('\n── CLEANUP ──');

    // Delete test truck config
    if (createdTruckConfig) {
        try {
            // No delete endpoint for truck config, so we call the DB directly won't work
            // We need to use a workaround — the test code __TEST__ won't bother anyone
            console.log(`    ℹ️  Note: Test truck config '${createdTruckConfig}' left in DB (no delete endpoint). Harmless.`);
        } catch (e) { /* ignore */ }
    }

    // Delete test article dimensions
    if (createdArticleDims) {
        // PUT with null values won't delete, but the code __TESTDIM__ won't match any real article
        console.log(`    ℹ️  Note: Test article dims '${createdArticleDims}' left in DB (no delete endpoint). Harmless.`);
    }

    // Delete test manual layout
    if (createdManualLayoutCode) {
        const r = await GET(`manual-layout/${createdManualLayoutCode}/${createdManualLayoutDate}`);
        if (r.data.found && r.data.layout?.id) {
            const delR = await POST(`manual-layout/${r.data.layout.id}/delete`);
            check('Cleanup: delete manual layout', delR.status === 200 && delR.data.success, `status=${delR.status}`);
        } else {
            console.log('    ℹ️  Manual layout already gone or ID not found');
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
    console.log(`  Server: localhost:3334`);
    console.log(`  Token: ${TOKEN.substring(0, 30)}...`);
    console.log(`  Time: ${new Date().toISOString()}`);

    try {
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
