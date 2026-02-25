#!/usr/bin/env node
const http = require('http');

const API_BASE = 'http://localhost:3334';
const VENDEDOR = '33';
const ROLE = 'comercial';
let token = null;

async function makeRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, API_BASE);
        const options = {
            hostname: url.hostname,
            port: url.port || 3334,
            path: url.pathname + url.search,
            method,
            headers: { 'Content-Type': 'application/json' }
        };
        if (token) options.headers['Authorization'] = `Bearer ${token}`;

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                catch (e) { resolve({ status: res.statusCode, data }); }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function runAudit() {
    console.log("🚀 STARTING FINAL PERSISTENCE AUDIT...");

    // 0. Login
    console.log("Phase 0: Login...");
    const loginRes = await makeRequest('POST', '/api/auth/login', { username: VENDEDOR, password: '33' + '18' });
    token = loginRes.data.token;
    if (!token) { console.error("❌ Login failed"); process.exit(1); }
    console.log("✅ Logged in.");

    // 1. Audit Ghost Blocking
    console.log("\nPhase 1: Testing 'Ghost' Blocking (Natural clients removed from UI)...");
    const mieRes = await makeRequest('GET', `/api/rutero/day/miercoles?vendedorCodes=${VENDEDOR}&role=${ROLE}`);
    const originalClients = mieRes.data.clients;
    console.log(`Initial Miercoles: ${originalClients.length} clients`);

    if (originalClients.length < 5) { console.error("❌ Not enough clients to test"); process.exit(1); }

    // Skip the first 2 clients in the order payload
    const skippedClients = originalClients.slice(0, 2);
    const keptClients = originalClients.slice(2);
    const orderPayload = keptClients.map((c, i) => ({ cliente: c.code, posicion: i * 10 }));

    console.log(`Saving order WITHOUT ${skippedClients.map(c => c.code).join(', ')}...`);
    await makeRequest('POST', '/api/rutero/config', { vendedor: VENDEDOR, dia: 'miercoles', orden: orderPayload });

    // Verify they are blocked
    console.log("Verifying blocks exist in DB via API...");
    const mieAfter = await makeRequest('GET', `/api/rutero/day/miercoles?vendedorCodes=${VENDEDOR}&role=${ROLE}`);
    const countsAfter = await makeRequest('GET', `/api/rutero/counts?vendedorCodes=${VENDEDOR}&role=${ROLE}`);

    const countX = countsAfter.data.counts.miercoles;
    const listX = mieAfter.data.clients.length;

    const stillInList = mieAfter.data.clients.filter(c => skippedClients.some(s => s.code === c.code));
    if (stillInList.length === 0 && listX === keptClients.length) {
        console.log("✅ SUCCESS: Skipped clients are GONE from the list.");
    } else {
        console.log(`❌ FAIL: Skipped clients still present or count mismatch. List: ${listX}, Expected: ${keptClients.length}`);
    }

    // 2. Audit Move-Back Restoration
    console.log("\nPhase 2: Testing Restoration (Moving a blocked client back)...");
    const clientToRestore = skippedClients[0];
    console.log(`Moving ${clientToRestore.code} back to Miercoles...`);
    await makeRequest('POST', '/api/rutero/move_clients', {
        vendedor: VENDEDOR,
        moves: [{ client: clientToRestore.code, toDay: 'miercoles', fromDay: 'martes', position: 'start' }]
    });

    const mieRestored = await makeRequest('GET', `/api/rutero/day/miercoles?vendedorCodes=${VENDEDOR}&role=${ROLE}`);
    const found = mieRestored.data.clients.find(c => c.code === clientToRestore.code);
    if (found && mieRestored.data.clients[0].code === clientToRestore.code) {
        console.log("✅ SUCCESS: Blocked client was restored to the top.");
    } else {
        console.log("❌ FAIL: Blocked client did not return or wrong position.");
    }

    // 3. Counter Sync Audit
    console.log("\nPhase 3: Testing Counter Sync (Original vs Custom)...");
    const countsCustom = await makeRequest('GET', `/api/rutero/counts?vendedorCodes=${VENDEDOR}&role=${ROLE}`);
    const countsOriginal = await makeRequest('GET', `/api/rutero/counts?vendedorCodes=${VENDEDOR}&role=${ROLE}&ignoreOverrides=true`);

    console.log(`Custom X: ${countsCustom.data.counts.miercoles}`);
    console.log(`Original X: ${countsOriginal.data.counts.miercoles}`);

    if (countsCustom.data.counts.miercoles !== countsOriginal.data.counts.miercoles) {
        console.log("✅ SUCCESS: Counters differ correctly between modes.");
    } else {
        console.log("❌ WARNING: Counters are identical. This might be correct if no diffs remain, but usually should differ in this test.");
    }

    console.log("\n🚀 AUDIT COMPLETE.");
    process.exit(0);
}

runAudit().catch(console.error);
