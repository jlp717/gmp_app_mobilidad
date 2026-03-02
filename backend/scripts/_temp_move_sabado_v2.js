/**
 * Move 16 clients to Saturday for vendor 33, then reorder everything.
 * Uses direct DB + laclae service (same logic as the API endpoints).
 */
const { query, getPool, initDb } = require('../config/db');
const { loadLaclaeCache, getClientsForDay, reloadRuteroConfig, getClientCurrentDay } = require('../services/laclae');

async function main() {
    await initDb();
    await loadLaclaeCache();

    const pool = getPool();
    const conn = await pool.connect();

    const VENDEDOR = '33';
    const DIA = 'sabado';

    // The 16 clients in the exact order requested (at the start)
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
    const newCodes = new Set(newClientsOrdered.map(c => c.code));

    console.log('=== SATURDAY REORDER FOR VENDOR 33 ===\n');

    // Step 1: Get current Saturday clients (personalized view)
    const currentSatClients = getClientsForDay(VENDEDOR, DIA, 'comercial', false) || [];
    console.log(`1. Current Saturday: ${currentSatClients.length} clients`);

    // Step 2: Identify who needs to be MOVED from another day
    const needsMove = newClientsOrdered.filter(c => !currentSatClients.includes(c.code));
    const alreadyOnSat = newClientsOrdered.filter(c => currentSatClients.includes(c.code));

    console.log(`   Already on Saturday: ${alreadyOnSat.length}`);
    alreadyOnSat.forEach(c => console.log(`     ✅ ${c.code} (${c.name})`));
    console.log(`   Need to move: ${needsMove.length}`);
    needsMove.forEach(c => {
        const currentDay = getClientCurrentDay(VENDEDOR, c.code);
        console.log(`     📦 ${c.code} (${c.name}) — currently on: ${currentDay || 'natural only'}`);
    });

    // Step 3: Execute moves (same logic as POST /rutero/move_clients)
    if (needsMove.length > 0) {
        console.log('\n2. Moving clients to Saturday...');
        for (const client of needsMove) {
            const clientCode = client.code;
            const previousDay = getClientCurrentDay(VENDEDOR, clientCode);

            // Delete ALL existing entries for this client
            await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDEDOR}' AND TRIM(CLIENTE) = '${clientCode}'`);

            // Block from source day if different
            if (previousDay && previousDay !== DIA) {
                await conn.query(`
                    INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN)
                    VALUES ('${VENDEDOR}', '${previousDay}', '${clientCode}', -1)
                `);
                console.log(`   🚫 Blocked ${clientCode} from ${previousDay}`);
            }

            // Insert positive entry for sabado (temp high order, will be reordered below)
            await conn.query(`
                INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN)
                VALUES ('${VENDEDOR}', '${DIA}', '${clientCode}', 999999)
            `);
            console.log(`   ✅ Moved ${clientCode} (${client.name}) to ${DIA}`);

            // Log the move
            try {
                await conn.query(`
                    INSERT INTO JAVIER.RUTERO_LOG 
                    (VENDEDOR, TIPO_CAMBIO, DIA_ORIGEN, DIA_DESTINO, CLIENTE, NOMBRE_CLIENTE, POSICION_ANTERIOR, POSICION_NUEVA, DETALLES)
                    VALUES ('${VENDEDOR}', 'CAMBIO_DIA', '${previousDay || 'natural'}', '${DIA}', '${clientCode}', 
                            '${client.name.replace(/'/g, "''")}', NULL, 999999, 
                            'Movido a sabado por solicitud del comercial')
                `);
            } catch (e) { /* non-blocking */ }
        }
    }

    // Reload config so getClientsForDay reflects moves
    await reloadRuteroConfig();

    // Step 4: Build final order
    console.log('\n3. Building final Saturday order...');

    // Get FULL updated Saturday client list
    const updatedSatClients = getClientsForDay(VENDEDOR, DIA, 'comercial', false) || [];
    console.log(`   Updated Saturday: ${updatedSatClients.length} clients`);

    // Get current config for existing order
    const existingConfig = await conn.query(`
        SELECT TRIM(CLIENTE) as CLI, ORDEN
        FROM JAVIER.RUTERO_CONFIG
        WHERE VENDEDOR = '${VENDEDOR}' AND DIA = '${DIA}' AND ORDEN >= 0
        ORDER BY ORDEN ASC
    `);
    const existingOrderMap = {};
    existingConfig.forEach(r => { existingOrderMap[r.CLI] = r.ORDEN; });

    // Existing clients NOT in the 16 new ones, sorted by their current order
    const existingAfter = updatedSatClients
        .filter(code => !newCodes.has(code))
        .sort((a, b) => {
            const oa = existingOrderMap[a] ?? 99999;
            const ob = existingOrderMap[b] ?? 99999;
            return oa - ob;
        });

    console.log(`   New at start: ${newClientsOrdered.length}`);
    console.log(`   Existing after: ${existingAfter.length}`);

    // Step 5: Delete positive entries and write new order
    console.log('\n4. Saving final order...');

    // Preserve blocking entries, delete only positives
    await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDEDOR}' AND DIA = '${DIA}' AND ORDEN >= 0`);

    let pos = 0;
    // First: 16 new clients in requested order
    for (const c of newClientsOrdered) {
        await conn.query(`
            INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN)
            VALUES ('${VENDEDOR}', '${DIA}', '${c.code}', ${pos})
        `);
        pos += 10;
    }

    // Then: existing Saturday clients
    for (const code of existingAfter) {
        await conn.query(`
            INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN)
            VALUES ('${VENDEDOR}', '${DIA}', '${code}', ${pos})
        `);
        pos += 10;
    }

    // Reload again
    await reloadRuteroConfig();

    // Step 6: Verify
    console.log('\n5. ✅ FINAL SATURDAY ORDER:\n');
    const finalConfig = await conn.query(`
        SELECT R.ORDEN, TRIM(R.CLIENTE) as CLI, 
               TRIM(COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO),''), C.NOMBRECLIENTE)) as NAME
        FROM JAVIER.RUTERO_CONFIG R
        LEFT JOIN DSEDAC.CLI C ON R.CLIENTE = C.CODIGOCLIENTE
        WHERE R.VENDEDOR = '${VENDEDOR}' AND R.DIA = '${DIA}' AND R.ORDEN >= 0
        ORDER BY R.ORDEN ASC
    `);

    finalConfig.forEach((r, i) => {
        const marker = newCodes.has(r.CLI) ? '⭐' : '  ';
        console.log(`   ${marker} ${String(i + 1).padStart(2)}. [pos ${String(r.ORDEN).padStart(3)}] ${r.CLI} | ${r.NAME?.trim()}`);
    });

    console.log(`\n   Total: ${finalConfig.length} clients`);
    console.log(`   ⭐ = Newly inserted at start (16)`);

    await conn.close();
    process.exit(0);
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
