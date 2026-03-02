/**
 * Script to move 16 clients to Saturday for vendor 33, then reorder everything.
 * Uses the API endpoints at localhost:3334 exactly as the app would.
 */
const http = require('http');

function apiCall(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3334,
            path: '/api/planner' + path,
            method: method,
            headers: { 'Content-Type': 'application/json' }
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function main() {
    console.log('=== MOVING CLIENTS TO SATURDAY FOR VENDOR 33 ===\n');

    // The 16 clients in the desired order (with full codes)
    const newClientsOrdered = [
        { code: '4300010170', name: 'CANTINA ASOCIACION CAMPILLO' },
        { code: '4300007970', name: 'RECEPCION CAMPING LAS TORRES' },
        { code: '4300009698', name: 'CLUB PADEL' },
        { code: '4300010373', name: 'REST. LEONARDO SUL MARE' },
        { code: '4300010346', name: 'PUTORTI GUISEPPE' },
        { code: '4300010338', name: 'PEYMA RESTAURANTE' },
        { code: '4300009447', name: 'RESTAURANTE CHINO PEKIN 5' },
        { code: '4300010208', name: 'INDU SARTAJ' },
        { code: '4300010332', name: 'PORTICHUELO MESON' },
        { code: '4300010336', name: 'REST. COPO MARTIN' },
        { code: '4300005584', name: 'PANADERIA CONFITERIA LLAMPOS II' },
        { code: '4300001078', name: 'PANADERIA EL JIMENADO' },
        { code: '4300010353', name: 'CASA COMIDAS LA CONCHI' },
        { code: '4300010339', name: 'CAFETERIA MAREA' },
        { code: '4300003095', name: 'PANADERIA CONFITERIA PEDRO' },
        { code: '4300010039', name: 'THE CHEESECAKE EMPORIUM' },
    ];

    // Step 1: Check current Saturday to see who's already there
    console.log('1. Checking current Saturday route...');
    const currentSat = await apiCall('GET', '/rutero/day/sabado?vendedorCodes=33&role=comercial');
    const currentSatClients = (currentSat.body.clients || []).map(c => c.code);
    console.log(`   Current Saturday has ${currentSatClients.length} clients`);

    // Step 2: Identify which of the 16 need to be MOVED (not already on Saturday)
    const needsMove = newClientsOrdered.filter(c => !currentSatClients.includes(c.code));
    const alreadyOnSat = newClientsOrdered.filter(c => currentSatClients.includes(c.code));

    console.log(`   Already on Saturday: ${alreadyOnSat.length} (${alreadyOnSat.map(c => c.code).join(', ')})`);
    console.log(`   Need to move to Saturday: ${needsMove.length}`);
    needsMove.forEach(c => console.log(`     - ${c.code} (${c.name})`));

    // Step 3: Move clients that aren't already on Saturday
    if (needsMove.length > 0) {
        console.log('\n2. Moving clients to Saturday via /rutero/move_clients...');
        const moves = needsMove.map(c => ({
            client: c.code,
            clientName: c.name,
            toDay: 'sabado'
        }));

        const moveResult = await apiCall('POST', '/rutero/move_clients', {
            vendedor: '33',
            moves: moves
        });

        console.log(`   Move result: ${moveResult.status}`);
        if (moveResult.status === 200) {
            console.log(`   Moved ${moveResult.body.movedClients?.length || 0} clients successfully`);
            if (moveResult.body.movedClients) {
                moveResult.body.movedClients.forEach(m => {
                    console.log(`     ${m.client}: ${m.fromDay} -> ${m.toDay} (pos ${m.newPosition})`);
                });
            }
        } else {
            console.log(`   ERROR: ${JSON.stringify(moveResult.body)}`);
            process.exit(1);
        }
    }

    // Step 4: Now get UPDATED Saturday route to build the final reorder
    console.log('\n3. Getting updated Saturday route...');
    const updatedSat = await apiCall('GET', '/rutero/day/sabado?vendedorCodes=33&role=comercial');
    const updatedClients = updatedSat.body.clients || [];
    console.log(`   Updated Saturday has ${updatedClients.length} clients`);

    // Step 5: Build final order - 16 new ones first, then existing ones
    const newCodes = new Set(newClientsOrdered.map(c => c.code));
    const existingAfter = updatedClients.filter(c => !newCodes.has(c.code));

    console.log(`   New clients (at start): ${newClientsOrdered.length}`);
    console.log(`   Existing clients (after): ${existingAfter.length}`);

    const finalOrder = [];
    let pos = 0;

    // First: the 16 new ones in exact order
    for (const c of newClientsOrdered) {
        finalOrder.push({ cliente: c.code, posicion: pos, posicionOriginal: -1 });
        pos += 10;
    }

    // Then: existing Saturday clients (preserving their relative order)
    for (const c of existingAfter) {
        finalOrder.push({ cliente: c.code, posicion: pos, posicionOriginal: c.order });
        pos += 10;
    }

    console.log(`   Total final order: ${finalOrder.length} clients`);

    // Step 6: Save the order via /rutero/config
    console.log('\n4. Saving final order via /rutero/config...');
    const saveResult = await apiCall('POST', '/rutero/config', {
        vendedor: '33',
        dia: 'sabado',
        orden: finalOrder
    });

    console.log(`   Save result: ${saveResult.status}`);
    if (saveResult.status === 200) {
        console.log(`   ${saveResult.body.message}`);
    } else {
        console.log(`   ERROR: ${JSON.stringify(saveResult.body)}`);
    }

    // Step 7: Verify final order
    console.log('\n5. VERIFICATION - Final Saturday route:');
    const finalSat = await apiCall('GET', '/rutero/day/sabado?vendedorCodes=33&role=comercial');
    const finalClients = finalSat.body.clients || [];
    console.log(`   Total: ${finalClients.length} clients\n`);
    finalClients.forEach((c, i) => {
        const isNew = newCodes.has(c.code) ? '⭐' : '  ';
        console.log(`   ${isNew} ${String(i + 1).padStart(2)}. [${c.order}] ${c.code} | ${c.name}`);
    });
}

main().catch(e => { console.error(e); process.exit(1); });
