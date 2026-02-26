/**
 * TEST MASIVO: Cambio de día + Reconexión (logout/login)
 * Simula: modificar ruta, desconectar (cerrar conexión), reconectar y verificar persistencia.
 * Simula múltiples "dispositivos" (conexiones independientes).
 */
const { getPool, initDb } = require('../config/db');

const VENDOR = 'TEST99';

async function main() {
    console.log('=== TEST MASIVO: CAMBIO DÍA + RECONEXIÓN ===\n');
    await initDb();
    const pool = getPool();
    let passed = 0, failed = 0;

    // Cleanup
    const c0 = await pool.connect();
    await c0.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'`);
    await c0.close();

    // Phase 1: "Dispositivo 1" creates route
    console.log('FASE 1: Dispositivo 1 (tablet) crea ruta...');
    const device1 = await pool.connect();
    for (let i = 1; i <= 40; i++) {
        await device1.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'lunes', 'RC${String(i).padStart(4,'0')}', ${i * 10})`);
    }
    await device1.close(); // "logout"
    console.log('   OK - 40 clientes creados, dispositivo 1 desconectado');
    passed++;

    // Phase 2: "Dispositivo 2" reads the state (simulates login from web)
    console.log('\nFASE 2: Dispositivo 2 (web) lee estado...');
    const device2 = await pool.connect();
    const readState = await device2.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = 'lunes' AND ORDEN >= 0`);
    if (readState[0].CNT === 40) {
        console.log('   OK - Dispositivo 2 ve 40 clientes');
        passed++;
    } else {
        console.log(`   FAIL - Dispositivo 2 ve ${readState[0].CNT} (esperado 40)`);
        failed++;
    }

    // Phase 3: "Dispositivo 2" modifies (moves 10 to martes)
    console.log('\nFASE 3: Dispositivo 2 mueve 10 a martes...');
    for (let i = 1; i <= 10; i++) {
        const cli = `RC${String(i).padStart(4,'0')}`;
        await device2.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND TRIM(CLIENTE) = '${cli}'`);
        await device2.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'lunes', '${cli}', -1)`);
        await device2.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'martes', '${cli}', ${i * 10})`);
    }
    await device2.close(); // "logout"
    console.log('   OK - 10 clientes movidos, dispositivo 2 desconectado');
    passed++;

    // Phase 4: "Dispositivo 1" reconnects next day
    console.log('\nFASE 4: Dispositivo 1 reconecta (simula nuevo día)...');
    const device1b = await pool.connect();
    const lunesAfter = await device1b.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = 'lunes' AND ORDEN >= 0`);
    const martesAfter = await device1b.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = 'martes' AND ORDEN >= 0`);

    if (lunesAfter[0].CNT === 30 && martesAfter[0].CNT === 10) {
        console.log('   OK - Dispositivo 1 ve cambios del dispositivo 2 (lunes:30, martes:10)');
        passed++;
    } else {
        console.log(`   FAIL - Lunes:${lunesAfter[0].CNT}, Martes:${martesAfter[0].CNT}`);
        failed++;
    }

    // Phase 5: "Dispositivo 3" reads (another independent connection)
    console.log('\nFASE 5: Dispositivo 3 (otro comercial) verifica...');
    const device3 = await pool.connect();
    const totalCheck = await device3.query(`
        SELECT TRIM(DIA) as DIA,
               SUM(CASE WHEN ORDEN >= 0 THEN 1 ELSE 0 END) as POS,
               SUM(CASE WHEN ORDEN = -1 THEN 1 ELSE 0 END) as BLK
        FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'
        GROUP BY DIA ORDER BY DIA
    `);
    console.table(totalCheck);

    const lunesCheck = totalCheck.find(r => r.DIA?.trim() === 'lunes');
    const martesCheck = totalCheck.find(r => r.DIA?.trim() === 'martes');
    if (lunesCheck?.POS === 30 && lunesCheck?.BLK === 10 && martesCheck?.POS === 10) {
        console.log('   OK - Dispositivo 3 confirma estado consistente');
        passed++;
    } else {
        console.log('   FAIL - Estado inconsistente entre dispositivos');
        failed++;
    }

    // Phase 6: Rapid reconnection test (5 connect/read/close cycles)
    console.log('\nFASE 6: Test de reconexiones rápidas (5 ciclos)...');
    const t0 = Date.now();
    for (let cycle = 0; cycle < 5; cycle++) {
        const tempConn = await pool.connect();
        const cnt = await tempConn.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'`);
        await tempConn.close();
        if (cnt[0].CNT !== 50) { // 30 lunes pos + 10 lunes blk + 10 martes pos
            console.log(`   FAIL - Cycle ${cycle}: expected 50, got ${cnt[0].CNT}`);
            failed++;
            break;
        }
    }
    const elapsed = Date.now() - t0;
    console.log(`   OK - 5 ciclos de reconexión en ${elapsed}ms (${Math.round(elapsed/5)}ms/ciclo)`);
    passed++;

    // Cleanup
    await device1b.close();
    await device3.close();
    const cleanup = await pool.connect();
    await cleanup.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'`);
    await cleanup.close();

    console.log(`\n=== RESULTADO: ${passed}/${passed + failed} tests passed ===`);
    if (failed > 0) console.log('FAIL');
    else console.log('ALL PASSED');
    process.exit(failed > 0 ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
