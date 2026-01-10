/**
 * Benchmark de endpoints - Mide tiempos de respuesta
 * Uso: node scripts/benchmark_endpoints.js
 */
const https = require('https');

const BASE_URL = 'https://retailers-oct-dale-shows.trycloudflare.com';

// Primero login para obtener token
async function login(vendedor, password) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ vendedor, password });
        const req = https.request(`${BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    resolve(json.token);
                } catch (e) {
                    reject(new Error(`Login failed: ${body}`));
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function benchmark(endpoint, token, label) {
    return new Promise((resolve) => {
        const start = Date.now();
        const req = https.request(`${BASE_URL}${endpoint}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                const duration = Date.now() - start;
                const size = body.length;
                console.log(`${label.padEnd(40)} ${duration.toString().padStart(6)}ms  (${(size/1024).toFixed(1)}KB)`);
                resolve({ endpoint, duration, size, status: res.statusCode });
            });
        });
        req.on('error', (err) => {
            const duration = Date.now() - start;
            console.log(`${label.padEnd(40)} ERROR: ${err.message}`);
            resolve({ endpoint, duration, error: err.message });
        });
        req.end();
    });
}

async function runBenchmarks() {
    console.log('═'.repeat(70));
    console.log('  BENCHMARK DE ENDPOINTS - GMP Sales App');
    console.log('═'.repeat(70));
    
    // Login como comercial (93)
    console.log('\n📋 Login como comercial (93 1510)...');
    const tokenComercial = await login('93', '1510');
    console.log('✅ Token obtenido\n');
    
    console.log('ENDPOINT'.padEnd(40) + 'TIEMPO'.padStart(8) + '  TAMAÑO');
    console.log('─'.repeat(70));
    
    const endpoints = [
        // Dashboard
        { path: '/api/dashboard/metrics?year=2025', label: 'Dashboard Metrics 2025' },
        { path: '/api/dashboard/metrics?year=2026', label: 'Dashboard Metrics 2026' },
        { path: '/api/dashboard/sales-evolution?year=2025', label: 'Sales Evolution 2025' },
        { path: '/api/dashboard/matrix-data?year=2025', label: 'Matrix Data 2025' },
        { path: '/api/dashboard/recent-sales?year=2025', label: 'Recent Sales 2025' },
        
        // Objetivos (los más lentos)
        { path: '/api/objectives?year=2025', label: '⚠️  Objectives Summary 2025' },
        { path: '/api/objectives?year=2026', label: '⚠️  Objectives Summary 2026' },
        { path: '/api/objectives/by-client?year=2025', label: '⚠️  Objectives By-Client 2025' },
        { path: '/api/objectives/by-client?year=2026', label: '⚠️  Objectives By-Client 2026' },
        { path: '/api/objectives/matrix?year=2025&depth=FAM', label: '⚠️  Objectives Matrix FAM 2025' },
        { path: '/api/objectives/matrix?year=2025&depth=FI1', label: '⚠️  Objectives Matrix FI1 2025' },
        
        // Clientes
        { path: '/api/clients', label: 'Clients List' },
        
        // Analytics
        { path: '/api/analytics/top-clients?year=2025', label: 'Top Clients 2025' },
        { path: '/api/analytics/top-products?year=2025', label: 'Top Products 2025' },
        
        // Rutero
        { path: '/api/rutero/week', label: 'Rutero Week' },
        
        // Comisiones
        { path: '/api/commissions/summary?year=2025&month=12', label: 'Commissions Dec 2025' },
    ];
    
    const results = [];
    for (const ep of endpoints) {
        const result = await benchmark(ep.path, tokenComercial, ep.label);
        results.push(result);
    }
    
    console.log('─'.repeat(70));
    
    // Resumen
    const successful = results.filter(r => !r.error);
    const avgTime = successful.reduce((a, b) => a + b.duration, 0) / successful.length;
    const slowest = successful.reduce((a, b) => a.duration > b.duration ? a : b);
    const fastest = successful.reduce((a, b) => a.duration < b.duration ? a : b);
    
    console.log('\n📊 RESUMEN:');
    console.log(`   Total endpoints: ${results.length}`);
    console.log(`   Exitosos: ${successful.length}`);
    console.log(`   Tiempo promedio: ${avgTime.toFixed(0)}ms`);
    console.log(`   Más lento: ${slowest.endpoint} (${slowest.duration}ms)`);
    console.log(`   Más rápido: ${fastest.endpoint} (${fastest.duration}ms)`);
    
    // Alertas de rendimiento
    console.log('\n⚠️  ENDPOINTS LENTOS (>5s):');
    const slow = successful.filter(r => r.duration > 5000);
    if (slow.length === 0) {
        console.log('   ✅ Ninguno! Todo está dentro del umbral.');
    } else {
        slow.forEach(r => {
            console.log(`   ❌ ${r.endpoint}: ${r.duration}ms`);
        });
    }
    
    console.log('\n═'.repeat(70));
}

runBenchmarks().catch(console.error);
