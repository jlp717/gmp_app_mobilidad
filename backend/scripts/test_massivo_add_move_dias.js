/**
 * TEST MASIVO: Añadir y Mover 100 clientes entre días
 * Simula operaciones de mass move_clients entre diferentes días.
 * Verifica persistencia, bloqueados y contadores.
 */
const { getPool, initDb } = require('../config/db');

const VENDOR = 'TEST99';
const DAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

async function main() {
    console.log('=== TEST MASIVO: ADD/MOVE 100 CLIENTES ENTRE DÍAS ===\n');
    await initDb();
    const pool = getPool();
    let passed = 0, failed = 0;

    // Cleanup
    const c0 = await pool.connect();
    await c0.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'`);
    await c0.close();

    // Phase 1: Create 100 clients on 'lunes'
    console.log('FASE 1: Insertar 100 clientes en LUNES...');
    let t0 = Date.now();
    const c1 = await pool.connect();
    for (let i = 1; i <= 100; i++) {
        await c1.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'lunes', 'MC${String(i).padStart(4,'0')}', ${i * 10})`);
    }
    await c1.close();
    let elapsed = Date.now() - t0;
    console.log(`   Tiempo inserción 100 clientes: ${elapsed}ms`);

    // Verify
    const c2 = await pool.connect();
    const count1 = await c2.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = 'lunes' AND ORDEN >= 0`);
    if (count1[0].CNT === 100) {
        console.log('   OK - 100 clientes en lunes');
        passed++;
    } else {
        console.log(`   FAIL - Expected 100, got ${count1[0].CNT}`);
        failed++;
    }
    await c2.close();

    // Phase 2: Move 50 clients from lunes to martes (simulate move_clients)
    console.log('\nFASE 2: Mover 50 clientes de LUNES a MARTES...');
    t0 = Date.now();
    const c3 = await pool.connect();
    for (let i = 1; i <= 50; i++) {
        const cli = `MC${String(i).padStart(4,'0')}`;
        // Delete all existing entries
        await c3.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND TRIM(CLIENTE) = '${cli}'`);
        // Block on lunes
        await c3.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'lunes', '${cli}', -1)`);
        // Positive on martes
        await c3.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'martes', '${cli}', ${i * 10})`);
    }
    await c3.close();
    elapsed = Date.now() - t0;
    console.log(`   Tiempo move 50 clientes: ${elapsed}ms`);

    // Verify counts
    const c4 = await pool.connect();
    const lunesPos = await c4.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = 'lunes' AND ORDEN >= 0`);
    const lunesBlk = await c4.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = 'lunes' AND ORDEN = -1`);
    const martesPos = await c4.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = 'martes' AND ORDEN >= 0`);

    if (lunesPos[0].CNT === 50 && lunesBlk[0].CNT === 50 && martesPos[0].CNT === 50) {
        console.log('   OK - Lunes: 50 positivos + 50 bloqueados | Martes: 50 positivos');
        passed++;
    } else {
        console.log(`   FAIL - Lunes pos:${lunesPos[0].CNT}, blk:${lunesBlk[0].CNT}, Martes pos:${martesPos[0].CNT}`);
        failed++;
    }
    await c4.close();

    // Phase 3: Move 25 from martes to miercoles
    console.log('\nFASE 3: Mover 25 de MARTES a MIÉRCOLES...');
    t0 = Date.now();
    const c5 = await pool.connect();
    for (let i = 1; i <= 25; i++) {
        const cli = `MC${String(i).padStart(4,'0')}`;
        await c5.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND TRIM(CLIENTE) = '${cli}'`);
        // Block on lunes (original source)
        await c5.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'lunes', '${cli}', -1)`);
        // Block on martes (previous destination)
        await c5.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'martes', '${cli}', -1)`);
        // Positive on miercoles (new destination)
        await c5.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'miercoles', '${cli}', ${i * 10})`);
    }
    await c5.close();
    elapsed = Date.now() - t0;
    console.log(`   Tiempo move 25 clientes: ${elapsed}ms`);

    // Verify final state
    const c6 = await pool.connect();
    const summary = [];
    for (const day of DAYS) {
        const pos = await c6.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = '${day}' AND ORDEN >= 0`);
        const blk = await c6.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = '${day}' AND ORDEN = -1`);
        summary.push({ DIA: day, POSITIVOS: pos[0].CNT, BLOQUEADOS: blk[0].CNT });
    }
    console.table(summary);

    // Expected: lunes 50pos+50blk, martes 25pos+25blk, miercoles 25pos+0blk
    const lunS = summary.find(s => s.DIA === 'lunes');
    const marS = summary.find(s => s.DIA === 'martes');
    const mieS = summary.find(s => s.DIA === 'miercoles');

    if (lunS.POSITIVOS === 50 && lunS.BLOQUEADOS === 50 &&
        marS.POSITIVOS === 25 && marS.BLOQUEADOS === 25 &&
        mieS.POSITIVOS === 25 && mieS.BLOQUEADOS === 0) {
        console.log('   OK - Estado final correcto');
        passed++;
    } else {
        console.log('   FAIL - Estado final incorrecto');
        failed++;
    }

    // Phase 4: Verify no duplicates
    console.log('\nFASE 4: Verificar sin duplicados...');
    const dups = await c6.query(`
        SELECT TRIM(DIA) as D, TRIM(CLIENTE) as C, COUNT(*) as N
        FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'
        GROUP BY DIA, CLIENTE HAVING COUNT(*) > 1
    `);
    if (dups.length === 0) {
        console.log('   OK - Sin duplicados');
        passed++;
    } else {
        console.log(`   FAIL - ${dups.length} duplicados`);
        console.table(dups);
        failed++;
    }

    // Phase 5: Total entry count
    console.log('\nFASE 5: Conteo total de entradas...');
    const totalRes = await c6.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'`);
    const total = totalRes[0].CNT;
    const expected = 50 + 50 + 25 + 25 + 25; // 50lunPos + 50lunBlk + 25marPos + 25marBlk + 25miePos
    if (total === expected) {
        console.log(`   OK - Total: ${total} (esperado: ${expected})`);
        passed++;
    } else {
        console.log(`   FAIL - Total: ${total} (esperado: ${expected})`);
        failed++;
    }

    // Cleanup
    await c6.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'`);
    await c6.close();

    console.log(`\n=== RESULTADO: ${passed}/${passed + failed} tests passed ===`);
    if (failed > 0) console.log('FAIL');
    else console.log('ALL PASSED');
    process.exit(failed > 0 ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
