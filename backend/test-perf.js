const http = require('http');

function testEndpoint(name, path) {
    return new Promise((resolve) => {
        const start = Date.now();
        const req = http.get(`http://localhost:3197${path}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const time = Date.now() - start;
                resolve({ name, time, status: res.statusCode, data: data.substring(0, 500) });
            });
        });
        req.on('error', () => resolve({ name, time: -1, status: 'error' }));
        req.setTimeout(30000, () => req.destroy());
    });
}

async function runTests() {
    console.log('🧪 TESTEANDO GMP APP...\n');
    
    // Test 1: Health
    const health = await testEndpoint('health', '/api/health');
    console.log(`1. Health: ${health.time}ms (status: ${health.status})`);
    
    // Test 2: Login (Diego 9173)
    const loginReq = http.request({
        hostname: 'localhost',
        port: 3197,
        path: '/api/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            const time = Date.now() - start;
            console.log(`2. Login Diego: ${time}ms (status: ${res.statusCode})`);
            try {
                const json = JSON.parse(data);
                if (json.token) {
                    testDashboard(json.token);
                } else {
                    console.log('   ❌ Login falló');
                }
            } catch(e) {}
        });
    });
    loginReq.on('error', () => console.log('2. Login: ERROR'));
    loginReq.write(JSON.stringify({ username: 'DIEGO', password: '9173' }));
    loginReq.end();
    const start = Date.now();
}

function testDashboard(token) {
    const req = http.request({
        hostname: 'localhost',
        port: 3197,
        path: '/api/dashboard/metrics?year=2026&month=4',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
    }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            const time = Date.now() - dashboardStart;
            console.log(`3. Dashboard: ${time}ms (status: ${res.statusCode})`);
        });
    });
    req.on('error', () => console.log('3. Dashboard: ERROR'));
    const dashboardStart = Date.now();
    req.end();
}

runTests();