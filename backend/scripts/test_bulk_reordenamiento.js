/**
 * TEST MASIVO: Bulk Reordenamiento
 * Move clients in bulk to start, end, and specific positions.
 * Simulates the POST /rutero/config logic.
 */
const { getPool, initDb } = require('../config/db');

const VENDOR = 'TEST99';
const DAY = 'miercoles';

async function main() {
    console.log('=== TEST MASIVO: BULK REORDENAMIENTO ===\n');
    await initDb();
    const pool = getPool();
    let passed = 0, failed = 0;

    const conn = await pool.connect();
    await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'`);

    // Phase 1: Create 60 clients in order
    console.log('FASE 1: Crear 60 clientes en miércoles...');
    for (let i = 1; i <= 60; i++) {
        await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', '${DAY}', 'BK${String(i).padStart(4,'0')}', ${i * 10})`);
    }
    const initial = await conn.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = '${DAY}' AND ORDEN >= 0`);
    console.log(`   OK - ${initial[0].CNT} clientes creados`);
    passed++;

    // Phase 2: Simulate reorder - move last 10 to start
    console.log('\nFASE 2: Mover últimos 10 al principio (simular config save)...');
    const t0 = Date.now();

    // Delete all positives for the day (like POST /rutero/config does)
    await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = '${DAY}' AND ORDEN >= 0`);

    // Re-insert in new order: 51-60 first, then 1-50
    const newOrder = [];
    for (let i = 51; i <= 60; i++) newOrder.push(`BK${String(i).padStart(4,'0')}`);
    for (let i = 1; i <= 50; i++) newOrder.push(`BK${String(i).padStart(4,'0')}`);

    for (let idx = 0; idx < newOrder.length; idx++) {
        await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', '${DAY}', '${newOrder[idx]}', ${idx * 10})`);
    }
    const elapsed2 = Date.now() - t0;
    console.log(`   Tiempo reorder 60 clientes: ${elapsed2}ms`);

    // Verify order
    const reordered = await conn.query(`
        SELECT TRIM(CLIENTE) as CLI, ORDEN
        FROM JAVIER.RUTERO_CONFIG
        WHERE VENDEDOR = '${VENDOR}' AND DIA = '${DAY}' AND ORDEN >= 0
        ORDER BY ORDEN ASC
        FETCH FIRST 5 ROWS ONLY
    `);
    if (reordered[0]?.CLI === 'BK0051') {
        console.log('   OK - Primer cliente es BK0051 (anteriormente posición 51)');
        passed++;
    } else {
        console.log(`   FAIL - Primer cliente es ${reordered[0]?.CLI} (esperado BK0051)`);
        failed++;
    }

    // Phase 3: Move middle 10 to end
    console.log('\nFASE 3: Mover clientes del medio al final...');
    const t1 = Date.now();
    await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = '${DAY}' AND ORDEN >= 0`);

    // New order: positions 1-25, then 36-60, then 26-35
    const newOrder2 = [];
    for (let i = 0; i < 25; i++) newOrder2.push(newOrder[i]);
    for (let i = 35; i < 60; i++) newOrder2.push(newOrder[i]);
    for (let i = 25; i < 35; i++) newOrder2.push(newOrder[i]);

    for (let idx = 0; idx < newOrder2.length; idx++) {
        await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', '${DAY}', '${newOrder2[idx]}', ${idx * 10})`);
    }
    const elapsed3 = Date.now() - t1;
    console.log(`   Tiempo reorder: ${elapsed3}ms`);

    // Verify count preserved
    const afterReorder = await conn.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = '${DAY}' AND ORDEN >= 0`);
    if (afterReorder[0].CNT === 60) {
        console.log('   OK - 60 clientes preservados tras reorder');
        passed++;
    } else {
        console.log(`   FAIL - ${afterReorder[0].CNT} clientes (esperado 60)`);
        failed++;
    }

    // Phase 4: Verify no duplicates after all reorders
    console.log('\nFASE 4: Sin duplicados tras reorders...');
    const dups = await conn.query(`
        SELECT TRIM(CLIENTE) as CLI, COUNT(*) as N
        FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = '${DAY}'
        GROUP BY CLIENTE HAVING COUNT(*) > 1
    `);
    if (dups.length === 0) {
        console.log('   OK - Sin duplicados');
        passed++;
    } else {
        console.log(`   FAIL - ${dups.length} duplicados`);
        failed++;
    }

    // Phase 5: Verify ORDEN sequence is clean (no gaps that break sorting)
    console.log('\nFASE 5: Secuencia ORDEN limpia...');
    const ordenes = await conn.query(`
        SELECT ORDEN FROM JAVIER.RUTERO_CONFIG
        WHERE VENDEDOR = '${VENDOR}' AND DIA = '${DAY}' AND ORDEN >= 0
        ORDER BY ORDEN ASC
    `);
    let isMonotonic = true;
    for (let i = 1; i < ordenes.length; i++) {
        if (ordenes[i].ORDEN <= ordenes[i-1].ORDEN) {
            isMonotonic = false;
            break;
        }
    }
    if (isMonotonic) {
        console.log(`   OK - ORDEN es estrictamente creciente (${ordenes[0].ORDEN} ... ${ordenes[ordenes.length-1].ORDEN})`);
        passed++;
    } else {
        console.log('   FAIL - ORDEN no es estrictamente creciente');
        failed++;
    }

    // Phase 6: Blocks preserved across reorders
    console.log('\nFASE 6: Bloqueados preservados durante reorders...');
    // Add some blocks before reorder
    await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', '${DAY}', 'BLOCKED1', -1)`);
    await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', '${DAY}', 'BLOCKED2', -1)`);

    // Simulate config save (delete positives, re-insert)
    await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = '${DAY}' AND ORDEN >= 0`);
    for (let idx = 0; idx < 60; idx++) {
        await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', '${DAY}', '${newOrder2[idx]}', ${idx * 10})`);
    }

    // Check blocks still exist
    const blocksAfter = await conn.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = '${DAY}' AND ORDEN = -1`);
    if (blocksAfter[0].CNT === 2) {
        console.log('   OK - 2 bloqueados preservados tras reorder');
        passed++;
    } else {
        console.log(`   FAIL - ${blocksAfter[0].CNT} bloqueados (esperado 2)`);
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
