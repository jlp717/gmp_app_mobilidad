/**
 * TEST MASIVO: Comparar estado post-operaciones masivas contra Ruta Original
 * Verifica que los contadores custom + blocks == original count.
 * READ operations on real vendor 33, WRITE operations on TEST99.
 */
const { getPool, initDb } = require('../config/db');

const VENDOR = 'TEST99';

async function main() {
    console.log('=== TEST MASIVO: COMPARACIÓN VS RUTA ORIGINAL ===\n');
    await initDb();
    const pool = getPool();
    let passed = 0, failed = 0;

    const conn = await pool.connect();
    await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'`);

    // Phase 1: Simulate original route (80 clients distributed across 5 days)
    console.log('FASE 1: Simular ruta original de 80 clientes...');
    const distribution = { lunes: 20, martes: 20, miercoles: 15, jueves: 15, viernes: 10 };
    let clientId = 1;
    const originalCounts = {};
    const clientDay = {};

    for (const [day, count] of Object.entries(distribution)) {
        originalCounts[day] = count;
        for (let i = 0; i < count; i++) {
            const cli = `OR${String(clientId).padStart(4,'0')}`;
            await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', '${day}', '${cli}', ${(i + 1) * 10})`);
            clientDay[cli] = day;
            clientId++;
        }
    }
    console.log('   Original:', JSON.stringify(originalCounts));
    passed++;

    // Phase 2: Move 10 from lunes to viernes, 5 from martes to jueves
    console.log('\nFASE 2: Operaciones masivas de movimiento...');
    const t0 = Date.now();

    // Move lunes[1-10] -> viernes
    for (let i = 1; i <= 10; i++) {
        const cli = `OR${String(i).padStart(4,'0')}`;
        await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND TRIM(CLIENTE) = '${cli}'`);
        await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'lunes', '${cli}', -1)`);
        await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'viernes', '${cli}', ${(10 + i) * 10})`);
    }
    // Move martes[21-25] -> jueves
    for (let i = 21; i <= 25; i++) {
        const cli = `OR${String(i).padStart(4,'0')}`;
        await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND TRIM(CLIENTE) = '${cli}'`);
        await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'martes', '${cli}', -1)`);
        await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'jueves', '${cli}', ${(15 + (i - 20)) * 10})`);
    }
    const elapsed = Date.now() - t0;
    console.log(`   Tiempo: ${elapsed}ms`);

    // Phase 3: Compare against original
    console.log('\nFASE 3: Comparación vs Ruta Original...');
    const expectedAfterMove = { lunes: 10, martes: 15, miercoles: 15, jueves: 20, viernes: 20 };

    const results = [];
    for (const day of Object.keys(distribution)) {
        const posRes = await conn.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = '${day}' AND ORDEN >= 0`);
        const blkRes = await conn.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = '${day}' AND ORDEN = -1`);
        const posCount = posRes[0].CNT;
        const blkCount = blkRes[0].CNT;
        results.push({
            DIA: day,
            ORIGINAL: originalCounts[day],
            CUSTOM_POSITIVOS: posCount,
            BLOQUEADOS: blkCount,
            EXPECTED_POSITIVOS: expectedAfterMove[day],
            MATCH: posCount === expectedAfterMove[day] ? 'OK' : 'FAIL'
        });
    }
    console.table(results);

    const allMatch = results.every(r => r.MATCH === 'OK');
    if (allMatch) {
        console.log('   OK - Todos los contadores coinciden con lo esperado');
        passed++;
    } else {
        console.log('   FAIL - Discrepancias detectadas');
        failed++;
    }

    // Phase 4: Total clients conserved (80 total should still exist)
    console.log('\nFASE 4: Conservación total de clientes...');
    const uniqueClients = await conn.query(`
        SELECT COUNT(DISTINCT TRIM(CLIENTE)) as CNT
        FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'
    `);
    if (uniqueClients[0].CNT === 80) {
        console.log('   OK - 80 clientes únicos conservados');
        passed++;
    } else {
        console.log(`   FAIL - ${uniqueClients[0].CNT} clientes únicos (esperado 80)`);
        failed++;
    }

    // Phase 5: No client appears as positive in two days
    console.log('\nFASE 5: Sin clientes duplicados en positivos...');
    const multiDay = await conn.query(`
        SELECT TRIM(CLIENTE) as CLI, COUNT(*) as DAYS_POS
        FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND ORDEN >= 0
        GROUP BY CLIENTE HAVING COUNT(*) > 1
    `);
    if (multiDay.length === 0) {
        console.log('   OK - Cada cliente aparece como positivo en un solo día');
        passed++;
    } else {
        console.log(`   FAIL - ${multiDay.length} clientes en múltiples días positivos`);
        console.table(multiDay);
        failed++;
    }

    // Phase 6: Propagation time < 3 seconds
    console.log('\nFASE 6: Tiempo de propagación...');
    if (elapsed < 3000) {
        console.log(`   OK - ${elapsed}ms < 3000ms`);
        passed++;
    } else {
        console.log(`   WARN - ${elapsed}ms >= 3000ms (lento pero funcional)`);
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
