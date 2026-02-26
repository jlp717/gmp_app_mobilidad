/**
 * TEST: Cambio de Vista Rutero (Original vs Personalizado)
 * Verifica que la lógica de filtrado ORDEN >= 0 / ORDEN = -1 funciona.
 */
const { getPool, initDb } = require('../config/db');

const VENDOR = 'TEST99';

async function main() {
    console.log('=== TEST: CAMBIO VISTA RUTERO ===\n');
    await initDb();
    const pool = getPool();
    let passed = 0, failed = 0;

    const conn = await pool.connect();
    // Cleanup
    await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'`);

    // Setup: simulate a vendor with mixed entries
    console.log('Setup: Creating test data...');
    const entries = [
        { dia: 'lunes', cliente: 'A001', orden: 10 },   // positive (visible in custom)
        { dia: 'lunes', cliente: 'A002', orden: 20 },   // positive
        { dia: 'lunes', cliente: 'A003', orden: -1 },   // blocked (hidden in custom)
        { dia: 'martes', cliente: 'B001', orden: 0 },    // positive at start
        { dia: 'martes', cliente: 'B002', orden: -1 },   // blocked
        { dia: 'miercoles', cliente: 'C001', orden: 100 }, // positive
    ];

    for (const e of entries) {
        await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', '${e.dia}', '${e.cliente}', ${e.orden})`);
    }

    // Test 1: Custom view (ORDEN >= 0 only)
    console.log('\n1. Vista Personalizada (ORDEN >= 0)...');
    const custom = await conn.query(`
        SELECT TRIM(DIA) as DIA, TRIM(CLIENTE) as CLI, ORDEN
        FROM JAVIER.RUTERO_CONFIG
        WHERE VENDEDOR = '${VENDOR}' AND ORDEN >= 0
        ORDER BY DIA, ORDEN
    `);
    const expectedCustom = 4; // A001, A002, B001, C001
    if (custom.length === expectedCustom) {
        console.log(`   OK - ${expectedCustom} clientes visibles en vista personalizada`);
        passed++;
    } else {
        console.log(`   FAIL - Expected ${expectedCustom}, got ${custom.length}`);
        console.table(custom);
        failed++;
    }

    // Test 2: All entries (for debugging)
    console.log('2. Todas las entradas (incluye bloqueados)...');
    const all = await conn.query(`
        SELECT TRIM(DIA) as DIA, TRIM(CLIENTE) as CLI, ORDEN
        FROM JAVIER.RUTERO_CONFIG
        WHERE VENDEDOR = '${VENDOR}'
    `);
    if (all.length === 6) {
        console.log('   OK - 6 total entries (4 positive + 2 blocked)');
        passed++;
    } else {
        console.log(`   FAIL - Expected 6, got ${all.length}`);
        failed++;
    }

    // Test 3: Count per day (custom view)
    console.log('3. Contadores por día (solo positivos)...');
    const counts = await conn.query(`
        SELECT TRIM(DIA) as DIA, COUNT(*) as CNT
        FROM JAVIER.RUTERO_CONFIG
        WHERE VENDEDOR = '${VENDOR}' AND ORDEN >= 0
        GROUP BY DIA ORDER BY DIA
    `);
    const lunesCount = counts.find(c => c.DIA === 'lunes')?.CNT || 0;
    const martesCount = counts.find(c => c.DIA === 'martes')?.CNT || 0;
    const miercolesCount = counts.find(c => c.DIA === 'miercoles')?.CNT || 0;

    if (lunesCount === 2 && martesCount === 1 && miercolesCount === 1) {
        console.log('   OK - Lunes:2, Martes:1, Miércoles:1');
        passed++;
    } else {
        console.log(`   FAIL - L:${lunesCount}, M:${martesCount}, X:${miercolesCount}`);
        failed++;
    }

    // Test 4: Blocked entries per day
    console.log('4. Bloqueados por día...');
    const blocks = await conn.query(`
        SELECT TRIM(DIA) as DIA, COUNT(*) as CNT
        FROM JAVIER.RUTERO_CONFIG
        WHERE VENDEDOR = '${VENDOR}' AND ORDEN = -1
        GROUP BY DIA ORDER BY DIA
    `);
    const lunesBlocked = blocks.find(c => c.DIA === 'lunes')?.CNT || 0;
    const martesBlocked = blocks.find(c => c.DIA === 'martes')?.CNT || 0;

    if (lunesBlocked === 1 && martesBlocked === 1) {
        console.log('   OK - Lunes:1 blocked, Martes:1 blocked');
        passed++;
    } else {
        console.log(`   FAIL - L:${lunesBlocked}, M:${martesBlocked}`);
        failed++;
    }

    // Cleanup
    await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'`);
    await conn.close();

    console.log(`\n=== RESULTADO: ${passed}/${passed + failed} tests passed ===`);
    if (failed > 0) console.log('FAIL');
    else console.log('ALL PASSED');
    process.exit(failed > 0 ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
