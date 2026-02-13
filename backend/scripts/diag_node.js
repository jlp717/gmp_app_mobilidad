// Quick test script for GMP API - runs on the server with Node.js
const http = require('http');

const BASE = 'http://localhost:3000';
const USER = process.argv[2] || '01';
const PIN = process.argv[3] || '9584';

function request(method, path, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE);
        const opts = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000
        };
        if (body && body.token) {
            opts.headers['Authorization'] = 'Bearer ' + body.token;
            delete body.token;
        }
        const req = http.request(opts, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                catch(e) { resolve({ status: res.statusCode, data: data.substring(0, 200) }); }
            });
        });
        req.on('error', e => reject(e));
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        if (method === 'POST' && body) req.write(JSON.stringify(body));
        req.end();
    });
}

function get(path, token) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE);
        const opts = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + token },
            timeout: 15000
        };
        const req = http.request(opts, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                catch(e) { resolve({ status: res.statusCode, data: data.substring(0, 500) }); }
            });
        });
        req.on('error', e => reject(e));
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
    });
}

async function main() {
    console.log('=== GMP API DIAGNOSTIC ===');
    console.log('Date:', new Date().toISOString());
    console.log('');
    
    // 1. Login
    console.log('[1] LOGIN');
    const login = await request('POST', '/api/auth/login', { username: USER, password: PIN });
    if (!login.data.token) {
        console.log('  FAIL: Login failed -', JSON.stringify(login.data).substring(0, 200));
        process.exit(1);
    }
    const token = login.data.token;
    const role = login.data.role;
    console.log('  OK: Logged in as', login.data.user?.code, '(' + role + ')');
    console.log('');

    // 2. Vendedores
    console.log('[2] VENDEDORES (Issue #1)');
    const vend = await get('/api/rutero/vendedores', token);
    const vendedores = vend.data.vendedores || [];
    console.log('  Count:', vendedores.length, '(expected: 20)');
    console.log('  Codes:', vendedores.map(v => v.code).join(', '));
    if (vendedores.length === 20) console.log('  PASS');
    else console.log('  FAIL: expected 20, got', vendedores.length);
    console.log('');

    // 3. Repartidores
    console.log('[3] REPARTIDORES (Issue #2)');
    const rep = await get('/api/auth/repartidores', token);
    const repartidores = Array.isArray(rep.data) ? rep.data : (rep.data.repartidores || rep.data.data || []);
    console.log('  Count:', repartidores.length);
    if (repartidores.length > 0) {
        console.log('  Sample:', repartidores.slice(0,5).map(r => (r.code||r.codigoConductor||'?') + '-' + (r.name||r.nombre||'?')).join(', '));
        const bad = repartidores.filter(r => ['UNK','ZZ'].includes((r.code||r.codigoConductor||'').trim()));
        console.log('  UNK/ZZ entries:', bad.length, bad.length === 0 ? 'PASS' : 'FAIL');
    } else {
        console.log('  FAIL: no repartidores returned');
    }
    console.log('');

    // 4. Documents (FACTURA -0)
    console.log('[4] DOCUMENTS / FACTURA-0 (Issue #4)');
    // Try many client IDs to find one with documents
    const testClients = [
        '4300000060', '4300001040', '4300000001', '4300000010', '4300000100',
        '4300000200', '4300000300', '4300000500', '4300001000', '4300002000',
        '4300003000', '4300004000', '4300005000', '4300006000', '4300007000',
        '4300008000', '4300009000', '4300009046', '4300000002', '4300000003',
        '4300000020', '4300000030', '4300000040', '4300000050', '4300000070',
        '4300000080', '4300000090', '4300000101', '4300000150', '4300000250'
    ];
    let docs = [];
    let foundClient = '';
    for (const cid of testClients) {
        try {
            const dResp = await get('/api/repartidor/history/documents/' + cid + '?days=180', token);
            docs = dResp.data.documents || [];
            if (docs.length > 0) {
                foundClient = cid;
                console.log('  Found', docs.length, 'docs for client', cid);
                break;
            }
        } catch(e) {
            // skip
        }
    }
    if (docs.length === 0) {
        console.log('  WARN: No documents found for test clients');
    } else {
        const facturas = docs.filter(d => d.type === 'factura');
        const factura0 = facturas.filter(d => !d.facturaNumber || d.facturaNumber === 0);
        console.log('  Total docs:', docs.length, '| Facturas:', facturas.length);
        console.log('  Facturas with numFactura=0:', factura0.length, factura0.length === 0 ? 'PASS' : 'FAIL');
        
        // Check for serieFactura
        const withSerie = facturas.filter(d => d.serieFactura);
        console.log('  Facturas with serieFactura:', withSerie.length + '/' + facturas.length);
        
        // Sample - show ALL keys of first doc
        if (docs.length > 0) {
            console.log('  First doc keys:', Object.keys(docs[0]).join(', '));
            console.log('  First doc:', JSON.stringify(docs[0]).substring(0, 500));
        }
        // Show a factura if found
        if (facturas.length > 0) {
            console.log('  First factura:', JSON.stringify(facturas[0]).substring(0, 500));
        }
    }
    console.log('');

    // 5. Signature
    console.log('[5] SIGNATURES (Issue #3)');
    if (docs.length > 0) {
        const testDoc = docs.find(d => d.hasSignature || d.hasLegacySignature) || docs[0];
        const sigUrl = '/api/repartidor/history/signature?ejercicio=' + (testDoc.ejercicio||2025) +
            '&serie=' + (testDoc.serie||'A') +
            '&terminal=' + (testDoc.terminal||0) +
            '&numero=' + (testDoc.albaranNumber||testDoc.number||0);
        console.log('  Testing:', sigUrl);
        const sigResp = await get(sigUrl, token);
        console.log('  hasSignature:', sigResp.data.hasSignature);
        if (sigResp.data.signature) {
            console.log('  source:', sigResp.data.signature.source);
            console.log('  base64 length:', (sigResp.data.signature.base64||'').length);
            console.log('  firmante:', sigResp.data.signature.firmante);
        }
        console.log('  ' + (sigResp.data.hasSignature ? 'PASS' : 'WARN: no signature for this doc'));
    } else {
        console.log('  SKIP: no documents to test signatures');
    }
    console.log('');
    console.log('=== DONE ===');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
