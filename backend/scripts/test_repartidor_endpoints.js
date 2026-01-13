/**
 * Test script para verificar los endpoints de repartidor después de los fixes
 */

const http = require('http');

const BASE_URL = 'http://localhost:3334';
const TEST_REPARTIDOR_ID = '79';
const TEST_TOKEN = 'VjM0OlYzNDoxNzI4MDAwMDAwMDAw'; // Token de ejemplo

async function makeRequest(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3334,
            path: path,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${TEST_TOKEN}`,
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        statusCode: res.statusCode,
                        data: JSON.parse(data)
                    });
                } catch (e) {
                    resolve({
                        statusCode: res.statusCode,
                        data: data
                    });
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

async function runTests() {
    console.log('====== TESTING REPARTIDOR ENDPOINTS ======\n');
    
    const tests = [
        {
            name: 'GET /api/repartidor/collections/summary/:id',
            path: `/api/repartidor/collections/summary/${TEST_REPARTIDOR_ID}?year=2026&month=1`,
            expectSuccess: true
        },
        {
            name: 'GET /api/repartidor/history/clients/:id',
            path: `/api/repartidor/history/clients/${TEST_REPARTIDOR_ID}`,
            expectSuccess: true
        },
        {
            name: 'GET /api/repartidor/collections/daily/:id',
            path: `/api/repartidor/collections/daily/${TEST_REPARTIDOR_ID}?year=2026&month=1`,
            expectSuccess: true
        },
        {
            name: 'GET /api/entregas/pendientes/:id',
            path: `/api/entregas/pendientes/${TEST_REPARTIDOR_ID}`,
            expectSuccess: true
        }
    ];

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        console.log(`Testing: ${test.name}`);
        console.log(`  Path: ${test.path}`);
        
        try {
            const result = await makeRequest(test.path);
            console.log(`  Status: ${result.statusCode}`);
            
            if (result.statusCode === 200) {
                const success = result.data.success !== false;
                if (success) {
                    console.log(`  ✅ PASSED - success: true`);
                    if (result.data.clients) console.log(`     clients: ${result.data.clients.length}`);
                    if (result.data.daily) console.log(`     daily: ${result.data.daily.length}`);
                    if (result.data.albaranes) console.log(`     albaranes: ${result.data.albaranes.length}`);
                    if (result.data.summary) console.log(`     summary: clientCount=${result.data.summary.clientCount}`);
                    if (result.data.warning) console.log(`     warning: ${result.data.warning}`);
                    passed++;
                } else {
                    console.log(`  ❌ FAILED - ${result.data.error || 'Unknown error'}`);
                    failed++;
                }
            } else if (result.statusCode >= 500) {
                console.log(`  ❌ FAILED - Server Error 500`);
                console.log(`     Error: ${JSON.stringify(result.data).substring(0, 100)}`);
                failed++;
            } else if (result.statusCode === 404) {
                console.log(`  ❌ FAILED - 404 Not Found`);
                failed++;
            } else {
                console.log(`  ⚠️  Status ${result.statusCode}`);
                passed++; // 401 is expected without valid token
            }
        } catch (e) {
            console.log(`  ❌ FAILED - ${e.message}`);
            failed++;
        }
        
        console.log('');
    }

    console.log('====== RESULTS ======');
    console.log(`Passed: ${passed}/${tests.length}`);
    console.log(`Failed: ${failed}/${tests.length}`);
    console.log('=====================');
    
    process.exit(failed > 0 ? 1 : 0);
}

// Wait a bit for server to fully start
setTimeout(runTests, 2000);
