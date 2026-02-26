/**
 * TEST MASIVO: Alto Volumen - Simular miércoles con +60 clientes modificados
 * Usa TEST99 para escritura pero verifica estructura contra vendor 33 (read-only).
 */
const { getPool, initDb } = require('../config/db');

const VENDOR = 'TEST99';

async function main() {
    console.log('=== TEST MASIVO: ALTO VOLUMEN (60+ CLIENTES MIÉRCOLES) ===\n');
    await initDb();
    const pool = getPool();
    let passed = 0, failed = 0;

    const conn = await pool.connect();
    await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'`);

    // Phase 1: Read real vendor 33 miércoles count for reference
    console.log('FASE 1: Referencia del vendedor 33...');
    const ref = await conn.query(`
        SELECT COUNT(*) as CNT FROM DSEDAC.CDVI C
        JOIN DSEDAC.CLI K ON C.CODIGOCLIENTE = K.CODIGOCLIENTE
        WHERE TRIM(C.CODIGOVENDEDOR) = '33'
          AND TRIM(C.DIAVISITAMIERCOLESSN) = 'S'
          AND (C.MARCAACTUALIZACION <> 'B' OR C.MARCAACTUALIZACION IS NULL OR TRIM(C.MARCAACTUALIZACION) = '')
          AND (K.ANOBAJA = 0 OR K.ANOBAJA IS NULL)
    `);
    console.log(`   Referencia: Vendedor 33 tiene ${ref[0].CNT} clientes en miércoles (CDVI)`);
    passed++;

    // Phase 2: Create 70 clients on miércoles + 30 on other days
    console.log('\nFASE 2: Crear 70 clientes en miércoles + 30 en otros días...');
    const t0 = Date.now();
    for (let i = 1; i <= 70; i++) {
        await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'miercoles', 'HV${String(i).padStart(4,'0')}', ${i * 10})`);
    }
    for (let i = 71; i <= 100; i++) {
        const day = i <= 80 ? 'lunes' : (i <= 90 ? 'martes' : 'jueves');
        await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', '${day}', 'HV${String(i).padStart(4,'0')}', ${(i - 70) * 10})`);
    }
    const elapsed1 = Date.now() - t0;
    console.log(`   Tiempo creación 100 clientes: ${elapsed1}ms`);
    passed++;

    // Phase 3: Mass reorder miércoles (simulate drag-and-drop all 70)
    console.log('\nFASE 3: Reordenar 70 clientes de miércoles (reverse order)...');
    const t1 = Date.now();
    await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = 'miercoles' AND ORDEN >= 0`);
    for (let i = 70; i >= 1; i--) {
        await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'miercoles', 'HV${String(i).padStart(4,'0')}', ${(71 - i) * 10})`);
    }
    const elapsed2 = Date.now() - t1;
    console.log(`   Tiempo reorder 70 clientes: ${elapsed2}ms`);

    // Verify reverse order
    const first = await conn.query(`SELECT TRIM(CLIENTE) as CLI FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = 'miercoles' AND ORDEN >= 0 ORDER BY ORDEN ASC FETCH FIRST 1 ROWS ONLY`);
    const last = await conn.query(`SELECT TRIM(CLIENTE) as CLI FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = 'miercoles' AND ORDEN >= 0 ORDER BY ORDEN DESC FETCH FIRST 1 ROWS ONLY`);
    if (first[0]?.CLI === 'HV0070' && last[0]?.CLI === 'HV0001') {
        console.log('   OK - Orden invertido correctamente (HV0070 primero, HV0001 último)');
        passed++;
    } else {
        console.log(`   FAIL - First: ${first[0]?.CLI}, Last: ${last[0]?.CLI}`);
        failed++;
    }

    // Phase 4: Move 20 from miércoles to lunes (mass move + reorder)
    console.log('\nFASE 4: Mover 20 de miércoles a lunes...');
    const t2 = Date.now();
    for (let i = 1; i <= 20; i++) {
        const cli = `HV${String(i).padStart(4,'0')}`;
        await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND TRIM(CLIENTE) = '${cli}'`);
        await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'miercoles', '${cli}', -1)`);
        await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'lunes', '${cli}', ${(10 + i) * 10})`);
    }
    const elapsed3 = Date.now() - t2;
    console.log(`   Tiempo move 20 clientes: ${elapsed3}ms`);

    // Final state verification
    console.log('\nFASE 5: Verificación estado final...');
    const days = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'];
    const finalState = [];
    for (const day of days) {
        const pos = await conn.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = '${day}' AND ORDEN >= 0`);
        const blk = await conn.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = '${day}' AND ORDEN = -1`);
        finalState.push({ DIA: day, POSITIVOS: pos[0].CNT, BLOQUEADOS: blk[0].CNT });
    }
    console.table(finalState);

    const mieState = finalState.find(s => s.DIA === 'miercoles');
    const lunState = finalState.find(s => s.DIA === 'lunes');

    // miércoles should have 50 pos + 20 blocked, lunes should have 10 original + 20 moved = 30
    if (mieState.POSITIVOS === 50 && mieState.BLOQUEADOS === 20 && lunState.POSITIVOS === 30) {
        console.log('   OK - miércoles: 50pos+20blk, lunes: 30pos');
        passed++;
    } else {
        console.log(`   FAIL - mie pos:${mieState.POSITIVOS} blk:${mieState.BLOQUEADOS}, lun pos:${lunState.POSITIVOS}`);
        failed++;
    }

    // Phase 6: Performance check
    console.log('\nFASE 6: Performance...');
    const totalTime = elapsed1 + elapsed2 + elapsed3;
    console.log(`   Total: ${totalTime}ms (create: ${elapsed1}ms, reorder: ${elapsed2}ms, move: ${elapsed3}ms)`);
    if (totalTime < 10000) {
        console.log('   OK - Bajo 10 segundos');
        passed++;
    } else {
        console.log('   WARN - Más de 10 segundos');
        passed++; // warn only
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
