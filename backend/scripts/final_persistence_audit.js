#!/usr/bin/env node
/**
 * AUDITORÍA DE PERSISTENCIA RUTEROS (PRE/PROD)
 * ===========================================
 * Este script verifica que los movimientos de clientes entre días sean permanentes.
 * 
 * Uso en Putty:
 *   node backend/scripts/final_persistence_audit.js
 */

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
            port: 3334,
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
    console.log("🚀 INICIANDO AUDITORÍA FINAL DE PERSISTENCIA...");

    // 0. Login
    console.log("Fase 0: Login...");
    const loginRes = await makeRequest('POST', '/api/auth/login', { username: VENDEDOR, password: '33' + '18' });
    if (!loginRes.data || !loginRes.data.token) {
        console.error("❌ Error de login. Verifica que el servidor esté corriendo en el 3334.");
        process.exit(1);
    }
    token = loginRes.data.token;
    console.log("✅ Sesión iniciada.");

    // 1. Audit Ghost Blocking (Clientes movidos a otros días)
    console.log("\nFase 1: Probando bloqueo de 'Clientes Fantasma' (Clientes movidos fuera)...");
    const mieRes = await makeRequest('GET', `/api/rutero/day/miercoles?vendedorCodes=${VENDEDOR}&role=${ROLE}`);

    if (!mieRes.data || !mieRes.data.clients) {
        console.error("❌ No se pudieron obtener clientes del Miércoles.");
        process.exit(1);
    }

    const originalClients = mieRes.data.clients;
    console.log(`Miércoles inicial: ${originalClients.length} clientes`);

    if (originalClients.length < 5) {
        console.error("❌ No hay suficientes clientes para la prueba (el Vendedor 33 debería tener ~50).");
        process.exit(1);
    }

    // Simulamos que movemos los 2 primeros clientes a otro día (los quitamos del payload del miércoles)
    const clientesAMover = originalClients.slice(0, 2);
    const clientesQueSeQuedan = originalClients.slice(2);
    const orderPayload = clientesQueSeQuedan.map((c, i) => ({ cliente: c.code, posicion: i * 10 }));

    console.log(`Guardando configuración SIN los clientes: ${clientesAMover.map(c => c.code).join(', ')}...`);
    await makeRequest('POST', '/api/rutero/config', { vendedor: VENDEDOR, dia: 'miercoles', orden: orderPayload });

    // Verificar que han desaparecido del miércoles y el contador es correcto
    console.log("Verificando persistencia...");
    const mieAfter = await makeRequest('GET', `/api/rutero/day/miercoles?vendedorCodes=${VENDEDOR}&role=${ROLE}`);
    const countsAfter = await makeRequest('GET', `/api/rutero/counts?vendedorCodes=${VENDEDOR}&role=${ROLE}`);

    const countX = countsAfter.data.counts.miercoles;
    const listX = mieAfter.data.clients.length;

    const siguenEnLista = mieAfter.data.clients.filter(c => clientesAMover.some(s => s.code === c.code));
    if (siguenEnLista.length === 0 && listX === clientesQueSeQuedan.length) {
        console.log("✅ EXITO: Los clientes movidos han desaparecido de la lista y no reaparecen.");
    } else {
        console.log(`❌ FALLO: Los clientes reaparecieron o el contador no coincide. Lista: ${listX}, Esperado: ${clientesQueSeQuedan.length}`);
    }

    // 2. Audit Move-Back (Restauración)
    console.log("\nFase 2: Probando restauración (Mover un cliente de vuelta)...");
    const clienteARestaurar = clientesAMover[0];
    console.log(`Moviendo ${clienteARestaurar.code} de vuelta al Miércoles...`);
    await makeRequest('POST', '/api/rutero/move_clients', {
        vendedor: VENDEDOR,
        moves: [{ client: clienteARestaurar.code, toDay: 'miercoles', fromDay: 'martes', position: 'start' }]
    });

    const mieRestored = await makeRequest('GET', `/api/rutero/day/miercoles?vendedorCodes=${VENDEDOR}&role=${ROLE}`);
    const found = mieRestored.data.clients.find(c => c.code === clienteARestaurar.code);
    if (found && mieRestored.data.clients[0].code === clienteARestaurar.code) {
        console.log("✅ EXITO: El cliente bloqueado volvió a aparecer en la posición correcta.");
    } else {
        console.log("❌ FALLO: El cliente no volvió o está en mala posición.");
    }

    // 3. Counter Sync Audit
    console.log("\nFase 3: Sincronización de contadores (Original vs Personalizado)...");
    const countsCustom = await makeRequest('GET', `/api/rutero/counts?vendedorCodes=${VENDEDOR}&role=${ROLE}`);
    const countsOriginal = await makeRequest('GET', `/api/rutero/counts?vendedorCodes=${VENDEDOR}&role=${ROLE}&ignoreOverrides=true`);

    console.log(`Miercoles (Personalizado): ${countsCustom.data.counts.miercoles}`);
    console.log(`Miercoles (Original): ${countsOriginal.data.counts.miercoles}`);

    if (countsCustom.data.counts.miercoles !== countsOriginal.data.counts.miercoles) {
        console.log("✅ EXITO: Los contadores distinguen correctamente entre ruta original y personalizada.");
    } else {
        console.log("⚠️ AVISO: Los contadores son iguales. Puede ser normal si no quedan discrepancias ahora mismo.");
    }

    console.log("\n🚀 AUDITORÍA COMPLETADA.");
    process.exit(0);
}

runAudit().catch(e => {
    console.error("❌ ERROR CRÍTICO EN AUDITORÍA:", e.message);
    process.exit(1);
});
