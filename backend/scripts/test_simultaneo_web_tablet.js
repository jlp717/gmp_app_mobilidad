/**
 * TEST MASIVO: Operaciones Simultáneas Web + Tablet
 * Simula operaciones concurrentes desde dos "dispositivos" usando conexiones paralelas.
 * Verifica que no hay corrupción de datos ni duplicados.
 */
const { getPool, initDb } = require('../config/db');

const VENDOR = 'TEST99';

async function main() {
    console.log('=== TEST MASIVO: OPERACIONES SIMULTÁNEAS WEB + TABLET ===\n');
    await initDb();
    const pool = getPool();
    let passed = 0, failed = 0;

    // Cleanup
    const c0 = await pool.connect();
    await c0.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'`);
    await c0.close();

    // Setup: create initial data
    console.log('SETUP: Crear 50 clientes distribuidos...');
    const setup = await pool.connect();
    for (let i = 1; i <= 25; i++) {
        await setup.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'lunes', 'SIM${String(i).padStart(4,'0')}', ${i * 10})`);
    }
    for (let i = 26; i <= 50; i++) {
        await setup.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'martes', 'SIM${String(i).padStart(4,'0')}', ${(i - 25) * 10})`);
    }
    await setup.close();
    console.log('   OK - 25 en lunes, 25 en martes');
    passed++;

    // Phase 1: Concurrent operations
    console.log('\nFASE 1: Operaciones concurrentes...');
    console.log('   Web: mueve SIM0001-SIM0005 de lunes a miércoles');
    console.log('   Tablet: mueve SIM0026-SIM0030 de martes a jueves');

    const t0 = Date.now();

    // Simulate web and tablet working in parallel
    const webOp = (async () => {
        const webConn = await pool.connect();
        for (let i = 1; i <= 5; i++) {
            const cli = `SIM${String(i).padStart(4,'0')}`;
            await webConn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND TRIM(CLIENTE) = '${cli}'`);
            await webConn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'lunes', '${cli}', -1)`);
            await webConn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'miercoles', '${cli}', ${i * 10})`);
        }
        await webConn.close();
        return 'web OK';
    })();

    const tabletOp = (async () => {
        const tabConn = await pool.connect();
        for (let i = 26; i <= 30; i++) {
            const cli = `SIM${String(i).padStart(4,'0')}`;
            await tabConn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND TRIM(CLIENTE) = '${cli}'`);
            await tabConn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'martes', '${cli}', -1)`);
            await tabConn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'jueves', '${cli}', ${(i - 25) * 10})`);
        }
        await tabConn.close();
        return 'tablet OK';
    })();

    const results = await Promise.all([webOp, tabletOp]);
    const elapsed1 = Date.now() - t0;
    console.log(`   Completado en ${elapsed1}ms: ${results.join(', ')}`);
    passed++;

    // Phase 2: Verify no data corruption
    console.log('\nFASE 2: Verificar integridad post-concurrencia...');
    const verify = await pool.connect();

    // Check counts per day
    const counts = await verify.query(`
        SELECT TRIM(DIA) as DIA,
               SUM(CASE WHEN ORDEN >= 0 THEN 1 ELSE 0 END) as POS,
               SUM(CASE WHEN ORDEN = -1 THEN 1 ELSE 0 END) as BLK
        FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'
        GROUP BY DIA ORDER BY DIA
    `);
    console.table(counts);

    const lunesC = counts.find(c => c.DIA === 'lunes');
    const martesC = counts.find(c => c.DIA === 'martes');
    const miercolesC = counts.find(c => c.DIA === 'miercoles');
    const juevesC = counts.find(c => c.DIA === 'jueves');

    // Expected: lunes 20pos+5blk, martes 20pos+5blk, miercoles 5pos, jueves 5pos
    if (lunesC?.POS === 20 && lunesC?.BLK === 5 &&
        martesC?.POS === 20 && martesC?.BLK === 5 &&
        miercolesC?.POS === 5 && juevesC?.POS === 5) {
        console.log('   OK - Contadores correctos tras operaciones concurrentes');
        passed++;
    } else {
        console.log('   FAIL - Contadores incorrectos');
        failed++;
    }

    // Phase 3: No duplicates
    console.log('\nFASE 3: Sin duplicados...');
    const dups = await verify.query(`
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

    // Phase 4: Second round of concurrent ops (more aggressive)
    console.log('\nFASE 4: Segunda ronda concurrente (20 operaciones cada una)...');
    const t1 = Date.now();

    const webOp2 = (async () => {
        const c = await pool.connect();
        // Reorder lunes completely
        await c.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = 'lunes' AND ORDEN >= 0`);
        for (let i = 25; i >= 6; i--) { // reverse order of all 20 remaining on lunes
            const cli = `SIM${String(i).padStart(4,'0')}`;
            await c.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'lunes', '${cli}', ${(26 - i) * 10})`);
        }
        await c.close();
    })();

    const tabletOp2 = (async () => {
        const c = await pool.connect();
        // Reorder martes completely
        await c.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND DIA = 'martes' AND ORDEN >= 0`);
        for (let i = 50; i >= 31; i--) {
            const cli = `SIM${String(i).padStart(4,'0')}`;
            await c.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'martes', '${cli}', ${(51 - i) * 10})`);
        }
        await c.close();
    })();

    await Promise.all([webOp2, tabletOp2]);
    const elapsed2 = Date.now() - t1;
    console.log(`   Tiempo: ${elapsed2}ms`);

    // Verify second round
    const counts2 = await verify.query(`
        SELECT TRIM(DIA) as DIA,
               SUM(CASE WHEN ORDEN >= 0 THEN 1 ELSE 0 END) as POS,
               SUM(CASE WHEN ORDEN = -1 THEN 1 ELSE 0 END) as BLK
        FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'
        GROUP BY DIA ORDER BY DIA
    `);
    console.table(counts2);

    const lunesC2 = counts2.find(c => c.DIA === 'lunes');
    const martesC2 = counts2.find(c => c.DIA === 'martes');
    // Lunes: 20 (reversed from pos 6-25) + 5 blocks, martes: 20 (reversed 31-50) + 5 blocks
    if (lunesC2?.POS === 20 && martesC2?.POS === 20) {
        console.log('   OK - Segunda ronda concurrente correcta');
        passed++;
    } else {
        console.log(`   FAIL - lunes:${lunesC2?.POS}, martes:${martesC2?.POS}`);
        failed++;
    }

    // Phase 5: Total unique clients
    console.log('\nFASE 5: Clientes únicos preservados...');
    const unique = await verify.query(`SELECT COUNT(DISTINCT TRIM(CLIENTE)) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'`);
    if (unique[0].CNT === 50) {
        console.log('   OK - 50 clientes únicos preservados');
        passed++;
    } else {
        console.log(`   FAIL - ${unique[0].CNT} únicos (esperado 50)`);
        failed++;
    }

    // Cleanup
    await verify.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'`);
    await verify.close();

    console.log(`\n=== RESULTADO: ${passed}/${passed + failed} tests passed ===`);
    if (failed > 0) console.log('FAIL');
    else console.log('ALL PASSED');
    process.exit(failed > 0 ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
